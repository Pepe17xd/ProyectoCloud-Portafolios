"""Weighted project scoring and tenant-scoped ranking API."""

import base64
import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from logging import getLogger
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

import boto3
import jwt
from boto3.dynamodb.conditions import Key
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from mangum import Mangum
from pydantic import BaseModel, ConfigDict, Field, model_validator
from starlette.middleware.cors import CORSMiddleware

from decision_simulation import compare_scenarios

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format='{"level":"%(levelname)s","message":"%(message)s"}')
logger = getLogger(__name__)
app = FastAPI(title="CloudPortfolio Priority Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv("CORS_ORIGIN", "http://localhost:5173").split(",") if origin.strip()],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
ddb = boto3.resource(
    "dynamodb",
    endpoint_url=os.getenv("DYNAMODB_ENDPOINT"),
    region_name=os.getenv("AWS_REGION", "us-east-1"),
    **({"aws_access_key_id": "local", "aws_secret_access_key": "local"} if os.getenv("DYNAMODB_ENDPOINT") and not os.getenv("AWS_LAMBDA_FUNCTION_NAME") else {}),
)
table = ddb.Table(os.getenv("TABLE_NAME", "cloudportfolio-priority-local"))
now = lambda: datetime.now(UTC).isoformat()


class Criterion(BaseModel):
    name: str = Field(min_length=1)
    weight: float = Field(ge=0, le=1)
    score: float = Field(ge=0, le=100)


class Assessment(BaseModel):
    projectId: str = Field(min_length=1)
    impact: float = Field(default=50, ge=0, le=100)
    urgency: float = Field(default=50, ge=0, le=100)
    risk: float = Field(default=50, ge=0, le=100)
    alignment: float = Field(default=50, ge=0, le=100)
    criteria: list[Criterion] = []


class DecisionScope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    projectId: str | None = None
    portfolioId: str | None = None

    @model_validator(mode="after")
    def one_scope_only(self):
        if self.projectId and self.portfolioId:
            raise ValueError("Choose either one project or one portfolio scope")
        return self


class ResourceReassignment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    resourceId: str = Field(min_length=1)
    projectId: str = Field(min_length=1)
    allocation: float = Field(ge=0, le=1)


class ProjectDateOverride(BaseModel):
    model_config = ConfigDict(extra="forbid")
    startDate: str | None = None
    endDate: str | None = None


class DecisionVariables(BaseModel):
    model_config = ConfigDict(extra="forbid")
    budgetLimit: float | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    resourceReassignments: list[ResourceReassignment] = Field(default_factory=list)
    dateOverrides: dict[str, ProjectDateOverride] = Field(default_factory=dict)
    priorityWeights: dict[str, float] | None = None


class DecisionScenarioInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str
    name: str = Field(min_length=1, max_length=80)
    variables: DecisionVariables = Field(default_factory=DecisionVariables)


class DecisionComparisonRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scope: DecisionScope = Field(default_factory=DecisionScope)
    scenarios: list[DecisionScenarioInput] = Field(min_length=2, max_length=2)

    @model_validator(mode="after")
    def require_a_and_b(self):
        if {scenario.key for scenario in self.scenarios} != {"A", "B"}:
            raise ValueError("Scenarios with keys A and B are required")
        return self


class SaveDecisionRequest(DecisionComparisonRequest):
    name: str = Field(min_length=1, max_length=100)
    visibility: str = Field(default="private", pattern="^(private|tenant)$")


def actor(authorization: str | None = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Bearer token required")
    try:
        token = authorization[7:]
        unverified = jwt.decode(token, options={"verify_signature": False})
        if unverified.get("iss") == "cloudportfolio-local":
            if os.getenv("AWS_LAMBDA_FUNCTION_NAME"):
                raise ValueError("Local tokens are not accepted in Lambda")
            c = jwt.decode(
                token,
                os.getenv("LOCAL_JWT_SECRET") or (_ for _ in ()).throw(ValueError("LOCAL_JWT_SECRET is required")),
                algorithms=["HS256"],
                issuer="cloudportfolio-local",
                options={"require": ["exp", "iat", "iss", "sub"]},
            )
        else:
            issuer = os.getenv("JWT_ISSUER", "")
            if not issuer:
                raise ValueError("JWT_ISSUER is not configured")
            client_id = os.getenv("COGNITO_CLIENT_ID")
            if not client_id:
                raise ValueError("COGNITO_CLIENT_ID is required")
            public_key = jwt.PyJWKClient(f"{issuer}/.well-known/jwks.json").get_signing_key_from_jwt(token).key
            c = jwt.decode(
                token,
                public_key,
                algorithms=["RS256"],
                issuer=issuer,
                audience=client_id,
                options={"require": ["exp", "iss", "sub", "aud", "token_use"]},
            )
            if c.get("token_use") != "id":
                raise ValueError("ID token required")
        tenant = c.get("tenantId") or c.get("custom:tenantId")
        role = c.get("role") or c.get("custom:role")
        service_ok = c.get("service") == "profiles-flow" and c.get("scopes") == ["domain:read"]
        if not tenant or (role not in {"ADMIN", "MANAGER", "VIEWER"} and not (role == "SERVICE" and service_ok)):
            raise ValueError()
        return {"tenantId": tenant, "userId": c["sub"], "role": role}
    except Exception:
        raise HTTPException(401, "Invalid or expired token")


def allowed(a, method="GET"):
    matrix = {
        "VIEWER": {"GET", "HEAD", "OPTIONS"},
        "MANAGER": {"GET", "HEAD", "OPTIONS", "POST", "PATCH"},
        "ADMIN": {"GET", "HEAD", "OPTIONS", "POST", "PATCH", "DELETE"},
        "SERVICE": {"GET", "HEAD", "OPTIONS"},
    }
    if method not in matrix.get(a.get("role"), set()):
        raise HTTPException(403, "Admin required" if method == "DELETE" and a.get("role") == "MANAGER" else "Insufficient role")


def assert_project_reference(project_id: str, authorization: str | None):
    base = os.getenv("PROJECT_API_URL", "").rstrip("/")
    if not base:
        raise HTTPException(503, "Project service validation is not configured")
    if not authorization:
        raise HTTPException(401, "Bearer token required")
    request = urllib.request.Request(f"{base}/projects/{project_id}", headers={"Authorization": authorization})
    try:
        with urllib.request.urlopen(request, timeout=3) as response:
            if response.status != 200:
                raise HTTPException(503, "Project service unavailable")
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise HTTPException(422, "Project not found in this tenant") from exc
        raise HTTPException(503, "Project service unavailable") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise HTTPException(503, "Project service unavailable") from exc


def key(t, i):
    return {"pk": f"TENANT#{t}", "sk": i if i.startswith("ITEM#") else f"ITEM#{i}"}


def dynamo_safe(value):
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {k: dynamo_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [dynamo_safe(v) for v in value]
    return value


def get(t, i):
    return table.get_item(Key=key(t, i)).get("Item")


def score(b):
    if b.criteria:
        total = sum(x.weight for x in b.criteria)
        if abs(total - 1) > 0.001:
            raise HTTPException(422, "Criterion weights must sum to 1")
        return round(sum(x.weight * x.score for x in b.criteria), 2)
    # Default weighted model favors impact, urgency and alignment while treating risk as penalty.
    return round(0.35 * b.impact + 0.25 * b.urgency + 0.25 * b.alignment + 0.15 * (100 - b.risk), 2)


@app.get("/health")
@app.get("/healthz")
def health():
    return {"status": "ok", "service": "priority-service"}


@app.get("/priorities")
def list_priorities(limit: int = Query(50, ge=1, le=100), cursor: str | None = None, a=Depends(actor)):
    args = {
        "KeyConditionExpression": "pk = :pk",
        "ExpressionAttributeValues": {":pk": f"TENANT#{a['tenantId']}"},
        "Limit": limit,
    }
    if cursor:
        try:
            raw = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))
            if raw.get("pk") != f"TENANT#{a['tenantId']}":
                raise ValueError()
            args["ExclusiveStartKey"] = raw
        except Exception:
            raise HTTPException(400, "Invalid cursor")
    out = table.query(**args)
    last = out.get("LastEvaluatedKey")
    return {
        "items": [x for x in out.get("Items", []) if x.get("entityType") == "Assessment"],
        "nextCursor": base64.urlsafe_b64encode(json.dumps(last).encode()).decode().rstrip("=") if last else None,
    }


@app.post("/priorities/recalculate")
@app.post("/priorities", status_code=201)
def assess(b: Assessment, authorization: str | None = Header(None), a=Depends(actor)):
    allowed(a, "POST")
    assert_project_reference(b.projectId, authorization)
    ident = b.projectId
    value = score(b)
    existing = get(a["tenantId"], ident)
    doc = {
        **key(a["tenantId"], ident),
        "id": ident,
        "entityType": "Assessment",
        "projectId": ident,
        "impact": b.impact,
        "urgency": b.urgency,
        "risk": b.risk,
        "alignment": b.alignment,
        "criteria": [x.model_dump() for x in b.criteria],
        "score": value,
        "updatedAt": now(),
        "createdBy": a["userId"],
    }
    if existing:
        doc["createdAt"] = existing.get("createdAt", now())
    else:
        doc["createdAt"] = now()
    table.put_item(Item=dynamo_safe(doc))
    if os.getenv("DOMAIN_TOPIC_ARN"):
        boto3.client(
            "sns",
            endpoint_url=os.getenv("SNS_ENDPOINT"),
            region_name=os.getenv("AWS_REGION", "us-east-1"),
            **({"aws_access_key_id": "local", "aws_secret_access_key": "local"} if os.getenv("SNS_ENDPOINT") and not os.getenv("AWS_LAMBDA_FUNCTION_NAME") else {}),
        ).publish(
            TopicArn=os.environ["DOMAIN_TOPIC_ARN"],
            Message=json.dumps(
                {
                    "eventId": str(uuid.uuid4()),
                    "eventType": "PriorityRecalculated",
                    "eventVersion": 1,
                    "tenantId": a["tenantId"],
                    "entityId": ident,
                    "occurredAt": now(),
                    "payload": {"score": value},
                }
            ),
        )
    return doc


@app.get("/rankings")
def rankings(limit: int = Query(50, ge=1, le=100), cursor: str | None = None, a=Depends(actor)):
    records, start_key = [], None
    while True:
        query = {"KeyConditionExpression": "pk = :pk", "ExpressionAttributeValues": {":pk": f"TENANT#{a['tenantId']}"}}
        if start_key:
            query["ExclusiveStartKey"] = start_key
        out = table.query(**query)
        records.extend(out.get("Items", []))
        start_key = out.get("LastEvaluatedKey")
        if not start_key:
            break
    rows = sorted(
        [x for x in records if x.get("entityType") == "Assessment"],
        key=lambda x: (-float(x.get("score", 0)), x["projectId"]),
    )
    offset = 0
    if cursor:
        try:
            page_cursor = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))
            if page_cursor.get("tenantId") != a["tenantId"] or not isinstance(page_cursor.get("lastProjectId"), str):
                raise ValueError()
            marker = (-float(page_cursor["lastScore"]), page_cursor["lastProjectId"])
            offset = next((n + 1 for n, row in enumerate(rows) if (-float(row.get("score", 0)), row["projectId"]) == marker), -1)
            if offset < 0:
                raise ValueError()
        except Exception:
            raise HTTPException(400, "Invalid cursor")
    page = rows[offset:offset + limit]
    next_cursor = None
    if offset + limit < len(rows) and page:
        last = page[-1]
        marker = {"tenantId": a["tenantId"], "lastScore": float(last.get("score", 0)), "lastProjectId": last["projectId"]}
        next_cursor = base64.urlsafe_b64encode(json.dumps(marker).encode()).decode().rstrip("=")
    return {"items": [{**x, "rank": offset + n + 1} for n, x in enumerate(page)], "nextCursor": next_cursor}


def _decision_access(a, write: bool = False, allow_service_read: bool = False):
    if a.get("role") == "SERVICE" and allow_service_read and not write:
        return
    if a.get("role") not in {"ADMIN", "MANAGER", "VIEWER"}:
        raise HTTPException(403, "Decision Lab operation is unavailable to this identity")
    if write and a.get("role") not in {"ADMIN", "MANAGER"}:
        raise HTTPException(403, "ADMIN or MANAGER role required")


def _fetch_pages(base: str, path: str, authorization: str, max_pages: int = 20):
    if not base:
        raise HTTPException(503, f"{path.split('/')[0]} source is not configured")
    rows, cursor = [], None
    for _ in range(max_pages):
        query = {"limit": "100"}
        if cursor:
            query["cursor"] = cursor
        request_url = f"{base.rstrip('/')}/{path}?{urllib.parse.urlencode(query)}"
        request = urllib.request.Request(request_url, headers={"Authorization": authorization})
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            logger.warning("Decision Lab domain query returned HTTP %s for %s", error.code, path.split("/")[0])
            raise HTTPException(503, f"Could not read {path.split('/')[0]} data") from error
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            logger.warning("Decision Lab domain query failed for %s: %s", path.split("/")[0], type(error).__name__)
            raise HTTPException(503, f"Could not read {path.split('/')[0]} data") from error
        rows.extend(payload if isinstance(payload, list) else payload.get("items", []))
        cursor = payload.get("nextCursor") if isinstance(payload, dict) else None
        if not cursor:
            return rows, False
    return rows, True


def _collect_decision_data(authorization: str, tenant_id: str):
    sources = {
        "portfolios": (os.getenv("PORTFOLIO_API_URL", ""), "portfolios"),
        "projects": (os.getenv("PROJECT_API_URL", ""), "projects"),
        "resources": (os.getenv("RESOURCE_API_URL", ""), "resources"),
        "assignments": (os.getenv("RESOURCE_API_URL", ""), "assignments"),
        "budgets": (os.getenv("BUDGET_API_URL", ""), "budgets"),
    }
    result = {"priorities": []}
    truncated = []
    with ThreadPoolExecutor(max_workers=len(sources)) as executor:
        requests = {executor.submit(_fetch_pages, base, path, authorization): name for name, (base, path) in sources.items()}
        for future in as_completed(requests):
            name = requests[future]
            rows, partial = future.result()
            result[name] = rows
            if partial:
                truncated.append(name)
    last_key = None
    for _ in range(20):
        query = {"KeyConditionExpression": Key("pk").eq(f"TENANT#{tenant_id}"), "Limit": 100}
        if last_key:
            query["ExclusiveStartKey"] = last_key
        page = table.query(**query)
        result["priorities"].extend(row for row in page.get("Items", []) if row.get("entityType") == "Assessment")
        last_key = page.get("LastEvaluatedKey")
        if not last_key:
            break
    if last_key:
        truncated.append("priorities")
    result["truncated"] = truncated
    result["fetchedAt"] = now()
    return result


def _validate_scope(scope: DecisionScope, source: dict[str, Any]):
    project_ids = {str(row.get("id") or row.get("projectId")) for row in source.get("projects", [])}
    portfolio_ids = {str(row.get("id")) for row in source.get("portfolios", []) if row.get("id")}
    if scope.projectId and scope.projectId not in project_ids:
        raise HTTPException(404, "Project not found in this tenant")
    if scope.portfolioId and scope.portfolioId not in portfolio_ids:
        raise HTTPException(404, "Portfolio not found in this tenant")


def _run_comparison(payload: DecisionComparisonRequest, authorization: str, tenant_id: str):
    source = _collect_decision_data(authorization, tenant_id)
    _validate_scope(payload.scope, source)
    try:
        return compare_scenarios(
            source,
            [{"key": row.key, "name": row.name, "variables": row.variables.model_dump(exclude_none=True)} for row in payload.scenarios],
            payload.scope.model_dump(exclude_none=True),
        )
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


@app.get("/decisions/context")
def decision_context(authorization: str | None = Header(None), a=Depends(actor)):
    _decision_access(a)
    source = _collect_decision_data(authorization or "", a["tenantId"])
    currencies = sorted({str(row.get("currency")).upper() for row in source.get("budgets", []) if row.get("currency")})
    return {
        "projects": [{key: row.get(key) for key in ("id", "name", "portfolioId", "status", "startDate", "endDate")} for row in source["projects"]],
        "portfolios": [{key: row.get(key) for key in ("id", "name", "status")} for row in source["portfolios"]],
        "resources": [{key: row.get(key) for key in ("id", "name", "capacity")} for row in source["resources"]],
        "currencies": currencies,
        "capabilities": {"canSimulate": a["role"] in {"ADMIN", "MANAGER"}, "canSave": a["role"] in {"ADMIN", "MANAGER"}, "canDeleteOwn": a["role"] == "MANAGER", "canDeleteAll": a["role"] == "ADMIN"},
        "currentUserId": a["userId"],
        "sourceCompleteness": "PARTIAL" if source["truncated"] else "COMPLETE",
        "truncatedSources": source["truncated"],
    }


@app.post("/decisions/simulate")
def simulate_decisions(payload: DecisionComparisonRequest, authorization: str | None = Header(None), a=Depends(actor)):
    _decision_access(a, write=True)
    if not authorization:
        raise HTTPException(401, "Bearer token required")
    return _run_comparison(payload, authorization, a["tenantId"])


@app.get("/decisions/scenarios")
def list_decision_scenarios(reviewStatus: str | None = None, a=Depends(actor)):
    _decision_access(a, allow_service_read=True)
    page = table.query(
        KeyConditionExpression=Key("pk").eq(f"TENANT#{a['tenantId']}") & Key("sk").begins_with("DECISION#"),
        Limit=100,
        ScanIndexForward=False,
    )
    rows = page.get("Items", [])
    if a["role"] == "VIEWER":
        rows = [row for row in rows if row.get("visibility") == "tenant"]
    elif a["role"] == "SERVICE":
        rows = [row for row in rows if row.get("visibility") == "tenant" or row.get("createdBy") == a["userId"]]
    if reviewStatus:
        rows = [row for row in rows if row.get("reviewStatus") == reviewStatus]
    fields = ("id", "name", "scope", "visibility", "reviewStatus", "createdBy", "createdAt", "updatedAt")
    return {"items": [{field: row.get(field) for field in fields} for row in rows]}


@app.post("/decisions/scenarios", status_code=201)
def save_decision_scenario(payload: SaveDecisionRequest, authorization: str | None = Header(None), a=Depends(actor)):
    _decision_access(a, write=True)
    if not authorization:
        raise HTTPException(401, "Bearer token required")
    result = _run_comparison(payload, authorization, a["tenantId"])
    ident = str(uuid.uuid4())
    item = {
        "pk": f"TENANT#{a['tenantId']}", "sk": f"DECISION#{ident}", "id": ident,
        "tenantId": a["tenantId"], "name": payload.name.strip(), "scope": payload.scope.model_dump(exclude_none=True),
        "scenarios": [row.model_dump(exclude_none=True) for row in payload.scenarios], "result": result,
        "visibility": payload.visibility, "reviewStatus": "PENDING_REVIEW", "createdBy": a["userId"],
        "createdAt": now(), "updatedAt": now(), "entityType": "DecisionScenario",
    }
    table.put_item(Item=dynamo_safe(item), ConditionExpression="attribute_not_exists(pk) AND attribute_not_exists(sk)")
    return item


@app.get("/decisions/scenarios/{ident}")
def get_decision_scenario(ident: str, a=Depends(actor)):
    _decision_access(a)
    item = table.get_item(Key={"pk": f"TENANT#{a['tenantId']}", "sk": f"DECISION#{ident}"}).get("Item")
    if not item or (a["role"] == "VIEWER" and item.get("visibility") != "tenant"):
        raise HTTPException(404, "Not found")
    return item


@app.delete("/decisions/scenarios/{ident}")
def delete_decision_scenario(ident: str, a=Depends(actor)):
    _decision_access(a, write=True)
    item_key = {"pk": f"TENANT#{a['tenantId']}", "sk": f"DECISION#{ident}"}
    existing = table.get_item(Key=item_key).get("Item")
    if not existing:
        raise HTTPException(404, "Not found")
    if a["role"] != "ADMIN" and existing.get("createdBy") != a["userId"]:
        raise HTTPException(403, "Only the creator or an ADMIN can discard this scenario")
    table.delete_item(Key=item_key, ConditionExpression="attribute_exists(pk)")
    return {"deleted": True, "id": ident}


@app.get("/priorities/{ident}")
def get_assessment(ident, a=Depends(actor)):
    d = get(a["tenantId"], ident)
    if not d:
        raise HTTPException(404, "Not found")
    return d


@app.patch("/priorities/{ident}")
def patch(ident, b: dict[str, Any], authorization: str | None = Header(None), a=Depends(actor)):
    allowed(a, "PATCH")
    old = get(a["tenantId"], ident)
    if not old:
        raise HTTPException(404, "Not found")
    merged = {k: old.get(k, 50) for k in ("impact", "urgency", "risk", "alignment")}
    merged.update({k: v for k, v in b.items() if k in merged})
    merged["projectId"] = ident
    if "criteria" in b:
        merged["criteria"] = b["criteria"]
    return assess(Assessment(**merged), authorization, a)


@app.delete("/priorities/{ident}")
def delete(ident, a=Depends(actor)):
    allowed(a, "DELETE")
    table.delete_item(Key=key(a["tenantId"], ident), ConditionExpression="attribute_exists(pk)")
    return {"deleted": True}


handler = Mangum(app)
