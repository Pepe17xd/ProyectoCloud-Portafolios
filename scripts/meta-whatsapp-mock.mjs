import http from 'node:http';

if (process.env.NODE_ENV === 'production' || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.WHATSAPP_PROVIDER_MODE !== 'meta-mock') throw new Error('Meta HTTP mock is restricted to explicit local integration mode.');
const messages = [];
let sequence = 0;
let requests = 0;
let failNext = 0;
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.method === 'GET' && req.url === '/health') return send(200, { status: 'ok', service: 'meta-http-mock' });
  if (req.method === 'POST' && req.url === '/__test/fail-next') { failNext = 1; return send(200, { armed: true }); }
  if (req.method === 'GET' && req.url === '/messages') return send(200, { requests, messages: messages.map(({ id, to, template }) => ({ id, to, template })) });
  if (req.method !== 'POST' || !/^\/v\d+\.\d+\/\d+\/messages$/.test(req.url || '')) return send(404, { error: 'Not found' });
  let body; try { body = JSON.parse(raw); } catch { return send(400, { error: 'Invalid JSON' }); }
  if (body.messaging_product !== 'whatsapp' || body.type !== 'template' || !/^[a-z0-9_]+$/.test(body.template?.name || '') || !body.to) return send(400, { error: 'Invalid WhatsApp template request' });
  requests += 1;
  if (failNext) { failNext -= 1; return send(429, { error: { code: 80007, message: 'Local rate limit simulation' } }); }
  const id = `wamid.local.${++sequence}`;
  messages.push({ id, to: body.to, template: body.template.name, createdAt: new Date().toISOString() });
  return send(200, { messaging_product: 'whatsapp', contacts: [{ input: body.to, wa_id: body.to }], messages: [{ id }] });
});
server.listen(Number(process.env.WHATSAPP_MOCK_PORT || 4290), '0.0.0.0', () => console.log('Local Meta HTTP mock ready.'));
process.on('SIGTERM', () => server.close());
