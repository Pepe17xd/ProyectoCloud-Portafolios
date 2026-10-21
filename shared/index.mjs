import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

const b64url = (value) => Buffer.from(value).toString('base64url');
export const uuid = () => randomUUID();

/** Authenticates the API Gateway JWT context or a locally issued HS256 bearer token. */
export function claims(event) {
  const contextClaims = event.requestContext?.authorizer?.jwt?.claims;
  let c = contextClaims;
  if (!c) {
    const authorization = event.headers?.authorization || event.headers?.Authorization;
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) throw Object.assign(new Error('Authentication required'), { status: 401 });
    c = verifyLocalToken(token);
  }
  const tenantId = c['custom:tenantId'] || c.tenantId;
  const userId = c.sub || c.userId;
  const role = c['custom:role'] || c.role;
  if (!tenantId || !userId || !['ADMIN', 'MANAGER', 'VIEWER'].includes(role)) {
    throw Object.assign(new Error('Invalid identity claims'), { status: 403 });
  }
  return { tenantId, userId, role };
}

function verifyLocalToken(token) {
  const secret = process.env.LOCAL_JWT_SECRET;
  if (!secret) throw Object.assign(new Error('Local identity provider is not configured'), { status: 401 });
  const parts = token.split('.');
  if (parts.length !== 3) throw Object.assign(new Error('Invalid token'), { status: 401 });
  const [headerPart, payloadPart, signature] = parts;
  let header, payload;
  try { header = JSON.parse(Buffer.from(headerPart, 'base64url')); payload = JSON.parse(Buffer.from(payloadPart, 'base64url')); }
  catch { throw Object.assign(new Error('Invalid token'), { status: 401 }); }
  if (header.alg !== 'HS256') throw Object.assign(new Error('Invalid token algorithm'), { status: 401 });
  const expected = createHmac('sha256', secret).update(`${headerPart}.${payloadPart}`).digest();
  let actual;
  try { actual = Buffer.from(signature, 'base64url'); } catch { actual = Buffer.alloc(0); }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw Object.assign(new Error('Invalid token signature'), { status: 401 });
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= now) throw Object.assign(new Error('Token expired'), { status: 401 });
  if (payload.nbf && payload.nbf > now) throw Object.assign(new Error('Token not active'), { status: 401 });
  if (payload.iss !== 'cloudportfolio-local') throw Object.assign(new Error('Invalid token issuer'), { status: 401 });
  return payload;
}

export function signLocalToken({ userId, tenantId, role, email }, secret = process.env.LOCAL_JWT_SECRET, ttlSeconds = 3600) {
  if (!secret) throw new Error('LOCAL_JWT_SECRET is required');
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub: userId, tenantId, role, email, iss: 'cloudportfolio-local', iat: now, exp: now + ttlSeconds }));
  return `${header}.${payload}.${createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')}`;
}

export const RBAC_MATRIX = Object.freeze({
  VIEWER: Object.freeze(['GET', 'HEAD', 'OPTIONS']),
  MANAGER: Object.freeze(['GET', 'HEAD', 'OPTIONS', 'POST', 'PATCH']),
  ADMIN: Object.freeze(['GET', 'HEAD', 'OPTIONS', 'POST', 'PATCH', 'DELETE']),
});

/** Shared policy: reads are available to all; only ADMIN deletes or administers identity. */
export function authorize(role, method, resource = '') {
  if (!RBAC_MATRIX[role] || !RBAC_MATRIX[role].includes(method)) {
    throw Object.assign(new Error(method === 'DELETE' && role === 'MANAGER' ? 'Admin required' : 'Forbidden'), { status: 403 });
  }
  if (['users', 'identityAdmin'].includes(resource) && !['GET', 'HEAD', 'OPTIONS'].includes(method) && role !== 'ADMIN') {
    throw Object.assign(new Error('Admin required'), { status: 403 });
  }
}

/** Validate an external entity through its owning API while forwarding the caller identity. */
export async function assertRelatedEntity(baseUrl, path, event, label) {
  if (!baseUrl) throw Object.assign(new Error(`${label} validation is not configured`), { status: 503 });
  const authorization = event.headers?.authorization || event.headers?.Authorization;
  if (!authorization) throw Object.assign(new Error('Authentication required'), { status: 401 });
  let response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`, {
      headers: { authorization },
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    throw Object.assign(new Error(`${label} service unavailable`), { status: 503 });
  }
  if (response.status === 404) throw Object.assign(new Error(`${label} not found in this tenant`), { status: 422 });
  if (!response.ok) throw Object.assign(new Error(`${label} service unavailable`), { status: 503 });
  return response.json();
}

export const reply = (statusCode, body) => ({ statusCode, headers: { 'content-type': 'application/json', 'access-control-allow-origin': process.env.CORS_ORIGIN || '*' }, body: JSON.stringify(body) });
export function parse(event) { try { return JSON.parse(event.body || '{}'); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); } }
export function validate(data, fields) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Object.assign(new Error('Invalid payload'), { status: 400 });
  for (const field of fields) if (data[field] === undefined || data[field] === null || data[field] === '') throw Object.assign(new Error(`Missing ${field}`), { status: 400 });
}
export const key = (tenant, id) => ({ pk: `TENANT#${tenant}`, sk: `ITEM#${id}` });
export function decodeCursor(cursor, tenantId) {
  if (!cursor) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    if (parsed.pk !== `TENANT#${tenantId}` || typeof parsed.sk !== 'string') throw new Error();
    return parsed;
  } catch { throw Object.assign(new Error('Invalid cursor'), { status: 400 }); }
}
export function sanitize(input, allowed) { return Object.fromEntries(Object.entries(input).filter(([k]) => allowed.includes(k))); }
