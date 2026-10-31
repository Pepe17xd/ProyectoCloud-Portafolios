# ProFiles Decision Lab

Decision Lab is a deterministic, read-only comparison capability in Priority Service. It reads tenant-scoped records from Portfolio, Project, Resource, Budget, and its own Priority table. Saved scenarios are separate `DecisionScenario` records in the Priority table and never update the source entities.

## Calculations and limits

- **Available budget** is the sum, for the selected scope and one currency, of `max(allocated - spent, 0)` for each budget record. When more than one currency exists, callers must choose one. This is a balance calculation, not a future spending estimate.
- **Planned cost** is the sum of the `allocated` amounts for projects with a matching budget and currency.
- **Fundable project selection** orders projects by the existing Priority formula and then project ID; it takes each project whose registered allocated cost fits the remaining limit. This is a deterministic greedy comparison, not an approval or an optimal portfolio solver. Projects with unknown cost are excluded and reported as such.
- **Priority score** uses `impact*wImpact + urgency*wUrgency + alignment*wAlignment + (100-risk)*wRisk`. Default weights are `0.35, 0.25, 0.25, 0.15`; custom weights must be between zero and one and sum to one.
- Assessments using custom named criteria rather than the standard four fields are reported as not calculable for scenario weighting; their values are not silently translated.
- **Resource load** sums registered assignment allocations per resource. A scenario can set a resource's allocation to zero on an origin project and set an allocation on a destination project. The result compares totals with recorded capacity. It does not infer task duration or delivery speed.
- **Dates** are displayed as hypothetical planned dates. The service identifies an invalid start/end range; it does not forecast delay or completion likelihood.
- Missing or ambiguous inputs return `NOT_CALCULABLE`; truncated owner-service pagination is surfaced as partial source completeness.

## API contract

All paths are under the Priority Service API. Cognito JWT authorization is required for user calls. The tenant comes from verified token claims and is used for every downstream owner-service query and every saved record key. `ADMIN` and `MANAGER` can simulate and save. `VIEWER` can list/open tenant-shared scenarios. A verified Flow `SERVICE` identity may only list summary fields for shared scenarios or scenarios created by its revalidated owner; it cannot simulate, save, open full reports, or discard scenarios.

### `GET /decisions/context`

Returns tenant projects, portfolios, resources, available budget currencies, role capabilities, and whether all domain source pages were read. If an owner API is not configured or returns an error, the request fails with `503`; source data is not fabricated.

### `POST /decisions/simulate`

Computes base/A/B without persistence. `scope` may contain `projectId`, `portfolioId`, or neither (all tenant projects). A project or portfolio outside the authenticated tenant returns `404`.

```json
{
  "scope": { "portfolioId": "portfolio-1" },
  "scenarios": [
    { "key": "A", "name": "Limit 120k", "variables": { "budgetLimit": 120000, "currency": "USD" } },
    { "key": "B", "name": "Limit 90k", "variables": { "budgetLimit": 90000, "currency": "USD" } }
  ]
}
```

`variables` supports `budgetLimit`, `currency`, `resourceReassignments`, `dateOverrides`, and `priorityWeights`. The response includes `scenarios.BASE`, `scenarios.A`, `scenarios.B`, per-project results, constraints, warnings, assumptions, source timestamp/completeness, and numeric deltas where applicable.

### Saved scenarios

- `POST /decisions/scenarios` accepts the simulation payload plus `name` and optional `visibility` (`private` by default, or `tenant`). Returns `201` with the saved calculated snapshot, creator, timestamp, and `reviewStatus: PENDING_REVIEW`.
- `GET /decisions/scenarios` lists up to 100 tenant records; `reviewStatus=PENDING_REVIEW` filters pending human review. Viewers see only `visibility=tenant` records.
- `GET /decisions/scenarios/{id}` opens a saved report. A foreign tenant ID is indistinguishable from a missing record (`404`).
- `DELETE /decisions/scenarios/{id}` discards a scenario. Managers may discard scenarios they created; admins may discard any tenant scenario.

No endpoint approves or applies a saved scenario. Flow reports may reference pending scenario IDs and names for human review only.

## AWS Academy configuration

Priority Service needs `PORTFOLIO_API_URL`, `PROJECT_API_URL`, `RESOURCE_API_URL`, and `BUDGET_API_URL`. Its owner-service queries forward the authenticated request token, so each owner service revalidates signature, role, and tenant. The Academy orchestrator resolves deployed API URLs from CloudFormation stack outputs, supplies them when deploying Priority, and updates Identity's runtime environment after domain services exist. It uses the existing stacks and does not add a Decision Lab microservice or data table.

The new Decision Lab routes retain the Cognito HTTP API authorizer. Priority's existing DynamoDB role already grants the per-table Get/Put/Delete/Query operations used by scenarios; no cross-service table access was added. Actual Academy role restrictions, API reachability, and service-to-service Cognito behavior still require validation in the lab account.
