import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, createHmac } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SQSClient, GetQueueAttributesCommand, CreateQueueCommand } from '@aws-sdk/client-sqs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { createWhatsAppRuntime } from '../services/identity-service/whatsapp-runtime.mjs';
import { localMetaMockConfig } from '../services/identity-service/whatsapp-local-provider.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compose = ['compose', '-f', 'infrastructure/docker-compose.yml'];
const run = (bin, args, options = {}) => new Promise((resolve, reject) => { const child = spawn(bin, args, { cwd: root, stdio: 'inherit', ...options }); child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${bin} exited ${code}`))); });
const children = [];
let integrationQueueUrl;
function start(args, env) { const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } }); children.push(child); return child; }
async function waitFor(url, env) { for (let i=0;i<80;i++) { try { const r=await fetch(url); if (r.ok) return; } catch {} await delay(500); } throw new Error(`Local service did not become ready: ${url}`); }
async function api(token, route, method='GET', body) { const response=await fetch(`http://127.0.0.1:4101${route}`, { method, headers:{ ...(token?{authorization:`Bearer ${token}`}:{}) , ...(body?{'content-type':'application/json'}:{}) }, body:body?JSON.stringify(body):undefined }); const text=await response.text(); let data; try { data=JSON.parse(text); } catch { data=text; } return {response,data}; }
async function register(email,organizationName) { const result=await api(null,'/auth/register','POST',{email,name:'Integration Admin',password:'Demo123!Abcd',organizationName}); assert.equal(result.response.status,201,JSON.stringify(result.data)); return result.data.accessToken; }
async function queueVisible() { const sqs=new SQSClient({endpoint:'http://127.0.0.1:4566',region:'us-east-1',credentials:{accessKeyId:'local',secretAccessKey:'local'}}); try { const value=await sqs.send(new GetQueueAttributesCommand({QueueUrl:integrationQueueUrl,AttributeNames:['ApproximateNumberOfMessages','ApproximateNumberOfMessagesNotVisible']})); return Number(value.Attributes?.ApproximateNumberOfMessages||0)+Number(value.Attributes?.ApproximateNumberOfMessagesNotVisible||0); } finally { sqs.destroy(); } }
async function createAutomation(token, executionId) { const created=await api(token,'/flows','POST',{type:'weekly-summary',frequency:'manual',name:'Integración WhatsApp'}); assert.equal(created.response.status,201,JSON.stringify(created.data)); const runResult=await api(token,`/flows/${created.data.id}/run`,'POST',{executionId}); assert.equal(runResult.response.status,200,JSON.stringify(runResult.data)); return created.data.id; }

try {
  await run('docker',['compose','-f','infrastructure/docker-compose.yml','up','-d','--wait']);
  const containerRoot = root.replaceAll('\\','/');
  await run('docker',['run','--rm','--network','cloudportfolio-local','-e','DYNAMODB_ENDPOINT=http://dynamodb:8000','-e','LOCALSTACK_ENDPOINT=http://localstack:4566','-v',`${containerRoot}:/work`,'-w','/work','node:24-alpine','node','scripts/init-local.mjs']);
  const sqsAdmin=new SQSClient({endpoint:'http://127.0.0.1:4566',region:'us-east-1',credentials:{accessKeyId:'local',secretAccessKey:'local'}}); const queue=await sqsAdmin.send(new CreateQueueCommand({QueueName:`profiles-integration-${Date.now()}-${randomBytes(4).toString('hex')}`})); integrationQueueUrl=queue.QueueUrl; await sqsAdmin.destroy();
  const sharedSecret=randomBytes(32).toString('base64url'); const common={NODE_ENV:'test',LOCAL_JWT_SECRET:sharedSecret,DYNAMODB_ENDPOINT:'http://127.0.0.1:8000',SQS_ENDPOINT:'http://127.0.0.1:4566',AWS_REGION:'us-east-1',TABLE_NAME:'cloudportfolio-identity-local',WHATSAPP_QUEUE_URL:integrationQueueUrl,NOTIFICATION_MODE:'integration-test',WHATSAPP_PROVIDER_MODE:'meta-mock',WHATSAPP_VERIFICATION_PROVIDER:'local-test',WHATSAPP_ALLOW_TEST_DELIVERY:'true',WHATSAPP_META_API_ORIGIN:'http://127.0.0.1:4290',WHATSAPP_TEST_APP_SECRET:'local-integration-secret-only',WHATSAPP_WEBHOOK_VERIFY_TOKEN:'local-webhook-token-only',PORTFOLIO_API_URL:'',PROJECT_API_URL:'',BUDGET_API_URL:'',RESOURCE_API_URL:'',PRIORITY_API_URL:''};
  start(['scripts/meta-whatsapp-mock.mjs'],{...common,WHATSAPP_MOCK_PORT:'4290'});
  start(['scripts/local-api.mjs','identity'],common);
  start(['scripts/whatsapp-consumer-local.mjs'],common);
  await waitFor('http://127.0.0.1:4290/health'); await waitFor('http://127.0.0.1:4101/healthz');
  console.log('Local API, DynamoDB Local, SQS and Meta mock are ready.');
  const suffix=Date.now(); const tenantAToken=await register(`wa-a-${suffix}@example.local`,'Tenant WhatsApp A'); const tenantBToken=await register(`wa-b-${suffix}@example.local`,'Tenant WhatsApp B'); console.log('Created isolated test organizations through HTTP.');
  const settingsB=await api(tenantBToken,'/notifications/whatsapp'); assert.equal(settingsB.response.status,200); assert.equal(settingsB.data.whatsappNumber,null);
  const flowBefore=await api(tenantAToken,'/flows','POST',{type:'weekly-summary',frequency:'manual',name:'Sin permiso WhatsApp'}); assert.equal(flowBefore.response.status,201);
  let runBefore=await api(tenantAToken,`/flows/${flowBefore.data.id}/run`,'POST',{executionId:'before-consent'}); assert.equal(runBefore.response.status,200); await delay(400); assert.equal((await fetch('http://127.0.0.1:4290/messages').then(r=>r.json())).messages.length,0,'no Meta call without consent/verification'); assert.equal(await queueVisible(),0,'nothing is enqueued without consent/verification');
  console.log('Confirmed automation cannot enqueue/send before consent and verification.');
  const verificationRequests=await Promise.all([api(tenantAToken,'/notifications/whatsapp/verification','POST',{phoneNumber:'+15555550101',consent:true,consentVersion:'profiles-whatsapp-2026-01'}),api(tenantAToken,'/notifications/whatsapp/verification','POST',{phoneNumber:'+15555550101',consent:true,consentVersion:'profiles-whatsapp-2026-01'})]); assert.deepEqual(verificationRequests.map(x=>x.response.status).sort(),[202,429],'atomic cooldown allows one verification request at a time'); const started=verificationRequests.find(x=>x.response.status===202); assert.ok(started,JSON.stringify(verificationRequests.map(x=>x.data)));
  const code=await api(tenantAToken,'/notifications/verification-inbox'); assert.equal(code.response.status,200);
  const prefs=await api(tenantAToken,'/notifications/whatsapp/preferences','PUT',{alertTypes:['weekly-summary','reminder'],timezone:'UTC',allowedHours:{start:'00:00',end:'23:59'}}); assert.equal(prefs.response.status,200);
  const pendingFlow=await api(tenantAToken,`/flows/${flowBefore.data.id}/run`,'POST',{executionId:`pending-verification-${suffix}`}); assert.equal(pendingFlow.response.status,200,JSON.stringify(pendingFlow.data)); await delay(300); assert.equal((await fetch('http://127.0.0.1:4290/messages').then(r=>r.json())).messages.length,0,'consent without verified number cannot send'); assert.equal(await queueVisible(),0,'pending verification cannot enter outbound queue');
  const confirmed=await api(tenantAToken,'/notifications/whatsapp/confirm','POST',{code:code.data.code}); assert.equal(confirmed.response.status,200); assert.equal(confirmed.data.status,'verified-test'); assert.equal(confirmed.data.whatsappVerified,false);
  console.log('Completed explicit test-provider verification; account remains unverified for real WhatsApp.');
  const otherTenant=await api(tenantBToken,'/notifications/whatsapp'); assert.equal(otherTenant.data.whatsappNumber,null); assert.equal(otherTenant.data.consent,false);
  const automationId=await createAutomation(tenantAToken,`automation-integration-${suffix}`);
  let messages=[]; for(let i=0;i<80;i++){messages=(await fetch('http://127.0.0.1:4290/messages').then(r=>r.json())).messages;if(messages.length)break;await delay(250);}
  assert.equal(messages.length,1,'consumer sends once to Meta HTTP mock'); assert.equal(messages[0].template,'profiles_weekly_summary');
  const replay=await api(tenantAToken,`/flows/${automationId}/run`,'POST',{executionId:`automation-integration-${suffix}`}); assert.equal(replay.response.status,200); await delay(600); assert.equal((await fetch('http://127.0.0.1:4290/messages').then(r=>r.json())).messages.length,1,'redelivered automation is idempotent');
  const failNext=await fetch('http://127.0.0.1:4290/__test/fail-next',{method:'POST'}); assert.equal(failNext.status,200);
  await createAutomation(tenantAToken,`automation-retry-${suffix}`);
  let retryState={messages:[],requests:0}; for(let i=0;i<100;i++){retryState=await fetch('http://127.0.0.1:4290/messages').then(r=>r.json());if(retryState.messages.length===2&&retryState.requests>=3)break;await delay(300);}
  assert.equal(retryState.messages.length,2,'SQS retry recovers after Meta returns HTTP 429'); assert.equal(retryState.requests,3,'first request was rate limited and retried once'); messages=retryState.messages;
  const who=await api(tenantAToken,'/auth/me'); assert.equal(who.response.status,200); process.env.DYNAMODB_ENDPOINT=common.DYNAMODB_ENDPOINT; process.env.TABLE_NAME=common.TABLE_NAME; process.env.REMINDER_TABLE_NAME='cloudportfolio-reminders-local'; process.env.AWS_REGION='us-east-1'; process.env.NODE_ENV='test';
  const recordsDb=DynamoDBDocumentClient.from(new DynamoDBClient({endpoint:common.DYNAMODB_ENDPOINT,region:'us-east-1',credentials:{accessKeyId:'local',secretAccessKey:'local'}}));
  const reminderId=`integration-${String(9999999999999-suffix).padStart(13,'0')}`; const dueAt='1970-01-01T00:00:00.000Z';
  await recordsDb.send(new PutCommand({TableName:'cloudportfolio-reminders-local',Item:{pk:`TENANT#${who.data.tenantId}`,sk:`REMINDER#${who.data.userId}#${reminderId}`,id:reminderId,tenantId:who.data.tenantId,userId:who.data.userId,title:'Revisar presupuesto de prueba',dueAt,timezone:'UTC',recurrence:'ONCE',status:'SCHEDULED',gsi1pk:'REMINDER#ACTIVE',gsi1sk:`${dueAt}#${reminderId}`,createdAt:new Date().toISOString()}}));
  await delay(800); const dueCheck=await recordsDb.send(new QueryCommand({TableName:'cloudportfolio-reminders-local',IndexName:'DueIndex',KeyConditionExpression:'gsi1pk = :pk AND gsi1sk <= :due',ExpressionAttributeValues:{':pk':'REMINDER#ACTIVE',':due':`${new Date().toISOString()}\uffff`}})); const remindersModule=await import('../services/identity-service/orbital.mjs'); const reminderRuntime=createWhatsAppRuntime({db:recordsDb,table:'cloudportfolio-identity-local',sqs:new SQSClient({endpoint:common.SQS_ENDPOINT,region:'us-east-1',credentials:{accessKeyId:'local',secretAccessKey:'local'}}),queueUrl:common.WHATSAPP_QUEUE_URL,mode:'integration-test',secretProvider:async()=>localMetaMockConfig(common.WHATSAPP_META_API_ORIGIN),testVerification:true,allowTestDelivery:true});
  const reminderOutcome=await remindersModule.runDueReminders({enqueueWhatsApp:reminderRuntime.enqueue}); assert.equal(reminderOutcome[0]?.whatsappQueued,true,JSON.stringify({directDueCount:dueCheck.Items?.length,reminderOutcome})); await recordsDb.destroy();
  for(let i=0;i<80;i++){retryState=await fetch('http://127.0.0.1:4290/messages').then(r=>r.json());if(retryState.messages.length===3)break;await delay(250);}
  assert.equal(retryState.messages.length,3,'due reminder is delivered by the same SQS consumer'); assert.equal(retryState.messages[2].template,'profiles_reminder'); messages=retryState.messages;
  const raw=JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{statuses:[{id:messages[0].id,status:'delivered',timestamp:String(Math.floor(Date.now()/1000))}]}}]}]});
  const signature='sha256='+createHmac('sha256','local-integration-secret-only').update(Buffer.from(raw)).digest('hex');
  const handshake=await fetch('http://127.0.0.1:4101/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=local-webhook-token-only&hub.challenge=challenge-123'); assert.equal(handshake.status,200); assert.equal(await handshake.text(),'challenge-123');
  const deniedHandshake=await fetch('http://127.0.0.1:4101/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge-123'); assert.equal(deniedHandshake.status,403);
  const badWebhook=await fetch('http://127.0.0.1:4101/webhooks/meta/whatsapp',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':'sha256='+'0'.repeat(64)},body:raw}); assert.equal(badWebhook.status,401);
  const goodWebhook=await fetch('http://127.0.0.1:4101/webhooks/meta/whatsapp',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':signature},body:raw}); assert.equal(goodWebhook.status,200); assert.equal((await goodWebhook.json()).updated,1);
  const duplicateWebhook=await fetch('http://127.0.0.1:4101/webhooks/meta/whatsapp',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':signature},body:raw}); assert.equal(duplicateWebhook.status,200); assert.equal((await duplicateWebhook.json()).updated,0);
  const afterWebhook=await api(tenantAToken,'/notifications/whatsapp'); assert.equal(afterWebhook.data.items.find((item)=>item.providerMessageId===messages[0].id)?.deliveryStatus,'DELIVERED',JSON.stringify({messages,whatsapp:afterWebhook.data}));
  const isolatedRevoke=await api(tenantBToken,'/notifications/whatsapp/number','DELETE'); assert.equal(isolatedRevoke.response.status,200); assert.equal((await api(tenantAToken,'/notifications/whatsapp')).data.status,'verified-test');
  const revoked=await api(tenantAToken,'/notifications/whatsapp/number','DELETE'); assert.equal(revoked.response.status,200);
  await createAutomation(tenantAToken,`automation-after-revoke-${suffix}`); await delay(500); const finalMock=await fetch('http://127.0.0.1:4290/messages').then(r=>r.json()); assert.equal(finalMock.messages.length,3,'revocation blocks later Meta sends'); assert.equal(finalMock.requests,4); assert.equal(await queueVisible(),0,'revoked notifications are not queued');
  console.log('PASS HTTP → DynamoDB Local → LocalStack SQS → local consumer → Meta HTTP mock → signed webhook → DynamoDB');
  console.log('PASS no enqueue/send before consent + test verification + preference; signed webhook accepted; forged rejected; duplicate ignored; revoke blocks later send; tenant state isolated.');
} finally { for (const child of children) child.kill('SIGTERM'); await delay(300); }
