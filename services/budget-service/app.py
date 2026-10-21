"""Budget API and idempotent ProjectCreated consumer."""

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
from botocore.exceptions import ClientError
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from mangum import Mangum
from pydantic import BaseModel, Field
from starlette.middleware.cors import CORSMiddleware

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format='{"level":"%(levelname)s","message":"%(message)s"}')
logger = logging.getLogger(__name__)
app = FastAPI(title="CloudPortfolio Budget Service", version="1.0.0")
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
table = ddb.Table(os.getenv("TABLE_NAME", "cloudportfolio-budget-local"))
now = lambda: datetime.now(UTC).isoformat()


class BudgetIn(BaseModel):
    projectId: str = Field(min_length=1)
    allocated: float = Field(default=0, ge=0)
    spent: float = Field(default=0, ge=0)
    currency: str = "USD"


class ExpenseIn(BaseModel):
    budgetId: str
    projectId: str
    amount: float = Field(gt=0)
    description: str = Field(min_length=1, max_length=300)
    currency: str = "USD"
    idempotencyKey: str | None = Field(default=None, min_length=8, max_length=128)


def actor(authorization: str | None = Header(None)):
    # API Gateway/local JWT verifier may inject verified context via x-claims; bearer is validated by edge adapter.
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Bearer token required")
    try:
        import jwt

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
    if i.startswith(("ITEM#", "EXPENSE#")):
        return {"pk": f"TENANT#{t}", "sk": i}
    return {"pk": f"TENANT#{t}", "sk": f"ITEM#{i}"}


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


def query_all_expenses(tenant: str, budget_id: str):
    rows, cursor = [], None
    while True:
        args = {
            "KeyConditionExpression": "pk = :pk",
            "FilterExpression": "entityType = :type AND budgetId = :budgetId",
            "ExpressionAttributeValues": {":pk": f"TENANT#{tenant}", ":type": "Expense", ":budgetId": budget_id},
        }
        if cursor:
            args["ExclusiveStartKey"] = cursor
        page = table.query(**args)
        rows.extend(page.get("Items", []))
        cursor = page.get("LastEvaluatedKey")
        if not cursor:
            return rows


@app.get("/health")
@app.get("/healthz")
def health():
    return {"status": "ok", "service": "budget-service"}


@app.get("/budgets")
def list_budgets(limit: int = Query(50, ge=1, le=100), cursor: str | None = None, a=Depends(actor)):
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
        "items": out.get("Items", []),
        "nextCursor": base64.urlsafe_b64encode(json.dumps(last).encode()).decode().rstrip("=") if last else None,
    }


@app.post("/budgets", status_code=201)
def create_budget(b: BudgetIn, authorization: str | None = Header(None), a=Depends(actor)):
    allowed(a, "POST")
    assert_project_reference(b.projectId, authorization)
    i = str(uuid.uuid4())
    d = {
        **key(a["tenantId"], i),
        "id": i,
        **b.model_dump(),
        "entityType": "Budget",
        "balance": b.allocated - b.spent,
        "createdAt": now(),
    }
    table.put_item(Item=dynamo_safe(d), ConditionExpression="attribute_not_exists(pk) AND attribute_not_exists(sk)")
    return d


@app.get("/budgets/{ident}")
def budget(ident, a=Depends(actor)):
    d = get(a["tenantId"], ident)
    if not d or d.get("entityType") == "Expense":
        raise HTTPException(404, "Not found")
    return d


@app.patch("/budgets/{ident}")
def update(ident, b: dict[str, Any], a=Depends(actor)):
    allowed(a, "PATCH")
    d = get(a["tenantId"], ident)
    if not d or d.get("entityType") == "Expense":
        raise HTTPException(404, "Not found")
    for k in ("allocated", "currency"):
        if k in b:
            d[k] = b[k]
    d["balance"] = float(d.get("allocated", 0)) - float(d.get("spent", 0))
    d["updatedAt"] = now()
    table.put_item(Item=dynamo_safe(d))
    return d


@app.delete("/budgets/{ident}")
def delete(ident, a=Depends(actor)):
    allowed(a, "DELETE")
    d = get(a["tenantId"], ident)
    if not d or d.get("entityType") == "Expense":
        raise HTTPException(404, "Not found")
    table.delete_item(Key=key(a["tenantId"], ident), ConditionExpression="attribute_exists(pk)")
    return {"deleted": True}


@app.get("/budgets/{ident}/summary")
def summary(ident, a=Depends(actor)):
    d = get(a["tenantId"], ident)
    if not d:
        raise HTTPException(404, "Not found")
    expenses = query_all_expenses(a["tenantId"], ident)
    spent = sum(float(x["amount"]) for x in expenses)
    allocated = float(d.get("allocated", 0))
    return {
        "budgetId": ident,
        "allocated": allocated,
        "spent": spent,
        "balance": allocated - spent,
        "variancePercent": (spent / allocated * 100 if allocated else 0),
        "expenses": expenses,
    }


@app.post("/expenses", status_code=201)
def expense(b: ExpenseIn, authorization: str | None = Header(None), a=Depends(actor)):
    allowed(a, "POST")
    assert_project_reference(b.projectId, authorization)
    d = get(a["tenantId"], b.budgetId)
    if not d:
        raise HTTPException(404, "Budget not found")
    if d.get("projectId") != b.projectId:
        raise HTTPException(400, "Project does not match budget")
    i = hashlib.sha256(f"{a['tenantId']}:{b.idempotencyKey}".encode()).hexdigest() if b.idempotencyKey else str(uuid.uuid4())
    expense_key = key(a["tenantId"], f"EXPENSE#{i}")
    if b.idempotencyKey:
        previous = table.get_item(Key=expense_key).get("Item")
        if previous:
            if all(previous.get(k) == getattr(b, k) for k in ("budgetId", "projectId", "amount", "description", "currency")):
                return previous
            raise HTTPException(409, "Idempotency key was already used for a different expense")
    item = {
        **expense_key,
        "id": i,
        "entityType": "Expense",
        **b.model_dump(exclude={"idempotencyKey"}),
        "createdBy": a["userId"],
        "createdAt": now(),
    }
    from boto3.dynamodb.types import TypeSerializer

    serializer = TypeSerializer()
    serialize = lambda value: {k: serializer.serialize(v) for k, v in value.items()}
    transaction = [
            {
                "Put": {
                    "TableName": table.name,
                    "Item": serialize(dynamo_safe(item)),
                    "ConditionExpression": "attribute_not_exists(pk) AND attribute_not_exists(sk)",
                }
            },
            {
                "Update": {
                    "TableName": table.name,
                    "Key": serialize(key(a["tenantId"], b.budgetId)),
                    "UpdateExpression": "SET #spent = if_not_exists(#spent, :zero) + :amount, #balance = #allocated - if_not_exists(#spent, :zero) - :amount, #updatedAt = :updatedAt",
                    "ConditionExpression": "attribute_exists(pk) AND #entityType = :budget",
                    "ExpressionAttributeNames": {"#spent": "spent", "#balance": "balance", "#allocated": "allocated", "#updatedAt": "updatedAt", "#entityType": "entityType"},
                    "ExpressionAttributeValues": serialize({":zero": Decimal(0), ":amount": Decimal(str(b.amount)), ":updatedAt": now(), ":budget": "Budget"}),
                }
            },
        ]
    try:
        table.meta.client.transact_write_items(TransactItems=transaction)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "TransactionCanceledException" and b.idempotencyKey:
            previous = table.get_item(Key=expense_key).get("Item")
            if previous and all(previous.get(k) == getattr(b, k) for k in ("budgetId", "projectId", "amount", "description", "currency")):
                return previous
            if previous:
                raise HTTPException(409, "Idempotency key was already used for a different expense") from exc
        raise
    updated_budget = get(a["tenantId"], b.budgetId) or d
    threshold = float(os.getenv("BUDGET_ALERT_THRESHOLD", "0.9"))
    spent = float(updated_budget.get("spent", 0))
    allocated = float(updated_budget.get("allocated", 0))
    if allocated and spent / allocated >= threshold and os.getenv("DOMAIN_TOPIC_ARN"):
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
                    "eventType": "BudgetThresholdExceeded",
                    "eventVersion": 1,
                    "tenantId": a["tenantId"],
                    "entityId": b.budgetId,
                    "occurredAt": now(),
                    "payload": {"spent": spent, "allocated": allocated},
                }
            ),
        )
    return item


@app.get("/expenses")
def expenses(projectId: str | None = None, limit: int = Query(50, ge=1, le=100), cursor: str | None = None, a=Depends(actor)):
    args = {
        "KeyConditionExpression": "pk = :pk",
        "FilterExpression": "entityType = :type",
        "ExpressionAttributeValues": {":pk": f"TENANT#{a['tenantId']}", ":type": "Expense"},
        "Limit": limit,
    }
    if projectId:
        args["FilterExpression"] += " AND projectId = :projectId"
        args["ExpressionAttributeValues"][":projectId"] = projectId
    if cursor:
        try:
            raw = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))
            if raw.get("pk") != f"TENANT#{a['tenantId']}" or not isinstance(raw.get("sk"), str):
                raise ValueError()
            args["ExclusiveStartKey"] = raw
        except Exception:
            raise HTTPException(400, "Invalid cursor")
    out = table.query(**args)
    last = out.get("LastEvaluatedKey")
    return {"items": out.get("Items", []), "nextCursor": base64.urlsafe_b64encode(json.dumps(last).encode()).decode().rstrip("=") if last else None}


def consume_message(message: dict):
    if message.get("eventType") != "ProjectCreated" or not message.get("tenantId") or not message.get("entityId"):
        raise ValueError("Invalid ProjectCreated event")
    # Stable key makes redeliveries idempotent.
    ident = f"initial-{message['entityId']}"
    item = {
        **key(message["tenantId"], ident),
        "entityType": "Budget",
        "projectId": message["entityId"],
        "allocated": 0,
        "spent": 0,
        "balance": 0,
        "currency": "USD",
        "createdAt": message.get("occurredAt", now()),
        "sourceEventId": message.get("eventId"),
    }
    try:
        table.put_item(Item=dynamo_safe(item), ConditionExpression="attribute_not_exists(pk) AND attribute_not_exists(sk)")
    except Exception as exc:
        if exc.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
            raise
    return item


def consume(event, context=None):
    failures = []
    for record in event.get("Records", []):
        try:
            raw = json.loads(record["body"])
            message = json.loads(raw["Message"]) if "Message" in raw else raw
            consume_message(message)
        except Exception:
            logger.exception("Failed to consume SQS record")
            failures.append({"itemIdentifier": record["messageId"]})
    return {"batchItemFailures": failures}


handler = Mangum(app)
