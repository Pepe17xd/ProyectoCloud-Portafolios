import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateSeedPartitions } from '../scripts/seed-plan.mjs';

test('three-thousand pilot records split evenly across six services and three tenants', () => {
  const services = ['identity', 'portfolio', 'project', 'resource', 'budget', 'priority'];
  const tenants = ['tenant-a', 'tenant-b', 'tenant-c'];
  const plan = allocateSeedPartitions(3000, services, tenants);
  assert.equal(Object.values(plan).reduce((sum, count) => sum + count, 0), 3000);
  for (const tenant of tenants) assert.equal(services.reduce((sum, service) => sum + plan[`${service}/${tenant}`], 0), 1000);
  for (const service of services) {
    const amount = tenants.reduce((sum, tenant) => sum + plan[`${service}/${tenant}`], 0);
    assert.ok(amount === 498 || amount === 501);
  }
  assert.ok(Object.values(plan).every((count) => count === 166 || count === 167));
});

test('seed planner enforces per-partition bounds', () => {
  assert.throws(() => allocateSeedPartitions(180001, ['identity'], ['tenant-a']), /10,000-record/);
  assert.throws(() => allocateSeedPartitions(0, ['identity'], ['tenant-a']), /positive total/);
});
