import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestScheduler } from '../frontend/src/api/scheduler.mjs';

test('scheduler caps concurrent requests without dropping queued tasks', async () => {
  const scheduler = createRequestScheduler({ maxConcurrent: 3, retryDelayMs: 5 });
  let inFlight = 0;
  let peak = 0;

  const results = await Promise.all(
    Array.from({ length: 10 }, (_, idx) =>
      scheduler.schedule({
        method: 'GET',
        key: `project:item-${idx}`,
        run: async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise(resolve => setTimeout(resolve, 12));
          inFlight -= 1;
          return idx;
        },
      }),
    ),
  );

  assert.equal(peak <= 3, true, `Expected peak <= 3, got ${peak}`);
  assert.deepEqual(results, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('scheduler deduplicates in-flight GET calls but never deduplicates POST calls', async () => {
  const scheduler = createRequestScheduler({ maxConcurrent: 3, retryDelayMs: 5 });
  let getExecutions = 0;
  let postExecutions = 0;

  const getPromises = [0, 1, 2].map(() =>
    scheduler.schedule({
      method: 'GET',
      key: 'portfolio:portfolios',
      run: async () => {
        getExecutions += 1;
        await new Promise(resolve => setTimeout(resolve, 15));
        return { items: ['p1'] };
      },
    }),
  );

  const postPromises = [0, 1].map(() =>
    scheduler.schedule({
      method: 'POST',
      key: 'project:projects',
      run: async () => {
        postExecutions += 1;
        await new Promise(resolve => setTimeout(resolve, 10));
        return { count: postExecutions };
      },
    }),
  );

  const [gResults] = await Promise.all([Promise.all(getPromises), Promise.all(postPromises)]);
  assert.equal(getExecutions, 1);
  assert.equal(postExecutions, 2);
  assert.deepEqual(gResults, [{ items: ['p1'] }, { items: ['p1'] }, { items: ['p1'] }]);
});

test('scheduler retries retryable GET errors once and never retries POST or non-retryable errors', async () => {
  const scheduler = createRequestScheduler({ maxConcurrent: 2, retryDelayMs: 10 });

  let getAttempts = 0;
  const recovered = await scheduler.schedule({
    method: 'GET',
    key: 'resource:availability',
    run: async () => {
      getAttempts += 1;
      if (getAttempts === 1) {
        const err = new Error('Too Many Requests');
        err.retryable = true;
        throw err;
      }
      return { ok: true };
    },
  });
  assert.equal(getAttempts, 2);
  assert.deepEqual(recovered, { ok: true });

  let postAttempts = 0;
  await assert.rejects(
    scheduler.schedule({
      method: 'POST',
      key: 'budget:expenses',
      run: async () => {
        postAttempts += 1;
        const err = new Error('Service Unavailable');
        err.retryable = true;
        throw err;
      },
    }),
    /Service Unavailable/,
  );
  assert.equal(postAttempts, 1);

  let nonRetryableAttempts = 0;
  await assert.rejects(
    scheduler.schedule({
      method: 'GET',
      key: 'project:missing',
      run: async () => {
        nonRetryableAttempts += 1;
        throw new Error('Not found');
      },
    }),
    /Not found/,
  );
  assert.equal(nonRetryableAttempts, 1);
});
