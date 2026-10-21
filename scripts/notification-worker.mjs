import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, ChangeMessageVisibilityCommand } from '@aws-sdk/client-sqs';

const endpoint = process.env.SQS_ENDPOINT || 'http://localhost:4566';
const sqs = new SQSClient({ endpoint, region: 'us-east-1', credentials: { accessKeyId: 'local', secretAccessKey: 'local' } });
const db = DynamoDBDocumentClient.from(new DynamoDBClient({ endpoint: process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000', region: 'us-east-1', credentials: { accessKeyId: 'local', secretAccessKey: 'local' } }));
const queue = `${endpoint}/000000000000/cloudportfolio-identity-local`;
let running = true;
process.on('SIGINT', () => { running = false; }); process.on('SIGTERM', () => { running = false; });
const allowedNow = (pref) => {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: pref.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).split(':').map(Number);
    const current = parts[0] * 60 + parts[1], start = Number(pref.allowedHours.start.slice(0, 2)) * 60 + Number(pref.allowedHours.start.slice(3)), end = Number(pref.allowedHours.end.slice(0, 2)) * 60 + Number(pref.allowedHours.end.slice(3));
    return start <= end ? current >= start && current <= end : current >= start || current <= end;
  } catch { return false; }
};
console.log(JSON.stringify({ level: 'info', service: 'notification-worker', mode: 'SIMULATED_LOCAL_NOT_SENT', queue }));
while (running) {
  const batch = await sqs.send(new ReceiveMessageCommand({ QueueUrl: queue, MaxNumberOfMessages: 5, WaitTimeSeconds: 10, VisibilityTimeout: 60 }));
  for (const message of batch.Messages || []) {
    try {
      const envelope = JSON.parse(message.Body || '{}'); const event = JSON.parse(envelope.Message || message.Body || '{}');
      if (!event.eventId || !event.tenantId || !event.eventType) throw new Error('Invalid domain event');
      const prefs = await db.send(new QueryCommand({ TableName: 'cloudportfolio-identity-local', KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)', ExpressionAttributeValues: { ':pk': `TENANT#${event.tenantId}`, ':prefix': 'NOTIFY#PREFERENCES#' }, Limit: 100 }));
      for (const pref of prefs.Items || []) {
        const userId = pref.sk.slice('NOTIFY#PREFERENCES#'.length);
        if (!pref.enabled || pref.frequency !== 'immediate' || !pref.alertTypes?.includes(event.eventType) || !allowedNow(pref)) continue;
        const item = { pk: pref.pk, sk: `NOTIFY#DELIVERY#${userId}#${event.eventId}`, eventId: event.eventId, eventType: event.eventType, userId, tenantId: event.tenantId, projectId: event.payload?.projectId || event.entityId, title: event.eventType, deliveryStatus: 'SIMULATED_LOCAL', provider: 'local-mailbox', notice: 'Simulado localmente — No enviado a WhatsApp', createdAt: new Date().toISOString() };
        try { await db.send(new PutCommand({ TableName: 'cloudportfolio-identity-local', Item: item, ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)' })); }
        catch (error) { if (error.name !== 'ConditionalCheckFailedException') throw error; }
      }
      await sqs.send(new DeleteMessageCommand({ QueueUrl: queue, ReceiptHandle: message.ReceiptHandle }));
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', service: 'notification-worker', message: error.message }));
      await sqs.send(new ChangeMessageVisibilityCommand({ QueueUrl: queue, ReceiptHandle: message.ReceiptHandle, VisibilityTimeout: 10 }));
    }
  }
}
await Promise.all([sqs.destroy(), db.destroy()]);
