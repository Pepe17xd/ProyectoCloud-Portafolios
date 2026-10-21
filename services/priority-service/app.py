"""Weighted project scoring and tenant-scoped ranking API."""

import base64
import json
import logging
import os
import urllib.error
import urllib.request
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import boto3
import jwt
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from mangum import Mangum
from pydantic import BaseModel, Field
from starlette.middleware.cors import CORSMiddleware

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format='{"level":"%(levelname)s","message":"%(message)s"}')
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
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID", "local"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY", "local"),
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


def actor(authorization: str | None = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Bearer token required")
    try:
        token = authorization[7:]
        unverified = jwt.decode(token, options={"verify_signature": False})
        if unverified.get("iss") == "cloudportfolio-local":
            c = jwt.decode(
                token,
                os.getenv("LOCAL_JWT_SECRET", "local-only"),
                algorithms=["HS256"],
                issuer="cloudportfolio-local",
                options={"require": ["exp", "iat", "iss", "sub"]},
            )
        else:
            issuer = os.getenv("JWT_ISSUER", "")
            if not issuer:
                raise ValueError("JWT_ISSUER is not configured")
            public_key = jwt.PyJWKClient(f"{issuer}/.well-known/jwks.json").get_signing_key_from_jwt(token).key
            c = jwt.decode(
                token,
                public_key,
                algorithms=["RS256"],
                issuer=issuer,
                options={"require": ["exp", "iss", "sub"], "verify_aud": False},
            )
            client_id = os.getenv("COGNITO_CLIENT_ID")
            if client_id and c.get("client_id", c.get("aud")) != client_id:
                raise ValueError("Unexpected token audience")
        tenant = c.get("tenantId") or c.get("custom:tenantId")
        role = c.get("role") or c.get("custom:role")
        if not tenant or role not in {"ADMIN", "MANAGER", "VIEWER"}:
            raise ValueError()
        return {"tenantId": tenant, "userId": c["sub"], "role": role}
    except Exception:
        raise HTTPException(401, "Invalid or expired token")


def allowed(a, method="GET"):
    matrix = {
        "VIEWER": {"GET", "HEAD", "OPTIONS"},
        "MANAGER": {"GET", "HEAD", "OPTIONS", "POST", "PATCH"},
        "ADMIN": {"GET", "HEAD", "OPTIONS", "POST", "PATCH", "DELETE"},
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
            aws_access_key_id="local",
            aws_secret_access_key="local",
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
