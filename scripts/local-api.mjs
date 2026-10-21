import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { signLocalToken } from '../shared/index.mjs';
import { createLocalAuth } from '../services/identity-service/local-auth.mjs';

const service = process.argv[2];
const config = {
  identity: { port: 4101, table: 'cloudportfolio-identity-local', routes: ['users','tenants','memberships'] },
  portfolio: { port: 4102, table: 'cloudportfolio-portfolio-local', route: 'portfolios', topic: 'arn:aws:sns:us-east-1:000000000000:cloudportfolio-domain-local' },
  project: { port: 4103, table: 'cloudportfolio-project-local', route: 'projects', topic: 'arn:aws:sns:us-east-1:000000000000:cloudportfolio-domain-local' },
  resource: { port: 4104, table: 'cloudportfolio-resource-local', route: 'resources' },
  budget: { port: 4105, table: 'cloudportfolio-budget-local', route: 'budgets', topic: 'arn:aws:sns:us-east-1:000000000000:cloudportfolio-domain-local' },
  priority: { port: 4106, table: 'cloudportfolio-priority-local', route: 'priorities', topic: 'arn:aws:sns:us-east-1:000000000000:cloudportfolio-domain-local' }
}[service];
if (!config) throw new Error(`Unknown service: ${service}`);
process.env.LOCAL_JWT_SECRET ||= 'local-only-change-this-secret-before-sharing';
process.env.DYNAMODB_ENDPOINT ||= 'http://localhost:8000';
process.env.SNS_ENDPOINT ||= 'http://localhost:4566';
process.env.S3_ENDPOINT ||= 'http://localhost:4566';
process.env.TOPIC_ARN ||= 'arn:aws:sns:us-east-1:000000000000:cloudportfolio-domain-local';
process.env.DOCUMENTS_BUCKET ||= 'cloudportfolio-documents-local';
process.env.TABLE_NAME ||= config.table;
if (service === 'identity') process.env.REMINDER_TABLE_NAME ||= 'cloudportfolio-reminders-local';
process.env.DOMAIN_TOPIC_ARN ||= config.topic || '';
process.env.AWS_REGION ||= 'us-east-1';
process.env.CORS_ORIGIN ||= 'http://localhost:5173';
process.env.PORTFOLIO_API_URL ||= 'http://localhost:4102';
process.env.PROJECT_API_URL ||= 'http://localhost:4103';
process.env.IDENTITY_API_URL ||= 'http://localhost:4101';
process.env.BUDGET_API_URL ||= 'http://localhost:4105';
process.env.RESOURCE_API_URL ||= 'http://localhost:4104';
process.env.PRIORITY_API_URL ||= 'http://localhost:4106';
if (service === 'project') console.log(JSON.stringify({ level: 'info', service, topicConfigured: Boolean(process.env.TOPIC_ARN), snsEndpointConfigured: Boolean(process.env.SNS_ENDPOINT) }));
const handlerPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), `../services/${service}-service/handler.mjs`);
const { api } = await import(pathToFileURL(handlerPath).href);

const demoUsers = [
  { email: 'admin-a@demo.local', password: 'Demo123!', userId: 'demo-admin-a', tenantId: 'tenant-a', role: 'ADMIN', name: 'Alicia Admin' },
  { email: 'manager-a@demo.local', password: 'Demo123!', userId: 'demo-manager-a', tenantId: 'tenant-a', role: 'MANAGER', name: 'Marco Manager' },
  { email: 'viewer-a@demo.local', password: 'Demo123!', userId: 'demo-viewer-a', tenantId: 'tenant-a', role: 'VIEWER', name: 'Valeria Viewer' },
  { email: 'admin-b@demo.local', password: 'Demo123!', userId: 'demo-admin-b', tenantId: 'tenant-b', role: 'ADMIN', name: 'Bruno Admin' },
  { email: 'manager-b@demo.local', password: 'Demo123!', userId: 'demo-manager-b', tenantId: 'tenant-b', role: 'MANAGER', name: 'Beatriz Manager' },
  { email: 'admin-c@demo.local', password: 'Demo123!', userId: 'demo-admin-c', tenantId: 'tenant-c', role: 'ADMIN', name: 'Carmen Admin' }
];
const localAuth = service === 'identity' ? createLocalAuth(DynamoDBDocumentClient.from(new DynamoDBClient({ endpoint: process.env.DYNAMODB_ENDPOINT, region: process.env.AWS_REGION, credentials: process.env.DYNAMODB_ENDPOINT ? { accessKeyId: 'local', secretAccessKey: 'local' } : undefined })), { table: config.table }) : undefined;
const authWindows = new Map();
function allowAuthAttempt(key, now = Date.now()) {
  const current = authWindows.get(key) || { startedAt: now, count: 0 };
  if (now - current.startedAt >= 15 * 60_000) { current.startedAt = now; current.count = 0; }
  current.count += 1;
  authWindows.set(key, current);
  return current.count <= 12;
}
async function readAuthBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 16_384) throw Object.assign(new Error('Request too large'), { status: 413 });
  }
  try { return JSON.parse(raw || '{}'); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': process.env.CORS_ORIGIN, 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' }); res.end(JSON.stringify(body)); };
  if (req.method === 'OPTIONS') return send(204, {});
  if (url.pathname === '/healthz') return send(200, { status: 'ok', service });
  if (service === 'identity' && (url.pathname === '/auth/register' || url.pathname === '/auth/login') && req.method === 'POST') {
    const ip = req.socket.remoteAddress || 'unknown';
    if (!allowAuthAttempt(`${ip}:${url.pathname}`)) return send(429, { error: 'Demasiados intentos. Espera 15 minutos y vuelve a intentarlo.' });
    try {
      const input = await readAuthBody(req);
      if (url.pathname === '/auth/register') return send(201, await localAuth.register(input));
      try { return send(200, await localAuth.login(input)); }
      catch (error) {
        if (error.status !== 401) throw error;
        const user = demoUsers.find((candidate) => candidate.email.toLowerCase() === String(input.email || '').trim().toLowerCase() && candidate.password === input.password);
        if (!user) throw error;
        return send(200, { accessToken: signLocalToken(user), tokenType: 'Bearer', expiresIn: 3600, user: { id: user.userId, email: user.email, name: user.name, tenantId: user.tenantId, role: user.role } });
      }
    } catch (error) { return send(error.status || 500, { error: error.status ? error.message : 'No se pudo completar la autenticación local.' }); }
  }
  if (service === 'identity' && url.pathname === '/auth/login' && req.method === 'POST') {
    let raw = ''; for await (const chunk of req) raw += chunk;
    let input; try { input = JSON.parse(raw); } catch { return send(400, { error: 'Invalid JSON' }); }
    const user = demoUsers.find((candidate) => candidate.email.toLowerCase() === String(input.email || '').toLowerCase() && candidate.password === input.password);
    if (!user) return send(401, { error: 'Invalid email or password' });
    const accessToken = signLocalToken(user);
    return send(200, { accessToken, tokenType: 'Bearer', expiresIn: 3600, user: { id: user.userId, email: user.email, name: user.name, tenantId: user.tenantId, role: user.role } });
  }
  if (service === 'identity' && url.pathname === '/auth/me' && req.method === 'GET') {
    const authEvent = { headers: { authorization: req.headers.authorization } };
    const { claims } = await import('../shared/index.mjs');
    try { const c = claims(authEvent); return send(200, { ...c }); } catch (e) { return send(e.status || 401, { error: e.message }); }
  }
  if (service === 'identity' && url.pathname === '/profile' && req.method === 'GET') {
    const authEvent = { headers: { authorization: req.headers.authorization } };
    const { claims } = await import('../shared/index.mjs');
    try { const c = claims(authEvent); return send(200, { id: c.sub, email: c.email, tenantId: c.tenantId, role: c.role }); } catch (e) { return send(e.status || 401, { error: e.message }); }
  }
  const routes = config.routes || [config.route];
  if (service === 'project') routes.push('documents', 'intelligence');
  if (service === 'identity') routes.push('notifications', 'reminders', 'intelligence');
  const segments = url.pathname.split('/').filter(Boolean);
  if (!routes.includes(segments[0]) || segments.length > (service === 'project' || service === 'identity' ? 4 : 2)) return send(404, { error: 'Not found' });
  let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 1_000_000) return send(413, { error: 'Request too large' }); }
  const id = segments.length > 1 ? decodeURIComponent(segments[1]) : undefined;
  const event = { rawPath: url.pathname, headers: req.headers, body: raw || undefined, pathParameters: id ? { id } : undefined, queryStringParameters: Object.fromEntries(url.searchParams), requestContext: { http: { method: req.method } } };
  try { const response = await api(event); res.writeHead(response.statusCode, response.headers); res.end(response.body); }
  catch (error) { console.error(JSON.stringify({ level: 'error', service, message: error.message })); send(500, { error: 'Internal server error' }); }
});
const port = Number(process.env.PORT) || config.port;
server.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ level: 'info', service, port, table: config.table })));
