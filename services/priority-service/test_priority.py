import importlib.util
from pathlib import Path

import pytest
from fastapi import HTTPException

spec = importlib.util.spec_from_file_location("priority_app", Path(__file__).with_name("app.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
Assessment, Criterion, score = module.Assessment, module.Criterion, module.score


def test_default_weighted_score():
    assert score(Assessment(projectId="p1", impact=100, urgency=100, risk=0, alignment=100)) == 100


def test_custom_criteria_sum_to_one():
    model = Assessment(
        projectId="p1",
        criteria=[Criterion(name="impact", weight=0.7, score=80), Criterion(name="risk", weight=0.3, score=40)],
    )
    assert score(model) == 68


def test_custom_criteria_reject_bad_weights():
    with pytest.raises(HTTPException):
        score(Assessment(projectId="p1", criteria=[Criterion(name="x", weight=0.5, score=50)]))


def test_role_policy_denies_manager_delete_and_viewer_write():
    with pytest.raises(HTTPException) as manager_error:
        module.allowed({"role": "MANAGER"}, "DELETE")
    assert manager_error.value.status_code == 403
    with pytest.raises(HTTPException) as viewer_error:
        module.allowed({"role": "VIEWER"}, "POST")
    assert viewer_error.value.status_code == 403
    module.allowed({"role": "MANAGER"}, "PATCH")


def test_priority_lookup_does_not_cross_tenant(monkeypatch):
    from fastapi.testclient import TestClient

    requested = []

    class TenantTable:
        def get_item(self, Key):
            requested.append(Key)
            if Key == {"pk": "TENANT#tenant-a", "sk": "ITEM#project-1"}:
                return {"Item": {**Key, "id": "project-1", "entityType": "Assessment"}}
            return {}

    monkeypatch.setattr(module, "table", TenantTable())
    module.app.dependency_overrides[module.actor] = lambda: {"tenantId": "tenant-b", "userId": "b", "role": "ADMIN"}
    try:
        response = TestClient(module.app).get("/priorities/project-1")
    finally:
        module.app.dependency_overrides.clear()
    assert response.status_code == 404
    assert requested == [{"pk": "TENANT#tenant-b", "sk": "ITEM#project-1"}]


def test_local_cors_preflight_allows_frontend_origin():
    from fastapi.testclient import TestClient

    response = TestClient(module.app).options(
        "/priorities",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization,content-type"},
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
