# LocalStack initialization

The ready hook creates a private documents bucket, one domain SNS topic, one SQS
queue per service, and a shared dead-letter queue. Initialization is idempotent
when run by LocalStack on a fresh or persisted instance. It uses LocalStack's
`awslocal` CLI inside the container; no AWS credentials or cloud account are used.

The six service tables are created by `scripts/local-infra.ps1` or
`scripts/local-infra.sh` against DynamoDB Local.
