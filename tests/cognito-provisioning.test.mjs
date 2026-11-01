import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvisioner } from '../services/identity-service/provisioning.mjs';
import { readFileSync } from 'node:fs';
function setup() {
  const records = new Map(), users = new Map(); let failUpdate = false, failTransaction = false, writes = 0;
  const key = x => `${x.pk}|${x.sk}`;
  const db = { async send(cmd) { if (cmd.constructor.name === 'GetCommand') return { Item: records.get(key(cmd.input.Key)) }; if (cmd.constructor.name === 'TransactWriteCommand') { if (failTransaction) throw Error('database unavailable'); const items = cmd.input.TransactItems.map(x => x.Put.Item); if (items.some(x => records.has(key(x)))) throw Object.assign(Error('duplicate'), { name: 'TransactionCanceledException' }); for (const item of items) records.set(key(item), item); writes++; return {}; } throw Error('unexpected command'); } };
  const cognito = { async send(cmd) { const user = users.get(cmd.input.Username); if (cmd.constructor.name === 'AdminGetUserCommand') return { UserAttributes: Object.entries(user).map(([Name,Value]) => ({ Name, Value })) }; if (failUpdate) { failUpdate = false; throw Error('temporary'); } for (const a of cmd.input.UserAttributes) user[a.Name] = a.Value; return {}; } };
  const provision = createProvisioner({ db, cognito, table: 'identity', poolId: 'pool' });
  const add = sub => { users.set(sub, { sub, name: 'Test User', email: `${sub}@example.test`, email_verified: 'true' }); return { sub, 'cognito:username': sub, token_use: 'id', email_verified: 'true' }; };
  return { provision, add, records, users, writes: () => writes, failUpdate: () => { failUpdate = true; }, failTransaction: () => { failTransaction = true; } };
}
test('verified registration creates a single tenant, ADMIN profile and membership', async () => {
  const f = setup(), c = f.add('user-a'); await f.provision(c, { organizationName: 'Org A' }); await f.provision(c, { organizationName: 'Org A' });
  assert.equal(f.writes(), 1); const items = [...f.records.values()]; assert.equal(items.length, 4); const tenant = items.find(x => x.entityType === 'Tenant');
  assert.equal(items.find(x => x.entityType === 'Membership').userId, c.sub); assert.equal(items.find(x => x.entityType === 'Membership').role, 'ADMIN');
  assert.equal(f.users.get(c.sub)['custom:tenantId'], tenant.id); assert.equal(f.users.get(c.sub)['custom:role'], 'ADMIN');
});
test('unverified, access-token, arbitrary tenant and role requests are rejected', async () => {
  const f = setup(), c = f.add('user-a');
  await assert.rejects(f.provision({ ...c, email_verified: 'false' }, { organizationName: 'Org' }));
  await assert.rejects(f.provision({ ...c, token_use: 'access' }, { organizationName: 'Org' }));
  await assert.rejects(f.provision(c, { organizationName: 'Org', tenantId: 'someone-else' }));
  await assert.rejects(f.provision(c, { organizationName: 'Org', role: 'ADMIN' }));
  f.users.get('user-a')['custom:tenantId'] = 'existing'; await assert.rejects(f.provision(c, { organizationName: 'Org' }));
  assert.equal(f.records.size, 0);
});
test('failed Cognito update is recoverable without duplicate records', async () => {
  const f = setup(), c = f.add('user-a'); f.failUpdate(); await assert.rejects(f.provision(c, { organizationName: 'Org A' }));
  assert.equal(f.records.size, 4); await f.provision(c, { organizationName: 'Org A' }); assert.equal(f.writes(), 1);
});
test('failed transaction does not assign role or tenant', async () => {
  const f = setup(), c = f.add('user-a'); f.failTransaction(); await assert.rejects(f.provision(c, { organizationName: 'Org A' })); assert.equal(f.records.size, 0); assert.equal(f.users.get('user-a')['custom:role'], undefined);
});
test('separate identities get separate tenants and cannot change an existing role', async () => {
  const f = setup(), a = f.add('user-a'), b = f.add('user-b'); await f.provision(a, { organizationName: 'A org' }); await f.provision(b, { organizationName: 'B org' });
  assert.notEqual(f.users.get('user-a')['custom:tenantId'], f.users.get('user-b')['custom:tenantId']);
  f.users.get('user-a')['custom:role'] = 'VIEWER'; await assert.rejects(f.provision(a, { organizationName: 'A org' })); assert.equal(f.users.get('user-a')['custom:role'], 'VIEWER');
});
test('deployment protects endpoint and Cognito sensitive attributes', () => {
  const y = readFileSync(new URL('../services/identity-service/serverless.yml', import.meta.url), 'utf8'); const auth = readFileSync(new URL('../infrastructure/auth/serverless.yml', import.meta.url), 'utf8');
  assert.match(y, /path: \/auth\/provision, method: POST, authorizer: cognito/); assert.match(y, /AdminUpdateUserAttributes/);
  assert.match(auth, /ReadAttributes:.*email_verified/); assert.match(auth, /WriteAttributes: \[email, name\]/);
});
test('frontend registration uses confirmation, refresh and only the organization name', () => {
  const page = readFileSync(new URL('../frontend/src/features/auth/AuthPage.tsx', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../frontend/src/auth/cognito.ts', import.meta.url), 'utf8');
  assert.match(page, /await registerCognito\(/); assert.match(page, /await confirmCognito\(/); assert.match(page, /await resendCognito\(/); assert.match(page, /await provisionCognito\(/);
  assert.match(client, /JSON\.stringify\(\{ organizationName \}\)/); assert.match(client, /forceRefresh: true/); assert.doesNotMatch(client, /custom:role.*userAttributes/);
});
