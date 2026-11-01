import test from 'node:test';
import assert from 'node:assert/strict';
import { createWhatsAppRuntime, shouldRetryWhatsAppRecord } from '../services/identity-service/whatsapp-runtime.mjs';
import { readFileSync } from 'node:fs';

test('local verification and Meta mocks are hard-disabled in a Lambda runtime', async () => {
  const prior = { lambda: process.env.AWS_LAMBDA_FUNCTION_NAME, mode: process.env.NOTIFICATION_MODE, node: process.env.NODE_ENV };
  process.env.AWS_LAMBDA_FUNCTION_NAME = 'identity-test-function'; process.env.NOTIFICATION_MODE = 'integration-test'; process.env.NODE_ENV = 'test';
  try {
    let dbCalls = 0;
    const runtime = createWhatsAppRuntime({ db: { send: async () => { dbCalls += 1; throw new Error('must not touch state'); } }, table: 'records', sqs: {}, queueUrl: 'queue', mode: 'integration-test', testVerification: true, allowTestDelivery: true, secretProvider: async () => ({ accessToken: 'sentinel', phoneNumberId: '123', templates: { verification: { name: 'verify', language: 'es' } } }), fetchImpl: async () => { throw new Error('must not call network'); } });
    const response = await runtime.handle({ body: JSON.stringify({ phoneNumber: '+15555550123', consent: true, consentVersion: 'profiles-whatsapp-2026-01' }) }, { tenantId: 'tenant-a', userId: 'user-a' }, 'POST', '/notifications/whatsapp/verification');
    assert.equal(response.statusCode, 503); assert.equal(dbCalls, 0);
  } finally {
    if (prior.lambda === undefined) delete process.env.AWS_LAMBDA_FUNCTION_NAME; else process.env.AWS_LAMBDA_FUNCTION_NAME = prior.lambda;
    if (prior.mode === undefined) delete process.env.NOTIFICATION_MODE; else process.env.NOTIFICATION_MODE = prior.mode;
    if (prior.node === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prior.node;
  }
});

test('Identity stack adds an optional Meta queue consumer and public signed webhook route', () => {
  const identity = readFileSync(new URL('../services/identity-service/serverless.yml', import.meta.url), 'utf8');
  const events = readFileSync(new URL('../infrastructure/events/serverless.yml', import.meta.url), 'utf8');
  const handler = readFileSync(new URL('../services/identity-service/handler.mjs', import.meta.url), 'utf8');
  assert.match(events, /WhatsAppQueue:/); assert.match(events, /WhatsAppDLQ:/); assert.match(events, /WhatsAppQueueArn:/); assert.match(events, /WhatsAppQueueUrl:/); assert.match(events, /SqsManagedSseEnabled: true/);
  assert.match(identity, /handler\.whatsappConsumer/); assert.match(identity, /functionResponseType: ReportBatchItemFailures/); assert.match(identity, /secretsmanager:GetSecretValue/); assert.match(identity, /WHATSAPP_META_SECRET_ARN/);
  assert.match(identity, /path: \/webhooks\/meta\/whatsapp, method: GET/); assert.match(identity, /path: \/webhooks\/meta\/whatsapp, method: POST/);
  assert.match(handler, /processWhatsAppJob/); assert.match(handler, /whatsAppRuntime\.webhook\(event, method\)/);
});

test('consumer retries transient AWS failures but acknowledges terminal delivery outcomes safely', () => {
  assert.equal(shouldRetryWhatsAppRecord(Object.assign(new Error('temporary DynamoDB outage'), { code: 'ServiceUnavailable' })), true);
  assert.equal(shouldRetryWhatsAppRecord(Object.assign(new Error('rate limit'), { code: 'RETRYABLE' })), true);
  for (const code of ['INVALID_JOB', 'NOT_ALLOWED', 'PROVIDER_DISABLED', 'UNKNOWN', 'FAILED', 'PROVIDER_REJECTED']) assert.equal(shouldRetryWhatsAppRecord({ code }), false, code);
});
