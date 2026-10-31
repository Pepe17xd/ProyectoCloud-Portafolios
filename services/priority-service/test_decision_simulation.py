from copy import deepcopy

import pytest

from decision_simulation import compare_scenarios, evaluate_scenario


@pytest.fixture
def source():
    return {
        "fetchedAt": "2026-10-31T12:00:00+00:00",
        "projects": [
            {"id": "p1", "name": "Proyecto A", "portfolioId": "pf1", "startDate": "2026-01-01", "endDate": "2026-12-01"},
            {"id": "p2", "name": "Proyecto B", "portfolioId": "pf1", "startDate": "2026-02-01", "endDate": "2026-12-15"},
        ],
        "portfolios": [{"id": "pf1", "name": "Portafolio"}],
        "budgets": [
            {"projectId": "p1", "allocated": 100, "spent": 25, "currency": "USD"},
            {"projectId": "p2", "allocated": 60, "spent": 10, "currency": "USD"},
        ],
        "priorities": [
            {"projectId": "p1", "impact": 90, "urgency": 70, "alignment": 80, "risk": 20},
            {"projectId": "p2", "impact": 70, "urgency": 60, "alignment": 70, "risk": 40},
        ],
        "resources": [{"id": "r1", "name": "Recurso 1", "capacity": 1}],
        "assignments": [{"resourceId": "r1", "projectId": "p1", "allocation": 0.75}],
    }


def test_budget_and_priority_calculations_are_deterministic(source):
    first = evaluate_scenario(source)
    second = evaluate_scenario(source)
    assert first == second
    assert first["metrics"]["budgetAvailable"]["value"] == 125
    assert first["metrics"]["plannedCost"]["value"] == 160
    assert first["projects"][0]["priorityScore"]["value"] == 81


def test_funding_comparison_is_explainable_and_applies_budget_override(source):
    output = compare_scenarios(source, [
        {"key": "A", "name": "Presupuesto completo", "variables": {"budgetLimit": 125, "currency": "USD"}},
        {"key": "B", "name": "Presupuesto acotado", "variables": {"budgetLimit": 60, "currency": "USD"}},
    ])
    assert output["scenarios"]["A"]["metrics"]["projectsFundable"]["value"] == ["p1"]
    assert output["scenarios"]["B"]["metrics"]["projectsFundable"]["value"] == ["p2"]
    assert output["comparison"]["budgetLimit"]["deltaFromBase"] == {"A": 0, "B": -65}
    assert "no implica aprobación" in output["scenarios"]["A"]["metrics"]["projectsFundable"]["reason"]


def test_simulation_never_mutates_source_data(source):
    before = deepcopy(source)
    evaluate_scenario(source, {"dateOverrides": {"p1": {"endDate": "2027-01-15"}}})
    assert source == before


def test_missing_or_ambiguous_data_is_explicitly_not_calculable(source):
    source["budgets"][1]["currency"] = "PEN"
    result = evaluate_scenario(source)
    assert result["metrics"]["budgetAvailable"]["status"] == "NOT_CALCULABLE"
    assert result["metrics"]["projectsFundable"]["status"] == "NOT_CALCULABLE"
    empty = evaluate_scenario({"projects": [{"id": "p1"}]})
    assert empty["metrics"]["plannedCost"]["status"] == "NOT_CALCULABLE"
    assert empty["metrics"]["prioritizedProjects"]["status"] == "NOT_CALCULABLE"


def test_reassignment_only_reports_registered_capacity_constraints(source):
    move = {"resourceReassignments": [
        {"resourceId": "r1", "projectId": "p1", "allocation": 0},
        {"resourceId": "r1", "projectId": "p2", "allocation": 1},
    ]}
    result = evaluate_scenario(source, move)
    assert result["metrics"]["resourcesOverCapacity"]["value"] == 0
    result = evaluate_scenario(source, {"resourceReassignments": [
        {"resourceId": "r1", "projectId": "p1", "allocation": 1},
        {"resourceId": "r1", "projectId": "p2", "allocation": 1},
    ]})
    assert result["metrics"]["resourcesOverCapacity"]["value"] == 1
    assert any(row["code"] == "RESOURCE_OVER_CAPACITY" for row in result["constraints"])


def test_rejects_invalid_weights_dates_and_out_of_scope_references(source):
    with pytest.raises(ValueError, match="sum to 1"):
        evaluate_scenario(source, {"priorityWeights": {"impact": .5, "urgency": .2, "alignment": .2, "risk": .2}})
    with pytest.raises(ValueError, match="ISO date"):
        evaluate_scenario(source, {"dateOverrides": {"p1": {"endDate": "tomorrow"}}})
    with pytest.raises(ValueError, match="outside the selected tenant scope"):
        evaluate_scenario(source, {"dateOverrides": {"foreign": {"endDate": "2027-01-01"}}})


def test_date_change_does_not_claim_schedule_forecast(source):
    result = evaluate_scenario(source, {"dateOverrides": {"p1": {"endDate": "2027-01-15"}}})
    assert result["projects"][0]["dates"]["scenario"]["endDate"] == "2027-01-15"
    assert any(warning["code"] == "DATES_ARE_HYPOTHETICAL" for warning in result["warnings"])


def test_custom_priority_criteria_are_not_misrepresented_as_standard_weights(source):
    source["priorities"][0]["criteria"] = [{"name": "Strategic fit", "weight": 1, "score": 92}]
    result = evaluate_scenario(source)
    assert result["projects"][0]["priorityScore"]["status"] == "NOT_CALCULABLE"
    assert any(warning["code"] == "CUSTOM_PRIORITY_CRITERIA" for warning in result["warnings"])
