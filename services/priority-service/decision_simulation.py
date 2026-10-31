"""Deterministic, read-only Decision Lab calculations."""

from __future__ import annotations

from copy import deepcopy
from datetime import date
from math import isfinite
from typing import Any

DEFAULT_WEIGHTS = {"impact": 0.35, "urgency": 0.25, "alignment": 0.25, "risk": 0.15}


def _metric(value: Any, unit: str, reason: str | None = None) -> dict[str, Any]:
    result = {"status": "CALCULATED", "value": value, "unit": unit}
    if reason:
        result["reason"] = reason
    return result


def _not_calculable(reason: str, unit: str = "") -> dict[str, Any]:
    return {"status": "NOT_CALCULABLE", "value": None, "unit": unit, "reason": reason}


def _finite_number(value: Any) -> float | None:
    try:
        number = float(value)
        return number if isfinite(number) else None
    except (TypeError, ValueError):
        return None


def _project_scope(data: dict[str, Any], scope: dict[str, Any]) -> list[dict[str, Any]]:
    projects = data.get("projects", [])
    project_id = scope.get("projectId")
    portfolio_id = scope.get("portfolioId")
    if project_id:
        return [row for row in projects if str(row.get("id") or row.get("projectId")) == str(project_id)]
    if portfolio_id:
        return [row for row in projects if str(row.get("portfolioId")) == str(portfolio_id)]
    return list(projects)


def _priority_scores(projects: list[dict[str, Any]], priorities: list[dict[str, Any]], weights: dict[str, float]) -> dict[str, float | None]:
    by_project = {str(row.get("projectId") or row.get("id")): row for row in priorities if row.get("projectId") or row.get("id")}
    scores: dict[str, float | None] = {}
    for project in projects:
        ident = str(project.get("id") or project.get("projectId") or "")
        row = by_project.get(ident)
        if not row or row.get("criteria"):
            scores[ident] = None
            continue
        values = {key: _finite_number(row.get(key)) for key in ("impact", "urgency", "alignment", "risk")}
        if any(value is None or value < 0 or value > 100 for value in values.values()):
            scores[ident] = None
            continue
        scores[ident] = round(
            values["impact"] * weights["impact"]
            + values["urgency"] * weights["urgency"]
            + values["alignment"] * weights["alignment"]
            + (100 - values["risk"]) * weights["risk"],
            2,
        )
    return scores


def _costs_by_project(projects: list[dict[str, Any]], budgets: list[dict[str, Any]], currency: str | None) -> dict[str, float | None]:
    project_ids = {str(row.get("id") or row.get("projectId")) for row in projects if row.get("id") or row.get("projectId")}
    costs: dict[str, float | None] = {ident: None for ident in project_ids}
    for budget in budgets:
        ident = str(budget.get("projectId") or "")
        if ident not in project_ids or (currency and str(budget.get("currency") or "").upper() != currency.upper()):
            continue
        amount = _finite_number(budget.get("allocated"))
        if amount is None or amount < 0:
            continue
        costs[ident] = (costs[ident] or 0.0) + amount
    return costs


def _validate_weights(value: Any) -> dict[str, float]:
    if value is None:
        return dict(DEFAULT_WEIGHTS)
    if not isinstance(value, dict) or set(value) != set(DEFAULT_WEIGHTS):
        raise ValueError("priorityWeights must contain impact, urgency, alignment and risk")
    weights = {key: _finite_number(raw) for key, raw in value.items()}
    if any(weight is None or weight < 0 or weight > 1 for weight in weights.values()):
        raise ValueError("Priority weights must be between 0 and 1")
    if abs(sum(weights.values()) - 1) > 0.001:
        raise ValueError("Priority weights must sum to 1")
    return {key: float(weight) for key, weight in weights.items()}


def _validate_dates(date_overrides: Any, project_ids: set[str]) -> dict[str, dict[str, str]]:
    if date_overrides is None:
        return {}
    if not isinstance(date_overrides, dict):
        raise ValueError("dateOverrides must be an object keyed by project ID")
    result: dict[str, dict[str, str]] = {}
    for ident, values in date_overrides.items():
        if ident not in project_ids:
            raise ValueError(f"Date override project {ident} is outside the selected tenant scope")
        if not isinstance(values, dict) or not values or set(values) - {"startDate", "endDate"}:
            raise ValueError("Each date override may contain startDate and/or endDate")
        parsed: dict[str, str] = {}
        for field, raw in values.items():
            try:
                parsed[field] = date.fromisoformat(str(raw)).isoformat()
            except (TypeError, ValueError) as error:
                raise ValueError(f"{field} must be an ISO date") from error
        result[ident] = parsed
    return result


def evaluate_scenario(data: dict[str, Any], variables: dict[str, Any] | None = None, scope: dict[str, Any] | None = None) -> dict[str, Any]:
    """Evaluate one hypothetical scenario without modifying the supplied source data."""
    source = deepcopy(data)
    variables = deepcopy(variables or {})
    scope = scope or {}
    projects = _project_scope(source, scope)
    project_ids = {str(row.get("id") or row.get("projectId")) for row in projects if row.get("id") or row.get("projectId")}
    weights = _validate_weights(variables.get("priorityWeights"))
    dates = _validate_dates(variables.get("dateOverrides"), project_ids)

    relevant_budgets = [row for row in source.get("budgets", []) if str(row.get("projectId") or "") in project_ids]
    currencies = sorted({str(row.get("currency")).upper() for row in relevant_budgets if row.get("currency")})
    requested_currency = variables.get("currency")
    currency = str(requested_currency).upper() if requested_currency else (currencies[0] if len(currencies) == 1 else None)
    currency_rows = [row for row in relevant_budgets if currency and str(row.get("currency") or "").upper() == currency]
    source_available: float | None = None
    if currency_rows:
        balances = []
        for row in currency_rows:
            allocated = _finite_number(row.get("allocated"))
            spent = _finite_number(row.get("spent", 0))
            if allocated is None or spent is None:
                balances = []
                break
            balances.append(allocated - spent)
        if balances:
            source_available = round(sum(max(value, 0) for value in balances), 2)
    if source_available is not None:
        available_metric = _metric(source_available, currency or "")
    elif not relevant_budgets:
        available_metric = _not_calculable("No hay presupuestos asociados a los proyectos del alcance.")
    elif not currency:
        available_metric = _not_calculable("Hay varias monedas; elige una para evitar sumarlas entre sí.")
    else:
        available_metric = _not_calculable("Faltan montos o moneda suficientes en los presupuestos.", currency)

    budget_limit = _finite_number(variables.get("budgetLimit")) if variables.get("budgetLimit") is not None else source_available
    if budget_limit is not None and budget_limit < 0:
        raise ValueError("budgetLimit cannot be negative")
    limit_metric = _metric(round(budget_limit, 2), currency or "") if budget_limit is not None and currency else _not_calculable("Define una moneda y un límite presupuestario verificable.")

    costs = _costs_by_project(projects, relevant_budgets, currency)
    known_costs = [value for value in costs.values() if value is not None]
    planned_cost_metric = _metric(round(sum(known_costs), 2), currency or "") if known_costs else _not_calculable("No hay presupuestos con proyecto y moneda verificables.")

    scores = _priority_scores(projects, source.get("priorities", []), weights)
    priority_ids = [ident for ident in project_ids if scores.get(ident) is not None]
    priority_metric = _metric(len(priority_ids), "proyectos") if priority_ids else _not_calculable("No hay evaluaciones con los cuatro criterios necesarios.")

    fundable: list[str] = []
    remaining = budget_limit
    if remaining is not None and currency:
        ordered = sorted(project_ids, key=lambda ident: (-(scores.get(ident) if scores.get(ident) is not None else -1), ident))
        for ident in ordered:
            cost = costs.get(ident)
            if cost is None or remaining is None:
                continue
            if cost <= remaining:
                fundable.append(ident)
                remaining = round(remaining - cost, 2)
        funding_metric = _metric(fundable, "projectIds", "Selección codiciosa por prioridad descendente y luego ID; no implica aprobación.")
    else:
        funding_metric = _not_calculable("Faltan límite o moneda compatibles para comparar costos.", "projectIds")

    assignments = list(source.get("assignments", []))
    resources_by_id = {str(row.get("id")): row for row in source.get("resources", []) if row.get("id")}
    overrides = variables.get("resourceReassignments", []) or []
    if not isinstance(overrides, list):
        raise ValueError("resourceReassignments must be an array")
    override_map: dict[tuple[str, str], float] = {}
    for item in overrides:
        resource_id, project_id = str(item.get("resourceId", "")), str(item.get("projectId", ""))
        allocation = _finite_number(item.get("allocation"))
        if resource_id not in resources_by_id or project_id not in project_ids:
            raise ValueError("Resource reassignment must reference a tenant resource and a project in scope")
        if allocation is None or allocation < 0 or allocation > 1:
            raise ValueError("Scenario allocation must be between 0 and 1")
        override_map[(resource_id, project_id)] = allocation
    current_by_resource: dict[str, float] = {}
    simulated_by_resource: dict[str, float] = {}
    for row in assignments:
        resource_id, project_id = str(row.get("resourceId", "")), str(row.get("projectId", ""))
        allocation = _finite_number(row.get("allocation"))
        if resource_id not in resources_by_id or allocation is None:
            continue
        current_by_resource[resource_id] = current_by_resource.get(resource_id, 0.0) + allocation
        simulated = override_map.get((resource_id, project_id), allocation)
        simulated_by_resource[resource_id] = simulated_by_resource.get(resource_id, 0.0) + simulated
    existing_pairs = {(str(row.get("resourceId", "")), str(row.get("projectId", ""))) for row in assignments}
    for (resource_id, project_id), allocation in override_map.items():
        if (resource_id, project_id) not in existing_pairs:
            simulated_by_resource[resource_id] = simulated_by_resource.get(resource_id, 0.0) + allocation
    # Current registered allocation is a valid fallback when no assignment rows are available.
    for ident, resource in resources_by_id.items():
        if ident not in current_by_resource:
            allocated = _finite_number(resource.get("allocated"))
            if allocated is not None:
                current_by_resource[ident] = allocated
                simulated_by_resource[ident] = allocated
    resource_rows = []
    capacity_values: list[bool] = []
    for ident, resource in resources_by_id.items():
        capacity = _finite_number(resource.get("capacity"))
        current = current_by_resource.get(ident)
        simulated = simulated_by_resource.get(ident)
        if capacity is not None and current is not None and simulated is not None:
            over = simulated > capacity
            capacity_values.append(over)
            resource_rows.append({"resourceId": ident, "name": resource.get("name"), "capacity": capacity, "currentAllocation": round(current, 4), "scenarioAllocation": round(simulated, 4), "overCapacity": over})
        else:
            resource_rows.append({"resourceId": ident, "name": resource.get("name"), "status": "NOT_CALCULABLE", "reason": "Falta capacidad o asignación registrada."})
    capacity_metric = _metric(sum(capacity_values), "recursos") if capacity_values else _not_calculable("No hay capacidades y asignaciones suficientes para comparar.")

    output_projects = []
    constraints = []
    for project in projects:
        ident = str(project.get("id") or project.get("projectId") or "")
        cost = costs.get(ident)
        score_value = scores.get(ident)
        start_date = project.get("startDate")
        end_date = project.get("endDate")
        changed_dates = dates.get(ident, {})
        effective_start = changed_dates.get("startDate", start_date)
        effective_end = changed_dates.get("endDate", end_date)
        date_constraint = bool(effective_start and effective_end and effective_end < effective_start)
        if date_constraint:
            constraints.append({"code": "DATE_RANGE_INVALID", "projectId": ident, "evidence": {"startDate": effective_start, "endDate": effective_end}})
        output_projects.append({
            "projectId": ident,
            "name": project.get("name"),
            "plannedCost": _metric(round(cost, 2), currency or "") if cost is not None else _not_calculable("Falta un presupuesto asociado en la moneda elegida.", currency or ""),
            "priorityScore": _metric(score_value, "score/100", "Fórmula lineal explicada por las ponderaciones del escenario.") if score_value is not None else _not_calculable("Falta una evaluación completa de prioridad."),
            "dates": {"base": {"startDate": start_date, "endDate": end_date}, "scenario": {"startDate": effective_start, "endDate": effective_end}},
            "fundable": ident in fundable if funding_metric["status"] == "CALCULATED" and cost is not None else None,
        })
    if budget_limit is not None and planned_cost_metric["status"] == "CALCULATED" and planned_cost_metric["value"] > budget_limit:
        constraints.append({"code": "BUDGET_LIMIT_EXCEEDED", "evidence": {"plannedCost": planned_cost_metric["value"], "budgetLimit": round(budget_limit, 2), "currency": currency}})
    for resource in resource_rows:
        if resource.get("overCapacity"):
            constraints.append({"code": "RESOURCE_OVER_CAPACITY", "resourceId": resource["resourceId"], "evidence": {"capacity": resource["capacity"], "scenarioAllocation": resource["scenarioAllocation"]}})

    warnings = []
    if costs and any(value is None for value in costs.values()):
        warnings.append({"code": "PROJECT_COSTS_INCOMPLETE", "message": "Uno o más proyectos no tienen costo calculable; se excluyen de la selección de financiamiento."})
    if any(row.get("criteria") for row in source.get("priorities", [])):
        warnings.append({"code": "CUSTOM_PRIORITY_CRITERIA", "message": "Custom priority criteria are incompatible with the standard scenario weights; those scores are not calculable."})
    if source.get("truncated"):
        warnings.append({"code": "SOURCE_TRUNCATED", "message": "Una o más consultas alcanzaron el límite de paginación; los resultados pueden ser parciales."})
    if any(date_row.get("startDate") or date_row.get("endDate") for date_row in dates.values()):
        warnings.append({"code": "DATES_ARE_HYPOTHETICAL", "message": "Las fechas simuladas se muestran como cambios planificados; no predicen retrasos ni duración."})

    return {
        "metrics": {
            "budgetAvailable": available_metric,
            "budgetLimit": limit_metric,
            "plannedCost": planned_cost_metric,
            "projectsFundable": funding_metric,
            "prioritizedProjects": priority_metric,
            "resourcesOverCapacity": capacity_metric,
        },
        "projects": output_projects,
        "resources": resource_rows,
        "constraints": constraints,
        "warnings": warnings,
        "assumptions": [
            "El costo planificado es la suma de allocated por proyecto y moneda; no es una estimación de gasto futuro.",
            "La selección de financiamiento ordena por prioridad descendente y desempata por ID de proyecto.",
            "Reasignar capacidad no se interpreta como aceleración ni como cambio de fechas.",
        ],
        "priorityWeights": weights,
        "currency": currency,
        "sourceAt": data.get("fetchedAt"),
        "sourceCompleteness": "PARTIAL" if data.get("truncated") else "COMPLETE",
    }


def compare_scenarios(data: dict[str, Any], scenarios: list[dict[str, Any]], scope: dict[str, Any] | None = None) -> dict[str, Any]:
    if len(scenarios) != 2 or {row.get("key") for row in scenarios} != {"A", "B"}:
        raise ValueError("Exactly scenarios A and B are required")
    base = evaluate_scenario(data, {}, scope)
    results = {"BASE": {"key": "BASE", "name": "Base", **base}}
    for scenario in scenarios:
        results[scenario["key"]] = {"key": scenario["key"], "name": scenario.get("name") or f"Escenario {scenario['key']}", **evaluate_scenario(data, scenario.get("variables"), scope)}
    comparison = {}
    for key in ("budgetAvailable", "budgetLimit", "plannedCost", "prioritizedProjects", "resourcesOverCapacity"):
        values = {name: results[name]["metrics"][key] for name in ("BASE", "A", "B")}
        numbers = {name: value.get("value") for name, value in values.items() if value.get("status") == "CALCULATED" and isinstance(value.get("value"), (int, float))}
        deltas = {name: round(value - numbers["BASE"], 2) for name, value in numbers.items() if name != "BASE"} if "BASE" in numbers else {}
        comparison[key] = {"values": values, "deltaFromBase": deltas or None}
    return {"scope": scope or {}, "scenarios": results, "comparison": comparison, "sourceAt": data.get("fetchedAt"), "sourceCompleteness": "PARTIAL" if data.get("truncated") else "COMPLETE"}
