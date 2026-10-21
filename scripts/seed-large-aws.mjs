import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { faker } from '@faker-js/faker';
import { allocateSeedPartitions } from './seed-plan.mjs';

const confirmed = process.argv.includes('--confirm-aws-academy');
const stage = process.env.AWS_STAGE;
const region = process.env.AWS_REGION;
const expectedAccount = process.env.AWS_ACCOUNT_ID;
const totalRecords = process.env.SEED_TOTAL_RECORDS === undefined ? null : Number(process.env.SEED_TOTAL_RECORDS);
const perTenant = Number(process.env.RECORDS_PER_TENANT || 10000);
const concurrency = Number(process.env.SEED_CONCURRENCY || 8);
const tenants = (process.env.SEED_TENANTS || 'tenant-a,tenant-b,tenant-c').split(',').map((value) => value.trim()).filter(Boolean);

if (!confirmed || process.env.ASTRA_SEED_TARGET !== 'aws-academy') throw new Error('Mass seed disabled. Explicitly set ASTRA_SEED_TARGET=aws-academy and pass --confirm-aws-academy only in the authorized lab.');
if (!stage || !region || !expectedAccount) throw new Error('AWS_STAGE, AWS_REGION and AWS_ACCOUNT_ID are required.');
if (process.env.DYNAMODB_ENDPOINT || process.env.AWS_ENDPOINT_URL) throw new Error('Custom/local DynamoDB endpoints are forbidden for the AWS mass seed.');
if (totalRecords !== null && process.env.RECORDS_PER_TENANT !== undefined) throw new Error('Choose only one of SEED_TOTAL_RECORDS or RECORDS_PER_TENANT.');
if (totalRecords !== null && (!Number.isSafeInteger(totalRecords) || totalRecords < 1 || totalRecords > 180000)) throw new Error('SEED_TOTAL_RECORDS must be between 1 and 180000.');
if (totalRecords === null && (!Number.isSafeInteger(perTenant) || perTenant < 1 || perTenant > 10000)) throw new Error('RECORDS_PER_TENANT must be between 1 and 10000.');
if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('SEED_CONCURRENCY must be between 1 and 16.');
if (tenants.length !== 3 || new Set(tenants).size !== 3 || tenants.some((tenant) => !/^[a-z0-9-]{2,40}$/.test(tenant))) throw new Error('Exactly three distinct safe tenant identifiers are required.');

const identity = await new STSClient({ region }).send(new GetCallerIdentityCommand({}));
if (identity.Account !== expectedAccount) throw new Error(`Caller account does not match AWS_ACCOUNT_ID (caller account was not printed).`);
const client = new DynamoDBClient({ region, maxAttempts: 4 });
const ddb = DynamoDBDocumentClient.from(client);
const services = ['identity', 'portfolio', 'project', 'resource', 'budget', 'priority'];
const partitionPlan = totalRecords === null ? null : allocateSeedPartitions(totalRecords, services, tenants);
const stamp = new Date().toISOString();
faker.seed(Number(process.env.SEED || 20322026));

function record(service, tenant, n) {
  const id = `${service}-${tenant}-${String(n).padStart(6, '0')}`;
  const common = { pk: `TENANT#${tenant}`, sk: `ITEM#${id}`, id, seed: true, createdAt: stamp };
  const projectId = `project-${tenant}-${String(n).padStart(6, '0')}`;
  const portfolioId = `portfolio-${tenant}-${String(n).padStart(6, '0')}`;
  switch (service) {
    case 'identity': return { ...common, name: faker.person.fullName(), email: `seed-${n}@${tenant}.demo.local`, role: 'VIEWER', status: 'ACTIVE', entityType: 'UserProfile' };
    case 'portfolio': return { ...common, name: `Portfolio ${n + 1}`, description: faker.company.catchPhrase(), ownerId: `demo-admin-${tenant.slice(-1)}`, status: 'ACTIVE', entityType: 'Portfolio' };
    case 'project': return { ...common, id: projectId, name: `Project ${n + 1}`, portfolioId, ownerId: `demo-manager-${tenant.slice(-1)}`, status: ['PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED'][n % 4], startDate: '2026-01-01', endDate: '2026-12-31', progress: n % 101, entityType: 'Project' };
    case 'resource': return { ...common, name: faker.person.fullName(), type: 'PERSON', skills: ['planning', 'delivery'], capacity: 1, allocated: 0, remainingCapacity: 1, status: 'ACTIVE', entityType: 'Resource' };
    case 'budget': return { ...common, projectId, allocated: 50000 + n * 10, spent: n % 20000, balance: 50000 + n * 10 - n % 20000, currency: 'USD', entityType: 'Budget' };
    default: { const impact = n % 5 + 1, urgency = (n + 2) % 5 + 1, risk = n % 5 + 1, alignment = (n + 1) % 5 + 1; return { ...common, projectId, impact, urgency, risk, alignment, score: Number((alignment * 0.4 + impact * 0.3 + urgency * 0.2 + (6 - risk) * 0.1).toFixed(2)), entityType: 'Assessment' }; }
  }
}

async function seedPartition(service, tenant, requested) {
  const table = `cloudportfolio-${service}-${stage}`;
  const prefix = `ITEM#${service}-${tenant}-`;
  const existing = new Set();
  let cursor;
  do {
    const page = await ddb.send(new QueryCommand({
      TableName: table,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: { ':pk': `TENANT#${tenant}`, ':prefix': prefix },
      ProjectionExpression: 'sk',
      ExclusiveStartKey: cursor,
    }));
    for (const row of page.Items || []) existing.add(row.sk);
    cursor = page.LastEvaluatedKey;
  } while (cursor);

  const missing = Array.from({ length: requested }, (_, n) => n).filter((n) => !existing.has(`${prefix}${String(n).padStart(6, '0')}`));
  const batches = Array.from({ length: Math.ceil(missing.length / 25) }, (_, batch) => missing.slice(batch * 25, (batch + 1) * 25).map((n) => ({ PutRequest: { Item: record(service, tenant, n) } })));
  let next = 0, completed = 0;
  async function worker() {
    while (next < batches.length) {
      let pending = batches[next++];
      for (let attempt = 0; pending.length; attempt++) {
        const result = await ddb.send(new BatchWriteCommand({ RequestItems: { [table]: pending } }));
        pending = result.UnprocessedItems?.[table] || [];
        if (pending.length) {
          if (attempt >= 8) throw new Error(`Unprocessed batch retry limit reached for ${service}/${tenant}. Rerun to resume.`);
          await new Promise((resolve) => setTimeout(resolve, Math.min(100 * 2 ** attempt, 3000)));
        }
      }
      completed++;
      if (completed % 100 === 0) console.log(`${service}/${tenant}: ${Math.min(completed * 25, missing.length)} / ${missing.length} pending records written`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));

  let verified = 0;
  cursor = undefined;
  do {
    const page = await ddb.send(new QueryCommand({
      TableName: table,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      FilterExpression: '#seed = :seed',
      ExpressionAttributeNames: { '#seed': 'seed' },
      ExpressionAttributeValues: { ':pk': `TENANT#${tenant}`, ':prefix': prefix, ':seed': true },
      Select: 'COUNT',
      ExclusiveStartKey: cursor,
    }));
    verified += page.Count || 0;
    cursor = page.LastEvaluatedKey;
  } while (cursor);
  if (verified !== requested) throw new Error(`Verification mismatch for ${service}/${tenant}: expected ${requested}, found ${verified}.`);
  return { requested, inserted: missing.length, verified, table };
}

const report = { mode: totalRecords === null ? 'aws-academy-full' : 'aws-academy-custom-total', stage, region, accountVerified: true, tenants, recordsPerTenantPerService: totalRecords === null ? perTenant : null, totalRequested: totalRecords, recordsPerPartition: partitionPlan, startedAt: stamp, services: {} };
for (let serviceIndex = 0; serviceIndex < services.length; serviceIndex += 1) {
  const service = services[serviceIndex];
  report.services[service] = {};
  for (let tenantIndex = 0; tenantIndex < tenants.length; tenantIndex += 1) {
    const tenant = tenants[tenantIndex];
    const requested = partitionPlan ? partitionPlan[`${service}/${tenant}`] : perTenant;
    report.services[service][tenant] = await seedPartition(service, tenant, requested);
    console.log(`${service}/${tenant}: inserted=${report.services[service][tenant].inserted}, verified=${report.services[service][tenant].verified}`);
  }
}
report.totalExpected = Object.values(report.recordsPerPartition || {}).reduce((sum, count) => sum + count, 0) || services.length * tenants.length * perTenant;
report.finishedAt = new Date().toISOString();
report.reportPath = `seed-report-${stage}.json`;
await (await import('node:fs/promises')).writeFile(report.reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ totalExpected: report.totalExpected, reportPath: report.reportPath }, null, 2));
await ddb.destroy();
