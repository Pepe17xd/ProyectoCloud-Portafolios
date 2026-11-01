import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SQSClient } from '@aws-sdk/client-sqs';
import { createWhatsAppRuntime } from '../services/identity-service/whatsapp-runtime.mjs';
import { localMetaMockConfig } from '../services/identity-service/whatsapp-local-provider.mjs';
import { runDueReminders } from '../services/identity-service/orbital.mjs';

const interval = Math.max(5, Number(process.env.REMINDER_POLL_SECONDS) || 15) * 1000;
const endpoint = process.env.DYNAMODB_ENDPOINT;
const table = process.env.TABLE_NAME;
const queueUrl = process.env.WHATSAPP_QUEUE_URL;
const db = DynamoDBDocumentClient.from(new DynamoDBClient({ endpoint, region: process.env.AWS_REGION || 'us-east-1', ...(endpoint ? { credentials: { accessKeyId: 'local', secretAccessKey: 'local' } } : {}) }));
const sqs = new SQSClient({ endpoint: process.env.SQS_ENDPOINT, region: process.env.AWS_REGION || 'us-east-1', ...(process.env.SQS_ENDPOINT ? { credentials: { accessKeyId: 'local', secretAccessKey: 'local' } } : {}) });
const mode = process.env.NOTIFICATION_MODE || 'disabled';
const whatsapp = createWhatsAppRuntime({ db, table, sqs, queueUrl, mode, secretProvider: async () => mode === 'integration-test' && process.env.WHATSAPP_PROVIDER_MODE === 'meta-mock' ? localMetaMockConfig(process.env.WHATSAPP_META_API_ORIGIN) : null, allowTestDelivery: mode === 'integration-test' && process.env.WHATSAPP_ALLOW_TEST_DELIVERY === 'true' });
let running = true;
process.on('SIGINT', () => { running = false; });
process.on('SIGTERM', () => { running = false; });
console.log(JSON.stringify({ level: 'info', service: 'reminder-scheduler', mode: mode === 'integration-test' ? 'LOCAL_META_MOCK' : mode, intervalMs: interval }));
while (running) {
  try {
    const results = await runDueReminders({ enqueueWhatsApp: whatsapp.enqueue });
    for (const result of results) console.log(JSON.stringify({ level: 'info', service: 'reminder-scheduler', ...result }));
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', service: 'reminder-scheduler', code: error.code || 'INTERNAL' }));
  }
  await new Promise((resolve) => setTimeout(resolve, interval));
}
await Promise.all([db.destroy(), sqs.destroy()]);
