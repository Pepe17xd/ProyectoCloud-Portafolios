import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { signLocalServiceToken } from '../shared/index.mjs';

const bases = {
  identity: process.env.FLOW_IDENTITY_URL || 'http://localhost:4101',
  portfolio: process.env.FLOW_PORTFOLIO_URL || 'http://localhost:4102',
  project: process.env.FLOW_PROJECT_URL || 'http://localhost:4103',
  resource: process.env.FLOW_RESOURCE_URL || 'http://localhost:4104',
  budget: process.env.FLOW_BUDGET_URL || 'http://localhost:4105',
  priority: process.env.FLOW_PRIORITY_URL || 'http://localhost:4106',
};
const endpoint = process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000';
const tables = Object.fromEntries(['identity', 'portfolio', 'project', 'resource', 'budget', 'priority'].map((name) => [name, `cloudportfolio-${name}-local`]));
const tenants = [
  { tenantId: 'tenant-a', suffix: 'a', userId: 'demo-admin-a', email: 'admin-a@demo.local', name: 'ProFiles integration A' },
  { tenantId: 'tenant-b', suffix: 'b', userId: 'demo-admin-b', email: 'admin-b@demo.local', name: 'ProFiles integration B' },
];
const runTag = `v242-${randomUUID()}`;
const created = [];
let integrationPassed = false;
if (!process.env.LOCAL_JWT_SECRET) throw new Error('Set LOCAL_JWT_SECRET to the same temporary runtime key used by the local APIs.');
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ endpoint, region: 'us-east-1', credentials: { accessKeyId: 'local', secretAccessKey: 'local' } }));

function key(tenantId, sk) { return { pk: `TENANT#${tenantId}`, sk }; }
async function putIfAbsent(table, item) {
  const itemKey = { pk: item.pk, sk: item.sk };
  const prior = await ddb.send(new GetCommand({ TableName: table, Key: itemKey }));
  if (prior.Item) return false;
  await ddb.send(new PutCommand({ TableName: table, Item: item, ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)' }));
  created.push({ TableName: table, Key: itemKey });
  return true;
}
async function insertFixture(table, item) {
  await ddb.send(new PutCommand({ TableName: table, Item: item, ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)' }));
  created.push({ TableName: table, Key: { pk: item.pk, sk: item.sk } });
}
async function request(base, path, token, method = 'GET', body) {
  const response = await fetch(`${base}/${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}
async function expectRequest(base, path, token, method, body) {
  const response = await request(base, path, token, method, body);
  if (response.status < 200 || response.status >= 300) throw new Error(`${method} ${path} failed HTTP ${response.status}: ${response.data.error || 'no detail'}`);
  return response.data;
}
async function login(email) {
  return (await expectRequest(bases.identity, 'auth/login', null, 'POST', { email, password: 'Demo123!' })).accessToken;
}
async function seedIdentity() {
  for (const tenant of tenants) {
    await putIfAbsent(tables.identity, { ...key(tenant.tenantId, `TENANTMETA#${tenant.tenantId}`), id: tenant.tenantId, name: tenant.name, status: 'ACTIVE', entityType: 'Tenant' });
    await putIfAbsent(tables.identity, { ...key(tenant.tenantId, `ITEM#${tenant.userId}`), id: tenant.userId, email: tenant.email, name: tenant.name, role: 'ADMIN', status: 'ACTIVE', entityType: 'UserProfile' });
    await putIfAbsent(tables.identity, { ...key(tenant.tenantId, `MEMBERSHIP#${tenant.userId}`), id: tenant.userId, userId: tenant.userId, role: 'ADMIN', status: 'ACTIVE', entityType: 'Membership' });
  }
}
async function startScheduledFlow(tenant, token, foreignProjectId) {
  const project = await expectRequest(bases.project, 'projects', token, 'POST', { name: `${runTag}-${tenant.suffix}-project`, status: 'ACTIVE', endDate: '2020-01-01' });
  created.push({ TableName: tables.project, Key: key(tenant.tenantId, `ITEM#${project.id}`) });
  const ids = {
    portfolio: `${runTag}-${tenant.suffix}-portfolio`,
    resource: `${runTag}-${tenant.suffix}-resource`,
    budget: `${runTag}-${tenant.suffix}-budget`,
    priority: `${runTag}-${tenant.suffix}-priority`,
  };
  const stamp = new Date().toISOString();
  await insertFixture(tables.portfolio, { ...key(tenant.tenantId, `ITEM#${ids.portfolio}`), id: ids.portfolio, name: `${runTag} portfolio`, status: 'ACTIVE', entityType: 'Portfolio' });
  await insertFixture(tables.resource, { ...key(tenant.tenantId, `ITEM#${ids.resource}`), id: ids.resource, name: `${runTag} resource`, type: 'PERSON', capacity: 1, allocated: 1.25, status: 'ACTIVE', entityType: 'Resource', createdAt: stamp });
  await insertFixture(tables.budget, { ...key(tenant.tenantId, `ITEM#${ids.budget}`), id: ids.budget, projectId: project.id, allocated: 1000, spent: 950, currency: 'USD', entityType: 'Budget', createdAt: stamp });
  await insertFixture(tables.priority, { ...key(tenant.tenantId, `ITEM#${ids.priority}`), id: ids.priority, projectId: project.id, score: 82, impact: 80, urgency: 75, risk: 20, alignment: 90, entityType: 'Assessment', createdAt: stamp });
  const decisionName = `${runTag}-${tenant.suffix}-pending-review`;
  let decisionScenario;
  try {
    decisionScenario = await expectRequest(bases.priority, 'decisions/scenarios', token, 'POST', {
      name: decisionName, visibility: 'private', scope: { projectId: project.id },
    scenarios: [{ key: 'A', name: 'Base de prueba' }, { key: 'B', name: 'Alternativa de prueba', variables: { budgetLimit: 1000, currency: 'USD' } }],
    });
  } catch (error) {
    // Recover from an HTTP timeout after the server committed the scenario but before the client received its ID.
    try {
      const list = await expectRequest(bases.priority, 'decisions/scenarios', token, 'GET');
      for (const item of list.items || []) if (item.name === decisionName) await request(bases.priority, `decisions/scenarios/${encodeURIComponent(item.id)}`, token, 'DELETE');
    } catch { /* preserve the original API failure */ }
    throw error;
  }
  created.push({ TableName: tables.priority, Key: key(tenant.tenantId, `DECISION#${decisionScenario.id}`) });
  const flow = await expectRequest(bases.identity, 'flows', token, 'POST', { type: 'risk-alert', frequency: 'daily', time: '09:00', timezone: 'America/Lima' });
  created.push({ TableName: tables.identity, Key: key(tenant.tenantId, `FLOW#${flow.id}`) });
  const scheduledFor = new Date(Date.now() - 60_000).toISOString();
  await ddb.send(new PutCommand({ TableName: tables.identity, Item: { ...key(tenant.tenantId, `FLOW#${flow.id}`), ...flow, nextRunAt: scheduledFor, gsi2pk: 'FLOW#ENABLED', gsi2sk: scheduledFor } }));
  const executionId = `${flow.id}:${scheduledFor}`;
  created.push({ TableName: tables.identity, Key: key(tenant.tenantId, `FLOWRUN#${executionId}`) });
  created.push({ TableName: tables.identity, Key: key(tenant.tenantId, `NOTIFY#DELIVERY#${tenant.userId}#${executionId}`) });
  return { tenant, token, project, flow, decisionScenario, ids, scheduledFor, executionId, foreignProjectId };
}
async function schedulerOnce() {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/flow-scheduler.mjs', '--once'], {
      cwd: process.cwd(),
      env: { ...process.env, TABLE_NAME: tables.identity, DYNAMODB_ENDPOINT: endpoint },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Flow scheduler exited ${code}`)));
  });
}
async function list(base, route, token) {
  return (await expectRequest(base, route, token, 'GET')).items || [];
}
async function verifyTenantRun(run) {
  const { tenant, token, project, flow, decisionScenario, ids, executionId } = run;
  const [projects, portfolios, resources, budgets, priorities] = await Promise.all([
    list(bases.project, 'projects', token), list(bases.portfolio, 'portfolios', token),
    list(bases.resource, 'resources', token), list(bases.budget, 'budgets', token), list(bases.priority, 'priorities', token),
  ]);
  for (const rows of [projects, portfolios, resources, budgets, priorities]) {
    assert.ok(rows.every((row) => !row.pk || row.pk === `TENANT#${tenant.tenantId}`), `${tenant.tenantId}: domain API returned a different tenant partition`);
    assert.ok(!rows.some((row) => row.id === run.foreignProjectId), `${tenant.tenantId}: domain API returned foreign project data`);
  }
  for (const [rows, id, label] of [[portfolios, ids.portfolio, 'portfolio'], [resources, ids.resource, 'resource'], [budgets, ids.budget, 'budget'], [priorities, ids.priority, 'priority']]) {
    assert.ok(rows.some((row) => row.id === id), `${tenant.tenantId}: ${label} fixture ${id} was not returned by its owning API; returned ids=${rows.map((row) => row.id).join(',')}`);
  }
  assert.ok(projects.some((row) => row.id === project.id), `${tenant.tenantId}: own project was not returned by Project API`);
  const tasks = [];
  for (const row of projects.filter((item) => item.status === 'ACTIVE')) tasks.push(...await list(bases.project, `projects/${encodeURIComponent(row.id)}/tasks`, token));

  const history = await expectRequest(bases.identity, `flows/${flow.id}/runs`, token, 'GET');
  const matches = (history.items || []).filter((item) => item.executionId === executionId);
  assert.equal(matches.length, 1, `${tenant.tenantId}: exactly one durable execution record`);
  assert.equal(matches[0].status, 'SUCCEEDED');
  assert.ok(matches[0].report, `${tenant.tenantId}: generated report persisted`);
  assert.deepEqual(matches[0].report.counts, { projects: projects.length, portfolios: portfolios.length, tasks: tasks.length, budgets: budgets.length, resources: resources.length, priorities: priorities.length, pendingDecisionScenarios: 1 }, `${tenant.tenantId}: LangGraph report counts match its tenant-scoped API reads`);
  assert.equal(matches[0].report.pendingDecisionScenarios.length, 1, `${tenant.tenantId}: report includes one pending scenario summary`);
  assert.equal(matches[0].report.pendingDecisionScenarios[0].id, decisionScenario.id, `${tenant.tenantId}: report includes only its own private scenario`);
  assert.ok(!matches[0].report.pendingDecisionScenarios.some((item) => item.id === run.foreignDecisionScenarioId), `${tenant.tenantId}: report must not include another tenant's scenario`);
  const alerts = matches[0].report.alerts || [];
  for (const id of [project.id, ids.budget, ids.resource]) assert.ok(alerts.some((alert) => alert.entityId === id), `${tenant.tenantId}: report omitted expected risk ${id}`);
  assert.ok(!alerts.some((alert) => alert.entityId === run.foreignProjectId), `${tenant.tenantId}: report contains foreign project data`);

  const notification = await ddb.send(new QueryCommand({ TableName: tables.identity, KeyConditionExpression: 'pk = :pk AND begins_with(sk,:sk)', ExpressionAttributeValues: { ':pk': `TENANT#${tenant.tenantId}`, ':sk': `NOTIFY#DELIVERY#${tenant.userId}#` }, Limit: 100 }));
  const deliveries = (notification.Items || []).filter((item) => item.id === executionId);
  assert.equal(deliveries.length, 1, `${tenant.tenantId}: exactly one persisted local notification`);
  assert.equal(deliveries[0].status, 'SIMULATED');

  const otherTenantRead = await request(bases.project, `projects/${encodeURIComponent(run.foreignProjectId)}`, signLocalServiceToken({ userId: tenant.userId, tenantId: tenant.tenantId }));
  assert.equal(otherTenantRead.status, 404, `${tenant.tenantId}: SERVICE identity must not read the other tenant project`);
  const serviceWrite = await request(bases.project, 'projects', signLocalServiceToken({ userId: tenant.userId, tenantId: tenant.tenantId }), 'POST', { name: 'must-not-write' });
  assert.equal(serviceWrite.status, 403, `${tenant.tenantId}: SERVICE identity must not write through Project API`);
  return { tenantId: tenant.tenantId, reportCounts: matches[0].report.counts, alertKinds: alerts.map((item) => item.kind), localDelivery: deliveries[0].status, serviceCrossTenantRead: otherTenantRead.status, serviceWrite: serviceWrite.status };
}

try {
  await seedIdentity();
  const tokenA = await login(tenants[0].email);
  const tokenB = await login(tenants[1].email);
  const runA = await startScheduledFlow(tenants[0], tokenA, 'pending');
  const runB = await startScheduledFlow(tenants[1], tokenB, runA.project.id);
  runA.foreignProjectId = runB.project.id;
  runA.foreignDecisionScenarioId = runB.decisionScenario.id;
  runB.foreignDecisionScenarioId = runA.decisionScenario.id;
  await Promise.all([schedulerOnce(), schedulerOnce()]);
  const tenantResults = await Promise.all([verifyTenantRun(runA), verifyTenantRun(runB)]);
  // A fresh process simulates a restart/replay: completed idempotency keys must not repeat side effects.
  await schedulerOnce();
  for (const run of [runA, runB]) {
    const history = await expectRequest(bases.identity, `flows/${run.flow.id}/runs`, run.token, 'GET');
    assert.equal((history.items || []).filter((item) => item.executionId === run.executionId).length, 1);
  }
  console.log(JSON.stringify({ integration: 'PASS', tenants: tenantResults, schedulerProcesses: 3, concurrentDispatches: 2, restartReplay: 'no duplicate execution or delivery', externalMessages: 0, cleanup: 'created DynamoDB fixture keys only' }, null, 2));
  integrationPassed = true;
} finally {
  if (!integrationPassed) {
    for (const row of created.filter((item) => item.TableName === tables.identity && item.Key.sk.startsWith('FLOWRUN#'))) {
      try {
        const result = await ddb.send(new GetCommand(row));
        if (result.Item) console.error(JSON.stringify({ failedExecution: result.Item.executionId, status: result.Item.status, errors: result.Item.errors }));
      } catch (error) { console.error(`Could not read failed execution ${row.Key.sk}: ${error.name}`); }
    }
  }
  for (const row of [...created].reverse()) {
    try { await ddb.send(new DeleteCommand(row)); } catch (error) { console.error(`Fixture cleanup failed for ${row.TableName}/${row.Key.sk}: ${error.name}`); }
  }
  await ddb.destroy();
}
