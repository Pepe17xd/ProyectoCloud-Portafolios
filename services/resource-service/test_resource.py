import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("resource_app", Path(__file__).with_name("app.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
ResourceIn, AssignmentIn = module.ResourceIn, module.AssignmentIn
import pytest
from pydantic import ValidationError


def test_resource_capacity_is_bounded():
    with pytest.raises(ValidationError):
        ResourceIn(name="A", capacity=1.2)


def test_assignment_allocation_is_positive_and_bounded():
    assert AssignmentIn(resourceId="r", projectId="p", allocation=0.5).allocation == 0.5
    with pytest.raises(ValidationError):
        AssignmentIn(resourceId="r", projectId="p", allocation=1.1)


def test_role_policy_denies_manager_delete_and_viewer_write():
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as manager_error:
        module.allowed({"role": "MANAGER"}, "DELETE")
    assert manager_error.value.status_code == 403
    with pytest.raises(HTTPException) as viewer_error:
        module.allowed({"role": "VIEWER"}, "POST")
    assert viewer_error.value.status_code == 403
    module.allowed({"role": "MANAGER"}, "PATCH")


def test_resource_lookup_is_scoped_to_authenticated_tenant(monkeypatch):
    from fastapi.testclient import TestClient

    requested = []

    class TenantTable:
        def get_item(self, Key):
            requested.append(Key)
            if Key == {"pk": "TENANT#tenant-a", "sk": "ITEM#resource-1"}:
                return {"Item": {**Key, "id": "resource-1", "name": "Private A"}}
            return {}

    monkeypatch.setattr(module, "table", TenantTable())
    module.app.dependency_overrides[module.actor] = lambda: {"tenantId": "tenant-b", "userId": "b", "role": "ADMIN"}
    try:
        response = TestClient(module.app).get("/resources/resource-1")
    finally:
        module.app.dependency_overrides.clear()
    assert response.status_code == 404
    assert requested == [{"pk": "TENANT#tenant-b", "sk": "ITEM#resource-1"}]


def test_local_cors_preflight_allows_frontend_origin():
    from fastapi.testclient import TestClient

    response = TestClient(module.app).options(
        "/resources",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization,content-type"},
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_assignment_transaction_reserves_capacity(monkeypatch):
    from types import SimpleNamespace

    from boto3.dynamodb.types import TypeDeserializer

    class TransactionTable:
        name = "resource-test"

        def __init__(self):
            self.resource = {"pk": "TENANT#t1", "sk": "ITEM#r1", "id": "r1", "entityType": "Resource", "capacity": 1, "allocated": 0.25, "remainingCapacity": 0.75}
            self.items = {("TENANT#t1", "ITEM#r1"): self.resource}
            self.transactions = []
            self.meta = SimpleNamespace(client=self)

        def get_item(self, Key):
            item = self.items.get((Key["pk"], Key["sk"]))
            return {"Item": item} if item else {}

        def transact_write_items(self, TransactItems):
            self.transactions.append(TransactItems)
            deserializer = TypeDeserializer()
            put = TransactItems[0]["Put"]
            item = {k: deserializer.deserialize(v) for k, v in put["Item"].items()}
            self.items[(item["pk"], item["sk"])] = item
            values = {k: deserializer.deserialize(v) for k, v in TransactItems[1]["Update"]["ExpressionAttributeValues"].items()}
            self.resource["allocated"] += float(values[":allocation"])
            self.resource["remainingCapacity"] -= float(values[":allocation"] )

    fake = TransactionTable()
    monkeypatch.setattr(module, "table", fake)
    monkeypatch.setattr(module, "assert_project_reference", lambda project_id, authorization: None)
    body = module.AssignmentIn(resourceId="r1", projectId="p1", allocation=0.5, idempotencyKey="request-0002")
    actor = {"tenantId": "t1", "userId": "u1", "role": "MANAGER"}
    module.assign(body, "Bearer local", actor)
    assert len(fake.transactions) == 1
    assert len(fake.transactions[0]) == 2
    assert fake.resource["allocated"] == 0.75
    assert fake.resource["remainingCapacity"] == 0.25
    assert "#remaining >= :allocation" in fake.transactions[0][1]["Update"]["ConditionExpression"]
