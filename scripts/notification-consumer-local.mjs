// Local stand-in for the "Notification Consumer" Lambda: polls the SQS Notifications queue
// (LocalStack) and runs the same handler code as AWS. NOTIFICATION_MODE=local simulates delivery:
// no e-mail is ever sent from a local machine.
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';

process.env.NOTIFICATION_MODE ||= 'local';
process.env.DYNAMODB_ENDPOINT ||= 'http://127.0.0.1:8000';
process.env.SNS_ENDPOINT ||= 'http://127.0.0.1:4566';
process.env.TABLE_NAME ||= 'cloudportfolio-identity-local';
process.env.TOPIC_ARN ||= 'arn:aws:sns:us-east-1:000000000000:cloudportfolio-domain-local';
const { notificationConsumer } = await import('../services/identity-service/handler.mjs');
const endpoint = process.env.SQS_ENDPOINT || 'http://127.0.0.1:4566';
const queueUrl = process.env.NOTIFICATION_QUEUE_URL || `${endpoint}/000000000000/cloudportfolio-notifications-local`;
const sqs = new SQSClient({ endpoint, region: 'us-east-1', credentials: { accessKeyId: 'local', secretAccessKey: 'local' } });
let running = true;
process.on('SIGINT', () => { running = false; });
process.on('SIGTERM', () => { running = false; });
console.log(JSON.stringify({ level: 'info', service: 'notification-consumer-local', mode: process.env.NOTIFICATION_MODE }));
while (running) {
  try {
    const received = await sqs.send(new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 5, WaitTimeSeconds: 5 }));
    const records = (received.Messages || []).map((m) => ({ messageId: m.MessageId, body: m.Body, receiptHandle: m.ReceiptHandle }));
    if (!records.length) continue;
    const { batchItemFailures } = await notificationConsumer({ Records: records });
    const failed = new Set(batchItemFailures.map((f) => f.itemIdentifier));
    for (const record of records) if (!failed.has(record.messageId)) await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: record.receiptHandle }));
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', service: 'notification-consumer-local', code: error.code || 'INTERNAL' }));
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
