import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { createProvisioner } from './provisioning.mjs';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { SQSClient, GetQueueUrlCommand } from '@aws-sdk/client-sqs';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { createWhatsAppRuntime, processWhatsAppJob, shouldRetryWhatsAppRecord } from './whatsapp-runtime.mjs';
import { localMetaMockConfig } from './whatsapp-local-provider.mjs';
import { claims, authorize, reply, parse, validate, key, uuid, sanitize, decodeCursor } from '@cloudportfolio/shared';
import { orbitalApi, runDueReminders } from './orbital.mjs';
import { buildRecipientFlowReport, createFlowEngine, createLocalNotificationProvider, createWhatsAppBusinessProvider } from './flow-engine.mjs';
import { createHash } from 'node:crypto';
import { nextFlowRun, dispatchDueFlows } from './flow-scheduler.mjs';
const db = DynamoDBDocumentClient.from(new DynamoDBClient({ endpoint: process.env.DYNAMODB_ENDPOINT, region: process.env.AWS_REGION || 'us-east-1', ...(process.env.DYNAMODB_ENDPOINT ? {credentials:{accessKeyId:'local',secretAccessKey:'local'}} : {}) }));
const sns = new SNSClient({});
const sqs = new SQSClient({ endpoint: process.env.SQS_ENDPOINT, region: process.env.AWS_REGION || 'us-east-1', ...(process.env.SQS_ENDPOINT ? { credentials: { accessKeyId: 'local', secretAccessKey: 'local' } } : {}) });
const secrets = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });
const table = process.env.TABLE_NAME;
async function getWhatsAppSecret() {
  if (process.env.NOTIFICATION_MODE === 'integration-test') {
    if (process.env.NODE_ENV === 'production' || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.WHATSAPP_PROVIDER_MODE !== 'meta-mock') return null;
    return localMetaMockConfig(process.env.WHATSAPP_META_API_ORIGIN);
  }
  if (!process.env.WHATSAPP_META_SECRET_ARN) return null;
  try {
    const result = await secrets.send(new GetSecretValueCommand({ SecretId: process.env.WHATSAPP_META_SECRET_ARN }));
    return JSON.parse(result.SecretString || '{}');
  } catch {
    throw Object.assign(new Error('WhatsApp provider configuration is unavailable.'), { code: 'SECRET_UNAVAILABLE' });
  }
}
const notificationMode = process.env.NOTIFICATION_MODE || 'disabled';
const whatsAppRuntime = createWhatsAppRuntime({ db, table, sqs, queueUrl: process.env.WHATSAPP_QUEUE_URL, mode: notificationMode, secretProvider: getWhatsAppSecret, webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '', appSecret: notificationMode === 'integration-test' ? process.env.WHATSAPP_TEST_APP_SECRET || '' : '', testVerification: notificationMode === 'integration-test' && process.env.WHATSAPP_VERIFICATION_PROVIDER === 'local-test', allowTestDelivery: notificationMode === 'integration-test' && process.env.WHATSAPP_ALLOW_TEST_DELIVERY === 'true' });
if (notificationMode === 'integration-test') console.log(JSON.stringify({ action: 'whatsapp.integration-mode', providerMode: process.env.WHATSAPP_PROVIDER_MODE || 'unset', verificationProvider: process.env.WHATSAPP_VERIFICATION_PROVIDER || 'unset', testDeliveryEnabled: process.env.WHATSAPP_ALLOW_TEST_DELIVERY === 'true' }));
const provision = createProvisioner({ db, cognito: new CognitoIdentityProviderClient({}), table, poolId: process.env.COGNITO_USER_POOL_ID });
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
  deliver: async ({ tenantId, idempotencyKey, report, recipient, source, alerts, workflowId }) => {
    const notification = await localNotifications.deliver({ idempotencyKey, report, recipient });
    const actor = recipient || 'unknown';
    await db.send(new PutCommand({ TableName: table, Item: { pk: `TENANT#${tenantId}`, sk: `NOTIFY#DELIVERY#${actor}#${idempotencyKey}`, ...notification, createdAt: new Date().toISOString() } }));
    let lastKey, queued = 0;
    do {
      const page = await db.send(new QueryCommand({ TableName: table, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)', ExpressionAttributeValues: { ':pk': `TENANT#${tenantId}`, ':prefix': 'MEMBERSHIP#' }, Limit: 100, ExclusiveStartKey: lastKey }));
      for (const membership of page.Items || []) {
        if (membership.status !== 'ACTIVE' || !membership.userId || !['ADMIN', 'MANAGER', 'VIEWER'].includes(membership.role)) continue;
        const profile = await db.send(new GetCommand({ TableName: table, Key: { pk: `TENANT#${tenantId}`, sk: `ITEM#${membership.userId}` } }));
        if (profile.Item?.status !== 'ACTIVE') continue;
        const personalized = buildRecipientFlowReport({ role: membership.role, userId: membership.userId, source, alerts, workflowId, executionId: idempotencyKey });
        const stableId = createHash('sha256').update(`${tenantId}:${workflowId}:${idempotencyKey}:${membership.userId}`).digest('hex');
        if (await whatsAppRuntime.enqueue({ tenantId, userId: membership.userId, eventType: personalized.eventType, idempotencyKey: `flow-${stableId}`, title: personalized.report.title, parameters: personalized.parameters })) queued += 1;
      }
      lastKey = page.LastEvaluatedKey;
    } while (lastKey);
    return { ...notification, whatsappQueuedCount: queued, whatsappStatus: queued ? 'REQUESTED' : 'NOT_REQUESTED' };
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
  if(method==='POST'&&action==='run') { if(got.Item.enabled!==true)return reply(409,{error:'Flow is paused'}); try { const body=event.body?parse(event):{};let runActor={userId,role};if(role==='SERVICE'){if(userId!==got.Item.createdBy) return reply(403,{error:'Service subject does not own this flow'});const [profile,membership]=await Promise.all([db.send(new GetCommand({TableName:table,Key:{pk:prefix,sk:`ITEM#${userId}`}})),db.send(new GetCommand({TableName:table,Key:{pk:prefix,sk:`MEMBERSHIP#${userId}`}}))]);if(profile.Item?.status!=='ACTIVE'||membership.Item?.status!=='ACTIVE'||!['ADMIN','MANAGER'].includes(membership.Item.role))return reply(403,{error:'Flow owner is inactive or no longer authorized'});runActor={userId,role:membership.Item.role};}const recipientUserId=got.Item.createdBy;if(!recipientUserId)throw Object.assign(new Error('Flow recipient is unavailable'),{status:409});const [recipientProfile,recipientMembership]=await Promise.all([db.send(new GetCommand({TableName:table,Key:{pk:prefix,sk:`ITEM#${recipientUserId}`}})),db.send(new GetCommand({TableName:table,Key:{pk:prefix,sk:`MEMBERSHIP#${recipientUserId}`}}))]);if(recipientProfile.Item?.status!=='ACTIVE'||recipientMembership.Item?.status!=='ACTIVE'||!['ADMIN','MANAGER','VIEWER'].includes(recipientMembership.Item.role))throw Object.assign(new Error('Flow recipient is inactive or no longer belongs to this organization'),{status:409});const config={...got.Item,recipientUserId,recipientRole:recipientMembership.Item.role};const result=await flowEngine({tenantId,actor:runActor,workflowId:id,config,event,executionId:body.executionId});return reply(200,result); } catch(error) { const run={pk:prefix,sk:`FLOWRUN#${uuid()}`,workflowId:id,status:'FAILED',errors:[{message:error.message,at:new Date().toISOString()}],createdAt:new Date().toISOString()}; await db.send(new PutCommand({TableName:table,Item:run})); return reply(error.status||502,{error:error.message,executionId:run.sk.slice(8)}); } }
  if(method==='GET'&&action==='runs'&&!executionId){const data=await db.send(new QueryCommand({TableName:table,KeyConditionExpression:'pk = :pk AND begins_with(sk,:sk)',ExpressionAttributeValues:{':pk':prefix,':sk':'FLOWRUN#'},Limit:50,ScanIndexForward:false}));const runs=(data.Items||[]).filter(x=>x.workflowId===id);return reply(200,{items:role==='ADMIN'?runs:runs.filter(x=>x.recipientUserId===userId)});}
  if(method==='PATCH'&&!action){authorize(role,method,'identityAdmin');const body=parse(event);const allowed=['name','frequency','time','dayOfWeek','timezone','enabled','budgetThreshold'];if(Object.keys(body).some(field=>!allowed.includes(field)))return reply(400,{error:'Field cannot be changed on an automation.'});if(typeof body.enabled!=='boolean')return reply(400,{error:'enabled is required'});if(body.name!==undefined&&(typeof body.name!=='string'||!body.name.trim()||body.name.length>100))return reply(400,{error:'Invalid automation name'});if(body.budgetThreshold!==undefined&&(!Number.isFinite(body.budgetThreshold)||body.budgetThreshold<0.5||body.budgetThreshold>1.5))return reply(400,{error:'Invalid budget threshold'});const schedule={...got.Item,...body};if(body.time||body.frequency||body.dayOfWeek!==undefined||body.timezone){schedule.nextRunAt=nextFlowRun(schedule);schedule.lastRunAt=got.Item.lastRunAt;}const item={...schedule,enabled:body.enabled,updatedAt:new Date().toISOString(),updatedBy:userId};if(item.enabled&&item.nextRunAt){item.gsi2pk='FLOW#ENABLED';item.gsi2sk=item.nextRunAt;}else{delete item.gsi2pk;delete item.gsi2sk;}await db.send(new PutCommand({TableName:table,Item:item,ConditionExpression:'attribute_exists(pk) AND attribute_exists(sk)'}));return reply(200,item);}
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
  if (path.startsWith('/notifications/whatsapp') || path === '/notifications/verification-inbox') return whatsAppRuntime.handle(event, actor, method, path);
  if (path === '/notifications/inbox' && method === 'GET') {
    const data = await db.send(new QueryCommand({ TableName: table, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)', ExpressionAttributeValues: { ':pk': prefKey.pk, ':prefix': `NOTIFY#DELIVERY#${userId}#` }, Limit: 50 }));
    return reply(200, { items: data.Items || [] });
  }
  return reply(404, { error: 'Not found' });
}
export async function api(event) {
  try {
    const method=event.requestContext?.http?.method;
    const path=event.rawPath || event.path || '/users';
    if (path === '/webhooks/meta/whatsapp') return await whatsAppRuntime.webhook(event, method);
    if (path === '/auth/provision' && method === 'POST') {
      try { if (typeof event.body !== 'string' || Buffer.byteLength(event.body, 'utf8') > 1024) return reply(400, { error: 'Invalid registration request' }); return reply(200, await provision(event.requestContext?.authorizer?.jwt?.claims, parse(event))); }
      catch (error) { return reply(error.status || 503, { error: error.status ? error.message : 'Provisioning temporarily unavailable; retry.' }); }
    }
    const {tenantId,userId,role} = claims(event);
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
  const outcomes = await runDueReminders({ limit: 20, enqueueWhatsApp: whatsAppRuntime.enqueue });
  return { processed: outcomes.length, outcomes };
}

export async function whatsappConsumer(event) {
  const batchItemFailures = [];
  for (const record of event.Records || []) {
    let job;
    try {
      job = JSON.parse(record.body || '{}');
      const outcome = await processWhatsAppJob({ job, db, table, runtime: whatsAppRuntime });
      if (outcome?.messageId) console.info(JSON.stringify({ action: 'whatsapp.accepted', tenantId: job.tenantId, userId: job.userId, idempotencyKey: job.idempotencyKey }));
    } catch (error) {
      if (shouldRetryWhatsAppRecord(error)) batchItemFailures.push({ itemIdentifier: record.messageId });
      console.error(JSON.stringify({ action: 'whatsapp.consume.failed', code: error.code || 'INTERNAL', retrying: shouldRetryWhatsAppRecord(error) }));
    }
  }
  return { batchItemFailures };
}
