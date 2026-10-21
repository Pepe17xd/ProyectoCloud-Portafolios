import assert from 'node:assert/strict';
import test from 'node:test';
import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { claims } from '../shared/index.mjs';
import { createLocalAuth } from '../services/identity-service/local-auth.mjs';

class MemoryDynamo {
  rows = new Map();
  key(item) { return `${item.pk}\0${item.sk}`; }
  async send(command) {
    if (command instanceof GetCommand) return { Item: this.rows.get(this.key(command.input.Key)) };
    if (command instanceof TransactWriteCommand) {
      const puts = command.input.TransactItems.map(({ Put }) => Put.Item);
      if (puts.some((item) => this.rows.has(this.key(item)))) throw Object.assign(new Error('Transaction cancelled'), { name: 'TransactionCanceledException' });
      for (const item of puts) this.rows.set(this.key(item), structuredClone(item));
      return {};
    }
    throw new Error(`Unexpected command ${command.constructor.name}`);
  }
}

test('local registration atomically provisions tenant, admin membership and a password hash', async () => {
  const db = new MemoryDynamo(); const secret = 'isolated-test-secret';
  const auth = createLocalAuth(db, { table: 'identity-test', secret });
  const result = await auth.register({ organizationName: 'Equipo Aurora', name: 'Ada Lovelace', email: 'ADA@example.test', password: 'StrongPassword9' });
  assert.equal(result.user.role, 'ADMIN');
  assert.match(result.user.tenantId, /^tenant-/);
  assert.equal(result.user.email, 'ada@example.test');
  const rows = [...db.rows.values()];
  assert.equal(rows.length, 4);
  const credential = rows.find((row) => row.entityType === 'LoginCredential');
  assert.ok(credential.passwordHash);
  assert.notEqual(credential.passwordHash, 'StrongPassword9');
  assert.notEqual(credential.passwordHash, credential.salt);
  assert.equal(rows.find((row) => row.entityType === 'Tenant').name, 'Equipo Aurora');
  assert.equal(rows.find((row) => row.entityType === 'UserProfile').role, 'ADMIN');
  assert.equal(rows.find((row) => row.entityType === 'Membership').userId, result.user.id);
  const oldSecret = process.env.LOCAL_JWT_SECRET;
  process.env.LOCAL_JWT_SECRET = secret;
  try { assert.deepEqual(claims({ headers: { authorization: `Bearer ${result.accessToken}` } }), { tenantId: result.user.tenantId, userId: result.user.id, role: 'ADMIN' }); }
  finally { if (oldSecret === undefined) delete process.env.LOCAL_JWT_SECRET; else process.env.LOCAL_JWT_SECRET = oldSecret; }
});

test('local registration rejects duplicate email atomically and never accepts caller roles or tenants', async () => {
  const db = new MemoryDynamo(); const auth = createLocalAuth(db, { table: 'identity-test', secret: 'test-secret' });
  const payload = { organizationName: 'North Star', name: 'Nora North', email: 'nora@example.test', password: 'StrongPassword9' };
  await auth.register(payload);
  await assert.rejects(auth.register({ ...payload, organizationName: 'Another tenant' }), (error) => error.status === 409);
  await assert.rejects(auth.register({ ...payload, email: 'new@example.test', role: 'ADMIN' }), (error) => error.status === 400);
  await assert.rejects(auth.register({ ...payload, email: 'new@example.test', tenantId: 'tenant-existing' }), (error) => error.status === 400);
  assert.equal([...db.rows.values()].filter((row) => row.entityType === 'Tenant').length, 1);
});

test('local login verifies the password hash and returns the same private tenant identity', async () => {
  const db = new MemoryDynamo(); const auth = createLocalAuth(db, { table: 'identity-test', secret: 'test-secret' });
  const registration = await auth.register({ organizationName: 'Polar', name: 'Pia Polar', email: 'pia@example.test', password: 'StrongPassword9' });
  const login = await auth.login({ email: 'PIA@example.test', password: 'StrongPassword9' });
  assert.equal(login.user.id, registration.user.id);
  assert.equal(login.user.tenantId, registration.user.tenantId);
  await assert.rejects(auth.login({ email: 'pia@example.test', password: 'WrongPassword9' }), (error) => error.status === 401);
  await assert.rejects(auth.login({ email: 'missing@example.test', password: 'WrongPassword9' }), (error) => error.status === 401);
});

test('registration enforces the server-side password policy', async () => {
  const auth = createLocalAuth(new MemoryDynamo(), { table: 'identity-test', secret: 'test-secret' });
  await assert.rejects(auth.register({ organizationName: 'Polar', name: 'Pia Polar', email: 'pia@example.test', password: 'weak' }), (error) => error.status === 400);
});
