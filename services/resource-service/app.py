"""Resource and assignment API. Business state is isolated in this service's DynamoDB table."""

import base64
import hashlib
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
from botocore.exceptions import ClientError
from fastapi import FastAPI, Header, HTTPException, Query
from mangum import Mangum
from pydantic import BaseModel, Field
from starlette.middleware.cors import CORSMiddleware

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format='{"level":"%(levelname)s","message":"%(message)s"}')
app = FastAPI(title="CloudPortfolio Resource Service", version="1.0.0")
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
table = ddb.Table(os.getenv("TABLE_NAME", "cloudportfolio-resource-local"))
now = lambda: datetime.now(UTC).isoformat()


class ResourceIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    type: str = "person"
    capacity: float = Field(default=1, gt=0, le=1)
    status: str = "active"
    skills: list[str] = []


class AssignmentIn(BaseModel):
    resourceId: str
    projectId: str
    allocation: float = Field(gt=0, le=1)
    startDate: str | None = None
    endDate: str | None = None
    idempotencyKey: str | None = Field(default=None, min_length=8, max_length=128)


def actor(authorization: str | None = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Bearer token required")
    try:
        token = authorization[7:]
        unverified = jwt.decode(token, options={"verify_signature": False})
        if unverified.get("iss") == "cloudportfolio-local":
            claims = jwt.decode(
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
            claims = jwt.decode(
                token,
                public_key,
                algorithms=["RS256"],
                issuer=issuer,
                options={"require": ["exp", "iss", "sub"], "verify_aud": False},
            )
            client_id = os.getenv("COGNITO_CLIENT_ID")
            if client_id and claims.get("client_id", claims.get("aud")) != client_id:
                raise ValueError("Unexpected token audience")
        tenant = claims.get("tenantId") or claims.get("custom:tenantId")
        role = claims.get("role") or claims.get("custom:role")
        if not tenant or role not in {"ADMIN", "MANAGER", "VIEWER"}:
            raise ValueError()
        return {"tenantId": tenant, "userId": claims["sub"], "role": role}
    except Exception:
        raise HTTPException(401, "Invalid or expired token")


def key(tenant: str, ident: str):
    return {"pk": f"TENANT#{tenant}", "sk": ident if ident.startswith("ITEM#") else f"ITEM#{ident}"}


def dynamo_safe(value):
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {k: dynamo_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [dynamo_safe(v) for v in value]
    return value


def allowed(a, method="GET", identity_admin=False):
    matrix = {
        "VIEWER": {"GET", "HEAD", "OPTIONS"},
        "MANAGER": {"GET", "HEAD", "OPTIONS", "POST", "PATCH"},
        "ADMIN": {"GET", "HEAD", "OPTIONS", "POST", "PATCH", "DELETE"},
    }
    if method not in matrix.get(a.get("role"), set()) or (identity_admin and method not in {"GET", "HEAD", "OPTIONS"} and a.get("role") != "ADMIN"):
        raise HTTPException(403, "Admin required" if method == "DELETE" and a.get("role") == "MANAGER" or identity_admin else "Insufficient role")


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


def item_get(tenant, ident):
    result = table.get_item(Key=key(tenant, ident))
    return result.get("Item")


def ensure_capacity_ledger(tenant: str, resource: dict):
    if "remainingCapacity" in resource and "allocated" in resource:
        return resource
    rows = []
    cursor = None
    while True:
        args = {"KeyConditionExpression": "pk = :pk", "ExpressionAttributeValues": {":pk": f"TENANT#{tenant}"}}
        if cursor:
            args["ExclusiveStartKey"] = cursor
        page = table.query(**args)
        rows.extend(page.get("Items", []))
        cursor = page.get("LastEvaluatedKey")
        if not cursor:
            break
    allocated = sum(float(row.get("allocation", 0)) for row in rows if row.get("entityType") == "Assignment" and row.get("resourceId") == resource["id"])
    capacity = float(resource.get("capacity", 1))
    table.update_item(
        Key={"pk": resource["pk"], "sk": resource["sk"]},
        UpdateExpression="SET #allocated = if_not_exists(#allocated, :allocated), #remaining = if_not_exists(#remaining, :remaining)",
        ExpressionAttributeNames={"#allocated": "allocated", "#remaining": "remainingCapacity"},
        ExpressionAttributeValues={":allocated": Decimal(str(allocated)), ":remaining": Decimal(str(max(0, capacity - allocated)))},
    )
    return item_get(tenant, resource["id"])


def cursor_decode(c):
    if not c:
        return None
    try:
        raw = json.loads(base64.urlsafe_b64decode(c + "=" * (-len(c) % 4)))
        if raw.get("pk") != f"TENANT#{tenant_ctx.get()}":
            raise ValueError()
        return raw
    except Exception:
        raise HTTPException(400, "Invalid cursor")


def query_all_tenant(tenant: str):
    rows, cursor = [], None
    while True:
        args = {"KeyConditionExpression": "pk = :pk", "ExpressionAttributeValues": {":pk": f"TENANT#{tenant}"}}
        if cursor:
            args["ExclusiveStartKey"] = cursor
        page = table.query(**args)
        rows.extend(page.get("Items", []))
        cursor = page.get("LastEvaluatedKey")
        if not cursor:
            return rows


from contextvars import ContextVar

tenant_ctx = ContextVar("tenant_ctx", default="")


@app.get("/health")
@app.get("/healthz")
def health():
    return {"status": "ok", "service": "resource-service"}


@app.get("/resources")
def list_resources(
    limit: int = Query(50, ge=1, le=100), cursor: str | None = None, a=__import__("fastapi").Depends(actor)
):
    tenant_ctx.set(a["tenantId"])
    args = {
        "KeyConditionExpression": "pk = :pk",
        "ExpressionAttributeValues": {":pk": f"TENANT#{a['tenantId']}"},
        "Limit": limit,
    }
    if cursor:
        args["ExclusiveStartKey"] = cursor_decode(cursor)
    out = table.query(**args)
    last = out.get("LastEvaluatedKey")
    return {
        "items": [x for x in out.get("Items", []) if "name" in x],
        "nextCursor": base64.urlsafe_b64encode(json.dumps(last).encode()).decode().rstrip("=") if last else None,
    }


@app.post("/resources", status_code=201)
def create_resource(body: ResourceIn, a=__import__("fastapi").Depends(actor)):
    allowed(a, "POST")
    ident = str(uuid.uuid4())
    doc = {**key(a["tenantId"], ident), "id": ident, "entityType": "Resource", **body.model_dump(), "allocated": 0, "remainingCapacity": body.capacity, "createdBy": a["userId"], "createdAt": now()}
    table.put_item(Item=dynamo_safe(doc), ConditionExpression="attribute_not_exists(pk) AND attribute_not_exists(sk)")
    return doc


@app.get("/resources/{ident}")
def get_resource(ident, a=__import__("fastapi").Depends(actor)):
    doc = item_get(a["tenantId"], ident)
    if not doc:
        raise HTTPException(404, "Not found")
    return doc


@app.patch("/resources/{ident}")
def patch_resource(ident, body: dict[str, Any], a=__import__("fastapi").Depends(actor)):
    allowed(a, "PATCH")
    doc = item_get(a["tenantId"], ident)
    if not doc:
        raise HTTPException(404, "Not found")
    for k, v in body.items():
        if k in ResourceIn.model_fields and k != "name":
            doc[k] = v
    if "capacity" in body:
        capacity = float(body["capacity"])
        if capacity <= 0 or capacity > 1 or capacity < float(doc.get("allocated", 0)):
            raise HTTPException(409, "Capacity cannot be lower than current allocation")
        doc["remainingCapacity"] = Decimal(str(capacity - float(doc.get("allocated", 0))))
    doc["updatedAt"] = now()
    table.put_item(Item=dynamo_safe(doc))
    return doc


@app.delete("/resources/{ident}")
def delete_resource(ident, a=__import__("fastapi").Depends(actor)):
    allowed(a, "DELETE")
    table.delete_item(Key=key(a["tenantId"], ident), ConditionExpression="attribute_exists(pk)")
    return {"deleted": True}


@app.post("/assignments", status_code=201)
def assign(body: AssignmentIn, authorization: str | None = Header(None), a=__import__("fastapi").Depends(actor)):
    allowed(a, "POST")
    assert_project_reference(body.projectId, authorization)
    if not item_get(a["tenantId"], body.resourceId):
        raise HTTPException(404, "Resource not found")
    resource = item_get(a["tenantId"], body.resourceId)
    resource = ensure_capacity_ledger(a["tenantId"], resource)
    ident = hashlib.sha256(f"{a['tenantId']}:{body.idempotencyKey}".encode()).hexdigest() if body.idempotencyKey else str(uuid.uuid4())
    assignment_key = key(a["tenantId"], ident)
    if body.idempotencyKey:
        previous = table.get_item(Key=assignment_key).get("Item")
        if previous:
            if all(previous.get(k) == getattr(body, k) for k in ("resourceId", "projectId", "allocation", "startDate", "endDate")):
                return previous
            raise HTTPException(409, "Idempotency key was already used for a different assignment")
    doc = {**assignment_key, "id": ident, "entityType": "Assignment", **body.model_dump(exclude={"idempotencyKey"}), "createdAt": now()}
    from boto3.dynamodb.types import TypeSerializer

    serializer = TypeSerializer()
    serialize = lambda value: {k: serializer.serialize(v) for k, v in value.items()}
    try:
        table.meta.client.transact_write_items(
            TransactItems=[
                {"Put": {"TableName": table.name, "Item": serialize(dynamo_safe(doc)), "ConditionExpression": "attribute_not_exists(pk) AND attribute_not_exists(sk)"}},
                {"Update": {"TableName": table.name, "Key": serialize({"pk": resource["pk"], "sk": resource["sk"]}), "UpdateExpression": "SET #remaining = #remaining - :allocation ADD #allocated :allocation", "ConditionExpression": "attribute_exists(pk) AND #remaining >= :allocation", "ExpressionAttributeNames": {"#remaining": "remainingCapacity", "#allocated": "allocated"}, "ExpressionAttributeValues": serialize({":allocation": Decimal(str(body.allocation))})}},
            ]
        )
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "TransactionCanceledException":
            previous = table.get_item(Key=assignment_key).get("Item") if body.idempotencyKey else None
            if previous and all(previous.get(k) == getattr(body, k) for k in ("resourceId", "projectId", "allocation", "startDate", "endDate")):
                return previous
            raise HTTPException(409, "Resource capacity exceeded or assignment conflict") from exc
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
                    "eventType": "ResourceAssigned",
                    "eventVersion": 1,
                    "tenantId": a["tenantId"],
                    "entityId": ident,
                    "occurredAt": now(),
                    "payload": {"projectId": body.projectId, "resourceId": body.resourceId},
                }
            ),
        )
    return doc


@app.get("/assignments")
def assignments(projectId: str | None = None, limit: int = Query(50, ge=1, le=100), cursor: str | None = None, a=__import__("fastapi").Depends(actor)):
    tenant_ctx.set(a["tenantId"])
    args = {"KeyConditionExpression": "pk = :pk", "ExpressionAttributeValues": {":pk": f"TENANT#{a['tenantId']}"}, "Limit": limit}
    if cursor:
        args["ExclusiveStartKey"] = cursor_decode(cursor)
    if projectId:
        args["FilterExpression"] = "entityType = :type AND projectId = :projectId"
        args["ExpressionAttributeValues"].update({":type": "Assignment", ":projectId": projectId})
    else:
        args["FilterExpression"] = "entityType = :type"
        args["ExpressionAttributeValues"][":type"] = "Assignment"
    out = table.query(**args)
    rows = out.get("Items", [])
    last = out.get("LastEvaluatedKey")
    return {"items": rows, "nextCursor": base64.urlsafe_b64encode(json.dumps(last).encode()).decode().rstrip("=") if last else None}


@app.get("/availability")
def availability(a=__import__("fastapi").Depends(actor)):
    rows = query_all_tenant(a["tenantId"])
    resources = [x for x in rows if "name" in x and "capacity" in x]
    alloc = {
        r["sk"]: sum(
            float(x.get("allocation", 0))
            for x in rows
            if x.get("entityType") == "Assignment" and x.get("resourceId") == r["sk"]
        )
        for r in resources
    }
    return {
        "items": [
            {**r, "allocated": alloc[r["sk"]], "available": max(0, float(r["capacity"]) - alloc[r["sk"]])}
            for r in resources
        ]
    }


handler = Mangum(app)
