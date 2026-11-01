import { createHash } from 'node:crypto';
import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { AdminGetUserCommand, AdminUpdateUserAttributesCommand } from '@aws-sdk/client-cognito-identity-provider';

const fail = (status, message) => Object.assign(new Error(message), { status });
// Only call with claims produced by the API Gateway Cognito JWT authorizer.
export function createProvisioner({ db, cognito, table, poolId }) {
  return async function provision(claims, input) {
    if (!claims || claims.token_use !== 'id' || !claims.sub || !claims['cognito:username'] || String(claims.email_verified) !== 'true') throw fail(401, 'Verified ID token required');
    if (!input || Object.keys(input).some(k => k !== 'organizationName') || typeof input.organizationName !== 'string') throw fail(400, 'Invalid registration request');
    const org = input.organizationName.trim();
    if (org.length < 2 || org.length > 100 || /[\x00-\x1f\x7f]/.test(org)) throw fail(400, 'Invalid organization name');
    const sub = claims.sub, username = claims['cognito:username'];
    const markerKey = { pk: `REGISTRATION#${sub}`, sk: 'STATE' };
    const read = async () => (await db.send(new GetCommand({ TableName: table, Key: markerKey, ConsistentRead: true }))).Item;
    const user = await cognito.send(new AdminGetUserCommand({ UserPoolId: poolId, Username: username }));
    const attrs = Object.fromEntries((user.UserAttributes || []).map(a => [a.Name, a.Value]));
    if (attrs.sub !== sub || attrs.email_verified !== 'true') throw fail(403, 'Account is not eligible');
    let marker = await read();
    if (!marker) {
      if (attrs['custom:tenantId'] || attrs['custom:role'] || claims['custom:tenantId'] || claims['custom:role']) throw fail(409, 'Account already belongs to an organization');
      const tenantId = `tenant-${createHash('sha256').update(sub).digest('hex').slice(0, 32)}`;
      const now = new Date().toISOString(), pk = `TENANT#${tenantId}`;
      const name = String(attrs.name || '').trim().slice(0, 100), email = String(attrs.email || '').slice(0, 254);
      const items = [
        { ...markerKey, tenantId, userId: sub, entityType: 'Registration', createdAt: now },
        { pk, sk: `TENANTMETA#${tenantId}`, id: tenantId, name: org, status: 'ACTIVE', plan: 'STANDARD', entityType: 'Tenant', createdBy: sub, createdAt: now },
        { pk, sk: `ITEM#${sub}`, id: sub, email, name, role: 'ADMIN', status: 'ACTIVE', entityType: 'UserProfile', createdAt: now },
        { pk, sk: `MEMBERSHIP#${sub}`, id: sub, userId: sub, role: 'ADMIN', status: 'ACTIVE', entityType: 'Membership', createdAt: now },
      ];
      try { await db.send(new TransactWriteCommand({ TransactItems: items.map(Item => ({ Put: { TableName: table, Item, ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)' } })) })); }
      catch (error) { if (error.name !== 'TransactionCanceledException') throw error; marker = await read(); if (!marker) throw error; }
      marker ||= await read();
    }
    if (!marker || marker.userId !== sub || !marker.tenantId) throw fail(409, 'Registration state is invalid');
    if ((attrs['custom:tenantId'] && attrs['custom:tenantId'] !== marker.tenantId) || (attrs['custom:role'] && attrs['custom:role'] !== 'ADMIN')) throw fail(409, 'Account already belongs to an organization');
    await cognito.send(new AdminUpdateUserAttributesCommand({ UserPoolId: poolId, Username: username, UserAttributes: [{ Name: 'custom:tenantId', Value: marker.tenantId }, { Name: 'custom:role', Value: 'ADMIN' }] }));
    return { provisioned: true };
  };
}
