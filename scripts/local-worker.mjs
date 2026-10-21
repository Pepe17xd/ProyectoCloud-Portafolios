import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, ChangeMessageVisibilityCommand } from '@aws-sdk/client-sqs';
import { spawn } from 'node:child_process';

process.env.DYNAMODB_ENDPOINT ||= 'http://localhost:8000';
process.env.TABLE_NAME ||= 'cloudportfolio-budget-local';
const endpoint = process.env.SQS_ENDPOINT || 'http://localhost:4566';
const sqs = new SQSClient({ endpoint, region: 'us-east-1', credentials: { accessKeyId: 'local', secretAccessKey: 'local' } });
const url = 'http://localhost:4566/000000000000/cloudportfolio-budget-local';
const python = process.env.PYTHON || (process.platform === 'win32' ? 'py' : 'python3');
let pythonPrefix = process.platform === 'win32' ? ['-3.12'] : [];
if (process.platform === 'win32' && !process.env.PYTHON) {
  const available = await new Promise((resolve) => { const probe = spawn(python, ['-3.12', '--version'], { stdio: 'ignore' }); probe.on('error', () => resolve(false)); probe.on('exit', (code) => resolve(code === 0)); });
  if (!available) pythonPrefix = ['-3.11'];
}
const pythonArgs = [...pythonPrefix, '-c', `import json,sys; from app import consume; print(json.dumps(consume(json.load(sys.stdin))))`];
const budgetDir = new URL('../services/budget-service/', import.meta.url);
console.log(JSON.stringify({ level: 'info', service: 'budget-worker', queue: url }));
let running = true;
process.on('SIGINT', () => { running = false; }); process.on('SIGTERM', () => { running = false; });
while (running) {
  const result = await sqs.send(new ReceiveMessageCommand({ QueueUrl: url, MaxNumberOfMessages: 5, WaitTimeSeconds: 10, VisibilityTimeout: 60 }));
  if (!result.Messages?.length) continue;
  const records = result.Messages.map((message) => ({ messageId: message.MessageId, body: message.Body }));
  const invoke = () => new Promise((resolve) => {
    const worker = spawn(python, pythonArgs, { cwd: budgetDir, env: { ...process.env, TABLE_NAME: 'cloudportfolio-budget-local', DYNAMODB_ENDPOINT: 'http://localhost:8000', LOCAL_JWT_SECRET: process.env.LOCAL_JWT_SECRET || 'local-only-change-this-secret-before-sharing', AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'local', AWS_SECRET_ACCESS_KEY: 'local' }, stdio: ['pipe','pipe','pipe'] });
    let stdout = '', stderr = ''; worker.stdout.on('data', (chunk) => stdout += chunk); worker.stderr.on('data', (chunk) => stderr += chunk);
    worker.on('close', (code) => { if (stderr.trim()) console.error(stderr.trim()); try { resolve(code ? { batchItemFailures: records.map(r => ({ itemIdentifier: r.messageId })) } : JSON.parse(stdout.trim().split(/\r?\n/).at(-1))); } catch { resolve({ batchItemFailures: records.map(r => ({ itemIdentifier: r.messageId })) }); } });
    worker.stdin.end(JSON.stringify({ Records: records }));
  });
  const processed = await invoke();
  const failed = new Set((processed.batchItemFailures || []).map((failure) => failure.itemIdentifier));
  for (const message of result.Messages) {
    if (failed.has(message.MessageId)) await sqs.send(new ChangeMessageVisibilityCommand({ QueueUrl: url, ReceiptHandle: message.ReceiptHandle, VisibilityTimeout: 10 }));
    else await sqs.send(new DeleteMessageCommand({ QueueUrl: url, ReceiptHandle: message.ReceiptHandle }));
  }
}
await sqs.destroy();
