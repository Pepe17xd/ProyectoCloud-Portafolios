import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { assertRelatedEntity } from '../shared/index.mjs';

async function withServer(status, handler) {
  const server = http.createServer((req, res) => {
    if (handler) return handler(req, res);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(status === 200 ? JSON.stringify({ id: 'p1' }) : JSON.stringify({ error: 'not found' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('reference validation forwards caller JWT to the owning API', async () => {
  let auth;
  const upstream = await withServer(200, (req, res) => {
    auth = req.headers.authorization;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"id":"p1"}');
  });
  try {
    const result = await assertRelatedEntity(upstream.url, '/projects/p1', { headers: { authorization: 'Bearer sample' } }, 'Project');
    assert.equal(result.id, 'p1');
    assert.equal(auth, 'Bearer sample');
  } finally { await upstream.close(); }
});

test('reference validation rejects entities hidden by tenant scope', async () => {
  const upstream = await withServer(404);
  try {
    await assert.rejects(assertRelatedEntity(upstream.url, 'projects/p1', { headers: { authorization: 'Bearer sample' } }, 'Project'), (error) => error.status === 422);
  } finally { await upstream.close(); }
});

test('reference validation fails closed on missing configuration', async () => {
  await assert.rejects(assertRelatedEntity('', 'projects/p1', { headers: { authorization: 'Bearer sample' } }, 'Project'), (error) => error.status === 503);
});
