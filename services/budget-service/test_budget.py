import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("budget_app", Path(__file__).with_name("app.py"))
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


class FakeTable:
    def __init__(self):
        self.items = {}

    def put_item(self, Item, ConditionExpression=None):
        key = (Item["pk"], Item["sk"])
        if ConditionExpression and key in self.items:

            class Error(Exception):
                def __init__(self):
                    self.response = {"Error": {"Code": "ConditionalCheckFailedException"}}

            raise Error()
        self.items[key] = Item


def test_project_created_is_idempotent(monkeypatch):
    fake = FakeTable()
    monkeypatch.setattr(app, "table", fake)
    event = {
        "eventId": "e1",
        "eventType": "ProjectCreated",
        "tenantId": "t1",
        "entityId": "p1",
        "occurredAt": "2026-01-01T00:00:00Z",
    }
    app.consume_message(event)
    app.consume_message(event)
    assert len(fake.items) == 1
    assert next(iter(fake.items.values()))["projectId"] == "p1"


def test_sqs_partial_failures(monkeypatch):
    monkeypatch.setattr(
        app, "consume_message", lambda msg: (_ for _ in ()).throw(ValueError()) if msg.get("bad") else None
    )
    result = app.consume({"Records": [{"messageId": "ok", "body": "{}"}, {"messageId": "bad", "body": '{"bad":true}'}]})
    assert result == {"batchItemFailures": [{"itemIdentifier": "bad"}]}


def test_role_policy_denies_manager_delete_and_viewer_write():
    with pytest.raises(HTTPException) as manager_error:
        app.allowed({"role": "MANAGER"}, "DELETE")
    assert manager_error.value.status_code == 403
    with pytest.raises(HTTPException) as viewer_error:
        app.allowed({"role": "VIEWER"}, "POST")
    assert viewer_error.value.status_code == 403
    app.allowed({"role": "MANAGER"}, "PATCH")
import pytest
from fastapi import HTTPException


def test_budget_lookup_does_not_cross_tenant(monkeypatch):
    from fastapi.testclient import TestClient

    requested = []

    class TenantTable:
        def get_item(self, Key):
            requested.append(Key)
            if Key == {"pk": "TENANT#tenant-a", "sk": "ITEM#budget-1"}:
                return {"Item": {**Key, "id": "budget-1", "entityType": "Budget"}}
            return {}

    monkeypatch.setattr(app, "table", TenantTable())
    app.app.dependency_overrides[app.actor] = lambda: {"tenantId": "tenant-b", "userId": "b", "role": "ADMIN"}
    try:
        response = TestClient(app.app).get("/budgets/budget-1")
    finally:
        app.app.dependency_overrides.clear()
    assert response.status_code == 404
    assert requested == [{"pk": "TENANT#tenant-b", "sk": "ITEM#budget-1"}]


def test_local_cors_preflight_allows_frontend_origin():
    from fastapi.testclient import TestClient

    response = TestClient(app.app).options(
        "/budgets",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization,content-type"},
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_expense_updates_budget_atomically_and_is_idempotent(monkeypatch):
    from types import SimpleNamespace

    from boto3.dynamodb.types import TypeDeserializer

    class TransactionTable:
        name = "budget-test"

        def __init__(self):
            self.items = {
                ("TENANT#t1", "ITEM#b1"): {"pk": "TENANT#t1", "sk": "ITEM#b1", "id": "b1", "entityType": "Budget", "projectId": "p1", "allocated": 100, "spent": 0, "balance": 100}
            }
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
            update = TransactItems[1]["Update"]
            key = tuple(deserializer.deserialize(v) for v in update["Key"].values())
            budget = self.items[key]
            values = {k: deserializer.deserialize(v) for k, v in update["ExpressionAttributeValues"].items()}
            budget["spent"] += values[":amount"]
            budget["balance"] = budget["allocated"] - budget["spent"]
            self.items[(item["pk"], item["sk"])] = item

    fake = TransactionTable()
    monkeypatch.setattr(app, "table", fake)
    monkeypatch.setattr(app, "assert_project_reference", lambda project_id, authorization: None)
    body = app.ExpenseIn(budgetId="b1", projectId="p1", amount=10, description="travel", idempotencyKey="request-0001")
    actor = {"tenantId": "t1", "userId": "u1", "role": "MANAGER"}
    first = app.expense(body, "Bearer local", actor)
    second = app.expense(body, "Bearer local", actor)
    assert len(fake.transactions) == 1
    assert len(fake.transactions[0]) == 2
    assert fake.items[("TENANT#t1", "ITEM#b1")]["spent"] == 10
    assert first == second
