import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, DeleteCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { claims, authorize, reply, parse, validate, key, uuid, sanitize, decodeCursor, assertRelatedEntity } from '@cloudportfolio/shared';
const localEndpoint = process.env.DYNAMODB_ENDPOINT;
const db = DynamoDBDocumentClient.from(new DynamoDBClient({ endpoint: localEndpoint, region: process.env.AWS_REGION || 'us-east-1', ...(localEndpoint ? {credentials:{accessKeyId:'local',secretAccessKey:'local'}} : {}) }));
const snsEndpoint = process.env.SNS_ENDPOINT;
const sns = new SNSClient({ endpoint: snsEndpoint, region: process.env.AWS_REGION || 'us-east-1', ...(snsEndpoint ? {credentials:{accessKeyId:'local',secretAccessKey:'local'}} : {}) });
const table = process.env.TABLE_NAME;
const fields = ["name", "portfolioId", "ownerId", "status", "startDate", "endDate"];
const required = ["name"];
const resource = 'projects';
const s3Endpoint = process.env.S3_ENDPOINT;
const s3 = new S3Client({ endpoint: s3Endpoint, region: process.env.AWS_REGION || 'us-east-1', forcePathStyle: Boolean(s3Endpoint), ...(s3Endpoint ? {credentials:{accessKeyId:'local',secretAccessKey:'local'}} : {}) });
const bucket = process.env.DOCUMENTS_BUCKET || 'cloudportfolio-documents-local';
const documentFields = ['projectId','fileName','contentType','contentLength'];
const allowedContentTypes = new Set(['application/pdf','image/png','image/jpeg','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
const present = (item) => item ? { ...item, id: item.id || String(item.sk || '').replace(/^ITEM#/, '') } : item;

// Deterministic, read-only intelligence. Each source is an explicitly configured
// domain API; the caller's verified bearer token carries the tenant boundary.
const intelligenceHits = new Map();
const supportedReports = new Set(['portfolio-status', 'project-progress', 'overdue-tasks', 'resource-usage', 'budgets', 'priorities', 'risks']);
const intelligenceSources = {
  projects: () => process.env.PROJECT_API_URL,
  portfolios: () => process.env.PORTFOLIO_API_URL,
  budgets: () => process.env.BUDGET_API_URL,
  resources: () => process.env.RESOURCE_API_URL,
  assignments: () => process.env.RESOURCE_API_URL,
  priorities: () => process.env.PRIORITY_API_URL,
};
async function askIntelligence(event, tenantId, userId, role) {
  const body = parse(event);
  if (typeof body.question !== 'string' || !body.question.trim() || body.question.length > 500) return reply(400, { error: 'Question must contain 1–500 characters' });
  const allowedRoles = new Set(['ADMIN', 'MANAGER', 'VIEWER']);
  if (!allowedRoles.has(role)) return reply(403, { error: 'Forbidden' });
  const now = Date.now();
  const recent = (intelligenceHits.get(userId) || []).filter((time) => now - time < 60_000);
  if (recent.length >= 20) return reply(429, { error: 'Intelligence query limit reached; retry shortly' });
  recent.push(now); intelligenceHits.set(userId, recent);
  const bearer = event.headers?.authorization || event.headers?.Authorization;
  const question = body.question.trim().toLocaleLowerCase('es');
  const relevant = question.includes('presupuest') || question.includes('gast') ? ['projects', 'budgets']
    : question.includes('recurso') || question.includes('asign') ? ['projects', 'resources', 'assignments']
      : question.includes('prior') ? ['projects', 'priorities']
        : question.includes('portafolio') ? ['projects', 'portfolios']
      : question.includes('tarea') ? ['projects', 'tasks']
          : ['projects', 'budgets', 'resources', 'priorities'];
  const results = {};
  const unavailable = [];
  for (const name of relevant) {
    if (name === 'tasks') {
      const data = await db.send(new QueryCommand({ TableName: table, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)', ExpressionAttributeValues: { ':pk': `TENANT#${tenantId}`, ':prefix': 'TASK#' }, Limit: 100 }));
      results.tasks = data.Items || [];
      continue;
    }
    const base = intelligenceSources[name]();
    if (!base) { unavailable.push(name); continue; }
    try {
      const route = name === 'assignments' ? 'assignments' : name;
      const response = await fetch(`${base.replace(/\/$/, '')}/${route}?limit=100`, { headers: { Authorization: bearer }, signal: AbortSignal.timeout(2500) });
      if (!response.ok) { unavailable.push(name); continue; }
      const payload = await response.json();
      results[name] = Array.isArray(payload) ? payload : (payload.items || []);
    } catch { unavailable.push(name); }
  }
  const projects = results.projects || [];
  const today = new Date().toISOString().slice(0, 10);
  const late = projects.filter((p) => p.endDate && p.endDate < today && !['DONE', 'COMPLETED', 'COMPLETE'].includes(String(p.status).toUpperCase()));
  const budgets = results.budgets || [];
  const nearLimit = budgets.filter((b) => Number(b.allocated) > 0 && Number(b.spent) / Number(b.allocated) >= 0.8);
  const tasks = results.tasks || [];
  const lateTasks = tasks.filter((task) => task.dueDate && task.dueDate < today && !['DONE', 'COMPLETED'].includes(String(task.status).toUpperCase()));
  const reviewHorizon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const reviewTasks = tasks.filter((task) => task.dueDate && task.dueDate <= reviewHorizon && !['DONE', 'COMPLETED'].includes(String(task.status).toUpperCase()));
  const facts = [];
  if (relevant.includes('projects')) facts.push(`${projects.length} proyectos consultados en la primera página (máximo 100).`, `${late.length} proyectos con fecha final vencida entre los consultados.`, `${projects.filter((p) => ['DONE','COMPLETED','COMPLETE'].includes(String(p.status).toUpperCase())).length} proyectos cerrados entre los consultados.`);
  if (relevant.includes('budgets')) facts.push(`${nearLimit.length} presupuestos consultados con consumo igual o superior al 80 %.`);
  if (relevant.includes('resources')) facts.push(`${(results.resources || []).length} recursos consultados.`);
  if (relevant.includes('assignments')) {
    const load = new Map(); for (const row of results.assignments || []) load.set(row.resourceId, (load.get(row.resourceId) || 0) + Number(row.allocation || 0));
    const capacity = new Map((results.resources || []).map((row) => [row.id, Number(row.capacity ?? 1)]));
    const overloaded = [...load.entries()].filter(([id, value]) => value > (capacity.get(id) ?? 1));
    facts.push(`${(results.assignments || []).length} asignaciones consultadas; ${overloaded.length} recursos exceden la capacidad registrada.`);
  }
  if (relevant.includes('priorities')) {
    const ranking = [...(results.priorities || [])].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
    facts.push(`${ranking.length} evaluaciones de prioridad consultadas${ranking[0] ? `; score más alto ${Number(ranking[0].score || 0).toFixed(2)} para proyecto ${ranking[0].projectId || 'sin referencia'}` : ''}.`);
  }
  if (relevant.includes('portfolios')) {
    const portfolios = results.portfolios || [];
    const attention = portfolios.filter((portfolio) => projects.some((project) => project.portfolioId === portfolio.id && late.includes(project)));
    facts.push(`${portfolios.length} portafolios consultados; ${attention.length} contienen al menos un proyecto vencido de los registros visibles.`);
  }
  if (relevant.includes('tasks')) facts.push(`${tasks.length} tareas consultadas en la primera página; ${lateTasks.length} tienen vencimiento pasado y ${reviewTasks.length} vencen dentro de los próximos siete días o ya están vencidas.`);
  const suggestions = [];
  if (late.length) suggestions.push('Revisar fechas, estado y responsable de los proyectos vencidos.');
  if (nearLimit.length) suggestions.push('Revisar gastos pendientes y saldo de los presupuestos cercanos al límite.');
  if (lateTasks.length) suggestions.push('Revisar las tareas vencidas y acordar su siguiente estado o responsable.');
  else if (reviewTasks.length) suggestions.push('Revisar las tareas próximas a vencer y confirmar que tienen responsable y fecha vigentes.');
  if (!suggestions.length) suggestions.push('No se detectó una alerta en las métricas disponibles; confirma las fechas y registros si esperabas otro resultado.');
  console.info(JSON.stringify({ level: 'info', service: 'project', action: 'intelligence.query', userId, tenantId, domains: relevant, unavailable }));
  return reply(200, { mode: 'deterministic-local-rules', readOnly: true, facts, suggestions, unavailable, relatedProjects: late.slice(0, 10).map((p) => ({ id: p.id, name: p.name, status: p.status, endDate: p.endDate })), relatedTasks: reviewTasks.slice(0, 10).map((task) => ({ id: task.id, projectId: task.projectId, title: task.title, dueDate: task.dueDate })), scope: { domains: relevant, pageLimit: 100, tenantScopedByVerifiedBearer: true }, generatedAt: new Date().toISOString() });
}

function csvCell(value) {
  let text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (typeof value === 'string' && /^\s*[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function reportCsv(record) {
  const columns = [...new Set(record.rows.flatMap((row) => Object.keys(row)))];
  return [columns.map(csvCell).join(','), ...record.rows.map((row) => columns.map((column) => csvCell(row[column])).join(','))].join('\r\n');
}
async function reportSources(names, event, tenantId) {
  const bearer = event.headers?.authorization || event.headers?.Authorization;
  const result = {}; const unavailable = [];
  for (const name of names) {
    if (name === 'tasks') {
      const data = await db.send(new QueryCommand({ TableName: table, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)', ExpressionAttributeValues: { ':pk': `TENANT#${tenantId}`, ':prefix': 'TASK#' }, Limit: 100 }));
      result.tasks = data.Items || []; continue;
    }
    const url = intelligenceSources[name]?.();
    if (!url) { unavailable.push(name); continue; }
    try {
      const route = name === 'assignments' ? 'assignments' : name;
      const response = await fetch(`${url.replace(/\/$/, '')}/${route}?limit=100`, { headers: { Authorization: bearer }, signal: AbortSignal.timeout(3000) });
      if (!response.ok) { unavailable.push(name); continue; }
      const payload = await response.json(); result[name] = Array.isArray(payload) ? payload : (payload.items || []);
    } catch { unavailable.push(name); }
  }
  return { result, unavailable };
}
async function reportsApi(event, tenantId, userId, role) {
  const method = event.requestContext?.http?.method;
  const path = event.rawPath || event.path || '';
  if (method === 'GET' && path === '/intelligence/reports') {
    const data = await db.send(new QueryCommand({ TableName: table, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)', ExpressionAttributeValues: { ':pk': `TENANT#${tenantId}`, ':prefix': 'REPORT#' }, Limit: 50, ScanIndexForward: false }));
    return reply(200, { items: (data.Items || []).map(({ rows, ...meta }) => meta) });
  }
  if (method === 'POST' && path === '/intelligence/reports') {
    if (!['ADMIN', 'MANAGER'].includes(role)) return reply(403, { error: 'Manager role required to generate and persist reports.' });
    const body = parse(event);
    if (!supportedReports.has(body.type)) return reply(400, { error: `type must be one of: ${[...supportedReports].join(', ')}` });
    if (body.filters && Object.keys(body.filters).length) return reply(400, { error: 'This release does not support report filters; omit filters to avoid misleading output.' });
    const plans = {
      'portfolio-status': ['portfolios', 'projects'], 'project-progress': ['projects', 'tasks'], 'overdue-tasks': ['projects', 'tasks'],
      'resource-usage': ['resources', 'assignments'], budgets: ['budgets'], priorities: ['priorities'], risks: ['projects', 'budgets', 'tasks'],
    };
    const sources = plans[body.type];
    const { result, unavailable } = await reportSources(sources, event, tenantId);
    const today = new Date().toISOString().slice(0, 10);
    let rows = [];
    if (body.type === 'portfolio-status') rows = (result.portfolios || []).map((p) => ({ portfolioId: p.id, portfolio: p.name, projectCount: (result.projects || []).filter((x) => x.portfolioId === p.id).length, projectsAtRisk: (result.projects || []).filter((x) => x.portfolioId === p.id && x.endDate < today && !['DONE', 'COMPLETED'].includes(String(x.status).toUpperCase())).length }));
    if (body.type === 'project-progress') rows = (result.projects || []).map((p) => ({ projectId: p.id, project: p.name, status: p.status, startDate: p.startDate, endDate: p.endDate, taskCount: (result.tasks || []).filter((x) => x.projectId === p.id).length, completedTasks: (result.tasks || []).filter((x) => x.projectId === p.id && String(x.status).toUpperCase() === 'DONE').length }));
    if (body.type === 'overdue-tasks') rows = (result.tasks || []).filter((task) => task.dueDate && task.dueDate < today && !['DONE', 'COMPLETED'].includes(String(task.status).toUpperCase())).map((task) => ({ taskId: task.id, projectId: task.projectId, title: task.title, status: task.status, dueDate: task.dueDate, assigneeId: task.assigneeId }));
    if (body.type === 'resource-usage') rows = (result.assignments || []).map((assignment) => ({ resourceId: assignment.resourceId, projectId: assignment.projectId, allocation: assignment.allocation, startDate: assignment.startDate, endDate: assignment.endDate, resourceCapacity: (result.resources || []).find((r) => r.id === assignment.resourceId)?.capacity }));
    if (body.type === 'budgets') rows = (result.budgets || []).map((budget) => ({ projectId: budget.projectId, allocated: budget.allocated, spent: budget.spent, remaining: Number(budget.allocated || 0) - Number(budget.spent || 0), currency: budget.currency, consumedPercent: Number(budget.allocated) ? Number(budget.spent || 0) / Number(budget.allocated) * 100 : null }));
    if (body.type === 'priorities') rows = (result.priorities || []).sort((a, b) => Number(b.score || 0) - Number(a.score || 0)).map((priority) => ({ rank: priority.rank, projectId: priority.projectId, score: priority.score, impact: priority.impact, urgency: priority.urgency, risk: priority.risk, alignment: priority.alignment }));
    if (body.type === 'risks') {
      rows = [
        ...(result.projects || []).filter((p) => p.endDate && p.endDate < today && !['DONE', 'COMPLETED'].includes(String(p.status).toUpperCase())).map((p) => ({ risk: 'PROJECT_PAST_END_DATE', projectId: p.id, project: p.name, status: p.status, dueDate: p.endDate })),
        ...(result.tasks || []).filter((task) => task.dueDate && task.dueDate < today && !['DONE', 'COMPLETED'].includes(String(task.status).toUpperCase())).map((task) => ({ risk: 'TASK_OVERDUE', taskId: task.id, projectId: task.projectId, task: task.title, dueDate: task.dueDate })),
        ...(result.budgets || []).filter((budget) => Number(budget.allocated) > 0 && Number(budget.spent || 0) / Number(budget.allocated) >= 0.8).map((budget) => ({ risk: 'BUDGET_NEAR_LIMIT', projectId: budget.projectId, allocated: budget.allocated, spent: budget.spent, currency: budget.currency })),
      ];
    }
    rows = rows.map((row) => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined)));
    const id = uuid(); const generatedAt = new Date().toISOString();
    const record = { pk: `TENANT#${tenantId}`, sk: `REPORT#${id}`, id, tenantId, generatedBy: userId, type: body.type, generatedAt, filters: {}, sourceServices: sources.map((name) => name === 'tasks' ? 'Project (tasks)' : name), unavailable, scope: { pageLimitPerService: 100, partial: unavailable.length > 0 || sources.some((name) => (result[name] || []).length === 100), tenantScopedByVerifiedBearer: true }, rows };
    await db.send(new PutCommand({ TableName: table, Item: record, ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)' }));
    console.info(JSON.stringify({ action: 'report.generated', tenantId, userId, reportId: id, type: body.type, rowCount: rows.length, unavailable }));
    return reply(201, { report: { ...record, csv: reportCsv(record), mediaType: 'text/csv; charset=utf-8', fileName: `astra-${body.type}-${id}.csv` } });
  }
  const match = path.match(/^\/intelligence\/reports\/([^/]+)$/);
  if (method === 'GET' && match) {
    const id = decodeURIComponent(match[1]);
    const found = await db.send(new GetCommand({ TableName: table, Key: { pk: `TENANT#${tenantId}`, sk: `REPORT#${id}` } }));
    if (!found.Item) return reply(404, { error: 'Report not found.' });
    return reply(200, { report: { ...found.Item, csv: reportCsv(found.Item), mediaType: 'text/csv; charset=utf-8', fileName: `astra-${found.Item.type}-${id}.csv` } });
  }
  return reply(404, { error: 'Not found' });
}

async function documentsApi(event, tenantId, userId, role) {
  const method = event.requestContext?.http?.method;
  const path = event.rawPath || event.path || '/documents';
  const id = event.pathParameters?.id;
  authorize(role, method, 'documents');
  if (method === 'POST' && path === '/documents') {
    const body = parse(event); validate(body, documentFields);
    if (!allowedContentTypes.has(body.contentType)) throw Object.assign(new Error('Unsupported content type'), { status: 400 });
    if (!Number.isInteger(body.contentLength) || body.contentLength < 1 || body.contentLength > 20 * 1024 * 1024) throw Object.assign(new Error('Document must be between 1 byte and 20 MB'), { status: 400 });
    const parent = await db.send(new GetCommand({ TableName: table, Key: key(tenantId, body.projectId) }));
    if (!parent.Item) return reply(404, { error: 'Project not found' });
    const docId = uuid();
    const fileName = String(body.fileName).replace(/[\\/\r\n]/g, '_').slice(0, 160);
    const objectKey = `${tenantId}/${docId}/${fileName}`;
    const item = { pk: `TENANT#${tenantId}`, sk: `DOC#${docId}`, id: docId, projectId: body.projectId, fileName, contentType: body.contentType, contentLength: body.contentLength, objectKey, createdBy: userId, createdAt: new Date().toISOString() };
    await db.send(new PutCommand({ TableName: table, Item: item, ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)' }));
    const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: objectKey, ContentType: body.contentType }), { expiresIn: 600 });
    return reply(201, { document: item, uploadUrl, expiresIn: 600 });
  }
  if (method === 'GET' && path === '/documents') {
    const data = await db.send(new QueryCommand({ TableName: table, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)', ExpressionAttributeValues: { ':pk': `TENANT#${tenantId}`, ':prefix': 'DOC#' }, Limit: Math.min(Number(event.queryStringParameters?.limit) || 50, 100), ExclusiveStartKey: decodeCursor(event.queryStringParameters?.cursor, tenantId) }));
    return reply(200, { items: data.Items || [], nextCursor: data.LastEvaluatedKey ? Buffer.from(JSON.stringify(data.LastEvaluatedKey)).toString('base64url') : null });
  }
  if (method === 'GET' && id) {
    const data = await db.send(new GetCommand({ TableName: table, Key: { pk: `TENANT#${tenantId}`, sk: `DOC#${id}` } }));
    if (!data.Item) return reply(404, { error: 'Not found' });
    const downloadUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: data.Item.objectKey }), { expiresIn: 600 });
    return reply(200, { document: data.Item, downloadUrl, expiresIn: 600 });
  }
  return reply(405, { error: 'Method not allowed' });
}

export async function api(event) {
  try {
    const {tenantId,userId,role} = claims(event);
    const path = event.rawPath || event.path || '';
    if (path === '/intelligence/ask' && event.requestContext?.http?.method === 'POST') return await askIntelligence(event, tenantId, userId, role);
    if (path === '/intelligence/reports' || path.startsWith('/intelligence/reports/')) return await reportsApi(event, tenantId, userId, role);
    if (path === '/documents' || path.startsWith('/documents/')) return await documentsApi(event, tenantId, userId, role);
    const method=event.requestContext?.http?.method;
    authorize(role,method,resource);
    const projectPath=event.rawPath || event.path || '/projects';
    const segments=projectPath.split('/').filter(Boolean);
    const id=segments[1];
    const childType=segments[2];
    const childId=segments[3];
    if((childType==='tasks'||childType==='milestones') && id){
      const parent=await db.send(new GetCommand({TableName:table,Key:key(tenantId,id)}));
      if(!parent.Item)return reply(404,{error:'Project not found'});
      const prefix=childType==='tasks'?'TASK':'MILESTONE';
      const childKey=(cid)=>({pk:`TENANT#${tenantId}`,sk:`${prefix}#${id}#${cid}`});
      const allowed=childType==='tasks'?['title','description','status','assigneeId','dueDate','priority']:['name','description','dueDate','status'];
      if(method==='GET'&&!childId){const result=await db.send(new QueryCommand({TableName:table,KeyConditionExpression:'pk = :pk AND begins_with(sk, :prefix)',ExpressionAttributeValues:{':pk':`TENANT#${tenantId}`,':prefix':`${prefix}#${id}#`},Limit:Math.min(Number(event.queryStringParameters?.limit)||50,100),ExclusiveStartKey:decodeCursor(event.queryStringParameters?.cursor,tenantId)}));return reply(200,{items:result.Items||[],nextCursor:result.LastEvaluatedKey?Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url'):null});}
      if(method==='POST'&&!childId){
        const body=parse(event);validate(body,[childType==='tasks'?'title':'name']);if(childType==='tasks'&&body.status&&!['TODO','IN_PROGRESS','BLOCKED','DONE'].includes(body.status))return reply(400,{error:'Invalid task status'});
        const cid=uuid();const item={...childKey(cid),id:cid,projectId:id,...sanitize(body,allowed),status:body.status||(childType==='tasks'?'TODO':'PLANNED'),createdBy:userId,createdAt:new Date().toISOString()};
        if(childType==='tasks'&&body.idempotencyKey!==undefined){
          if(typeof body.idempotencyKey!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(body.idempotencyKey))return reply(400,{error:'Invalid idempotencyKey'});
          const operationKey={pk:`TENANT#${tenantId}`,sk:`TASK_OPERATION#${userId}#${body.idempotencyKey}`};
          const marker={...operationKey,taskId:cid,projectId:id,userId,createdAt:item.createdAt};
          try{await db.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:table,Item:item,ConditionExpression:'attribute_not_exists(pk) AND attribute_not_exists(sk)'}},{Put:{TableName:table,Item:marker,ConditionExpression:'attribute_not_exists(pk) AND attribute_not_exists(sk)'}}]}));}
          catch(error){if(error.name!=='TransactionCanceledException')throw error;const prior=await db.send(new GetCommand({TableName:table,Key:operationKey}));if(!prior.Item)throw error;const existing=await db.send(new GetCommand({TableName:table,Key:childKey(prior.Item.taskId)}));if(!existing.Item)throw error;return reply(200,{...existing.Item,idempotentReplay:true});}
        }else await db.send(new PutCommand({TableName:table,Item,ConditionExpression:'attribute_not_exists(pk) AND attribute_not_exists(sk)'}));
        return reply(201,item);
      }
      if(method==='GET'&&childId){const result=await db.send(new GetCommand({TableName:table,Key:childKey(childId)}));return result.Item?reply(200,result.Item):reply(404,{error:'Not found'});}
      if(method==='PATCH'&&childId){const result=await db.send(new GetCommand({TableName:table,Key:childKey(childId)}));if(!result.Item)return reply(404,{error:'Not found'});const body=parse(event);if(childType==='tasks'&&body.status&&!['TODO','IN_PROGRESS','BLOCKED','DONE'].includes(body.status))return reply(400,{error:'Invalid task status'});const item={...result.Item,...sanitize(body,allowed),updatedAt:new Date().toISOString()};await db.send(new PutCommand({TableName:table,Item:item,ConditionExpression:'attribute_exists(pk) AND attribute_exists(sk)'}));return reply(200,item);}
      if(method==='DELETE'&&childId){const result=await db.send(new DeleteCommand({TableName:table,Key:childKey(childId),ReturnValues:'ALL_OLD'}));return result.Attributes?reply(200,{deleted:true}):reply(404,{error:'Not found'});}
      return reply(405,{error:'Method not allowed'});
    }
    if(method==='GET' && !id){
      const data=await db.send(new QueryCommand({TableName:table,KeyConditionExpression:'pk = :pk AND begins_with(sk, :itemPrefix)',ExpressionAttributeValues:{':pk':`TENANT#${tenantId}`,':itemPrefix':'ITEM#'},Limit:Math.min(Number(event.queryStringParameters?.limit)||50,100),ExclusiveStartKey:decodeCursor(event.queryStringParameters?.cursor,tenantId)}));
      return reply(200,{items:(data.Items||[]).map(present),nextCursor:data.LastEvaluatedKey?Buffer.from(JSON.stringify(data.LastEvaluatedKey)).toString('base64url'):null});
    }
    if(method==='GET'){
      const data=await db.send(new GetCommand({TableName:table,Key:key(tenantId,id)}));
      return data.Item?reply(200,present(data.Item)):reply(404,{error:'Not found'});
    }
    if(method==='POST'){
      const body=parse(event);validate(body,required);
      if (body.portfolioId) await assertRelatedEntity(process.env.PORTFOLIO_API_URL, `portfolios/${encodeURIComponent(body.portfolioId)}`, event, 'Portfolio');
      if (body.ownerId) await assertRelatedEntity(process.env.IDENTITY_API_URL, `users/${encodeURIComponent(body.ownerId)}`, event, 'User profile');
      const id=uuid();
      const item={...key(tenantId,id),id,...sanitize(body,fields),createdBy:userId,createdAt:new Date().toISOString()};
      await db.send(new PutCommand({TableName:table,Item:item,ConditionExpression:'attribute_not_exists(pk) AND attribute_not_exists(sk)'}));
      if(process.env.TOPIC_ARN){
        const eventType = body.status === 'COMPLETED' ? 'ProjectCompleted' : 'ProjectCreated';
        const published = await sns.send(new PublishCommand({TopicArn:process.env.TOPIC_ARN,Message:JSON.stringify({eventId:uuid(),eventType,eventVersion:1,tenantId,entityId:item.sk.slice(5),occurredAt:new Date().toISOString(),payload:{projectId:item.sk.slice(5),name:item.name,status:item.status||'PLANNED'}}),MessageAttributes:{eventType:{DataType:'String',StringValue:eventType}}}));
        console.info(JSON.stringify({ level: 'info', service: 'project', eventType, messageId: published.MessageId }));
      } else {
        console.error(JSON.stringify({ level: 'error', service: 'project', eventType: 'ProjectCreated', reason: 'TOPIC_ARN is not configured' }));
      }
      return reply(201,present(item));
    }
    if(method==='PATCH'){
      const body=sanitize(parse(event),fields);
      if (body.portfolioId) await assertRelatedEntity(process.env.PORTFOLIO_API_URL, `portfolios/${encodeURIComponent(body.portfolioId)}`, event, 'Portfolio');
      if (body.ownerId) await assertRelatedEntity(process.env.IDENTITY_API_URL, `users/${encodeURIComponent(body.ownerId)}`, event, 'User profile');
      const old=await db.send(new GetCommand({TableName:table,Key:key(tenantId,id)}));
      if(!old.Item)return reply(404,{error:'Not found'});
      const item={...old.Item,...body,updatedAt:new Date().toISOString()};
      await db.send(new PutCommand({TableName:table,Item:item,ConditionExpression:'attribute_exists(pk) AND attribute_exists(sk)'}));
      if(process.env.TOPIC_ARN){
        const eventType = item.status === 'COMPLETED' && old.Item.status !== 'COMPLETED' ? 'ProjectCompleted' : 'ProjectUpdated';
        await sns.send(new PublishCommand({TopicArn:process.env.TOPIC_ARN,Message:JSON.stringify({eventId:uuid(),eventType,eventVersion:1,tenantId,entityId:id,occurredAt:new Date().toISOString(),payload:{projectId:id,name:item.name,status:item.status}}),MessageAttributes:{eventType:{DataType:'String',StringValue:eventType}}}));
      }
      return reply(200,present(item));
    }
    if(method==='DELETE'){
      const deleted=await db.send(new DeleteCommand({TableName:table,Key:key(tenantId,id),ReturnValues:'ALL_OLD'}));
      if(!deleted.Attributes)return reply(404,{error:'Not found'});
      return reply(200,{deleted:true});
    }
    return reply(405,{error:'Method not allowed'});
  }catch(e){console.error(e);return reply(e.status||500,{error:e.status?e.message:'Internal server error'});}
}
