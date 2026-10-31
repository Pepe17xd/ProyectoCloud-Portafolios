# ProFiles Flow MVP

Identity owns the first Flow endpoint; no seventh microservice was introduced. The authenticated request is tenant-scoped from verified JWT claims. ADMIN/MANAGER can create and run flows; recipients are restricted to the initiating user until a tenant membership recipient lookup is implemented. Flow configuration, execution records, report snapshots and local delivery records are stored in the tenant partition of Identity's existing DynamoDB table. LangGraph executes monitor → planner → reporter; there is no LLM or process-memory checkpoint dependency.

## Local API

- `GET /flows`
- `POST /flows` with `{type, frequency, timezone, recipientUserId?, budgetThreshold?}`
- `PATCH /flows/{id}` with `{enabled}`
- `POST /flows/{id}/run`
- `GET /flows/{id}/runs`

Types: `weekly-summary`, `reminder`, `risk-alert`. Reports use authorized Project/Budget/Resource API calls and caller JWT forwarding. Due tasks and deterministic risk rules include evidence. Notification preview is confidential and directs the user to sign in; local delivery is labelled `SIMULATED`. WhatsApp provider is disabled and performs no network calls.

Run locally with the established stack (`npm run dev:local`) and sign in as a local ADMIN. The frontend dashboard exposes the Automations panel. `npm test` includes graph role, input, report and provider checks.

### Real local integration test

Start Docker Desktop manually when its daemon is available. In one PowerShell session set a throwaway key and start the local stack:

```powershell
$bytes = [byte[]]::new(32)
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$env:LOCAL_JWT_SECRET = [Convert]::ToBase64String($bytes)
npm run dev:local
```

In a second PowerShell session, set the *same* temporary key and run `npm run test:flow:integration`. The script logs into the two demo tenants, creates one overdue project and Flow per tenant, advances only those test flows to due in DynamoDB Local, races two one-shot scheduler processes, verifies tenant-scoped reports across Project, Portfolio, Resource, Budget and Priority APIs, checks the SERVICE read/write boundary, then replays after completion. It uses real local APIs and DynamoDB Local, not mocks, and fails if a service, table/index, permission, or API is unavailable. It conditionally creates missing demo identity rows and deletes only keys recorded as created by the test; it does not clear tables or volumes.

Verified on 2026-10-31 with Docker Desktop 29.7.2 / WSL2: two tenants each generated one successful report with one portfolio, project, resource, budget and priority; project overdue, budget threshold and resource capacity alerts were present; local delivery was `SIMULATED`; SERVICE cross-tenant read returned 404 and SERVICE write returned 403. Two concurrent dispatchers and a third replay process produced one execution/report/notification per scheduled window. The harness cleanup left all seven local DynamoDB tables at zero rows in its isolated test volume; the test containers and volumes were then removed without touching the pre-existing `cloudportfolio-local_*` volumes. Node 41/41, Python 18/18 and frontend build also passed in that run. This validates the local path only; AWS Lambda-to-Lambda IAM transport and AWS Academy permissions remain unverified.

## Limits before production

`npm run dev:local` generates a fresh local JWT signing key in process memory and starts `scripts/flow-scheduler.mjs` with the other local processes. The worker polls Identity's `FlowDueIndex` every 30 seconds and recovers overdue work after restart. Its service identity is tenant-bound, short-lived and limited to `domain:read`; Identity checks the flow owner's active profile and membership before execution. The worker uses scheduled-window idempotency keys, conditional claims, five-minute leases, three attempts with bounded backoff, and a maximum of ten due flows per poll. Missed windows are coalesced: each overdue automation runs once, then advances from its previous scheduled slot.

Resource capacity alerts require an `allocated` field that current resource records may not expose. Task/project associations are queried from the Project API. Destination user is the actor only. The AWS stack declares a sparse `FlowDueIndex`, but does not wire an EventBridge event to execute flows. Domain HTTP APIs currently require Cognito JWTs, and AWS does not accept the local service token; direct Lambda invocation with narrowly scoped IAM and trusted tenant context or a private IAM-authorized API contract still needs implementation. No public service-auth bypass was added. LangGraph has no persistent checkpoint/resume adapter; durable business execution/report records are separate. Serverless packaging, AWS Academy compatibility, artifact size and IAM/API permissions remain unverified. No provider sends external notifications.
