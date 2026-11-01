import { DynamoDBClient, CreateTableCommand, DescribeTableCommand, UpdateTableCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, CreateBucketCommand, PutPublicAccessBlockCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3';
import { SNSClient, CreateTopicCommand, ListSubscriptionsByTopicCommand, SubscribeCommand, SetSubscriptionAttributesCommand } from '@aws-sdk/client-sns';
import { SQSClient, CreateQueueCommand, GetQueueAttributesCommand, SetQueueAttributesCommand } from '@aws-sdk/client-sqs';

const dynamo = new DynamoDBClient({ endpoint: process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000', region: 'us-east-1', credentials: { accessKeyId: 'local', secretAccessKey: 'local' }, maxAttempts: 2 });
for (const service of ['identity','portfolio','project','resource','budget','priority']) {
  const TableName = `cloudportfolio-${service}-local`;
  try {
    const existing = await dynamo.send(new DescribeTableCommand({ TableName }));
    if (service === 'identity') {
      const indexes = existing.Table.GlobalSecondaryIndexes || [];
      const missing = [];
      if (!indexes.some(index => index.IndexName === 'FlowDueIndex')) missing.push({ IndexName: 'FlowDueIndex', AttributeDefinitions: [{ AttributeName: 'gsi2pk', AttributeType: 'S' }, { AttributeName: 'gsi2sk', AttributeType: 'S' }], KeySchema: [{ AttributeName: 'gsi2pk', KeyType: 'HASH' }, { AttributeName: 'gsi2sk', KeyType: 'RANGE' }] });
      if (!indexes.some(index => index.IndexName === 'WhatsAppNumberIndex')) missing.push({ IndexName: 'WhatsAppNumberIndex', AttributeDefinitions: [{ AttributeName: 'gsi3pk', AttributeType: 'S' }, { AttributeName: 'gsi3sk', AttributeType: 'S' }], KeySchema: [{ AttributeName: 'gsi3pk', KeyType: 'HASH' }, { AttributeName: 'gsi3sk', KeyType: 'RANGE' }] });
      for (const index of missing) {
        await dynamo.send(new UpdateTableCommand({ TableName, AttributeDefinitions: index.AttributeDefinitions, GlobalSecondaryIndexUpdates: [{ Create: { IndexName: index.IndexName, KeySchema: index.KeySchema, Projection: { ProjectionType: 'ALL' } } }] }));
        for (let attempt = 0; attempt < 60; attempt++) { const state = await dynamo.send(new DescribeTableCommand({ TableName })); if (state.Table.GlobalSecondaryIndexes?.some(item => item.IndexName === index.IndexName && item.IndexStatus === 'ACTIVE')) break; await new Promise(resolve => setTimeout(resolve, 500)); }
      }
      if (missing.length) console.log(`Added missing identity indexes to ${TableName}`);
    }
  }
  catch (error) {
    if (error.name !== 'ResourceNotFoundException') throw error;
    const flowIndex = service === 'identity' ? { AttributeDefinitions: [{ AttributeName: 'gsi2pk', AttributeType: 'S' }, { AttributeName: 'gsi2sk', AttributeType: 'S' }, { AttributeName: 'gsi3pk', AttributeType: 'S' }, { AttributeName: 'gsi3sk', AttributeType: 'S' }], GlobalSecondaryIndexes: [{ IndexName: 'FlowDueIndex', KeySchema: [{ AttributeName: 'gsi2pk', KeyType: 'HASH' }, { AttributeName: 'gsi2sk', KeyType: 'RANGE' }], Projection: { ProjectionType: 'ALL' } }, { IndexName: 'WhatsAppNumberIndex', KeySchema: [{ AttributeName: 'gsi3pk', KeyType: 'HASH' }, { AttributeName: 'gsi3sk', KeyType: 'RANGE' }], Projection: { ProjectionType: 'ALL' } }] } : {};
    await dynamo.send(new CreateTableCommand({ TableName, BillingMode: 'PAY_PER_REQUEST', AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }, { AttributeName: 'sk', AttributeType: 'S' }, ...(flowIndex.AttributeDefinitions || [])], KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }, { AttributeName: 'sk', KeyType: 'RANGE' }], ...(flowIndex.GlobalSecondaryIndexes ? { GlobalSecondaryIndexes: flowIndex.GlobalSecondaryIndexes } : {}) }));
    console.log(`Created ${TableName}`);
  }
}
const remindersTable = 'cloudportfolio-reminders-local';
try { await dynamo.send(new DescribeTableCommand({ TableName: remindersTable })); }
catch (error) {
  if (error.name !== 'ResourceNotFoundException') throw error;
  await dynamo.send(new CreateTableCommand({
    TableName: remindersTable,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'pk', AttributeType: 'S' }, { AttributeName: 'sk', AttributeType: 'S' },
      { AttributeName: 'gsi1pk', AttributeType: 'S' }, { AttributeName: 'gsi1sk', AttributeType: 'S' },
    ],
    KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }, { AttributeName: 'sk', KeyType: 'RANGE' }],
    GlobalSecondaryIndexes: [{ IndexName: 'DueIndex', KeySchema: [{ AttributeName: 'gsi1pk', KeyType: 'HASH' }, { AttributeName: 'gsi1sk', KeyType: 'RANGE' }], Projection: { ProjectionType: 'ALL' } }],
  }));
  console.log(`Created ${remindersTable} with persistent due-time index`);
}
await dynamo.destroy();

const endpoint = process.env.LOCALSTACK_ENDPOINT || 'http://localhost:4566';
const clientConfig = { endpoint, region: 'us-east-1', credentials: { accessKeyId: 'local', secretAccessKey: 'local' } };
const s3 = new S3Client({ ...clientConfig, forcePathStyle: true }); const sns = new SNSClient(clientConfig); const sqs = new SQSClient(clientConfig);
const bucket = 'cloudportfolio-documents-local';
try { await s3.send(new CreateBucketCommand({ Bucket: bucket })); } catch (error) { if (!/BucketAlreadyOwnedByYou|BucketAlreadyExists/.test(error.name)) throw error; }
await s3.send(new PutPublicAccessBlockCommand({ Bucket: bucket, PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true } }));
await s3.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: [{ AllowedOrigins: ['http://localhost:5173'], AllowedMethods: ['GET','PUT','HEAD'], AllowedHeaders: ['*'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 3000 }] } }));
const topic = await sns.send(new CreateTopicCommand({ Name: 'cloudportfolio-domain-local' }));
const dlq = await sqs.send(new CreateQueueCommand({ QueueName: 'cloudportfolio-domain-dlq-local' }));
const dlqArn = (await sqs.send(new GetQueueAttributesCommand({ QueueUrl: dlq.QueueUrl, AttributeNames: ['QueueArn'] }))).Attributes.QueueArn;
const whatsappDlq = await sqs.send(new CreateQueueCommand({ QueueName: 'cloudportfolio-whatsapp-dlq-local' }));
const whatsappDlqArn = (await sqs.send(new GetQueueAttributesCommand({ QueueUrl: whatsappDlq.QueueUrl, AttributeNames: ['QueueArn'] }))).Attributes.QueueArn;
await sqs.send(new CreateQueueCommand({ QueueName: 'cloudportfolio-whatsapp-local', Attributes: { VisibilityTimeout: '180', RedrivePolicy: JSON.stringify({ deadLetterTargetArn: whatsappDlqArn, maxReceiveCount: '5' }) } }));
const eventFilters = { budget: ['ProjectCreated'], project: ['BudgetThresholdExceeded'], portfolio: ['ProjectCreated','ProjectCompleted'], resource: ['ProjectCreated','ProjectUpdated'], priority: ['ProjectCreated','ProjectUpdated','BudgetThresholdExceeded','ResourceAssigned'], identity: ['UserCreated','MembershipChanged','ProjectCreated','ProjectUpdated','ProjectCompleted','BudgetThresholdExceeded','ResourceAssigned','PriorityRecalculated'] };
for (const service of ['budget','project','portfolio','resource','priority','identity']) {
  const queue = await sqs.send(new CreateQueueCommand({ QueueName: `cloudportfolio-${service}-local`, Attributes: { VisibilityTimeout: '120', RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: '4' }) } }));
  const queueArn = (await sqs.send(new GetQueueAttributesCommand({ QueueUrl: queue.QueueUrl, AttributeNames: ['QueueArn'] }))).Attributes.QueueArn;
  await sqs.send(new SetQueueAttributesCommand({ QueueUrl: queue.QueueUrl, Attributes: { Policy: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'sns.amazonaws.com' }, Action: 'sqs:SendMessage', Resource: queueArn, Condition: { ArnEquals: { 'aws:SourceArn': topic.TopicArn } } }] }) } }));
  let token, subscriptionArn;
  do { const listed = await sns.send(new ListSubscriptionsByTopicCommand({ TopicArn: topic.TopicArn, NextToken: token })); subscriptionArn = listed.Subscriptions?.find((item) => item.Protocol === 'sqs' && item.Endpoint === queueArn)?.SubscriptionArn; token = listed.NextToken; } while (token && !subscriptionArn);
  if (!subscriptionArn || subscriptionArn === 'PendingConfirmation') subscriptionArn = (await sns.send(new SubscribeCommand({ TopicArn: topic.TopicArn, Protocol: 'sqs', Endpoint: queueArn }))).SubscriptionArn;
  if (subscriptionArn && subscriptionArn !== 'PendingConfirmation') await sns.send(new SetSubscriptionAttributesCommand({ SubscriptionArn: subscriptionArn, AttributeName: 'FilterPolicy', AttributeValue: JSON.stringify({ eventType: eventFilters[service] }) }));
}
await s3.destroy(); await sns.destroy(); await sqs.destroy();
console.log('Local DynamoDB tables, protected S3 bucket, SNS subscriptions, notification queue and dead-letter queues are ready.');
