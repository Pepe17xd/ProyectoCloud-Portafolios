import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { signLocalToken, uuid } from '@cloudportfolio/shared';

const scrypt = promisify(scryptCallback);
const credentialKey = (email) => ({ pk: `LOGIN#${createHash('sha256').update(email).digest('hex')}`, sk: 'CREDENTIAL' });
const normalizedEmail = (value) => String(value || '').trim().toLowerCase();
const passwordPolicy = /^(?=.{12,128}$)(?=.*[a-z])(?=.*[A-Z])(?=.*\d).*/;

export function createLocalAuth(db, { table, secret = process.env.LOCAL_JWT_SECRET } = {}) {
  if (!table) throw new Error('Identity table is required for local authentication.');

  async function session(user) {
    return {
      accessToken: signLocalToken(user, secret), tokenType: 'Bearer', expiresIn: 3600,
      user: { id: user.userId, email: user.email, name: user.name, tenantId: user.tenantId, role: user.role },
    };
  }

  async function register(input) {
    const allowed = ['organizationName', 'name', 'email', 'password'];
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((field) => !allowed.includes(field))) {
      throw Object.assign(new Error('Solicitud de registro inválida.'), { status: 400 });
    }
    const organizationName = String(input.organizationName || '').trim();
    const name = String(input.name || '').trim();
    const email = normalizedEmail(input.email);
    const password = input.password;
    if (organizationName.length < 2 || organizationName.length > 100 || name.length < 2 || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !passwordPolicy.test(String(password || ''))) {
      throw Object.assign(new Error('Completa organización, nombre, correo válido y contraseña de 12 a 128 caracteres con mayúscula, minúscula y número.'), { status: 400 });
    }

    const userId = uuid();
    const tenantId = `tenant-${uuid()}`;
    const now = new Date().toISOString();
    const salt = randomBytes(16).toString('base64url');
    const passwordHash = Buffer.from(await scrypt(password, salt, 64)).toString('base64url');
    const credentials = {
      ...credentialKey(email), entityType: 'LoginCredential', email, passwordHash, salt,
      userId, tenantId, name, role: 'ADMIN', createdAt: now,
    };
    const tenant = { pk: `TENANT#${tenantId}`, sk: `TENANTMETA#${tenantId}`, id: tenantId, name: organizationName, status: 'ACTIVE', plan: 'LOCAL_DEMO', entityType: 'Tenant', createdBy: userId, createdAt: now };
    const profile = { pk: `TENANT#${tenantId}`, sk: `ITEM#${userId}`, id: userId, email, name, role: 'ADMIN', status: 'ACTIVE', entityType: 'UserProfile', createdAt: now };
    const membership = { pk: `TENANT#${tenantId}`, sk: `MEMBERSHIP#${userId}`, id: userId, userId, role: 'ADMIN', status: 'ACTIVE', entityType: 'Membership', createdAt: now };
    try {
      await db.send(new TransactWriteCommand({ TransactItems: [credentials, tenant, profile, membership].map((Item) => ({ Put: { TableName: table, Item, ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)' } })) }));
    } catch (error) {
      const existing = await db.send(new GetCommand({ TableName: table, Key: credentialKey(email) }));
      if (existing.Item) throw Object.assign(new Error('Ya existe una cuenta con ese correo.'), { status: 409 });
      throw error;
    }
    return session({ userId, tenantId, role: 'ADMIN', email, name });
  }

  async function login(input) {
    const email = normalizedEmail(input?.email);
    const password = String(input?.password || '');
    if (email.length > 254 || password.length > 128) throw Object.assign(new Error('Correo o contraseña incorrectos.'), { status: 401 });
    const result = await db.send(new GetCommand({ TableName: table, Key: credentialKey(email), ConsistentRead: true }));
    const credential = result.Item;
    if (!credential) throw Object.assign(new Error('Correo o contraseña incorrectos.'), { status: 401 });
    const check = Buffer.from(await scrypt(password, credential.salt, 64));
    const expected = Buffer.from(credential.passwordHash, 'base64url');
    if (check.length !== expected.length || !timingSafeEqual(check, expected)) throw Object.assign(new Error('Correo o contraseña incorrectos.'), { status: 401 });
    return session(credential);
  }

  return { register, login };
}
