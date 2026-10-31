import assert from 'node:assert/strict';
import test from 'node:test';
import { createFlowEngine, createLocalNotificationProvider, createWhatsAppBusinessProvider } from '../services/identity-service/flow-engine.mjs';
import { nextFlowRun, dispatchDueFlows } from '../services/identity-service/flow-scheduler.mjs';
import { authorize, claims, signLocalServiceToken, signLocalToken } from '../shared/index.mjs';

test('LangGraph runs monitor, deterministic risk checks, report persistence and simulated delivery', async () => {
  const persisted=[];const tenantCalls=[];
  const execute=createFlowEngine({monitor:async({tenantId})=>{tenantCalls.push(tenantId);return{fetchedAt:'2026-10-01T00:00:00Z',projects:[{id:'p1',status:'ACTIVE',endDate:'2020-01-01'}],tasks:[{id:'t1',dueDate:'2020-01-01',status:'OPEN'}],budgets:[{id:'b1',allocated:100,spent:95}],resources:[{id:'r1',capacity:1,allocated:2}]}},persist:async r=>persisted.push(r),deliver:createLocalNotificationProvider().deliver});
  const result=await execute({tenantId:'tenant-a',actor:{userId:'admin-a',role:'ADMIN'},workflowId:'w1',config:{type:'weekly-summary',budgetThreshold:.9}});
  assert.equal(result.report.alerts.length,4);assert.equal(persisted[0].tenantId,'tenant-a');assert.equal(persisted[0].deliveryStatus,'SIMULATED');assert.match(persisted[0].delivery.preview,/inicia sesión/i);assert.deepEqual(tenantCalls,['tenant-a']);
});
test('Flow reports pending Decision Lab scenarios for human review only', async () => {
 const execute=createFlowEngine({monitor:async()=>({pendingDecisionScenarios:[{id:'scenario-1',name:'Review spend',scope:{projectId:'p1'},createdAt:'2026-10-31'}]}),persist:async()=>{}});
 const result=await execute({tenantId:'tenant-a',actor:{userId:'manager-a',role:'MANAGER'},workflowId:'w1',config:{type:'weekly-summary'}});
 assert.deepEqual(result.report.pendingDecisionScenarios,[{id:'scenario-1',name:'Review spend',scope:{projectId:'p1'},createdAt:'2026-10-31',status:'PENDING_REVIEW'}]);
 assert.match(result.report.explanation,/nunca se aprueban|aplican autom/i);
});
test('flow engine rejects unauthorized roles and arbitrary/missing tenant context',async()=>{
 const execute=createFlowEngine({monitor:async()=>({}),persist:async()=>{}});
 await assert.rejects(execute({tenantId:'tenant-a',actor:{userId:'v',role:'VIEWER'},workflowId:'w',config:{type:'risk-alert'}}),{status:403});
 await assert.rejects(execute({tenantId:'tenant-a',actor:{userId:'v',role:'ADMIN'},workflowId:'w',config:{type:'fake'}}),{status:400});
 await assert.rejects(execute({actor:{userId:'v',role:'ADMIN'},workflowId:'w',config:{type:'risk-alert'}}),{status:400});
});
test('WhatsApp adapter remains explicitly disabled',async()=>{await assert.rejects(createWhatsAppBusinessProvider().deliver({}),{code:'PROVIDER_DISABLED'});});

test('daily and weekly schedules honor IANA timezone and weekday',()=>{
 const daily=nextFlowRun({frequency:'daily',time:'09:00',timezone:'America/Lima'},new Date('2026-05-01T13:59:00Z'));
 assert.equal(daily,'2026-05-01T14:00:00.000Z');
 const weekly=nextFlowRun({frequency:'weekly',time:'09:00',dayOfWeek:1,timezone:'America/Lima'},new Date('2026-05-01T15:00:00Z'));
 assert.equal(new Intl.DateTimeFormat('en',{timeZone:'America/Lima',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(weekly)),'Mon 09:00');
});
test('dispatcher claims a scheduled window once, retries controlled failures, and skips paused flows',async()=>{
 const claims=new Set();const history=[];let calls=0;
 const store={listDue:async()=>[{id:'wf',enabled:true,nextRunAt:'2026-05-01T14:00:00Z'},{id:'paused',enabled:false,nextRunAt:'2026-05-01T14:00:00Z'}],claim:async({idempotencyKey})=>{if(claims.has(idempotencyKey))return false;claims.add(idempotencyKey);return true;},recordFailure:async x=>history.push(x),finish:async x=>history.push(x),advance:async()=>{}};
 const result=await dispatchDueFlows({store,now:new Date('2026-05-01T14:00:00Z'),maxRetries:2,execute:async()=>{calls++;if(calls===1)throw new Error('transient');return{ok:true};}});
 assert.equal(result[0].status,'SUCCEEDED');assert.equal(result[0].attempt,2);assert.equal(result[1].status,'SKIPPED');assert.equal(calls,2);assert.equal(history.filter(x=>x.status==='SUCCEEDED').length,1);
});
test('concurrent dispatcher invocations execute one scheduled window once',async()=>{
 const claimed=new Set();let executions=0;const store={listDue:async()=>[{id:'same',tenantId:'tenant-a',enabled:true,nextRunAt:'2026-05-01T14:00:00Z'}],claim:async({idempotencyKey})=>{if(claimed.has(idempotencyKey))return false;claimed.add(idempotencyKey);return true;},finish:async()=>{},advance:async()=>{},recordFailure:async()=>{}};
 const execute=async()=>{executions++;await new Promise(resolve=>setTimeout(resolve,10));};const args={store,now:new Date('2026-05-01T14:00:00Z'),execute};
 await Promise.all([dispatchDueFlows(args),dispatchDueFlows(args)]);assert.equal(executions,1);
});
test('local service identity is tenant-bound and can perform only domain reads',()=>{
 const prior=process.env.LOCAL_JWT_SECRET;process.env.LOCAL_JWT_SECRET='test-only-runtime-secret';try{const token=signLocalServiceToken({userId:'owner-a',tenantId:'tenant-a'});const actor=claims({headers:{authorization:`Bearer ${token}`}});
 assert.equal(actor.tenantId,'tenant-a');assert.equal(actor.role,'SERVICE');assert.doesNotThrow(()=>authorize(actor.role,'GET','projects'));assert.throws(()=>authorize(actor.role,'POST','projects'),{status:403});
 assert.throws(()=>authorize(actor.role,'GET','users'),{status:403});assert.throws(()=>authorize(actor.role,'DELETE','projects'),{status:403});
 const other=claims({headers:{authorization:`Bearer ${signLocalServiceToken({userId:'owner-a',tenantId:'tenant-b'})}`}});assert.notEqual(actor.tenantId,other.tenantId);
 const expired=signLocalServiceToken({userId:'owner-a',tenantId:'tenant-a'},undefined,-1);assert.throws(()=>claims({headers:{authorization:`Bearer ${expired}`}}),{status:401});
 const unscoped=signLocalToken({userId:'owner-a',tenantId:'tenant-a',role:'SERVICE'});assert.throws(()=>claims({headers:{authorization:`Bearer ${unscoped}`}}),{status:403});}finally{if(prior===undefined)delete process.env.LOCAL_JWT_SECRET;else process.env.LOCAL_JWT_SECRET=prior;}
});

test('local service identities cannot be issued or accepted in production or Lambda',()=>{
 const priorNode=process.env.NODE_ENV;const priorLambda=process.env.AWS_LAMBDA_FUNCTION_NAME;const priorSecret=process.env.LOCAL_JWT_SECRET;
 process.env.LOCAL_JWT_SECRET='test-only-runtime-secret';delete process.env.AWS_LAMBDA_FUNCTION_NAME;
 try {
  delete process.env.NODE_ENV;
  const token=signLocalServiceToken({userId:'owner-a',tenantId:'tenant-a'});
  process.env.NODE_ENV='production';
  assert.throws(()=>claims({headers:{authorization:`Bearer ${token}`}}),{status:403});
  assert.throws(()=>signLocalServiceToken({userId:'owner-a',tenantId:'tenant-a'}),/cannot be issued/);
  process.env.NODE_ENV='test';process.env.AWS_LAMBDA_FUNCTION_NAME='profiles-identity-api';
  assert.throws(()=>claims({headers:{authorization:`Bearer ${token}`}}),{status:403});
  assert.throws(()=>signLocalServiceToken({userId:'owner-a',tenantId:'tenant-a'}),/cannot be issued/);
 } finally {
  if(priorNode===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=priorNode;
  if(priorLambda===undefined)delete process.env.AWS_LAMBDA_FUNCTION_NAME;else process.env.AWS_LAMBDA_FUNCTION_NAME=priorLambda;
  if(priorSecret===undefined)delete process.env.LOCAL_JWT_SECRET;else process.env.LOCAL_JWT_SECRET=priorSecret;
 }
});
