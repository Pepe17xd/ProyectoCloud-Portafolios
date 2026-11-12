import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SNSClient } from '@aws-sdk/client-sns';
import { createEmailRuntime } from '../services/identity-service/email-notifications.mjs';
import { runDueReminders } from '../services/identity-service/orbital.mjs';

const interval = Math.max(5, Number(process.env.REMINDER_POLL_SECONDS) || 15) * 1000;
const endpoint = process.env.DYNAMODB_ENDPOINT;
const table = process.env.TABLE_NAME;
const db = DynamoDBDocumentClient.from(new DynamoDBClient({ endpoint, region: process.env.AWS_REGION || 'us-east-1', ...(endpoint ? { credentials: { accessKeyId: 'local', secretAccessKey: 'local' } } : {}) }));
const sns = new SNSClient({ region: process.env.AWS_REGION || 'us-east-1', ...(process.env.SNS_ENDPOINT ? { endpoint: process.env.SNS_ENDPOINT, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } } : {}) });
const mode = process.env.NOTIFICATION_MODE || 'disabled';
const email = createEmailRuntime({ db, table, sns, domainTopicArn: process.env.TOPIC_ARN || '', emailTopicArn: process.env.EMAIL_TOPIC_ARN || '', mode });
let running = true;
process.on('SIGINT', () => { running = false; });
process.on('SIGTERM', () => { running = false; });
console.log(JSON.stringify({ level: 'info', service: 'reminder-scheduler', mode, intervalMs: interval }));
while (running) {
  try {
    const results = await runDueReminders({ enqueueEmail: email.enqueue });
    for (const result of results) console.log(JSON.stringify({ level: 'info', service: 'reminder-scheduler', ...result }));
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', service: 'reminder-scheduler', code: error.code || 'INTERNAL' }));
  }
  await new Promise((resolve) => setTimeout(resolve, interval));
}
await Promise.all([db.destroy(), sns.destroy()]);
