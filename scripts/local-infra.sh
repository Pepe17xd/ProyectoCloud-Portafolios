#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="$ROOT/infrastructure/docker-compose.yml"
ACTION="${1:-up}"

case "$ACTION" in
  down) docker compose -f "$COMPOSE" down; exit 0 ;;
  status) docker compose -f "$COMPOSE" ps; exit 0 ;;
  up) docker compose -f "$COMPOSE" up -d --wait ;;
  init) ;;
  *) echo "Usage: $0 [up|init|status|down]" >&2; exit 2 ;;
esac

for service in identity portfolio project resource budget priority; do
  table="cloudportfolio-${service}-local"
  if aws dynamodb describe-table --table-name "$table" --endpoint-url http://localhost:8000 --region us-east-1 >/dev/null 2>&1; then
    continue
  fi
  aws dynamodb create-table --table-name "$table" \
    --attribute-definitions AttributeName=pk,AttributeType=S AttributeName=sk,AttributeType=S \
    --key-schema AttributeName=pk,KeyType=HASH AttributeName=sk,KeyType=RANGE \
    --billing-mode PAY_PER_REQUEST --endpoint-url http://localhost:8000 --region us-east-1 >/dev/null
done
echo 'Local infrastructure is ready. DynamoDB: http://localhost:8000; LocalStack: http://localhost:4566'
