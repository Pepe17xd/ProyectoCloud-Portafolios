import { createHmac, timingSafeEqual } from 'node:crypto';

export const validE164 = number => typeof number === 'string' && /^\+[1-9]\d{7,14}$/.test(number);
export function validateMetaProviderConfig(value) {
  if (!value || typeof value !== 'object') return null;
  if (!value.accessToken || !/^\d+$/.test(value.phoneNumberId || '') || !/^v\d+\.\d+$/.test(value.graphVersion || '') || !value.appSecret || String(value.appSecret).length < 16 || !value.webhookVerifyToken || String(value.webhookVerifyToken).length < 16 || value.templatesApproved !== true) return null;
  if (value.wabaId && !/^\d+$/.test(value.wabaId)) return null;
  const templates = value.templates || {};
  for (const type of ['verification', 'reminder', 'risk-alert', 'weekly-summary']) {
    const template = templates[type];
    if (!/^[a-z0-9_]{1,512}$/.test(template?.name || '') || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(template?.language || '')) return null;
  }
  for (const template of Object.values(templates)) {
    if (!/^[a-z0-9_]{1,512}$/.test(template?.name || '') || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(template?.language || '')) return null;
  }
  return {
    accessToken: value.accessToken,
    phoneNumberId: value.phoneNumberId,
    ...(value.wabaId ? { wabaId: value.wabaId } : {}),
    graphVersion: value.graphVersion,
    templatesApproved: true,
    appSecret: value.appSecret,
    webhookVerifyToken: value.webhookVerifyToken,
    templates,
  };
}
export function verifyMetaSignature(rawBody, signature, appSecret) {
  if (!Buffer.isBuffer(rawBody) || typeof appSecret !== 'string' || !appSecret || !/^sha256=[0-9a-f]{64}$/i.test(signature || '')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const supplied = Buffer.from(signature.slice(7), 'hex');
  return supplied.length === expected.length && timingSafeEqual(expected, supplied);
}
export function isWithinAllowedHours(prefs, now = new Date()) {
  if (!prefs?.timezone || !/^\d{2}:\d{2}$/.test(prefs.allowedHours?.start || '') || !/^\d{2}:\d{2}$/.test(prefs.allowedHours?.end || '')) return false;
  const toMinutes = t => { const [h,m] = t.split(':').map(Number); return h < 24 && m < 60 ? h * 60 + m : NaN; };
  const start = toMinutes(prefs.allowedHours.start), end = toMinutes(prefs.allowedHours.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return false;
  try { const parts = new Intl.DateTimeFormat('en-GB', { timeZone: prefs.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now); const minute = Number(parts.find(p => p.type === 'hour').value)*60 + Number(parts.find(p => p.type === 'minute').value); return start < end ? minute >= start && minute < end : minute >= start || minute < end; } catch { return false; }
}
// This adapter requires a durable, tenant-scoped claim store and a separately
// verified number. It is not connected to production delivery until those exist.
export function createMetaAdapter({ accessToken, phoneNumberId, graphVersion, templates, store, fetchImpl = fetch, apiOrigin = 'https://graph.facebook.com', allowTestVerification = false }) {
  return { async deliver({ tenantId, userId, eventType, idempotencyKey, preferences, parameters = [], now = new Date() }) {
    if (!accessToken || !/^\d+$/.test(phoneNumberId || '') || !/^v\d+\.\d+$/.test(graphVersion || '') || !store?.claim || !store?.complete) throw Object.assign(new Error('Provider not configured'), { code: 'PROVIDER_DISABLED' });
    const template = templates?.[eventType];
    if (!tenantId || !userId || !idempotencyKey || !template || !/^[a-z0-9_]+$/.test(template.name || '') || !/^[a-z]{2}(?:_[A-Z]{2})?$/.test(template.language || '')) throw Object.assign(new Error('Invalid delivery configuration'), { code: 'NOT_ALLOWED' });
    const testVerified = allowTestVerification === true && preferences?.whatsappVerificationStatus === 'verified-test' && preferences?.verificationProvider === 'local-test';
    if (!validE164(preferences?.whatsappNumber) || preferences.whatsappConsent !== true || !preferences.consentVersion || !preferences.consentAt || preferences.consentRevokedAt || !(preferences.whatsappVerified === true && preferences.verificationProvider === 'trusted') && !testVerified || !(preferences.whatsappAlertTypes || preferences.alertTypes || []).includes(eventType) || !isWithinAllowedHours(preferences, now)) throw Object.assign(new Error('Delivery not authorized'), { code: 'NOT_ALLOWED' });
    if (!Array.isArray(parameters) || parameters.some(x => typeof x !== 'string' || x.length > 256) || parameters.length > 10) throw Object.assign(new Error('Invalid template parameters'), { code: 'NOT_ALLOWED' });
    const claim = await store.claim({ tenantId, userId, idempotencyKey });
    if (!claim) return { status: 'DUPLICATE' };
    const body = { messaging_product: 'whatsapp', to: preferences.whatsappNumber.slice(1), type: 'template', template: { name: template.name, language: { code: template.language }, ...(parameters.length ? { components: [{ type: 'body', parameters: parameters.map(text => ({ type: 'text', text })) }] } : {}) } };
    let response;
    try { response = await fetchImpl(`${apiOrigin.replace(/\/$/, '')}/${graphVersion}/${phoneNumberId}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
    catch { await store.complete({ tenantId, userId, idempotencyKey, status: 'UNKNOWN' }); throw Object.assign(new Error('Provider outcome unknown; do not retry automatically'), { code: 'UNKNOWN' }); }
    if (!response.ok) { const status = response.status >= 500 || response.status === 429 ? 'RETRYABLE' : 'FAILED'; await store.complete({ tenantId, userId, idempotencyKey, status }); throw Object.assign(new Error('Provider rejected request'), { code: status }); }
    const data = await response.json().catch(() => ({})); const messageId = data.messages?.[0]?.id;
    if (!messageId) { await store.complete({ tenantId, userId, idempotencyKey, status: 'UNKNOWN' }); throw Object.assign(new Error('Provider outcome unknown'), { code: 'UNKNOWN' }); }
    await store.complete({ tenantId, userId, idempotencyKey, status: 'ACCEPTED', messageId });
    return { status: 'ACCEPTED', messageId };
  } };
}
