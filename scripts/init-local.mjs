import { DynamoDBClient, CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, CreateBucketCommand, PutPublicAccessBlockCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3';
import { SNSClient, CreateTopicCommand, ListSubscriptionsByTopicCommand, SubscribeCommand, SetSubscriptionAttributesCommand } from '@aws-sdk/client-sns';
import { SQSClient, CreateQueueCommand, GetQueueAttributesCommand, SetQueueAttributesCommand } from '@aws-sdk/client-sqs';

const dynamo = new DynamoDBClient({ endpoint: process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000', region: 'us-east-1', credentials: { accessKeyId: 'local', secretAccessKey: 'local' }, maxAttempts: 2 });
for (const service of ['identity','portfolio','project','resource','budget','priority']) {
  const TableName = `cloudportfolio-${service}-local`;
  try { await dynamo.send(new DescribeTableCommand({ TableName })); }
  catch (error) {
    if (error.name !== 'ResourceNotFoundException') throw error;
    await dynamo.send(new CreateTableCommand({ TableName, BillingMode: 'PAY_PER_REQUEST', AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }, { AttributeName: 'sk', AttributeType: 'S' }], KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }, { AttributeName: 'sk', KeyType: 'RANGE' }] }));
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
console.log('Local DynamoDB tables (including reminders), protected S3 bucket, SNS topic, six SQS subscriptions and DLQ are ready.');
