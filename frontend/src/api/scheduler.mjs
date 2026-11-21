/** Concurrency-bounded HTTP scheduler with in-flight GET deduplication and 429/503 gentle retry. */
export function createRequestScheduler({ maxConcurrent = 3, retryDelayMs = 350 } = {}) {
  let active = 0;
  const queue = [];
  const inFlightGets = new Map();

  const runSlot = (fn) =>
    new Promise((resolve, reject) => {
      const execute = () => {
        active += 1;
        Promise.resolve()
          .then(fn)
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            const next = queue.shift();
            if (next) next();
          });
      };
      if (active < maxConcurrent) execute();
      else queue.push(execute);
    });

  return {
    schedule({ method = 'GET', key = '', run }) {
      const upper = String(method || 'GET').toUpperCase();
      const isGet = upper === 'GET' || upper === 'HEAD';
      const dedupeKey = isGet && key ? `${upper}:${key}` : '';

      if (dedupeKey && inFlightGets.has(dedupeKey)) {
        return inFlightGets.get(dedupeKey);
      }

      const executeAttempt = async () => {
        try {
          return await runSlot(run);
        } catch (error) {
          if (isGet && error && typeof error === 'object' && error.retryable === true) {
            await new Promise(resolve => setTimeout(resolve, retryDelayMs));
            return await runSlot(run);
          }
          throw error;
        }
      };

      const promise = executeAttempt().finally(() => {
        if (dedupeKey) inFlightGets.delete(dedupeKey);
      });

      if (dedupeKey) inFlightGets.set(dedupeKey, promise);
      return promise;
    },
  };
}
