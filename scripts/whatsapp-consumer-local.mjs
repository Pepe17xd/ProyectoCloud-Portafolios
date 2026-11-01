import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, ChangeMessageVisibilityCommand } from '@aws-sdk/client-sqs';
import { createWhatsAppRuntime, processWhatsAppJob } from '../services/identity-service/whatsapp-runtime.mjs';
import { localMetaMockConfig } from '../services/identity-service/whatsapp-local-provider.mjs';

if (process.env.NODE_ENV === 'production' || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NOTIFICATION_MODE !== 'integration-test' || process.env.WHATSAPP_PROVIDER_MODE !== 'meta-mock') throw new Error('Local WhatsApp consumer requires explicit non-production Meta mock mode.');
const endpoint = process.env.DYNAMODB_ENDPOINT || 'http://127.0.0.1:8000'; const sqsEndpoint = process.env.SQS_ENDPOINT || 'http://127.0.0.1:4566';
const table = process.env.TABLE_NAME || 'cloudportfolio-identity-local'; const queueUrl = process.env.WHATSAPP_QUEUE_URL || 'http://127.0.0.1:4566/000000000000/cloudportfolio-whatsapp-local';
const db = DynamoDBDocumentClient.from(new DynamoDBClient({ endpoint, region: 'us-east-1', credentials: { accessKeyId: 'local', secretAccessKey: 'local' } }));
const sqs = new SQSClient({ endpoint: sqsEndpoint, region: 'us-east-1', credentials: { accessKeyId: 'local', secretAccessKey: 'local' } });
const secret = localMetaMockConfig(process.env.WHATSAPP_META_API_ORIGIN);
const runtime = createWhatsAppRuntime({ db, table, sqs, queueUrl, mode: 'integration-test', secretProvider: async () => secret, testVerification: true, allowTestDelivery: true });
let running = true;
process.on('SIGTERM', () => { running = false; }); process.on('SIGINT', () => { running = false; });
console.log('Local WhatsApp SQS consumer ready; Meta calls target the local mock only.');
while (running) {
  const result = await sqs.send(new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 5, WaitTimeSeconds: 5, VisibilityTimeout: 60 }));
  for (const message of result.Messages || []) {
    try { await processWhatsAppJob({ job: JSON.parse(message.Body || '{}'), db, table, runtime }); await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle })); }
    catch (error) { console.error(JSON.stringify({ action: 'local.whatsapp.retry', code: error.code || 'INTERNAL' })); await sqs.send(new ChangeMessageVisibilityCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle, VisibilityTimeout: error.code === 'RETRYABLE' ? 5 : 60 })); }
  }
}
await Promise.all([db.destroy(), sqs.destroy()]);
