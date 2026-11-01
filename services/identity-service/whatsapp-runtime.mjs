import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { createMetaAdapter, validE164, validateMetaProviderConfig, verifyMetaSignature } from './meta-whatsapp.mjs';

const CONSENT_VERSION = 'profiles-whatsapp-2026-01';
const readableError = (statusCode, message) => ({ statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: message }) });
const ok = (statusCode, data) => ({ statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
const sha = value => createHash('sha256').update(value).digest('hex');
const prefKey = (tenantId, userId) => ({ pk: `TENANT#${tenantId}`, sk: `NOTIFY#PREFERENCES#${userId}` });
const challengeKey = (tenantId, userId) => ({ pk: `TENANT#${tenantId}`, sk: `NOTIFY#VERIFY#${userId}` });
const deliveryKey = (tenantId, userId, id) => ({ pk: `TENANT#${tenantId}`, sk: `NOTIFY#DELIVERY#${userId}#${id}` });
const eventTypes = new Set(['reminder', 'automation', 'risk-alert', 'weekly-summary', 'ProjectCreated', 'ProjectUpdated', 'ProjectCompleted', 'BudgetThresholdExceeded', 'ResourceAssigned', 'PriorityRecalculated']);

// Retry transient infrastructure/provider errors. Policy denials and ambiguous
// provider outcomes are terminal so a retry cannot send a duplicate message.
export function shouldRetryWhatsAppRecord(error) {
  return !['INVALID_JOB', 'NOT_ALLOWED', 'PROVIDER_DISABLED', 'UNKNOWN', 'FAILED', 'PROVIDER_REJECTED'].includes(error?.code);
}

export function createWhatsAppRuntime({ db, table, sqs, queueUrl, mode = 'disabled', secretProvider = async () => null, fetchImpl = fetch, webhookVerifyToken = '', appSecret = '', testVerification = false, allowTestDelivery = false, now = () => new Date() }) {
  if (process.env.NODE_ENV === 'production' || process.env.AWS_LAMBDA_FUNCTION_NAME) { testVerification = false; allowTestDelivery = false; }
  const getPreference = async (tenantId, userId) => (await db.send(new GetCommand({ TableName: table, Key: prefKey(tenantId, userId) }))).Item || {};
  async function providerConfig() {
    if (mode === 'integration-test') {
      if (!allowTestDelivery || process.env.NODE_ENV === 'production') return null;
      const cfg = await secretProvider();
      return cfg;
    }
    if (mode !== 'meta') return null;
    return validateMetaProviderConfig(await secretProvider());
  }
  async function sendVerificationCode(phoneNumber, code) {
    if (mode === 'integration-test' && testVerification && process.env.NODE_ENV !== 'production') return { provider: 'local-test' };
    const cfg = await providerConfig();
    if (!cfg?.accessToken || !cfg.phoneNumberId || !cfg.graphVersion || !cfg.templates?.verification) throw Object.assign(new Error('WhatsApp verification provider is not configured'), { code: 'PROVIDER_DISABLED' });
    const template = cfg.templates.verification;
    const testOrigin = mode === 'integration-test' && process.env.NOTIFICATION_MODE === 'integration-test' && process.env.NODE_ENV !== 'production' && !process.env.AWS_LAMBDA_FUNCTION_NAME ? cfg.apiOrigin : undefined;
    const apiOrigin = testOrigin || 'https://graph.facebook.com';
    const response = await fetchImpl(`${apiOrigin.replace(/\/$/, '')}/${cfg.graphVersion}/${cfg.phoneNumberId}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to: phoneNumber.slice(1), type: 'template', template: { name: template.name, language: { code: template.language }, components: [{ type: 'body', parameters: [{ type: 'text', text: code }] }] } }) });
    if (!response.ok) throw Object.assign(new Error('Verification message could not be sent'), { code: response.status === 429 || response.status >= 500 ? 'RETRYABLE' : 'PROVIDER_REJECTED' });
    const result = await response.json();
    return { provider: 'meta', messageId: result.messages?.[0]?.id };
  }
  async function handle(event, actor, method, path) {
    const { tenantId, userId } = actor;
    const key = prefKey(tenantId, userId);
    if (path === '/notifications/whatsapp' && method === 'GET') {
      const [prefs, history] = await Promise.all([getPreference(tenantId, userId), db.send(new QueryCommand({ TableName: table, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)', ExpressionAttributeValues: { ':pk': key.pk, ':prefix': `NOTIFY#DELIVERY#${userId}#` }, Limit: 25, ScanIndexForward: false }))]);
      const cfg = ['meta', 'integration-test'].includes(mode) ? await providerConfig() : null;
      const configured = Boolean(cfg?.accessToken && /^\d+$/.test(cfg.phoneNumberId || '') && (cfg?.appSecret || appSecret) && (cfg?.webhookVerifyToken || webhookVerifyToken) && cfg?.templates?.verification && Object.keys(cfg?.templates || {}).some(name => name !== 'verification'));
      const status = prefs.whatsappVerificationStatus === 'revoked' || prefs.consentRevokedAt ? 'revoked' : prefs.whatsappConsent !== true ? 'not-configured' : prefs.whatsappVerificationStatus === 'pending' ? 'pending-verification' : prefs.whatsappVerified ? 'active' : prefs.whatsappVerificationStatus || 'inactive';
      return ok(200, { status, providerAvailable: configured, verificationProvider: prefs.verificationProvider || null, whatsappNumber: prefs.whatsappNumber || null, consent: prefs.whatsappConsent === true, consentAt: prefs.consentAt || null, consentVersion: prefs.consentVersion || null, alertTypes: prefs.whatsappAlertTypes || [], timezone: prefs.timezone || 'America/Lima', allowedHours: prefs.allowedHours || { start: '08:00', end: '18:00' }, items: (history.Items || []).filter(item => item.provider === 'meta-cloud-api').sort((a,b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))) });
    }
    if (path === '/notifications/whatsapp/verification' && method === 'POST') {
      let body; try { body = JSON.parse(event.body || '{}'); } catch { return readableError(400, 'Revisa los datos enviados.'); }
      if (body.consent !== true || !validE164(body.phoneNumber) || body.consentVersion !== CONSENT_VERSION) return readableError(400, 'Ingresa un número internacional válido y acepta el consentimiento vigente.');
      if (!['meta', 'integration-test'].includes(mode) || mode === 'integration-test' && (!testVerification || process.env.NODE_ENV === 'production')) return readableError(503, 'WhatsApp todavía no está disponible para verificar números.');
      const previous = await getPreference(tenantId, userId); const current = now();
      if (previous.lastVerificationRequestedAt && current.getTime() - Date.parse(previous.lastVerificationRequestedAt) < 60_000) return readableError(429, 'Espera un minuto antes de solicitar otro código.');
      const code = String(randomInt(100000, 1000000)); const expiresAt = Math.floor(current.getTime() / 1000) + 600;
      const config = await providerConfig(); const lookupSecret = config?.appSecret || appSecret;
      try {
        await db.send(new UpdateCommand({ TableName: table, Key: key, UpdateExpression: 'SET lastVerificationRequestedAt = :requested', ConditionExpression: 'attribute_not_exists(lastVerificationRequestedAt) OR lastVerificationRequestedAt <= :allowedBefore', ExpressionAttributeValues: { ':requested': current.toISOString(), ':allowedBefore': new Date(current.getTime() - 60_000).toISOString() } }));
      } catch (error) {
        if (error.name === 'ConditionalCheckFailedException') return readableError(429, 'Espera un minuto antes de solicitar otro cÃ³digo.');
        throw error;
      }
      if (!lookupSecret) return readableError(503, 'El proveedor aún no tiene configurado el control seguro de números.');
      let sent; try { sent = await sendVerificationCode(body.phoneNumber, code); } catch (error) { return readableError(error.code === 'PROVIDER_DISABLED' ? 503 : 502, error.code === 'PROVIDER_DISABLED' ? 'El proveedor de verificación aún no está configurado.' : 'No se pudo enviar el código. Inténtalo más tarde.'); }
      const challenge = { ...challengeKey(tenantId, userId), phoneHash: sha(body.phoneNumber), codeHash: sha(code), expiresAt, attempts: 0, provider: sent.provider, createdAt: current.toISOString(), ...(sent.provider === 'local-test' ? { testCode: code } : {}) };
      const item = { ...key, ...previous, whatsappNumber: body.phoneNumber, gsi3pk: `PHONE#${createHmac('sha256', lookupSecret).update(body.phoneNumber.slice(1)).digest('hex')}`, gsi3sk: `${tenantId}#${userId}`, whatsappConsent: true, consentVersion: CONSENT_VERSION, consentAt: current.toISOString(), consentRevokedAt: null, whatsappVerified: false, whatsappVerificationStatus: 'pending', verificationProvider: null, whatsappVerifiedAt: null, timezone: previous.timezone || 'UTC', allowedHours: previous.allowedHours || { start: '00:00', end: '23:59' }, lastVerificationRequestedAt: current.toISOString(), updatedAt: current.toISOString() };
      await db.send(new PutCommand({ TableName: table, Item: challenge })); await db.send(new PutCommand({ TableName: table, Item: item }));
      return ok(202, { status: 'pending-verification', expiresInSeconds: 600, message: sent.provider === 'local-test' ? 'Código de proveedor de pruebas local; no se envió a WhatsApp ni verifica un número real.' : 'Te enviamos un código de verificación.' });
    }
    if (path === '/notifications/verification-inbox' && method === 'GET') {
      if (mode !== 'integration-test' || !testVerification || process.env.NODE_ENV === 'production') return readableError(404, 'No hay códigos de prueba disponibles.');
      const challenge = (await db.send(new GetCommand({ TableName: table, Key: challengeKey(tenantId, userId) }))).Item;
      if (!challenge || challenge.expiresAt <= Math.floor(now().getTime() / 1000) || challenge.provider !== 'local-test') return readableError(404, 'No hay un código de prueba vigente.');
      return ok(200, { code: challenge.testCode, notice: 'Código del proveedor local de pruebas; nunca habilita WhatsApp real.' });
    }
    if (path === '/notifications/whatsapp/confirm' && method === 'POST') {
      let body; try { body = JSON.parse(event.body || '{}'); } catch { return readableError(400, 'Código inválido.'); }
      const ck = challengeKey(tenantId, userId); const challenge = (await db.send(new GetCommand({ TableName: table, Key: ck }))).Item;
      if (!challenge || challenge.expiresAt <= Math.floor(now().getTime() / 1000) || challenge.attempts >= 5) return readableError(400, 'El código venció o se superó el límite de intentos.');
      const supplied = Buffer.from(sha(String(body.code || ''))); const expected = Buffer.from(challenge.codeHash || '');
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { try { await db.send(new UpdateCommand({ TableName: table, Key: ck, UpdateExpression: 'SET attempts = attempts + :one', ConditionExpression: 'expiresAt > :now AND attempts < :max', ExpressionAttributeValues: { ':one': 1, ':now': Math.floor(now().getTime() / 1000), ':max': 5 } })); } catch (error) { if (error.name !== 'ConditionalCheckFailedException') throw error; } return readableError(400, 'El código no coincide.'); }
      const current = await getPreference(tenantId, userId); if (current.whatsappConsent !== true || current.consentRevokedAt) return readableError(403, 'El consentimiento fue revocado.');
      const test = challenge.provider === 'local-test';
      const updated = { ...current, whatsappVerified: !test, whatsappVerificationStatus: test ? 'verified-test' : 'verified', verificationProvider: test ? 'local-test' : 'trusted', whatsappVerifiedAt: now().toISOString(), updatedAt: now().toISOString() };
      try { await db.send(new PutCommand({ TableName: table, Item: updated, ConditionExpression: 'whatsappConsent = :consent AND whatsappNumber = :phone', ExpressionAttributeValues: { ':consent': true, ':phone': current.whatsappNumber } })); } catch (error) { if (error.name === 'ConditionalCheckFailedException') return readableError(403, 'El consentimiento fue revocado antes de terminar la verificación.'); throw error; }
      await db.send(new DeleteCommand({ TableName: table, Key: ck }));
      return ok(200, { status: updated.whatsappVerificationStatus, whatsappVerified: updated.whatsappVerified, notice: test ? 'Verificación simulada: no prueba posesión de un número real ni habilita envíos fuera de la integración local.' : 'Número verificado.' });
    }
    if (path === '/notifications/whatsapp/preferences' && method === 'PUT') {
      let body; try { body = JSON.parse(event.body || '{}'); } catch { return readableError(400, 'Preferencias inválidas.'); }
      if (!Array.isArray(body.alertTypes) || body.alertTypes.length > 12 || body.alertTypes.some(type => !eventTypes.has(type))) return readableError(400, 'Selecciona eventos de notificación válidos.');
      try { new Intl.DateTimeFormat('en', { timeZone: body.timezone || 'America/Lima' }); } catch { return readableError(400, 'La zona horaria no es válida.'); }
      const current = await getPreference(tenantId, userId); const updated = { ...key, ...current, whatsappAlertTypes: [...new Set(body.alertTypes)], timezone: body.timezone || 'America/Lima', allowedHours: body.allowedHours || current.allowedHours || { start: '08:00', end: '18:00' }, updatedAt: now().toISOString() };
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(updated.allowedHours.start || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(updated.allowedHours.end || '')) return readableError(400, 'El horario no es válido.');
      await db.send(new PutCommand({ TableName: table, Item: updated })); return ok(200, { alertTypes: updated.whatsappAlertTypes, timezone: updated.timezone, allowedHours: updated.allowedHours });
    }
    if (path === '/notifications/whatsapp/number' && method === 'DELETE') {
      const current = await getPreference(tenantId, userId); if (!current.pk) return ok(200, { revoked: true });
      const updated = { ...current, whatsappNumber: null, whatsappConsent: false, whatsappVerified: false, whatsappVerificationStatus: 'revoked', verificationProvider: null, whatsappAlertTypes: [], consentRevokedAt: now().toISOString(), updatedAt: now().toISOString() }; delete updated.gsi3pk; delete updated.gsi3sk;
      await db.send(new PutCommand({ TableName: table, Item: updated })); await db.send(new DeleteCommand({ TableName: table, Key: challengeKey(tenantId, userId) })); return ok(200, { revoked: true, status: 'revoked' });
    }
    return readableError(404, 'Not found');
  }
  async function enqueue({ tenantId, userId, eventType, idempotencyKey, parameters = [], title = '' }) {
    if (!queueUrl || !eventTypes.has(eventType) || !tenantId || !userId || !idempotencyKey) return false;
    const prefs = await getPreference(tenantId, userId);
    const testVerified = allowTestDelivery && mode === 'integration-test' && prefs.whatsappVerificationStatus === 'verified-test' && prefs.verificationProvider === 'local-test';
    if (prefs.whatsappConsent !== true || prefs.consentRevokedAt || !(prefs.whatsappVerified === true && prefs.verificationProvider === 'trusted') && !testVerified || !prefs.whatsappAlertTypes?.includes(eventType)) return false;
    const cfg = await providerConfig();
    if (!cfg?.accessToken || !/^\d+$/.test(cfg.phoneNumberId || '') || !cfg.templates?.[eventType]) return false;
    const job = { tenantId, userId, eventType, idempotencyKey, parameters, title, queuedAt: now().toISOString() };
    await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(job), MessageAttributes: { eventType: { DataType: 'String', StringValue: eventType } } }));
    await db.send(new PutCommand({ TableName: table, Item: { ...deliveryKey(tenantId, userId, idempotencyKey), id: idempotencyKey, eventId: idempotencyKey, tenantId, userId, eventType, deliveryStatus: 'REQUESTED', provider: 'meta-cloud-api', title: title.slice(0, 180), createdAt: now().toISOString() }, ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)' })).catch(error => { if (error.name !== 'ConditionalCheckFailedException') throw error; });
    return true;
  }
  async function webhook(event, method) {
    if (method === 'GET') {
      const cfg = await providerConfig(); const verifyToken = cfg?.webhookVerifyToken || webhookVerifyToken;
      const params = event.queryStringParameters || {}; const token = params['hub.verify_token']; const challenge = params['hub.challenge'];
      if (!verifyToken || params['hub.mode'] !== 'subscribe' || !token || token !== verifyToken || typeof challenge !== 'string' || challenge.length > 200) return { statusCode: 403, headers: { 'content-type': 'text/plain' }, body: 'Forbidden' };
      return { statusCode: 200, headers: { 'content-type': 'text/plain' }, body: challenge };
    }
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : Buffer.from(event.body || '', 'utf8');
    const headers = event.headers || {}; const signature = headers['x-hub-signature-256'] || headers['X-Hub-Signature-256'];
    const cfg = await providerConfig(); const signingSecret = cfg?.appSecret || appSecret;
    if (!verifyMetaSignature(raw, signature, signingSecret)) return readableError(401, 'Invalid webhook signature');
    let payload; try { payload = JSON.parse(raw.toString('utf8')); } catch { return readableError(400, 'Invalid webhook payload'); }
    const updates = [];
    for (const entry of payload.entry || []) for (const change of entry.changes || []) {
      const value = change.value || {};
      for (const status of value.statuses || []) {
        if (!status.id || !['sent','delivered','read','failed'].includes(status.status)) continue;
        const mappingKey = { pk: `WHATSAPP#MESSAGE#${status.id}`, sk: 'META' };
        const mapping = (await db.send(new GetCommand({ TableName: table, Key: mappingKey }))).Item;
        if (!mapping) {
          const pendingKey = { pk: `WHATSAPP#PENDING#MESSAGE#${status.id}`, sk: `EVENT#${sha(`${status.id}:${status.status}:${status.timestamp || ''}`)}` };
          try { await db.send(new PutCommand({ TableName: table, Item: { ...pendingKey, messageId: status.id, status: status.status, timestamp: status.timestamp || null, errors: status.errors?.map(e => ({ code: e.code, title: e.title })).slice(0, 3) || [], expiresAt: Math.floor(now().getTime() / 1000) + 14 * 86400 }, ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)' })); } catch (error) { if (error.name !== 'ConditionalCheckFailedException') throw error; }
          continue;
        }
        const seenKey = { pk: `TENANT#${mapping.tenantId}`, sk: `NOTIFY#WEBHOOK#${sha(`${status.id}:${status.status}:${status.timestamp || ''}`)}` };
        try { await db.send(new PutCommand({ TableName: table, Item: { ...seenKey, receivedAt: now().toISOString() }, ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)' })); } catch (error) { if (error.name === 'ConditionalCheckFailedException') continue; throw error; }
        const key = deliveryKey(mapping.tenantId, mapping.userId, mapping.idempotencyKey);
        const current = (await db.send(new GetCommand({ TableName: table, Key: key }))).Item; if (!current) continue;
        const deliveryStatus = status.status.toUpperCase(); await db.send(new PutCommand({ TableName: table, Item: { ...current, deliveryStatus, providerStatusAt: status.timestamp ? new Date(Number(status.timestamp) * 1000).toISOString() : now().toISOString(), providerErrors: status.errors?.map(e => ({ code: e.code, title: e.title })).slice(0, 3) || [] } })); updates.push(deliveryStatus);
      }
      for (const incoming of value.messages || []) {
        const text = String(incoming.text?.body || '').trim().toLowerCase();
        if (!['stop','unsubscribe','cancel','parar','baja'].includes(text)) continue;
        // Number lookup is tenant-safe; a matching sender revokes only their registered preferences.
        const lookupSecret = cfg?.appSecret || appSecret; if (!lookupSecret) continue;
        const hash = createHmac('sha256', lookupSecret).update(String(incoming.from || '').replace(/^\+/, '')).digest('hex');
        const candidates = await db.send(new QueryCommand({ TableName: table, IndexName: 'WhatsAppNumberIndex', KeyConditionExpression: 'gsi3pk = :pk', ExpressionAttributeValues: { ':pk': `PHONE#${hash}` }, Limit: 100 }));
        for (const candidate of candidates.Items || []) {
          const prefs = (await db.send(new GetCommand({ TableName: table, Key: { pk: candidate.pk, sk: candidate.sk } }))).Item;
          if (!prefs || prefs.whatsappNumber?.replace(/^\+/, '') !== String(incoming.from) || !prefs.whatsappConsent) continue;
          await db.send(new PutCommand({ TableName: table, Item: { ...prefs, whatsappConsent: false, whatsappVerified: false, whatsappVerificationStatus: 'revoked', whatsappAlertTypes: [], consentRevokedAt: now().toISOString(), updatedAt: now().toISOString() } }));
        }
      }
    }
    return ok(200, { received: true, updated: updates.length });
  }
  return { handle, enqueue, webhook, getPreference, providerConfig };
}

export async function processWhatsAppJob({ job, db, table, runtime, adapter, now = new Date() }) {
  if (!job?.tenantId || !job?.userId || !job?.idempotencyKey) throw Object.assign(new Error('Invalid queued notification'), { code: 'INVALID_JOB' });
  const key = deliveryKey(job.tenantId, job.userId, job.idempotencyKey);
  const prefs = await runtime.getPreference(job.tenantId, job.userId);
  const testVerified = process.env.NODE_ENV !== 'production' && !process.env.AWS_LAMBDA_FUNCTION_NAME && process.env.WHATSAPP_ALLOW_TEST_DELIVERY === 'true' && prefs.whatsappVerificationStatus === 'verified-test' && prefs.verificationProvider === 'local-test';
  if (prefs.whatsappConsent !== true || prefs.consentRevokedAt || !(prefs.whatsappVerified === true && prefs.verificationProvider === 'trusted') && !testVerified || !prefs.whatsappAlertTypes?.includes(job.eventType)) {
    await db.send(new PutCommand({ TableName: table, Item: { ...key, id: job.idempotencyKey, tenantId: job.tenantId, userId: job.userId, eventType: job.eventType, deliveryStatus: 'BLOCKED', provider: 'meta-cloud-api', title: job.title || job.eventType, updatedAt: now.toISOString() } }));
    return { status: 'BLOCKED' };
  }
  const cfg = await runtime.providerConfig();
  if (!cfg) { await db.send(new PutCommand({ TableName: table, Item: { ...key, id: job.idempotencyKey, tenantId: job.tenantId, userId: job.userId, eventType: job.eventType, deliveryStatus: 'UNAVAILABLE', provider: 'meta-cloud-api', title: job.title || job.eventType, updatedAt: now.toISOString() } })); return { status: 'UNAVAILABLE' }; }
  const testOrigin = process.env.NOTIFICATION_MODE === 'integration-test' && process.env.WHATSAPP_PROVIDER_MODE === 'meta-mock' && process.env.NODE_ENV !== 'production' && !process.env.AWS_LAMBDA_FUNCTION_NAME ? process.env.WHATSAPP_META_API_ORIGIN || cfg.apiOrigin : undefined;
  const adapterWithConfig = createMetaAdapter({ ...cfg, apiOrigin: testOrigin, allowTestVerification: testVerified, fetchImpl: cfg.fetchImpl || fetch, store: {
    claim: async ({ tenantId, userId, idempotencyKey }) => { const claimKey = { pk: `TENANT#${tenantId}`, sk: `NOTIFY#WHATSAPP#CLAIM#${idempotencyKey}` }; try { await db.send(new PutCommand({ TableName: table, Item: { ...claimKey, userId, idempotencyKey, status: 'SENDING', createdAt: now.toISOString() }, ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)' })); return true; } catch (e) { if (e.name !== 'ConditionalCheckFailedException') throw e; } const prior = (await db.send(new GetCommand({ TableName: table, Key: claimKey }))).Item; if (prior?.status !== 'RETRYABLE') return false; try { await db.send(new UpdateCommand({ TableName: table, Key: claimKey, UpdateExpression: 'SET #status = :sending, updatedAt = :now', ConditionExpression: '#status = :retryable', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':sending': 'SENDING', ':retryable': 'RETRYABLE', ':now': now.toISOString() } })); return true; } catch (error) { if (error.name === 'ConditionalCheckFailedException') return false; throw error; } },
    complete: async ({ tenantId, userId, idempotencyKey, status, messageId }) => { const claimKey = { pk: `TENANT#${tenantId}`, sk: `NOTIFY#WHATSAPP#CLAIM#${idempotencyKey}` }; const current = (await db.send(new GetCommand({ TableName: table, Key: claimKey }))).Item; await db.send(new PutCommand({ TableName: table, Item: { ...claimKey, ...current, userId, idempotencyKey, status, messageId: messageId || current?.messageId, updatedAt: now.toISOString() } })); if (messageId) { await db.send(new PutCommand({ TableName: table, Item: { pk: `WHATSAPP#MESSAGE#${messageId}`, sk: 'META', tenantId, userId, idempotencyKey, createdAt: now.toISOString() } })); const pending = await db.send(new QueryCommand({ TableName: table, KeyConditionExpression: 'pk = :pk AND begins_with(sk,:prefix)', ExpressionAttributeValues: { ':pk': `WHATSAPP#PENDING#MESSAGE#${messageId}`, ':prefix': 'EVENT#' }, Limit: 20 })); const currentDelivery = (await db.send(new GetCommand({ TableName: table, Key: key }))).Item || { ...key, tenantId, userId, idempotencyKey, eventType: job.eventType, provider: 'meta-cloud-api', title: job.title || job.eventType }; for (const item of pending.Items || []) { await db.send(new PutCommand({ TableName: table, Item: { ...currentDelivery, deliveryStatus: String(item.status).toUpperCase(), providerMessageId: messageId, providerStatusAt: item.timestamp ? new Date(Number(item.timestamp)*1000).toISOString() : now.toISOString(), providerErrors: item.errors || [], updatedAt: now.toISOString() } })); await db.send(new DeleteCommand({ TableName: table, Key: { pk: item.pk, sk: item.sk } })); } } const currentDelivery = (await db.send(new GetCommand({ TableName: table, Key: key }))).Item || { ...key, tenantId, userId, idempotencyKey, eventType: job.eventType, provider: 'meta-cloud-api', title: job.title || job.eventType }; if (['REQUESTED','RETRYABLE'].includes(currentDelivery.deliveryStatus)) await db.send(new PutCommand({ TableName: table, Item: { ...currentDelivery, deliveryStatus: status === 'ACCEPTED' ? 'ACCEPTED_BY_META' : status, providerMessageId: messageId || null, updatedAt: now.toISOString() } })); }
  } });
  try { return await adapterWithConfig.deliver({ tenantId: job.tenantId, userId: job.userId, eventType: job.eventType, idempotencyKey: job.idempotencyKey, preferences: { ...prefs, ...(testVerified ? { whatsappVerified: true } : {}) }, parameters: job.parameters || [], now }); }
  catch (error) { if (error.code === 'RETRYABLE') throw error; if (error.code === 'UNKNOWN') { await db.send(new PutCommand({ TableName: table, Item: { ...key, id: job.idempotencyKey, tenantId: job.tenantId, userId: job.userId, eventType: job.eventType, deliveryStatus: 'UNKNOWN', updatedAt: now.toISOString() } })); } else if (error.code === 'NOT_ALLOWED' || error.code === 'PROVIDER_DISABLED') return { status: error.code }; else throw error; }
}
