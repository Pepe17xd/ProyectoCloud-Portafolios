import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';

const endpoint = process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000';
const parsed = new URL(endpoint);
if (!['localhost', '127.0.0.1', 'dynamodb'].includes(parsed.hostname) || parsed.port !== '8000') {
  throw new Error('Demo seed is restricted to local DynamoDB at port 8000. AWS volume uses seed-large-aws.mjs with explicit confirmation.');
}
const tenants = ['tenant-a', 'tenant-b', 'tenant-c'];
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ endpoint, region: 'us-east-1', credentials: { accessKeyId: 'local', secretAccessKey: 'local' } }));
const createdAt = new Date().toISOString();

function item(service, tenant, sk, fields) {
  return { pk: `TENANT#${tenant}`, sk, createdAt, ...fields };
}
function dataset(service, tenant) {
  const suffix = tenant.at(-1);
  const admin = `demo-admin-${suffix}`;
  const manager = `demo-manager-${suffix}`;
  const viewer = `demo-viewer-${suffix}`;
  const portfolio = `portfolio-${tenant}-001`;
  const project = `project-${tenant}-001`;
  const resource = `resource-${tenant}-001`;
  const budget = `budget-${tenant}-001`;
  switch (service) {
    case 'identity': return [
      item(service, tenant, `TENANTMETA#${tenant}`, { id: tenant, name: `Empresa ${suffix.toUpperCase()}`, status: 'ACTIVE', plan: 'DEMO', entityType: 'Tenant' }),
      ...[
        [admin, 'ADMIN', `admin-${suffix}@demo.local`, 'Alicia Admin'],
        [manager, 'MANAGER', `manager-${suffix}@demo.local`, 'Marco Manager'],
        [viewer, 'VIEWER', `viewer-${suffix}@demo.local`, 'Valeria Viewer'],
      ].map(([id, role, email, name]) => item(service, tenant, `ITEM#${id}`, { id, role, email, name, status: 'ACTIVE', entityType: 'UserProfile' })),
      ...[[admin, 'ADMIN'], [manager, 'MANAGER'], [viewer, 'VIEWER']].map(([userId, role]) => item(service, tenant, `MEMBERSHIP#${userId}`, { id: userId, userId, role, status: 'ACTIVE', entityType: 'Membership' })),
    ];
    case 'portfolio': return [
      item(service, tenant, `ITEM#${portfolio}`, { id: portfolio, name: `Portafolio ${suffix.toUpperCase()}`, description: 'Portafolio de demostración', ownerId: admin, status: 'ACTIVE', entityType: 'Portfolio' }),
      item(service, tenant, `OBJECTIVE#${portfolio}#objective-001`, { id: 'objective-001', portfolioId: portfolio, name: 'Modernizar operaciones', status: 'ACTIVE', entityType: 'Objective' }),
    ];
    case 'project': return [
      item(service, tenant, `ITEM#${project}`, { id: project, name: `Proyecto ${suffix.toUpperCase()}`, portfolioId: portfolio, ownerId: manager, status: 'ACTIVE', startDate: '2026-10-01', endDate: '2027-03-31', entityType: 'Project' }),
      item(service, tenant, `TASK#${project}#task-001`, { id: 'task-001', projectId: project, title: 'Definir alcance', status: 'IN_PROGRESS', assigneeId: manager, dueDate: '2026-11-15', entityType: 'Task' }),
      item(service, tenant, `TASK#${project}#task-002`, { id: 'task-002', projectId: project, title: 'Validar arquitectura', status: 'TODO', assigneeId: viewer, dueDate: '2026-12-01', entityType: 'Task' }),
      item(service, tenant, `MILESTONE#${project}#milestone-001`, { id: 'milestone-001', projectId: project, name: 'Diseño aprobado', status: 'PLANNED', dueDate: '2026-12-15', entityType: 'Milestone' }),
    ];
    case 'resource': return [
      item(service, tenant, `ITEM#${resource}`, { id: resource, name: `Recurso ${suffix.toUpperCase()}`, type: 'PERSON', capacity: 1, allocated: 0.5, remainingCapacity: 0.5, status: 'ACTIVE', skills: ['planning', 'delivery'], entityType: 'Resource' }),
      item(service, tenant, `ITEM#assignment-${tenant}-001`, { id: `assignment-${tenant}-001`, entityType: 'Assignment', resourceId: resource, projectId: project, allocation: 0.5, startDate: '2026-10-01', endDate: '2027-03-31' }),
    ];
    case 'budget': return [
      item(service, tenant, `ITEM#${budget}`, { id: budget, entityType: 'Budget', projectId: project, allocated: 50000, spent: 1250, balance: 48750, currency: 'USD' }),
      item(service, tenant, `EXPENSE#expense-${tenant}-001`, { id: `expense-${tenant}-001`, entityType: 'Expense', budgetId: budget, projectId: project, amount: 1250, description: 'Licencias de planificación', currency: 'USD', createdBy: manager }),
    ];
    case 'priority': return [
      item(service, tenant, `ITEM#${project}`, { id: project, entityType: 'Assessment', projectId: project, impact: 85, urgency: 70, risk: 25, alignment: 90, score: 81, criteria: [], createdBy: manager }),
    ];
    default: throw new Error(`Unknown service ${service}`);
  }
}

const report = { mode: 'demo', target: 'DynamoDB Local', tenantCount: tenants.length, generatedAt: createdAt, services: {} };
for (const service of ['identity', 'portfolio', 'project', 'resource', 'budget', 'priority']) {
  const tableName = `cloudportfolio-${service}-local`;
  report.services[service] = {};
  for (const tenant of tenants) {
    let inserted = 0;
    const expected = dataset(service, tenant);
    for (const record of expected) {
      try {
        await ddb.send(new PutCommand({ TableName: tableName, Item: record, ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)' }));
        inserted++;
      } catch (error) {
        if (error.name !== 'ConditionalCheckFailedException') throw error;
      }
    }
    let verified = 0;
    for (const record of expected) {
      const result = await ddb.send(new GetCommand({ TableName: tableName, Key: { pk: record.pk, sk: record.sk } }));
      const matches = result.Item && Object.entries(record).every(([field, expectedValue]) => field === 'createdAt' || JSON.stringify(result.Item[field]) === JSON.stringify(expectedValue));
      if (matches) verified++;
      else if (result.Item) throw new Error(`Existing demo record conflicts with the canonical fixture at ${service}/${tenant}/${record.sk}; no data was overwritten.`);
    }
    report.services[service][tenant] = { expected: expected.length, inserted, verified, tenantPartition: `TENANT#${tenant}` };
    if (verified !== expected.length) throw new Error(`Demo seed verification failed for ${service}/${tenant}`);
  }
}
report.totalExpected = Object.values(report.services).reduce((n, tenantsReport) => n + Object.values(tenantsReport).reduce((m, row) => m + row.expected, 0), 0);
report.totalInserted = Object.values(report.services).reduce((n, tenantsReport) => n + Object.values(tenantsReport).reduce((m, row) => m + row.inserted, 0), 0);
report.totalVerified = Object.values(report.services).reduce((n, tenantsReport) => n + Object.values(tenantsReport).reduce((m, row) => m + row.verified, 0), 0);
report.reportPath = 'seed-report-demo.json';
await (await import('node:fs/promises')).writeFile(report.reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ target: report.target, totalExpected: report.totalExpected, totalInserted: report.totalInserted, totalVerified: report.totalVerified, reportPath: report.reportPath }, null, 2));
await ddb.destroy();
