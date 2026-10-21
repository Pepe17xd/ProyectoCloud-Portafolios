import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { createHash, randomInt } from 'node:crypto';
import { claims, authorize, reply, parse, validate, key, uuid, sanitize, decodeCursor } from '@cloudportfolio/shared';
import { orbitalApi, runDueReminders } from './orbital.mjs';
const db = DynamoDBDocumentClient.from(new DynamoDBClient({ endpoint: process.env.DYNAMODB_ENDPOINT, region: process.env.AWS_REGION || 'us-east-1', ...(process.env.DYNAMODB_ENDPOINT ? {credentials:{accessKeyId:'local',secretAccessKey:'local'}} : {}) }));
const sns = new SNSClient({});
const table = process.env.TABLE_NAME;
const fields = ["name", "email", "role", "status"];
const required = ["name"];
const resource = 'users';
const notificationTypes = new Set(['ProjectCreated','ProjectUpdated','ProjectCompleted','BudgetThresholdExceeded','ResourceAssigned','PriorityRecalculated']);
async function notificationsApi(event, actor, method, path) {
  const { tenantId, userId } = actor;
  const prefKey = { pk: `TENANT#${tenantId}`, sk: `NOTIFY#PREFERENCES#${userId}` };
  const mode = process.env.NOTIFICATION_MODE || 'disabled';
  if (path === '/notifications/preferences' && method === 'GET') {
    const value = await db.send(new GetCommand({ TableName: table, Key: prefKey }));
    return reply(200, value.Item || { enabled: false, timezone: 'America/Lima', allowedHours: { start: '08:00', end: '18:00' }, frequency: 'immediate', alertTypes: [], whatsappConsent: false, whatsappVerifiedLocally: false });
  }
  if (path === '/notifications/preferences' && method === 'PUT') {
    const body = parse(event);
    if (typeof body.enabled !== 'boolean' || typeof body.timezone !== 'string' || !['immediate','daily','weekly'].includes(body.frequency) || !Array.isArray(body.alertTypes) || body.alertTypes.some((type) => !notificationTypes.has(type)) || !body.allowedHours) return reply(400, { error: 'Invalid notification preferences' });
    try { new Intl.DateTimeFormat('en', { timeZone: body.timezone }); } catch { return reply(400, { error: 'Invalid timezone' }); }
    const prior = await db.send(new GetCommand({ TableName: table, Key: prefKey }));
    const item = { ...prefKey, ...(prior.Item || {}), enabled: body.enabled, timezone: body.timezone, allowedHours: body.allowedHours, frequency: body.frequency, alertTypes: [...new Set(body.alertTypes)], updatedAt: new Date().toISOString() };
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(body.allowedHours.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.allowedHours.end)) return reply(400, { error: 'Invalid allowedHours' });
    await db.send(new PutCommand({ TableName: table, Item: item }));
    return reply(200, item);
  }
  if (path === '/notifications/whatsapp/verification' && method === 'POST') {
    if (mode !== 'local-simulator') return reply(503, { error: 'Official WhatsApp Business provider is not configured' });
    const body = parse(event);
    if (body.consent !== true || typeof body.phoneNumber !== 'string' || !/^\+[1-9]\d{7,14}$/.test(body.phoneNumber)) return reply(400, { error: 'Provide E.164 phoneNumber and explicit consent' });
    const code = String(randomInt(100000, 1000000));
    const hash = createHash('sha256').update(code).digest('hex');
    const expiresAt = Math.floor(Date.now() / 1000) + 600;
    const challengeKey = { pk: prefKey.pk, sk: `NOTIFY#VERIFY#${userId}` };
    const pref = await db.send(new GetCommand({ TableName: table, Key: prefKey }));
    await db.send(new PutCommand({ TableName: table, Item: { ...challengeKey, phoneNumber: body.phoneNumber, codeHash: hash, expiresAt, localCode: code } }));
    const updated = { ...prefKey, ...(pref.Item || {}), whatsappNumber: body.phoneNumber, whatsappConsent: true, consentAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await db.send(new PutCommand({ TableName: table, Item: updated }));
    return reply(202, { status: 'verification-pending', channel: 'local-simulator', message: 'Simulado localmente — no se envió a WhatsApp. Consulta el buzón de verificación local.' });
  }
  if (path === '/notifications/verification-inbox' && method === 'GET') {
    if (mode !== 'local-simulator') return reply(503, { error: 'Local verification inbox is disabled' });
    const challenge = await db.send(new GetCommand({ TableName: table, Key: { pk: prefKey.pk, sk: `NOTIFY#VERIFY#${userId}` } }));
    if (!challenge.Item || challenge.Item.expiresAt < Math.floor(Date.now() / 1000)) return reply(404, { error: 'No active local verification challenge' });
    return reply(200, { code: challenge.Item.localCode, status: 'SIMULATED_LOCAL_NOT_SENT', notice: 'Código de desarrollo local; no verifica posesión del número en WhatsApp.' });
  }
  if (path === '/notifications/whatsapp/confirm' && method === 'POST') {
    if (mode !== 'local-simulator') return reply(503, { error: 'Official WhatsApp Business provider is not configured' });
    const body = parse(event);
    const challengeKey = { pk: prefKey.pk, sk: `NOTIFY#VERIFY#${userId}` };
    const challenge = await db.send(new GetCommand({ TableName: table, Key: challengeKey }));
    if (!challenge.Item || challenge.Item.expiresAt < Math.floor(Date.now() / 1000) || createHash('sha256').update(String(body.code || '')).digest('hex') !== challenge.Item.codeHash) return reply(400, { error: 'Invalid or expired local verification code' });
    const pref = await db.send(new GetCommand({ TableName: table, Key: prefKey }));
    const item = { ...prefKey, ...(pref.Item || {}), whatsappVerifiedLocally: true, verifiedAt: new Date().toISOString() };
    await db.send(new PutCommand({ TableName: table, Item: item }));
    await db.send(new DeleteCommand({ TableName: table, Key: challengeKey }));
    return reply(200, { status: 'verified-local-only', whatsappVerifiedLocally: true, notice: 'La simulación local no verifica el número ante WhatsApp ni habilita envíos reales.' });
  }
  if (path === '/notifications/whatsapp/number' && method === 'DELETE') {
    const pref = await db.send(new GetCommand({ TableName: table, Key: prefKey }));
    if (!pref.Item) return reply(204, {});
    const item = { ...pref.Item, whatsappNumber: null, whatsappConsent: false, whatsappVerifiedLocally: false, consentRevokedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await db.send(new PutCommand({ TableName: table, Item: item }));
    await db.send(new DeleteCommand({ TableName: table, Key: { pk: prefKey.pk, sk: `NOTIFY#VERIFY#${userId}` } }));
    return reply(200, { revoked: true });
  }
  if (path === '/notifications/inbox' && method === 'GET') {
    const data = await db.send(new QueryCommand({ TableName: table, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)', ExpressionAttributeValues: { ':pk': prefKey.pk, ':prefix': `NOTIFY#DELIVERY#${userId}#` }, Limit: 50 }));
    return reply(200, { items: data.Items || [] });
  }
  return reply(404, { error: 'Not found' });
}
export async function api(event) {
  try {
    const {tenantId,userId,role} = claims(event);
    const method=event.requestContext?.http?.method;
    const path=event.rawPath || event.path || '/users';
    if (path.startsWith('/reminders') || path.startsWith('/intelligence/')) return await orbitalApi(event, { tenantId, userId, role }, method, path);
    if (path.startsWith('/notifications/')) return await notificationsApi(event, { tenantId, userId, role }, method, path);
    const id=event.pathParameters?.id;
    const kind=path.startsWith('/memberships')?'memberships':path.startsWith('/tenants')?'tenants':'users';
    authorize(role,method,kind === 'users' ? resource : 'identityAdmin');
    const prefix=kind==='users'?'ITEM#':`${kind==='tenants'?'TENANTMETA':'MEMBERSHIP'}#`;
    const allowed=kind==='users'?fields:kind==='tenants'?['name','status','plan']:['userId','role','status'];
    const collection=`/${kind}`;
    const itemKey=(recordId)=>({pk:`TENANT#${tenantId}`,sk:`${prefix}${recordId}`});
    if(method==='GET' && !id){
      const data=await db.send(new QueryCommand({TableName:table,KeyConditionExpression:'pk = :pk AND begins_with(sk, :prefix)',ExpressionAttributeValues:{':pk':`TENANT#${tenantId}`,':prefix':prefix},Limit:Math.min(Number(event.queryStringParameters?.limit)||50,100),ExclusiveStartKey:decodeCursor(event.queryStringParameters?.cursor,tenantId)}));
      return reply(200,{items:data.Items||[],nextCursor:data.LastEvaluatedKey?Buffer.from(JSON.stringify(data.LastEvaluatedKey)).toString('base64url'):null});
    }
    if(method==='GET'){
      if (kind === 'tenants' && id !== tenantId) return reply(404,{error:'Not found'});
      const data=await db.send(new GetCommand({TableName:table,Key:itemKey(id)}));
      return data.Item?reply(200,data.Item):reply(404,{error:'Not found'});
    }
    if(method==='POST'){
      const body=parse(event);validate(body,kind==='users'?required:kind==='tenants'?['name']:['userId','role']);
      if(kind==='users' && body.role && !['ADMIN','MANAGER','VIEWER'].includes(body.role)) return reply(400,{error:'Invalid role'});
      if(kind==='memberships' && !['ADMIN','MANAGER','VIEWER'].includes(body.role)) return reply(400,{error:'Invalid role'});
      if(kind==='users' && body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return reply(400,{error:'Invalid email'});
      if(kind==='memberships'){
        const member=await db.send(new GetCommand({TableName:table,Key:itemKey(body.userId)}));
        if(!member.Item || !member.Item.email) return reply(422,{error:'User profile not found in this tenant'});
      }
      const recordId=kind==='tenants'?tenantId:uuid();
      const item={...itemKey(recordId),id:recordId,...sanitize(body,allowed),createdBy:userId,createdAt:new Date().toISOString()};
      await db.send(new PutCommand({TableName:table,Item:item,ConditionExpression:'attribute_not_exists(pk) AND attribute_not_exists(sk)'}));
      return reply(201,item);
    }
    if(method==='PATCH'){
      const body=sanitize(parse(event),kind === 'memberships' ? ['role','status'] : kind === 'tenants' ? ['name','status','plan'] : fields);
      if (kind === 'tenants' && id !== tenantId) return reply(404,{error:'Not found'});
      if(body.role && !['ADMIN','MANAGER','VIEWER'].includes(body.role)) return reply(400,{error:'Invalid role'});
      if(body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return reply(400,{error:'Invalid email'});
      const old=await db.send(new GetCommand({TableName:table,Key:itemKey(id)}));
      if(!old.Item)return reply(404,{error:'Not found'});
      const item={...old.Item,...body,updatedAt:new Date().toISOString()};
      await db.send(new PutCommand({TableName:table,Item:item,ConditionExpression:'attribute_exists(pk) AND attribute_exists(sk)'}));
      return reply(200,item);
    }
    if(method==='DELETE'){
      if (kind === 'tenants' && id !== tenantId) return reply(404,{error:'Not found'});
      const deleted=await db.send(new DeleteCommand({TableName:table,Key:itemKey(id),ReturnValues:'ALL_OLD'}));
      return deleted.Attributes?reply(200,{deleted:true}):reply(404,{error:'Not found'});
    }
    return reply(405,{error:'Method not allowed'});
  }catch(e){console.error(e);return reply(e.status||500,{error:e.status?e.message:'Internal server error'});}
}

export async function scheduled() {
  const outcomes = await runDueReminders({ limit: 20 });
  return { processed: outcomes.length, outcomes };
}
