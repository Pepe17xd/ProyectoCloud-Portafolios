import { createHash } from 'node:crypto';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { PublishCommand, SubscribeCommand, UnsubscribeCommand, GetSubscriptionAttributesCommand } from '@aws-sdk/client-sns';

/**
 * E-mail notification channel (Amazon SNS e-mail subscriptions).
 *
 * Flow: producer -> SNS Domain Topic -> SQS Notifications (+DLQ) -> Notification Consumer
 *       -> SNS Email Topic -> one filtered e-mail subscription per user (tenantId + userId).
 *
 * Amazon SES is not available in AWS Academy, so delivery uses SNS e-mail subscriptions.
 * "Accepted by SNS" is not proof of delivery: SNS drops messages for unconfirmed subscriptions.
 */
export const CONSENT_VERSION = 'profiles-email-2026-01';
export const EMAIL_EVENT_TYPES = ['ReminderDue', 'AutomationReport', 'RiskAlert', 'WeeklySummary'];
// Flow engine event names -> domain event names published to the SNS Domain Topic.
export const FLOW_EVENT_MAP = { reminder: 'ReminderDue', automation: 'AutomationReport', 'risk-alert': 'RiskAlert', 'weekly-summary': 'WeeklySummary' };
const eventTypes = new Set(EMAIL_EVENT_TYPES);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TERMINAL_CODES = ['INVALID_JOB', 'NOT_ALLOWED', 'PROVIDER_DISABLED', 'PROVIDER_REJECTED'];
const SNS_REJECTIONS = ['InvalidParameterException', 'InvalidParameterValueException', 'AuthorizationErrorException', 'NotFoundException', 'EndpointDisabledException'];

const ok = (statusCode, data) => ({ statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
const fail = (statusCode, message) => ok(statusCode, { error: message });
const sha = (value) => createHash('sha256').update(value).digest('hex');
const prefKey = (tenantId, userId) => ({ pk: `TENANT#${tenantId}`, sk: `NOTIFY#PREFERENCES#${userId}` });
const deliveryKey = (tenantId, userId, id) => ({ pk: `TENANT#${tenantId}`, sk: `NOTIFY#EMAIL#${userId}#${id}` });
const claimKey = (tenantId, id) => ({ pk: `TENANT#${tenantId}`, sk: `NOTIFY#EMAILCLAIM#${sha(id)}` });
export const maskEmail = (email = '') => { const [name = '', domain = ''] = String(email).split('@'); return name && domain ? `${name.slice(0, 1)}***@${domain}` : null; };

// Transient provider/infrastructure errors are retried by SQS (and end in the DLQ after
// maxReceiveCount). Policy denials and provider rejections are terminal and acknowledged.
export function shouldRetryEmailRecord(error) {
  return !TERMINAL_CODES.includes(error?.code);
}

export function parseQueueBody(body) {
  const parsed = JSON.parse(body || '{}');
  // SNS -> SQS wraps the payload in a notification envelope unless raw delivery is enabled.
  if (parsed?.Type === 'Notification' && typeof parsed.Message === 'string') return JSON.parse(parsed.Message);
  return parsed;
}

export function renderEmail(job) {
  const title = String(job.title || job.eventType).replace(/[\r\n]+/g, ' ').slice(0, 150);
  const first = String(job.parameters?.[0] ?? '').slice(0, 150);
  const detail = {
    ReminderDue: `Recordatorio: ${first || title}`,
    RiskAlert: `Se detectaron ${first || 'nuevas'} alerta(s) en tus proyectos.`,
    WeeklySummary: `Resumen semanal: ${first || '0'} elemento(s) para revisar.`,
    AutomationReport: title,
  }[job.eventType] || title;
  return {
    subject: `[ProFiles] ${title}`.slice(0, 99),
    message: `Hola,\n\n${detail}\n\nIngresa a ProFiles para ver el detalle. Puedes cambiar o cancelar estos avisos en Notificaciones > Correo.\n\n— ProFiles`,
  };
}

export function createEmailRuntime({ db, table, sns, domainTopicArn = '', emailTopicArn = '', mode = 'disabled', now = () => new Date() }) {
  const getPreference = async (tenantId, userId) => (await db.send(new GetCommand({ TableName: table, Key: prefKey(tenantId, userId) }))).Item || {};
  const available = () => mode === 'local' || (mode === 'sns-email' && Boolean(emailTopicArn));
  const allowed = (prefs, eventType) => prefs.emailConsent === true && !prefs.consentRevokedAt && (prefs.emailAlertTypes || []).includes(eventType);

  async function refreshStatus(tenantId, userId, prefs) {
    if (mode !== 'sns-email' || prefs.emailStatus !== 'pending-confirmation' || !prefs.emailSubscriptionArn) return prefs;
    try {
      const attrs = (await sns.send(new GetSubscriptionAttributesCommand({ SubscriptionArn: prefs.emailSubscriptionArn }))).Attributes || {};
      if (attrs.PendingConfirmation === 'false') {
        const updated = { ...prefs, emailStatus: 'active', emailConfirmedAt: now().toISOString(), updatedAt: now().toISOString() };
        await db.send(new PutCommand({ TableName: table, Item: updated }));
        return updated;
      }
    } catch { /* keep the stored status; the user can retry */ }
    return prefs;
  }

  async function handle(event, actor, method, path) {
    const { tenantId, userId } = actor;
    const key = prefKey(tenantId, userId);
    if (path === '/notifications/email' && method === 'GET') {
      const loaded = await getPreference(tenantId, userId);
      const prefs = await refreshStatus(tenantId, userId, loaded);
      const history = await db.send(new QueryCommand({ TableName: table, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)', ExpressionAttributeValues: { ':pk': key.pk, ':prefix': `NOTIFY#EMAIL#${userId}#` }, Limit: 25 }));
      const status = prefs.consentRevokedAt ? 'revoked' : prefs.emailConsent !== true ? 'not-configured' : prefs.emailStatus || 'inactive';
      return ok(200, {
        status, providerAvailable: available(), channel: mode === 'sns-email' ? 'sns-email' : mode === 'local' ? 'local' : 'disabled',
        email: maskEmail(prefs.emailAddress), consent: prefs.emailConsent === true, consentAt: prefs.emailConsentAt || null, consentVersion: prefs.emailConsentVersion || null,
        alertTypes: prefs.emailAlertTypes || [],
        items: (history.Items || []).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))),
      });
    }
    if (path === '/notifications/email/subscribe' && method === 'POST') {
      let body; try { body = JSON.parse(event.body || '{}'); } catch { return fail(400, 'Revisa los datos enviados.'); }
      if (body.consent !== true || body.consentVersion !== CONSENT_VERSION) return fail(400, 'Debes aceptar el consentimiento vigente para recibir correos.');
      if (!available()) return fail(503, 'El canal de correo todavía no está disponible.');
      const profile = (await db.send(new GetCommand({ TableName: table, Key: { pk: key.pk, sk: `ITEM#${userId}` } }))).Item;
      if (!profile?.email || !EMAIL_RE.test(profile.email)) return fail(422, 'Tu perfil no tiene un correo válido.');
      const previous = await getPreference(tenantId, userId); const current = now();
      if (previous.emailConsent === true && !previous.consentRevokedAt && ['active', 'pending-confirmation'].includes(previous.emailStatus) && previous.emailAddress === profile.email) {
        return ok(200, { status: previous.emailStatus, message: 'Ya tienes este canal activado.' });
      }
      try {
        await db.send(new UpdateCommand({ TableName: table, Key: key, UpdateExpression: 'SET lastSubscribeRequestedAt = :requested', ConditionExpression: 'attribute_not_exists(lastSubscribeRequestedAt) OR lastSubscribeRequestedAt <= :allowedBefore', ExpressionAttributeValues: { ':requested': current.toISOString(), ':allowedBefore': new Date(current.getTime() - 30_000).toISOString() } }));
      } catch (error) {
        if (error.name === 'ConditionalCheckFailedException') return fail(429, 'Espera unos segundos antes de intentarlo otra vez.');
        throw error;
      }
      let status = 'active'; let subscriptionArn = null;
      if (mode === 'sns-email') {
        try {
          // The filter policy confines this subscription to the user's own messages (tenant + user).
          const result = await sns.send(new SubscribeCommand({ TopicArn: emailTopicArn, Protocol: 'email', Endpoint: profile.email, ReturnSubscriptionArn: true, Attributes: { FilterPolicy: JSON.stringify({ tenantId: [tenantId], userId: [userId] }) } }));
          subscriptionArn = result.SubscriptionArn || null; status = 'pending-confirmation';
        } catch { return fail(502, 'No se pudo crear la suscripción de correo. Inténtalo más tarde.'); }
      }
      const item = { ...key, ...previous, emailAddress: profile.email, emailConsent: true, emailConsentVersion: CONSENT_VERSION, emailConsentAt: current.toISOString(), consentRevokedAt: null, emailStatus: status, emailSubscriptionArn: subscriptionArn, emailAlertTypes: previous.emailAlertTypes || [], lastSubscribeRequestedAt: current.toISOString(), updatedAt: current.toISOString() };
      await db.send(new PutCommand({ TableName: table, Item: item }));
      return ok(202, { status, message: status === 'pending-confirmation' ? 'Te enviamos un correo de Amazon SNS: abre el mensaje y confirma la suscripción.' : 'Canal local activado; los correos se simulan y no salen de tu equipo.' });
    }
    if (path === '/notifications/email/preferences' && method === 'PUT') {
      let body; try { body = JSON.parse(event.body || '{}'); } catch { return fail(400, 'Preferencias inválidas.'); }
      if (!Array.isArray(body.alertTypes) || body.alertTypes.length > 12 || body.alertTypes.some((type) => !eventTypes.has(type))) return fail(400, 'Selecciona eventos de notificación válidos.');
      const current = await getPreference(tenantId, userId);
      const updated = { ...key, ...current, emailAlertTypes: [...new Set(body.alertTypes)], updatedAt: now().toISOString() };
      await db.send(new PutCommand({ TableName: table, Item: updated }));
      return ok(200, { alertTypes: updated.emailAlertTypes });
    }
    if (path === '/notifications/email' && method === 'DELETE') {
      const current = await getPreference(tenantId, userId);
      if (!current.pk) return ok(200, { revoked: true, status: 'revoked' });
      // Best effort: pending subscriptions cannot always be removed; consent revocation blocks every send anyway.
      if (mode === 'sns-email' && current.emailSubscriptionArn && current.emailSubscriptionArn !== 'pending confirmation') {
        try { await sns.send(new UnsubscribeCommand({ SubscriptionArn: current.emailSubscriptionArn })); } catch { /* ignored */ }
      }
      const updated = { ...current, emailConsent: false, emailStatus: 'revoked', emailAlertTypes: [], emailSubscriptionArn: null, consentRevokedAt: now().toISOString(), updatedAt: now().toISOString() };
      await db.send(new PutCommand({ TableName: table, Item: updated }));
      return ok(200, { revoked: true, status: 'revoked' });
    }
    return fail(404, 'Not found');
  }

  // Producer side: publish a notification request to the SNS Domain Topic.
  async function enqueue({ tenantId, userId, eventType, idempotencyKey, parameters = [], title = '' }) {
    if (mode === 'disabled' || !domainTopicArn || !eventTypes.has(eventType) || !tenantId || !userId || !idempotencyKey) return false;
    const prefs = await getPreference(tenantId, userId);
    if (!allowed(prefs, eventType)) return false;
    const job = { tenantId, userId, eventType, idempotencyKey, parameters, title: String(title).slice(0, 180), queuedAt: now().toISOString() };
    await sns.send(new PublishCommand({
      TopicArn: domainTopicArn, Message: JSON.stringify(job),
      MessageAttributes: { eventType: { DataType: 'String', StringValue: eventType }, tenantId: { DataType: 'String', StringValue: tenantId }, userId: { DataType: 'String', StringValue: userId } },
    }));
    await db.send(new PutCommand({ TableName: table, Item: { ...deliveryKey(tenantId, userId, idempotencyKey), id: idempotencyKey, eventId: idempotencyKey, tenantId, userId, eventType, deliveryStatus: 'REQUESTED', provider: 'email-sns', title: job.title, createdAt: now().toISOString() }, ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)' })).catch((error) => { if (error.name !== 'ConditionalCheckFailedException') throw error; });
    return true;
  }

  async function record(job, fields) {
    const key = deliveryKey(job.tenantId, job.userId, job.idempotencyKey);
    const current = (await db.send(new GetCommand({ TableName: table, Key: key }))).Item || { ...key, id: job.idempotencyKey, eventId: job.idempotencyKey, tenantId: job.tenantId, userId: job.userId, eventType: job.eventType, provider: 'email-sns', title: job.title || job.eventType, createdAt: now().toISOString() };
    await db.send(new PutCommand({ TableName: table, Item: { ...current, ...fields, updatedAt: now().toISOString() } }));
  }

  // Consumer side: SQS record -> SNS Email Topic. Idempotent per (tenant, idempotencyKey).
  async function processJob(job) {
    if (!job?.tenantId || !job?.userId || !job?.idempotencyKey || !eventTypes.has(job.eventType)) throw Object.assign(new Error('Invalid queued notification'), { code: 'INVALID_JOB' });
    const prefs = await getPreference(job.tenantId, job.userId);
    if (!allowed(prefs, job.eventType)) { await record(job, { deliveryStatus: 'BLOCKED' }); return { status: 'BLOCKED' }; }
    if (!available()) { await record(job, { deliveryStatus: 'UNAVAILABLE' }); return { status: 'UNAVAILABLE' }; }
    const claim = claimKey(job.tenantId, job.idempotencyKey);
    try {
      await db.send(new PutCommand({ TableName: table, Item: { ...claim, status: 'SENDING', createdAt: now().toISOString() }, ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)' }));
    } catch (error) {
      if (error.name !== 'ConditionalCheckFailedException') throw error;
      const prior = (await db.send(new GetCommand({ TableName: table, Key: claim }))).Item;
      if (prior?.status !== 'RETRYABLE') return { status: 'DUPLICATE' };
      try {
        await db.send(new UpdateCommand({ TableName: table, Key: claim, UpdateExpression: 'SET #s = :sending, updatedAt = :now', ConditionExpression: '#s = :retryable', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':sending': 'SENDING', ':retryable': 'RETRYABLE', ':now': now().toISOString() } }));
      } catch (conflict) { if (conflict.name === 'ConditionalCheckFailedException') return { status: 'DUPLICATE' }; throw conflict; }
    }
    if (mode === 'local') {
      await db.send(new PutCommand({ TableName: table, Item: { ...claim, status: 'SENT', updatedAt: now().toISOString() } }));
      await record(job, { deliveryStatus: 'SIMULATED_LOCAL', notice: 'Simulado localmente: no se envió ningún correo.' });
      return { status: 'SIMULATED_LOCAL' };
    }
    const mail = renderEmail(job);
    try {
      const result = await sns.send(new PublishCommand({
        TopicArn: emailTopicArn, Subject: mail.subject, Message: mail.message,
        MessageAttributes: { tenantId: { DataType: 'String', StringValue: job.tenantId }, userId: { DataType: 'String', StringValue: job.userId }, eventType: { DataType: 'String', StringValue: job.eventType } },
      }));
      await db.send(new PutCommand({ TableName: table, Item: { ...claim, status: 'SENT', messageId: result.MessageId, updatedAt: now().toISOString() } }));
      await record(job, { deliveryStatus: 'SENT_TO_SNS', providerMessageId: result.MessageId || null });
      return { status: 'SENT_TO_SNS', messageId: result.MessageId };
    } catch (error) {
      const rejected = SNS_REJECTIONS.includes(error?.name);
      await db.send(new PutCommand({ TableName: table, Item: { ...claim, status: rejected ? 'FAILED' : 'RETRYABLE', updatedAt: now().toISOString() } }));
      if (rejected) { await record(job, { deliveryStatus: 'FAILED' }); throw Object.assign(new Error('Notification rejected by the provider'), { code: 'PROVIDER_REJECTED' }); }
      throw Object.assign(new Error('Notification delivery failed; it will be retried'), { code: 'RETRYABLE' });
    }
  }

  return { handle, enqueue, processJob, getPreference };
}
