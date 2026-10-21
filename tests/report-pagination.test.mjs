import assert from 'node:assert/strict';
import test from 'node:test';
import { collectPages } from '../services/project-service/handler.mjs';

test('report and intelligence pagination follows each cursor and returns every page', async () => {
  const cursors = [];
  const result = await collectPages(async (cursor) => {
    cursors.push(cursor ?? null);
    if (!cursor) return { items: [{ id: 1 }, { id: 2 }], nextCursor: 'cursor-1' };
    if (cursor === 'cursor-1') return { items: [{ id: 3 }], nextCursor: 'cursor-2' };
    return { items: [{ id: 4 }], nextCursor: null };
  });
  assert.deepEqual(result.items.map((item) => item.id), [1, 2, 3, 4]);
  assert.deepEqual(cursors, [null, 'cursor-1', 'cursor-2']);
  assert.equal(result.truncated, false);
});

test('pagination cap is explicit instead of silently claiming complete report data', async () => {
  let calls = 0;
  const result = await collectPages(async () => ({ items: [{ id: ++calls }], nextCursor: `cursor-${calls}` }), { maxPages: 2 });
  assert.equal(calls, 2);
  assert.equal(result.items.length, 2);
  assert.equal(result.truncated, true);
});

test('array API responses remain compatible with one-page domain adapters', async () => {
  const result = await collectPages(async () => [{ id: 'one' }, { id: 'two' }]);
  assert.deepEqual(result.items.map((item) => item.id), ['one', 'two']);
  assert.equal(result.truncated, false);
});
