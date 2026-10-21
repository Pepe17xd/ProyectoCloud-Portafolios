import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { decodeCursor, parse, reply, uuid } from '@cloudportfolio/shared';

const endpoint = process.env.DYNAMODB_ENDPOINT;
const client = new DynamoDBClient({ endpoint, region: process.env.AWS_REGION || 'us-east-1', ...(endpoint ? { credentials: { accessKeyId: 'local', secretAccessKey: 'local' } } : {}) });
const db = DynamoDBDocumentClient.from(client);
const remindersTable = process.env.REMINDER_TABLE_NAME || `${process.env.TABLE_NAME}-reminders`;
const recordsTable = process.env.TABLE_NAME;
const reminderPrefix = (userId) => `REMINDER#${userId}#`;
const proposalPrefix = (userId) => `ORBITAL#PROPOSAL#${userId}#`;
const validZone = (timezone) => { try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); return true; } catch { return false; } };

function localDateParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}
function zonedInstant(dateText, timeText, timezone) {
  const [year, month, day] = dateText.split('-').map(Number);
  const [hour, minute] = timeText.split(':').map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(guess));
    const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
    const rendered = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute);
    const next = guess + target - rendered;
    if (next === guess) break;
    guess = next;
  }
  const result = new Date(guess);
  const verified = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(result);
  const values = Object.fromEntries(verified.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  if (`${values.year}-${values.month}-${values.day}` !== dateText || `${values.hour}:${values.minute}` !== timeText) throw new Error('La hora indicada no existe en esa zona horaria.');
  return result.toISOString();
}
function tomorrowDate(timezone) {
  const p = localDateParts(new Date(), timezone);
  const next = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day) + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}
function nextRecurringDue(dueAt, timezone, days) {
  const original = new Date(dueAt);
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(original);
  const parts = localDateParts(original, timezone);
  for (let extraDay = 0; extraDay <= 7; extraDay += 1) {
    const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + days + extraDay));
    const dateText = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    try { return zonedInstant(dateText, clock, timezone); } catch (error) { if (!/no existe/.test(error.message)) throw error; }
  }
  throw new Error('No se pudo encontrar una hora válida para la recurrencia en la zona configurada.');
}
function parseReminder(text, timezone) {
  if (typeof text !== 'string' || text.length > 300) throw Object.assign(new Error('La solicitud debe tener hasta 300 caracteres.'), { status: 400 });
  const weekly = text.trim().match(/^recu[eé]rdame\s+(.{3,180}?)\s+(?:todos\s+los\s+)?(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\s+a\s+las\s+(\d{1,2})(?::(\d{2}))?$/i);
  if (weekly) {
    const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const targetDay = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'].indexOf(weekly[2].toLocaleLowerCase('es'));
    const time = `${String(Number(weekly[3])).padStart(2, '0')}:${weekly[4] || '00'}`;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw Object.assign(new Error('La hora debe estar entre 00:00 y 23:59.'), { status: 400 });
    const now = new Date();
    const todayWeekday = names.indexOf(new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long' }).format(now).toLowerCase());
    let days = (targetDay - todayWeekday + 7) % 7;
    const today = localDateParts(now, timezone);
    if (days === 0) {
      const currentTime = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
      if (time <= currentTime) days = 7;
    }
    const date = new Date(Date.UTC(Number(today.year), Number(today.month) - 1, Number(today.day) + days));
    const dateText = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    return { title: weekly[1].trim(), dueAt: zonedInstant(dateText, time, timezone), recurrence: 'WEEKLY' };
  }
  const match = text.trim().match(/^recu[eé]rdame\s+(.{3,180}?)\s+(?:el\s+)?(hoy|ma[nñ]ana|\d{4}-\d{2}-\d{2})\s+a\s+las\s+(\d{1,2})(?::(\d{2}))?$/i);
  if (!match) throw Object.assign(new Error('Solicitud ambigua. Usa: “Recuérdame revisar el proyecto mañana a las 09:00”.'), { status: 422 });
  const title = match[1].trim();
  const dateToken = match[2].toLocaleLowerCase('es');
  const date = dateToken === 'hoy' ? `${localDateParts(new Date(), timezone).year}-${localDateParts(new Date(), timezone).month}-${localDateParts(new Date(), timezone).day}` : ['mañana', 'manana'].includes(dateToken) ? tomorrowDate(timezone) : dateToken;
  const time = `${String(Number(match[3])).padStart(2, '0')}:${match[4] || '00'}`;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw Object.assign(new Error('La hora debe estar entre 00:00 y 23:59.'), { status: 400 });
  const dueAt = zonedInstant(date, time, timezone);
  if (Date.parse(dueAt) <= Date.now() || Date.parse(dueAt) > Date.now() + 366 * 24 * 60 * 60 * 1000) throw Object.assign(new Error('El recordatorio debe quedar dentro de los próximos 366 días.'), { status: 400 });
  return { title, dueAt };
}
function parseTaskAction(text) {
  if (typeof text !== 'string' || text.length > 300) return null;
  const match = text.trim().match(/^crear tarea\s+["“](.{3,150})["”]\s+en proyecto\s+([a-zA-Z0-9_-]{3,100})$/i);
  return match ? { title: match[1].trim(), projectId: match[2] } : null;
}
async function projectRequest(event, path, method = 'GET', body) {
  const base = process.env.PROJECT_API_URL;
  const authorization = event.headers?.authorization || event.headers?.Authorization;
  if (!base || !authorization) throw Object.assign(new Error('Project API relationship validation is not configured.'), { status: 503 });
  try {
    return await fetch(`${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`, { method, headers: { authorization, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(3000) });
  } catch {
    throw Object.assign(new Error('Project service unavailable.'), { status: 503 });
  }
}
const itemKey = (tenantId, userId, id) => ({ pk: `TENANT#${tenantId}`, sk: `${reminderPrefix(userId)}${id}` });
const gsi = (dueAt, id) => ({ gsi1pk: 'REMINDER#ACTIVE', gsi1sk: `${dueAt}#${id}` });
function scopedCursor(cursor, tenantId, prefix) {
  const key = decodeCursor(cursor, tenantId);
  if (key && !key.sk.startsWith(prefix)) throw Object.assign(new Error('Invalid cursor scope'), { status: 400 });
  return key;
}

export async function orbitalApi(event, actor, method, path) {
  const { tenantId, userId, role } = actor;
  const timezoneDefault = 'America/Lima';
  const proposalMatch = path === '/intelligence/proposals' && method === 'POST';
  if (proposalMatch) {
    const body = parse(event);
    const taskAction = parseTaskAction(body.text);
    if (taskAction) {
      if (body.recurrence && body.recurrence !== 'ONCE') return reply(400, { error: 'La recurrencia solo aplica a recordatorios.' });
      if (!['ADMIN', 'MANAGER'].includes(role)) return reply(403, { error: 'Manager role required to propose task creation.' });
      const projectResponse = await projectRequest(event, `projects/${encodeURIComponent(taskAction.projectId)}`);
      if (projectResponse.status === 404) return reply(422, { error: 'El proyecto no existe en tu organización.' });
      if (!projectResponse.ok) return reply(projectResponse.status === 401 || projectResponse.status === 403 ? projectResponse.status : 503, { error: 'No se pudo validar el proyecto autorizado.' });
      const project = await projectResponse.json();
      const id = uuid(); const createdAt = new Date().toISOString();
      const proposal = { pk: `TENANT#${tenantId}`, sk: `${proposalPrefix(userId)}${id}`, id, kind: 'TASK_CREATE', status: 'PENDING_CONFIRMATION', title: taskAction.title, projectId: taskAction.projectId, projectName: project.name || taskAction.projectId, tenantId, userId, createdAt, expiresAt: Math.floor(Date.now() / 1000) + 900 };
      await db.send(new PutCommand({ TableName: recordsTable, Item: proposal, ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)' }));
      return reply(201, { proposal: { id, kind: proposal.kind, title: proposal.title, projectId: proposal.projectId, projectName: proposal.projectName, status: proposal.status, expiresAt: proposal.expiresAt }, confirmationRequired: true, interpreter: 'deterministic-limited-rules' });
    }
    const timezone = body.timezone || timezoneDefault;
    if (!validZone(timezone)) return reply(400, { error: 'Zona horaria inválida.' });
    let interpreted;
    try { interpreted = parseReminder(body.text, timezone); } catch (error) {
      if (error.status) throw error;
      throw Object.assign(error, { status: 400 });
    }
    const recurrence = interpreted.recurrence || body.recurrence || 'ONCE';
    if (!['ONCE', 'DAILY', 'WEEKLY'].includes(recurrence)) return reply(400, { error: 'Recurrencia inválida.' });
    const id = uuid();
    const createdAt = new Date().toISOString();
    const proposal = { pk: `TENANT#${tenantId}`, sk: `${proposalPrefix(userId)}${id}`, id, kind: 'REMINDER_CREATE', status: 'PENDING_CONFIRMATION', title: interpreted.title, dueAt: interpreted.dueAt, timezone, recurrence, tenantId, userId, createdAt, expiresAt: Math.floor(Date.now() / 1000) + 900 };
    await db.send(new PutCommand({ TableName: recordsTable, Item: proposal, ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)' }));
    console.info(JSON.stringify({ action: 'orbital.proposal.created', tenantId, userId, operationId: id, kind: proposal.kind }));
    return reply(201, { proposal: { id, kind: proposal.kind, title: proposal.title, dueAt: proposal.dueAt, timezone, recurrence, status: proposal.status, expiresAt: proposal.expiresAt }, confirmationRequired: true, interpreter: 'deterministic-limited-rules' });
  }
  if (path === '/intelligence/actions' && method === 'GET') {
    const prefix = proposalPrefix(userId);
    const data = await db.send(new QueryCommand({ TableName: recordsTable, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)', ExpressionAttributeValues: { ':pk': `TENANT#${tenantId}`, ':prefix': prefix }, Limit: Math.min(Number(event.queryStringParameters?.limit) || 50, 100), ExclusiveStartKey: scopedCursor(event.queryStringParameters?.cursor, tenantId, prefix), ScanIndexForward: false }));
    return reply(200, { items: data.Items || [], nextCursor: data.LastEvaluatedKey ? Buffer.from(JSON.stringify(data.LastEvaluatedKey)).toString('base64url') : null });
  }
  const confirmMatch = path.match(/^\/intelligence\/actions\/([^/]+)\/confirm$/);
  if (confirmMatch && method === 'POST') {
    const proposalId = decodeURIComponent(confirmMatch[1]);
    const body = parse(event);
    if (typeof body.operationId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(body.operationId)) return reply(400, { error: 'operationId válido requerido para idempotencia.' });
    const proposalKey = { pk: `TENANT#${tenantId}`, sk: `${proposalPrefix(userId)}${proposalId}` };
    const found = await db.send(new GetCommand({ TableName: recordsTable, Key: proposalKey }));
    const proposal = found.Item;
    if (!proposal || (proposal.status !== 'CONFIRMED' && proposal.expiresAt < Math.floor(Date.now() / 1000))) return reply(404, { error: 'Propuesta no encontrada o expirada.' });
    if (proposal.kind === 'TASK_CREATE') {
      if (!['ADMIN', 'MANAGER'].includes(role)) return reply(403, { error: 'Manager role required to create tasks.' });
      if (proposal.status === 'CONFIRMED') {
        if (proposal.operationId !== body.operationId || !proposal.resultId) return reply(409, { error: 'La propuesta ya fue confirmada con otra operación.' });
        const priorResponse = await projectRequest(event, `projects/${encodeURIComponent(proposal.projectId)}/tasks/${encodeURIComponent(proposal.resultId)}`);
        if (!priorResponse.ok) return reply(503, { error: 'La acción fue confirmada; el detalle del resultado no está disponible.' });
        return reply(200, { task: await priorResponse.json(), idempotentReplay: true });
      }
      const created = await projectRequest(event, `projects/${encodeURIComponent(proposal.projectId)}/tasks`, 'POST', { title: proposal.title, idempotencyKey: body.operationId });
      if (!created.ok) return reply(created.status === 401 || created.status === 403 || created.status === 404 ? created.status : 503, { error: created.status === 403 ? 'El servicio de proyectos denegó la creación por permisos.' : 'No se pudo crear la tarea en Project Service.' });
      const task = await created.json(); const now = new Date().toISOString();
      await db.send(new PutCommand({ TableName: recordsTable, Item: { ...proposal, status: 'CONFIRMED', operationId: body.operationId, resultId: task.id, confirmedAt: now }, ConditionExpression: '#status = :pending', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':pending': 'PENDING_CONFIRMATION' } }));
      console.info(JSON.stringify({ action: 'orbital.task.created', tenantId, userId, operationId: body.operationId, projectId: proposal.projectId, taskId: task.id }));
      return reply(created.status === 200 ? 200 : 201, { task, idempotentReplay: Boolean(task.idempotentReplay) });
    }
    const reminderKey = itemKey(tenantId, userId, proposalId);
    if (proposal.status === 'CONFIRMED') {
      const prior = await db.send(new GetCommand({ TableName: remindersTable, Key: reminderKey }));
      if (proposal.operationId === body.operationId && prior.Item) return reply(200, { reminder: prior.Item, idempotentReplay: true });
      return reply(409, { error: 'La propuesta ya fue confirmada con otra operación.' });
    }
    const now = new Date().toISOString();
    const reminder = { ...reminderKey, id: proposalId, tenantId, userId, title: proposal.title, dueAt: proposal.dueAt, timezone: proposal.timezone, recurrence: proposal.recurrence || 'ONCE', status: 'SCHEDULED', createdBy: userId, createdAt: now, updatedAt: now, operationId: body.operationId, audit: [{ at: now, actorId: userId, action: 'CREATED' }], ...gsi(proposal.dueAt, proposalId) };
    try {
      await db.send(new PutCommand({ TableName: remindersTable, Item: reminder, ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)' }));
    } catch (error) {
      if (error.name !== 'ConditionalCheckFailedException') throw error;
      const prior = await db.send(new GetCommand({ TableName: remindersTable, Key: reminderKey }));
      if (prior.Item?.operationId === body.operationId) {
        await db.send(new PutCommand({ TableName: recordsTable, Item: { ...proposal, status: 'CONFIRMED', operationId: body.operationId, confirmedAt: now }, ConditionExpression: '#status = :pending', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':pending': 'PENDING_CONFIRMATION' } }));
        return reply(200, { reminder: prior.Item, idempotentReplay: true });
      }
      return reply(409, { error: 'La acción ya fue procesada.' });
    }
    await db.send(new PutCommand({ TableName: recordsTable, Item: { ...proposal, status: 'CONFIRMED', operationId: body.operationId, confirmedAt: now }, ConditionExpression: '#status = :pending', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':pending': 'PENDING_CONFIRMATION' } }));
    console.info(JSON.stringify({ action: 'orbital.reminder.created', tenantId, userId, operationId: body.operationId, reminderId: proposalId, role }));
    return reply(201, { reminder, idempotentReplay: false });
  }
  if (path === '/reminders' && method === 'GET') {
    const prefix = reminderPrefix(userId);
    const data = await db.send(new QueryCommand({ TableName: remindersTable, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)', ExpressionAttributeValues: { ':pk': `TENANT#${tenantId}`, ':prefix': prefix }, Limit: Math.min(Number(event.queryStringParameters?.limit) || 50, 100), ExclusiveStartKey: scopedCursor(event.queryStringParameters?.cursor, tenantId, prefix), ScanIndexForward: false }));
    return reply(200, { items: data.Items || [], nextCursor: data.LastEvaluatedKey ? Buffer.from(JSON.stringify(data.LastEvaluatedKey)).toString('base64url') : null });
  }
  const reminderMatch = path.match(/^\/reminders\/([^/]+)$/);
  if (reminderMatch && ['PATCH', 'DELETE'].includes(method)) {
    const id = decodeURIComponent(reminderMatch[1]);
    const key = itemKey(tenantId, userId, id);
    const current = await db.send(new GetCommand({ TableName: remindersTable, Key: key }));
    if (!current.Item) return reply(404, { error: 'Recordatorio no encontrado.' });
    const body = method === 'PATCH' ? parse(event) : {};
    const allowed = ['title', 'dueAt', 'timezone', 'recurrence', 'status'];
    if (Object.keys(body).some((field) => !allowed.includes(field))) return reply(400, { error: 'Campo no permitido.' });
    const status = method === 'DELETE' ? 'CANCELLED' : (body.status || current.Item.status);
    if (!['SCHEDULED', 'PAUSED', 'COMPLETED', 'CANCELLED'].includes(status)) return reply(400, { error: 'Estado de recordatorio inválido.' });
    const item = { ...current.Item, ...body, status, updatedAt: new Date().toISOString(), audit: [...(current.Item.audit || []), { at: new Date().toISOString(), actorId: userId, action: method === 'DELETE' ? 'CANCELLED' : `UPDATED:${status}` }].slice(-50) };
    delete item.gsi1pk; delete item.gsi1sk;
    if (status === 'SCHEDULED') {
      if (typeof item.title !== 'string' || !item.title.trim() || item.title.length > 180 || !validZone(item.timezone) || !['ONCE', 'DAILY', 'WEEKLY'].includes(item.recurrence) || !Number.isFinite(Date.parse(item.dueAt)) || Date.parse(item.dueAt) <= Date.now()) return reply(400, { error: 'Revisa título, fecha futura, zona horaria o recurrencia.' });
      Object.assign(item, gsi(item.dueAt, id));
    }
    await db.send(new PutCommand({ TableName: remindersTable, Item: item, ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)' }));
    console.info(JSON.stringify({ action: `orbital.reminder.${status.toLowerCase()}`, tenantId, userId, reminderId: id }));
    return reply(200, { reminder: item });
  }
  return reply(404, { error: 'Not found' });
}

export async function runDueReminders({ limit = 20 } = {}) {
  const now = new Date().toISOString();
  const due = await db.send(new QueryCommand({ TableName: remindersTable, IndexName: 'DueIndex', KeyConditionExpression: 'gsi1pk = :pk AND gsi1sk <= :due', ExpressionAttributeValues: { ':pk': 'REMINDER#ACTIVE', ':due': `${now}\uffff` }, Limit: limit }));
  const outcomes = [];
  for (const reminder of due.Items || []) {
    const notificationId = `reminder-${reminder.id}-${reminder.dueAt}`;
    const inboxItem = { pk: `TENANT#${reminder.tenantId}`, sk: `NOTIFY#DELIVERY#${reminder.userId}#${notificationId}`, eventId: notificationId, eventType: 'ReminderDue', tenantId: reminder.tenantId, userId: reminder.userId, title: reminder.title, reminderId: reminder.id, deliveryStatus: 'SIMULATED_LOCAL', provider: 'local-mailbox', notice: 'Simulado localmente — No enviado a WhatsApp', createdAt: now };
    try {
      await db.send(new PutCommand({ TableName: recordsTable, Item: inboxItem, ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)' }));
    } catch (error) {
      if (error.name !== 'ConditionalCheckFailedException') throw error;
    }
    const current = await db.send(new GetCommand({ TableName: remindersTable, Key: { pk: reminder.pk, sk: reminder.sk } }));
    if (!current.Item || current.Item.status !== 'SCHEDULED' || current.Item.dueAt !== reminder.dueAt) continue;
    if (reminder.recurrence === 'ONCE') {
      await db.send(new PutCommand({ TableName: remindersTable, Item: { ...current.Item, status: 'COMPLETED', deliveredAt: now, updatedAt: now, audit: [...(current.Item.audit || []), { at: now, actorId: 'scheduler', action: 'DELIVERED' }].slice(-50) }, ConditionExpression: '#status = :scheduled AND dueAt = :due', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':scheduled': 'SCHEDULED', ':due': reminder.dueAt } }));
    } else {
      const stepDays = reminder.recurrence === 'DAILY' ? 1 : 7;
      let nextDue = nextRecurringDue(reminder.dueAt, reminder.timezone, stepDays);
      while (Date.parse(nextDue) <= Date.now()) nextDue = nextRecurringDue(nextDue, reminder.timezone, stepDays);
      await db.send(new PutCommand({ TableName: remindersTable, Item: { ...current.Item, ...gsi(nextDue, reminder.id), dueAt: nextDue, lastDeliveredAt: now, updatedAt: now, audit: [...(current.Item.audit || []), { at: now, actorId: 'scheduler', action: 'DELIVERED_AND_RESCHEDULED' }].slice(-50) }, ConditionExpression: '#status = :scheduled AND dueAt = :due', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':scheduled': 'SCHEDULED', ':due': reminder.dueAt } }));
    }
    outcomes.push({ reminderId: reminder.id, notificationId, status: 'SIMULATED_LOCAL' });
  }
  return outcomes;
}

export { zonedInstant, parseReminder };
