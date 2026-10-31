import importlib.util
from pathlib import Path

from fastapi.testclient import TestClient

spec = importlib.util.spec_from_file_location("decision_api_app", Path(__file__).with_name("app.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def auth_as(monkeypatch, tenant="tenant-a", role="MANAGER", user="user-a"):
    monkeypatch.setitem(module.app.dependency_overrides, module.actor, lambda: {"tenantId": tenant, "role": role, "userId": user})


def valid_payload(**extra):
    return {"scenarios": [{"key": "A", "name": "A"}, {"key": "B", "name": "B"}], **extra}


def test_viewer_cannot_simulate_or_save(monkeypatch):
    auth_as(monkeypatch, role="VIEWER")
    client = TestClient(module.app)
    assert client.post("/decisions/simulate", json=valid_payload(), headers={"Authorization": "Bearer test"}).status_code == 403
    assert client.post("/decisions/scenarios", json=valid_payload(name="Scenario"), headers={"Authorization": "Bearer test"}).status_code == 403
    module.app.dependency_overrides.clear()


def test_service_identity_cannot_use_decision_routes(monkeypatch):
    auth_as(monkeypatch, role="SERVICE")
    response = TestClient(module.app).get("/decisions/context", headers={"Authorization": "Bearer service"})
    module.app.dependency_overrides.clear()
    assert response.status_code == 403


def test_service_identity_can_read_only_owner_or_shared_scenario_summaries(monkeypatch):
    auth_as(monkeypatch, tenant="tenant-a", role="SERVICE", user="manager-a")
    rows = [
        {"id": "owner-private", "visibility": "private", "createdBy": "manager-a", "reviewStatus": "PENDING_REVIEW", "result": {"sensitive": True}},
        {"id": "other-private", "visibility": "private", "createdBy": "manager-b", "reviewStatus": "PENDING_REVIEW"},
        {"id": "shared", "visibility": "tenant", "createdBy": "manager-b", "reviewStatus": "PENDING_REVIEW"},
    ]

    class TenantTable:
        def query(self, **kwargs):
            partition_condition = kwargs["KeyConditionExpression"].get_expression()["values"][0]
            assert partition_condition.get_expression()["values"][1] == "TENANT#tenant-a"
            return {"Items": rows}

    monkeypatch.setattr(module, "table", TenantTable())
    response = TestClient(module.app).get("/decisions/scenarios?reviewStatus=PENDING_REVIEW")
    module.app.dependency_overrides.clear()
    result = response.json()["items"]
    assert {item["id"] for item in result} == {"owner-private", "shared"}
    assert all("result" not in item for item in result)


def test_simulation_rejects_project_outside_authorized_tenant(monkeypatch):
    auth_as(monkeypatch)
    monkeypatch.setattr(module, "_collect_decision_data", lambda authorization, tenant: {"projects": [{"id": f"{tenant}-project"}], "portfolios": [], "truncated": []})
    response = TestClient(module.app).post(
        "/decisions/simulate",
        json=valid_payload(scope={"projectId": "tenant-b-project"}),
        headers={"Authorization": "Bearer tenant-a"},
    )
    module.app.dependency_overrides.clear()
    assert response.status_code == 404


def test_saved_scenario_is_tenant_scoped_and_audited(monkeypatch):
    auth_as(monkeypatch, tenant="tenant-a", user="manager-1")
    monkeypatch.setattr(module, "_collect_decision_data", lambda authorization, tenant: {"projects": [], "portfolios": [], "budgets": [], "priorities": [], "resources": [], "assignments": [], "truncated": []})
    written = []

    class TenantTable:
        def put_item(self, **kwargs):
            written.append(kwargs)
            return {}

    monkeypatch.setattr(module, "table", TenantTable())
    response = TestClient(module.app).post("/decisions/scenarios", json=valid_payload(name="Escenario compartido", visibility="tenant"), headers={"Authorization": "Bearer tenant-a"})
    module.app.dependency_overrides.clear()
    assert response.status_code == 201
    record = written[0]["Item"]
    assert record["pk"] == "TENANT#tenant-a"
    assert record["createdBy"] == "manager-1"
    assert record["visibility"] == "tenant"
    assert record["reviewStatus"] == "PENDING_REVIEW"


def test_viewer_list_and_detail_only_show_shared_same_tenant_scenarios(monkeypatch):
    auth_as(monkeypatch, tenant="tenant-a", role="VIEWER", user="viewer-a")
    rows = [
        {"id": "private", "visibility": "private", "pk": "TENANT#tenant-a"},
        {"id": "shared", "visibility": "tenant", "pk": "TENANT#tenant-a"},
    ]

    class TenantTable:
        def query(self, **kwargs):
            partition_condition = kwargs["KeyConditionExpression"].get_expression()["values"][0]
            assert partition_condition.get_expression()["values"][1] == "TENANT#tenant-a"
            return {"Items": rows}

        def get_item(self, Key):
            assert Key["pk"] == "TENANT#tenant-a"
            return {"Item": next((row for row in rows if row["id"] == Key["sk"].replace("DECISION#", "")), None)}

    monkeypatch.setattr(module, "table", TenantTable())
    client = TestClient(module.app)
    response = client.get("/decisions/scenarios")
    hidden = client.get("/decisions/scenarios/private")
    shared = client.get("/decisions/scenarios/shared")
    module.app.dependency_overrides.clear()
    assert [row["id"] for row in response.json()["items"]] == ["shared"]
    assert hidden.status_code == 404
    assert shared.status_code == 200
