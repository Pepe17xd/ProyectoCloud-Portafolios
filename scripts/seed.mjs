// Backward-compatible safe alias. All writes are restricted by seed-local.mjs to DynamoDB Local.
process.argv[2] = process.argv[2] && ['demo','full'].includes(process.argv[2]) ? process.argv[2] : 'demo';
process.env.DYNAMODB_ENDPOINT = 'http://localhost:8000';
await import('./seed-local.mjs');
