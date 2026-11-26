import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmailRuntime, shouldRetryEmailRecord, parseQueueBody, renderEmail, maskEmail, isWithinAllowedHours, CONSENT_VERSION, FLOW_EVENT_MAP, EMAIL_EVENT_TYPES } from '../services/identity-service/email-notifications.mjs';
import { notificationsApi, deliverDomainEventToInbox } from '../services/identity-service/handler.mjs';

// Minimal in-memory DynamoDB document client double (Get/Put/Query/Update by pk+sk).
function fakeDb(seed = []) {
  const items = new Map(seed.map((i) => [`${i.pk}|${i.sk}`, i]));
  const conditional = (error) => Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException', ...error });
  return {
    items,
    async send(command) {
      const name = command.constructor.name; const input = command.input;
      if (name === 'GetCommand') return { Item: items.get(`${input.Key.pk}|${input.Key.sk}`) };
      if (name === 'PutCommand') {
        const k = `${input.Item.pk}|${input.Item.sk}`;
        if (input.ConditionExpression?.includes('attribute_not_exists') && items.has(k)) throw conditional();
        items.set(k, input.Item); return {};
      }
      if (name === 'QueryCommand') {
        const pk = input.ExpressionAttributeValues[':pk']; const prefix = input.ExpressionAttributeValues[':prefix'];
        return { Items: [...items.values()].filter((i) => i.pk === pk && i.sk.startsWith(prefix)) };
      }
      if (name === 'UpdateCommand') {
        const k = `${input.Key.pk}|${input.Key.sk}`; const current = items.get(k) || { ...input.Key };
        const values = input.ExpressionAttributeValues || {};
        if (input.ConditionExpression?.includes('lastSubscribeRequestedAt <=') && current.lastSubscribeRequestedAt && current.lastSubscribeRequestedAt > values[':allowedBefore']) throw conditional();
        if (input.ConditionExpression === '#s = :retryable' && current.status !== 'RETRYABLE') throw conditional();
        if (values[':requested']) current.lastSubscribeRequestedAt = values[':requested'];
        if (values[':sending']) current.status = values[':sending'];
        items.set(k, current); return {};
      }
      throw new Error(`Unexpected command ${name}`);
    },
  };
}
function fakeSns({ failPublish } = {}) {
  const sent = [];
  return { sent, async send(command) { const name = command.constructor.name; sent.push({ name, input: command.input }); if (name === 'PublishCommand' && failPublish) throw Object.assign(new Error('boom'), { name: failPublish }); if (name === 'SubscribeCommand') return { SubscriptionArn: 'arn:aws:sns:us-east-1:1:email:sub-1' }; if (name === 'PublishCommand') return { MessageId: `m-${sent.length}` }; if (name === 'GetSubscriptionAttributesCommand') return { Attributes: { PendingConfirmation: 'false' } }; return {}; } };
}
const tenantId = 'tenant-a'; const userId = 'user-1';
const profile = { pk: `TENANT#${tenantId}`, sk: `ITEM#${userId}`, email: 'ana@example.com', status: 'ACTIVE' };
const actor = { tenantId, userId };
const event = (body) => ({ body: JSON.stringify(body) });
const runtime = (over = {}) => { const db = over.db || fakeDb([profile]); const sns = over.sns || fakeSns(); return { db, sns, rt: createEmailRuntime({ db, table: 't', sns, domainTopicArn: 'arn:domain', emailTopicArn: 'arn:email', mode: 'sns-email', ...over.opts }) }; };

test('subscription requires consent, uses only the authenticated user profile e-mail and scopes the filter policy to tenant and user', async () => {
  const { rt, sns, db } = runtime();
  assert.equal((await rt.handle(event({ consent: false, consentVersion: CONSENT_VERSION }), actor, 'POST', '/notifications/email/subscribe')).statusCode, 400);
  assert.equal(sns.sent.length, 0);
  // A caller-supplied address is ignored: only the stored profile e-mail can be subscribed.
  const response = await rt.handle(event({ consent: true, consentVersion: CONSENT_VERSION, email: 'attacker@example.com' }), actor, 'POST', '/notifications/email/subscribe');
  assert.equal(response.statusCode, 202);
  const subscribe = sns.sent.find((c) => c.name === 'SubscribeCommand').input;
  assert.equal(subscribe.Protocol, 'email'); assert.equal(subscribe.Endpoint, 'ana@example.com'); assert.equal(subscribe.TopicArn, 'arn:email');
  assert.deepEqual(JSON.parse(subscribe.Attributes.FilterPolicy), { tenantId: [tenantId], userId: [userId] });
  assert.equal(db.items.get(`TENANT#${tenantId}|NOTIFY#PREFERENCES#${userId}`).emailStatus, 'pending-confirmation');
});

test('status refresh promotes a confirmed subscription and never exposes the full address', async () => {
  const { rt, sns } = runtime();
  await rt.handle(event({ consent: true, consentVersion: CONSENT_VERSION }), actor, 'POST', '/notifications/email/subscribe');
  const status = JSON.parse((await rt.handle({}, actor, 'GET', '/notifications/email')).body);
  assert.equal(status.status, 'active'); assert.equal(status.email, 'a***@example.com'); assert.ok(sns.sent.some((c) => c.name === 'GetSubscriptionAttributesCommand'));
  assert.doesNotMatch(JSON.stringify(status), /ana@example\.com/);
});

test('events are only published for consenting users that selected that event, always via the SNS Domain Topic', async () => {
  const { rt, sns } = runtime();
  const job = { tenantId, userId, eventType: 'ReminderDue', idempotencyKey: 'r-1', title: 'Revisar presupuesto', parameters: ['Revisar presupuesto'] };
  assert.equal(await rt.enqueue(job), false);
  await rt.handle(event({ consent: true, consentVersion: CONSENT_VERSION }), actor, 'POST', '/notifications/email/subscribe');
  assert.equal(await rt.enqueue(job), false, 'no event selected yet');
  assert.equal((await rt.handle(event({ alertTypes: ['ReminderDue'] }), actor, 'PUT', '/notifications/email/preferences')).statusCode, 200);
  assert.equal((await rt.handle(event({ alertTypes: ['nope'] }), actor, 'PUT', '/notifications/email/preferences')).statusCode, 400);
  assert.equal(await rt.enqueue(job), true);
  const publish = sns.sent.filter((c) => c.name === 'PublishCommand').at(-1).input;
  assert.equal(publish.TopicArn, 'arn:domain');
  assert.equal(publish.MessageAttributes.eventType.StringValue, 'ReminderDue');
  assert.equal(publish.MessageAttributes.tenantId.StringValue, tenantId);
  assert.equal(await rt.enqueue({ ...job, eventType: 'RiskAlert', idempotencyKey: 'x' }), false);
});

test('consumer publishes to the e-mail topic with tenant/user attributes and is idempotent', async () => {
  const { rt, sns, db } = runtime();
  await rt.handle(event({ consent: true, consentVersion: CONSENT_VERSION }), actor, 'POST', '/notifications/email/subscribe');
  await rt.handle(event({ alertTypes: ['RiskAlert'] }), actor, 'PUT', '/notifications/email/preferences');
  const job = { tenantId, userId, eventType: 'RiskAlert', idempotencyKey: 'flow-1', title: 'Alertas', parameters: ['3'] };
  const first = await rt.processJob(job);
  assert.equal(first.status, 'SENT_TO_SNS');
  const publish = sns.sent.filter((c) => c.name === 'PublishCommand').at(-1).input;
  assert.equal(publish.TopicArn, 'arn:email'); assert.match(publish.Subject, /^\[ProFiles\]/); assert.match(publish.Message, /3 alerta/);
  assert.equal(publish.MessageAttributes.userId.StringValue, userId);
  const before = sns.sent.length;
  assert.equal((await rt.processJob(job)).status, 'DUPLICATE');
  assert.equal(sns.sent.length, before, 'a redelivered SQS message must not send again');
  assert.equal(db.items.get(`TENANT#${tenantId}|NOTIFY#EMAIL#${userId}#flow-1`).deliveryStatus, 'SENT_TO_SNS');
});

test('revoked consent blocks a queued job and removes the subscription', async () => {
  const { rt, sns, db } = runtime();
  await rt.handle(event({ consent: true, consentVersion: CONSENT_VERSION }), actor, 'POST', '/notifications/email/subscribe');
  await rt.handle(event({ alertTypes: ['WeeklySummary'] }), actor, 'PUT', '/notifications/email/preferences');
  assert.equal((await rt.handle({}, actor, 'DELETE', '/notifications/email')).statusCode, 200);
  assert.ok(sns.sent.some((c) => c.name === 'UnsubscribeCommand'));
  const before = sns.sent.length;
  const result = await rt.processJob({ tenantId, userId, eventType: 'WeeklySummary', idempotencyKey: 'w-1', title: 'Semana' });
  assert.equal(result.status, 'BLOCKED'); assert.equal(sns.sent.length, before);
  assert.equal(db.items.get(`TENANT#${tenantId}|NOTIFY#PREFERENCES#${userId}`).emailStatus, 'revoked');
});

test('transient SNS failures are retried (and end in the DLQ); provider rejections are terminal', async () => {
  for (const [failPublish, code, retry] of [['ThrottlingException', 'RETRYABLE', true], ['AuthorizationErrorException', 'PROVIDER_REJECTED', false]]) {
    const { rt, db } = runtime({ sns: fakeSns() });
    await rt.handle(event({ consent: true, consentVersion: CONSENT_VERSION }), actor, 'POST', '/notifications/email/subscribe');
    await rt.handle(event({ alertTypes: ['ReminderDue'] }), actor, 'PUT', '/notifications/email/preferences');
    const failing = createEmailRuntime({ db, table: 't', sns: fakeSns({ failPublish }), domainTopicArn: 'arn:domain', emailTopicArn: 'arn:email', mode: 'sns-email' });
    await assert.rejects(failing.processJob({ tenantId, userId, eventType: 'ReminderDue', idempotencyKey: `k-${code}`, title: 'x' }), (error) => { assert.equal(error.code, code); assert.equal(shouldRetryEmailRecord(error), retry); return true; });
  }
  // After a retryable failure the claim is released so the redelivery can succeed exactly once.
  const { rt, db } = runtime();
  await rt.handle(event({ consent: true, consentVersion: CONSENT_VERSION }), actor, 'POST', '/notifications/email/subscribe');
  await rt.handle(event({ alertTypes: ['ReminderDue'] }), actor, 'PUT', '/notifications/email/preferences');
  const job = { tenantId, userId, eventType: 'ReminderDue', idempotencyKey: 'retry-me', title: 'x' };
  await assert.rejects(createEmailRuntime({ db, table: 't', sns: fakeSns({ failPublish: 'ThrottlingException' }), emailTopicArn: 'arn:email', mode: 'sns-email' }).processJob(job));
  assert.equal((await rt.processJob(job)).status, 'SENT_TO_SNS');
});

test('invalid jobs are terminal and the queue envelope from SNS is unwrapped', async () => {
  const { rt } = runtime();
  await assert.rejects(rt.processJob({ tenantId }), (error) => error.code === 'INVALID_JOB' && !shouldRetryEmailRecord(error));
  const job = { tenantId, userId, eventType: 'ReminderDue', idempotencyKey: 'a' };
  assert.deepEqual(parseQueueBody(JSON.stringify({ Type: 'Notification', Message: JSON.stringify(job) })), job);
  assert.deepEqual(parseQueueBody(JSON.stringify(job)), job);
});

test('local mode simulates delivery and the disabled mode never sends', async () => {
  const db = fakeDb([profile]); const sns = fakeSns();
  const local = createEmailRuntime({ db, table: 't', sns, domainTopicArn: 'arn:domain', mode: 'local' });
  await local.handle(event({ consent: true, consentVersion: CONSENT_VERSION }), actor, 'POST', '/notifications/email/subscribe');
  await local.handle(event({ alertTypes: ['ReminderDue'] }), actor, 'PUT', '/notifications/email/preferences');
  assert.equal(sns.sent.some((c) => c.name === 'SubscribeCommand'), false, 'local mode must not call SNS Subscribe');
  assert.equal((await local.processJob({ tenantId, userId, eventType: 'ReminderDue', idempotencyKey: 'l-1', title: 'x' })).status, 'SIMULATED_LOCAL');
  const off = createEmailRuntime({ db, table: 't', sns, domainTopicArn: 'arn:domain', mode: 'disabled' });
  assert.equal(await off.enqueue({ tenantId, userId, eventType: 'ReminderDue', idempotencyKey: 'd-1', title: 'x' }), false);
  assert.equal((await off.handle(event({ consent: true, consentVersion: CONSENT_VERSION }), actor, 'POST', '/notifications/email/subscribe')).statusCode, 503);
});

test('mappings, rendering and masking are stable', () => {
  assert.deepEqual(Object.values(FLOW_EVENT_MAP).sort(), [...EMAIL_EVENT_TYPES].sort());
  const mail = renderEmail({ eventType: 'ReminderDue', title: 'Línea 1\nLínea 2', parameters: ['Pagar proveedor'] });
  assert.doesNotMatch(mail.subject, /\n/); assert.match(mail.message, /Recordatorio: Pagar proveedor/);
  assert.equal(maskEmail('ana@example.com'), 'a***@example.com'); assert.equal(maskEmail('x'), null);
});

test('pending-confirmation subscription allows resending SNS confirmation after 30s cooldown', async () => {
  let clock = 1_700_000_000_000;
  const db = fakeDb([profile]);
  const sns = fakeSns();
  const rt = createEmailRuntime({ db, table: 't', sns, domainTopicArn: 'arn:domain', emailTopicArn: 'arn:email', mode: 'sns-email', now: () => new Date(clock) });
  const first = await rt.handle(event({ consent: true, consentVersion: CONSENT_VERSION }), actor, 'POST', '/notifications/email/subscribe');
  assert.equal(first.statusCode, 202);
  const tooSoon = await rt.handle(event({ consent: true, consentVersion: CONSENT_VERSION }), actor, 'POST', '/notifications/email/subscribe');
  assert.equal(tooSoon.statusCode, 429);
  clock += 35_000;
  const resend = await rt.handle(event({ consent: true, consentVersion: CONSENT_VERSION }), actor, 'POST', '/notifications/email/subscribe');
  assert.equal(resend.statusCode, 202);
  assert.match(JSON.parse(resend.body).message, /Reenviamos/);
  assert.equal(sns.sent.filter((c) => c.name === 'SubscribeCommand').length, 2);
});

test('internal notification preferences merge defaults after email subscription and persist updates', async () => {
  const db = fakeDb([profile]);
  const sns = fakeSns();
  const emailRuntime = createEmailRuntime({ db, table: 't', sns, domainTopicArn: 'arn:domain', emailTopicArn: 'arn:email', mode: 'sns-email' });
  await emailRuntime.handle(event({ consent: true, consentVersion: CONSENT_VERSION }), actor, 'POST', '/notifications/email/subscribe');

  const getRes = await notificationsApi({}, actor, 'GET', '/notifications/preferences', { db, table: 't', emailRuntime });
  assert.equal(getRes.statusCode, 200);
  const loaded = JSON.parse(getRes.body);
  assert.equal(loaded.enabled, false);
  assert.equal(loaded.frequency, 'immediate');
  assert.deepEqual(loaded.allowedHours, { start: '08:00', end: '18:00' });
  assert.deepEqual(loaded.alertTypes, []);

  const putRes = await notificationsApi(
    event({ enabled: true, timezone: 'America/Lima', allowedHours: { start: '08:00', end: '18:00' }, alertTypes: ['ProjectCreated', 'BudgetThresholdExceeded'] }),
    actor,
    'PUT',
    '/notifications/preferences',
    { db, table: 't', emailRuntime },
  );
  assert.equal(putRes.statusCode, 200);
  const saved = JSON.parse((await notificationsApi({}, actor, 'GET', '/notifications/preferences', { db, table: 't', emailRuntime })).body);
  assert.equal(saved.enabled, true);
  assert.equal(saved.emailStatus, 'pending-confirmation');
  assert.deepEqual(saved.alertTypes, ['ProjectCreated', 'BudgetThresholdExceeded']);
});

test('deliverDomainEventToInbox delivers idempotently only to subscribed users with enabled inbox', async () => {
  const db = fakeDb([
    { pk: `TENANT#${tenantId}`, sk: 'NOTIFY#PREFERENCES#u1', enabled: true, alertTypes: ['ProjectCreated'] },
    { pk: `TENANT#${tenantId}`, sk: 'NOTIFY#PREFERENCES#u2', enabled: false, alertTypes: ['ProjectCreated'] },
    { pk: `TENANT#${tenantId}`, sk: 'NOTIFY#PREFERENCES#u3', enabled: true, alertTypes: ['ResourceAssigned'] },
  ]);
  const ev = { eventId: 'evt-1', eventType: 'ProjectCreated', tenantId, entityId: 'proj-1', occurredAt: '2026-11-25T10:00:00Z', payload: { name: 'Portal Web' } };
  const first = await deliverDomainEventToInbox(ev, { db, table: 't' });
  const second = await deliverDomainEventToInbox(ev, { db, table: 't' });
  assert.equal(first.delivered, 1);
  assert.equal(second.delivered, 0);
  assert.ok(db.items.has(`TENANT#${tenantId}|NOTIFY#DELIVERY#u1#domain-evt-1`));
  assert.equal(db.items.get(`TENANT#${tenantId}|NOTIFY#DELIVERY#u1#domain-evt-1`).title, 'Proyecto creado: Portal Web');
  assert.equal(db.items.has(`TENANT#${tenantId}|NOTIFY#DELIVERY#u2#domain-evt-1`), false);
  assert.equal(db.items.has(`TENANT#${tenantId}|NOTIFY#DELIVERY#u3#domain-evt-1`), false);
});

test('email schedule supports anytime (24/7), custom hours, overnight windows, and validation', async () => {
  // 2026-11-25T15:30:00Z = 10:30 America/Lima (-05:00)
  let current = new Date('2026-11-25T15:30:00Z');
  const db = fakeDb([profile]);
  const sns = fakeSns();
  const rt = createEmailRuntime({ db, table: 't', sns, domainTopicArn: 'arn:domain', emailTopicArn: 'arn:email', mode: 'sns-email', now: () => current });
  await rt.handle(event({ consent: true, consentVersion: CONSENT_VERSION }), actor, 'POST', '/notifications/email/subscribe');

  const invalidHours = await rt.handle(event({ alertTypes: ['ReminderDue'], anytime: false, allowedHours: { start: '99:00', end: '17:00' } }), actor, 'PUT', '/notifications/email/preferences');
  assert.equal(invalidHours.statusCode, 400);

  const invalidTz = await rt.handle(event({ alertTypes: ['ReminderDue'], anytime: false, timezone: 'Mars/Phobos' }), actor, 'PUT', '/notifications/email/preferences');
  assert.equal(invalidTz.statusCode, 400);

  const saved = await rt.handle(event({ alertTypes: ['ReminderDue'], anytime: false, allowedHours: { start: '09:00', end: '17:00' }, timezone: 'America/Lima' }), actor, 'PUT', '/notifications/email/preferences');
  assert.equal(saved.statusCode, 200);
  const fetched = JSON.parse((await rt.handle({}, actor, 'GET', '/notifications/email')).body);
  assert.equal(fetched.anytime, false);
  assert.deepEqual(fetched.allowedHours, { start: '09:00', end: '17:00' });
  assert.equal(fetched.timezone, 'America/Lima');

  // Inside 09:00-17:00 Lima (10:30)
  assert.equal(await rt.enqueue({ tenantId, userId, eventType: 'ReminderDue', idempotencyKey: 'win-in', title: 'Dentro' }), true);
  // Outside 09:00-17:00 Lima (2026-11-26T01:30:00Z = 20:30 Lima)
  current = new Date('2026-11-26T01:30:00Z');
  assert.equal(await rt.enqueue({ tenantId, userId, eventType: 'ReminderDue', idempotencyKey: 'win-out', title: 'Fuera' }), false);

  // Overnight window (22:00-06:00) and anytime (24/7)
  assert.equal(isWithinAllowedHours({ anytime: false, allowedHours: { start: '22:00', end: '06:00' }, timezone: 'America/Lima' }, new Date('2026-11-26T04:00:00Z')), true); // 23:00 Lima
  assert.equal(isWithinAllowedHours({ anytime: false, allowedHours: { start: '22:00', end: '06:00' }, timezone: 'America/Lima' }, new Date('2026-11-25T15:30:00Z')), false); // 10:30 Lima
  await rt.handle(event({ alertTypes: ['ReminderDue'], anytime: true }), actor, 'PUT', '/notifications/email/preferences');
  assert.equal(await rt.enqueue({ tenantId, userId, eventType: 'ReminderDue', idempotencyKey: 'win-24-7', title: 'Siempre' }), true);
});

test('internal inbox preferences persist anytime (24/7) option', async () => {
  const db = fakeDb([profile]);
  const sns = fakeSns();
  const emailRuntime = createEmailRuntime({ db, table: 't', sns, domainTopicArn: 'arn:domain', emailTopicArn: 'arn:email', mode: 'sns-email' });
  const putRes = await notificationsApi(
    event({ enabled: true, anytime: true, timezone: 'America/Lima', alertTypes: ['ProjectCreated'] }),
    actor,
    'PUT',
    '/notifications/preferences',
    { db, table: 't', emailRuntime },
  );
  assert.equal(putRes.statusCode, 200);
  const loaded = JSON.parse((await notificationsApi({}, actor, 'GET', '/notifications/preferences', { db, table: 't', emailRuntime })).body);
  assert.equal(loaded.enabled, true);
  assert.equal(loaded.anytime, true);
  assert.deepEqual(loaded.allowedHours, { start: '00:00', end: '23:59' });
});

test('enqueue maps flow event names (weekly-summary, risk-alert) via FLOW_EVENT_MAP', async () => {
  const { rt, sns } = runtime();
  await rt.handle(event({ consent: true, consentVersion: CONSENT_VERSION }), actor, 'POST', '/notifications/email/subscribe');
  await rt.handle(event({ alertTypes: ['WeeklySummary', 'RiskAlert'] }), actor, 'PUT', '/notifications/email/preferences');

  assert.equal(await rt.enqueue({ tenantId, userId, eventType: 'weekly-summary', idempotencyKey: 'flow-ws-1', title: 'Resumen', parameters: ['2'] }), true);
  const pub1 = sns.sent.filter((c) => c.name === 'PublishCommand').at(-1).input;
  assert.equal(pub1.MessageAttributes.eventType.StringValue, 'WeeklySummary');
  assert.equal(JSON.parse(pub1.Message).eventType, 'WeeklySummary');

  assert.equal(await rt.enqueue({ tenantId, userId, eventType: 'risk-alert', idempotencyKey: 'flow-ra-1', title: 'Alerta', parameters: ['1'] }), true);
  const pub2 = sns.sent.filter((c) => c.name === 'PublishCommand').at(-1).input;
  assert.equal(pub2.MessageAttributes.eventType.StringValue, 'RiskAlert');
  assert.equal(JSON.parse(pub2.Message).eventType, 'RiskAlert');
});
