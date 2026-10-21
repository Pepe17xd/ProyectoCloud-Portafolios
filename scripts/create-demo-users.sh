#!/usr/bin/env bash
set -euo pipefail
: "${USER_POOL_ID:?Set USER_POOL_ID}"
: "${TENANT_ID:?Set TENANT_ID}"
: "${EMAIL:?Set EMAIL}"
: "${PASSWORD:?Set PASSWORD}"
ROLE="${ROLE:-ADMIN}"
aws cognito-idp admin-create-user --user-pool-id "$USER_POOL_ID" --username "$EMAIL" --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true Name=custom:tenantId,Value="$TENANT_ID" Name=custom:role,Value="$ROLE" --message-action SUPPRESS
aws cognito-idp admin-set-user-password --user-pool-id "$USER_POOL_ID" --username "$EMAIL" --password "$PASSWORD" --permanent
