import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { createHash, randomInt } from 'node:crypto';
import { claims, authorize, reply, parse, validate, key, uuid, sanitize, decodeCursor } from '@cloudportfolio/shared';
import { orbitalApi, runDueReminders } from './orbital.mjs';
import { createFlowEngine, createLocalNotificationProvider, createWhatsAppBusinessProvider } from './flow-engine.mjs';
import { nextFlowRun, dispatchDueFlows } from './flow-scheduler.mjs';
const db = DynamoDBDocumentClient.from(new DynamoDBClient({ endpoint: process.env.DYNAMODB_ENDPOINT, region: process.env.AWS_REGION || 'us-east-1', ...(process.env.DYNAMODB_ENDPOINT ? {credentials:{accessKeyId:'local',secretAccessKey:'local'}} : {}) }));
const sns = new SNSClient({});
const table = process.env.TABLE_NAME;
const fields = ["name", "email", "role", "status"];
const required = ["name"];
const resource = 'users';
const notificationTypes = new Set(['ProjectCreated','ProjectUpdated','ProjectCompleted','BudgetThresholdExceeded','ResourceAssigned','PriorityRecalculated']);
const flowEngine = createFlowEngine({
  monitor: async ({ tenantId, actor, config, event }) => {
    const token = event?.headers?.authorization || event?.headers?.Authorization;
    const get = async (base, path) => { if (!base) return []; const response = await fetch(`${base.replace(/\/$/, '')}/${path}`, { headers: { authorization: token } }); if (!response.ok) throw new Error(`Domain API unavailable (${response.status})`); const data = await response.json(); return data.items || []; };
    const [projects,portfolios,budgets,resources,priorities,pendingDecisionScenarios] = await Promise.all([get(process.env.PROJECT_API_URL,'projects'),get(process.env.PORTFOLIO_API_URL,'portfolios'),get(process.env.BUDGET_API_URL,'budgets'),get(process.env.RESOURCE_API_URL,'resources'),get(process.env.PRIORITY_API_URL,'priorities'),get(process.env.PRIORITY_API_URL,'decisions/scenarios?reviewStatus=PENDING_REVIEW')]);
    const tasks = [];
    for (const project of projects.filter(p => p.status === 'ACTIVE')) { const id = project.id || project.projectId; if (id) tasks.push(...await get(process.env.PROJECT_API_URL,`projects/${encodeURIComponent(id)}/tasks`)); }
    return { tenantId, fetchedAt: new Date().toISOString(), projects, portfolios, budgets, resources, priorities, pendingDecisionScenarios, tasks };
  },
  persist: async (run) => { const id = `FLOWRUN#${run.executionId}`; await db.send(new PutCommand({ TableName: table, Item: { pk: `TENANT#${run.tenantId}`, sk: id, ...run } })); },
  deliver: async ({ tenantId, idempotencyKey, report, recipient }) => {
    const notification = await localNotifications.deliver({ idempotencyKey, report, recipient });
    const actor = recipient || 'unknown';
    await db.send(new PutCommand({ TableName: table, Item: { pk: `TENANT#${tenantId}`, sk: `NOTIFY#DELIVERY#${actor}#${idempotencyKey}`, ...notification, createdAt: new Date().toISOString() } }));
    return notification;
  },
});
const localNotifications = createLocalNotificationProvider();
const whatsappProvider = createWhatsAppBusinessProvider();
async function flowsApi(event, actor, method, path) {
  const { tenantId, userId, role } = actor; const prefix = `TENANT#${tenantId}`;
  if (role === 'SERVICE' && !(method === 'POST' && /^\/flows\/[^/]+\/run$/.test(path))) return reply(403,{error:'Service identity is restricted to scheduled flow execution'});
  if (method === 'GET' && path === '/flows') { const data = await db.send(new QueryCommand({ TableName: table, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)', ExpressionAttributeValues: { ':pk': prefix, ':prefix': 'FLOW#' }, Limit: 50 })); return reply(200, { items: data.Items || [] }); }
  if (method === 'POST' && path === '/flows') {
    authorize(role, method, 'identityAdmin'); const body = parse(event);
    if (!['weekly-summary','reminder','risk-alert'].includes(body.type) || !['daily','weekly','manual'].includes(body.frequency || 'manual')) return reply(400,{error:'Invalid flow type or frequency'});
    try { new Intl.DateTimeFormat('en',{timeZone:body.timezone || 'America/Lima'}); } catch { return reply(400,{error:'Invalid timezone'}); }
    if (body.recipientUserId && body.recipientUserId !== userId) return reply(403,{error:'Recipient must be the authenticated user'});
    const schedule={frequency:body.frequency||'manual',time:body.time||'09:00',dayOfWeek:body.dayOfWeek??1,timezone:body.timezone||'America/Lima'};
    const flow = { pk:prefix, sk:`FLOW#${uuid()}`, id:undefined, tenantId, type:body.type, name:String(body.name || body.type).slice(0,100), ...schedule, nextRunAt:nextFlowRun(schedule), lastRunAt:null, recipientUserId:userId, budgetThreshold:Math.min(1.5,Math.max(.5,Number(body.budgetThreshold)||.9)), channel:'inbox', enabled:body.enabled !== false, createdBy:userId, createdAt:new Date().toISOString(), updatedBy:userId }; flow.id=flow.sk.slice(5);if(flow.enabled&&flow.nextRunAt){flow.gsi2pk='FLOW#ENABLED';flow.gsi2sk=flow.nextRunAt;}
    await db.send(new PutCommand({TableName:table,Item:flow,ConditionExpression:'attribute_not_exists(pk) AND attribute_not_exists(sk)'})); return reply(201,flow);
  }
  const [,collection,id,action,executionId] = path.split('/'); if (collection !== 'flows' || !id) return reply(404,{error:'Not found'});
  const flowKey={pk:prefix,sk:`FLOW#${id}`}; const got=await db.send(new GetCommand({TableName:table,Key:flowKey})); if(!got.Item)return reply(404,{error:'Not found'});
  if(method==='POST'&&action==='run') { if(got.Item.enabled!==true)return reply(409,{error:'Flow is paused'}); try { const body=event.body?parse(event):{};let runActor={userId,role};if(role==='SERVICE'){if(userId!==got.Item.createdBy) return reply(403,{error:'Service subject does not own this flow'});const [profile,membership]=await Promise.all([db.send(new GetCommand({TableName:table,Key:{pk:prefix,sk:`ITEM#${userId}`}})),db.send(new GetCommand({TableName:table,Key:{pk:prefix,sk:`MEMBERSHIP#${userId}`}}))]);if(profile.Item?.status!=='ACTIVE'||membership.Item?.status!=='ACTIVE'||!['ADMIN','MANAGER'].includes(membership.Item.role))return reply(403,{error:'Flow owner is inactive or no longer authorized'});runActor={userId,role:membership.Item.role};}const result=await flowEngine({tenantId,actor:runActor,workflowId:id,config:got.Item,event,executionId:body.executionId});return reply(200,result); } catch(error) { const run={pk:prefix,sk:`FLOWRUN#${uuid()}`,workflowId:id,status:'FAILED',errors:[{message:error.message,at:new Date().toISOString()}],createdAt:new Date().toISOString()}; await db.send(new PutCommand({TableName:table,Item:run})); return reply(error.status||502,{error:error.message,executionId:run.sk.slice(8)}); } }
  if(method==='GET'&&action==='runs'&&!executionId){const data=await db.send(new QueryCommand({TableName:table,KeyConditionExpression:'pk = :pk AND begins_with(sk,:sk)',ExpressionAttributeValues:{':pk':prefix,':sk':'FLOWRUN#'},Limit:50,ScanIndexForward:false}));return reply(200,{items:(data.Items||[]).filter(x=>x.workflowId===id)});}
  if(method==='PATCH'&&!action){authorize(role,method,'identityAdmin');const body=parse(event);if(typeof body.enabled!=='boolean')return reply(400,{error:'enabled is required'});if(body.recipientUserId&&body.recipientUserId!==userId)return reply(403,{error:'Recipient must be the authenticated user'});const schedule={...got.Item,...body};if(body.time||body.frequency||body.dayOfWeek!==undefined||body.timezone){schedule.nextRunAt=nextFlowRun(schedule);schedule.lastRunAt=got.Item.lastRunAt;}const item={...schedule,enabled:body.enabled,updatedAt:new Date().toISOString(),updatedBy:userId};if(item.enabled&&item.nextRunAt){item.gsi2pk='FLOW#ENABLED';item.gsi2sk=item.nextRunAt;}else{delete item.gsi2pk;delete item.gsi2sk;}await db.send(new PutCommand({TableName:table,Item:item,ConditionExpression:'attribute_exists(pk) AND attribute_exists(sk)'}));return reply(200,item);}
  return reply(404,{error:'Not found'});
}
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
    if (path.startsWith('/flows')) return await flowsApi(event,{tenantId,userId,role},method,path);
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
