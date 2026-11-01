import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CreateSecretCommand, DescribeSecretCommand, GetSecretValueCommand, PutSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { loadAcademyEnv, orchestrate, services } from '../scripts/deploy-academy.mjs';
import { hasInlineMetaConfig, metaSecretName, readMetaConfigFromEnvironment, stripMetaInputs, upsertMetaSecret, validateExistingMetaSecretArn } from '../scripts/whatsapp-secrets.mjs';

const account = '123456789012';
const roleArn = `arn:aws:iam::${account}:role/LabRole`;
const secretArn = `arn:aws:secretsmanager:us-east-1:${account}:secret:cloudportfolio/whatsapp/${account}/academy-AbCd12`;
const metaEnv = () => ({
  WHATSAPP_META_ENABLED: 'true', WHATSAPP_PHONE_NUMBER_ID: '9876543210', WHATSAPP_WABA_ID: '1234567890',
  WHATSAPP_ACCESS_TOKEN: 'meta-token-private-test', WHATSAPP_APP_SECRET: 'meta-app-secret-private-test',
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'webhook-token-private-test', WHATSAPP_GRAPH_VERSION: 'v26.0', WHATSAPP_TEMPLATES_APPROVED: 'true',
  WHATSAPP_TEMPLATE_VERIFICATION_NAME: 'profiles_verification', WHATSAPP_TEMPLATE_VERIFICATION_LANGUAGE: 'es',
  WHATSAPP_TEMPLATE_REMINDER_NAME: 'profiles_reminder', WHATSAPP_TEMPLATE_REMINDER_LANGUAGE: 'es',
  WHATSAPP_TEMPLATE_RISK_ALERT_NAME: 'profiles_risk_alert', WHATSAPP_TEMPLATE_RISK_ALERT_LANGUAGE: 'es',
  WHATSAPP_TEMPLATE_WEEKLY_SUMMARY_NAME: 'profiles_weekly_summary', WHATSAPP_TEMPLATE_WEEKLY_SUMMARY_LANGUAGE: 'es',
});

function fixture() {
  const state = { calls: [], deployments: [], builds: [], logs: [], stored: [], reads: [], permissionChecks: [] };
  const io = {
    log: value => state.logs.push(value),
    deploy(dir, env) { state.calls.push(`deploy:${dir}`); state.deployments.push({ dir, env: { ...env } }); },
    build(env) { state.builds.push({ ...env }); }, zip() {}, upload: async () => {}, wait: async () => {}, cleanup() {},
    async putWhatsAppSecret(input) { state.calls.push('secret:upsert'); state.stored.push(input); return secretArn; },
    async readWhatsAppSecret(arn, context) { state.calls.push('secret:read'); state.reads.push({ arn, context }); return { accessToken: 'opaque' }; },
    async canLabRoleReadWhatsAppSecret(role, resourceArn) { state.permissionChecks.push({ role, resourceArn }); return true; },
    aws(args) {
      const [service, op] = args; state.calls.push(`${service}:${op}`);
      if (service === 'sts') return { Account: account };
      if (service === 'iam') return { Role: { Arn: roleArn, RoleName: 'LabRole' } };
      if (service === 'cloudformation') {
        const name = args[args.indexOf('--stack-name') + 1].replace('cloudportfolio-', '').replace('-academy', '');
        const outputs = {
          auth: { UserPoolId: 'pool-dynamic', UserPoolClientId: 'client-dynamic' },
          storage: { BucketName: 'bucket-dynamic' },
          events: { DomainTopicArn: 'topic', BudgetQueueArn: 'budget-queue', WhatsAppQueueArn: 'whatsapp-queue-arn', WhatsAppQueueUrl: 'https://sqs.local/whatsapp' },
        }[name] || { HttpApiUrl: `https://${name}.example.test` };
        return { Stacks: [{ Outputs: Object.entries(outputs).map(([OutputKey, OutputValue]) => ({ OutputKey, OutputValue })) }] };
      }
      if (op === 'list-apps') return { apps: [{ appId: 'app-dynamic', name: 'cloudportfolio-academy', defaultDomain: 'example.amplifyapp.com' }] };
      if (op === 'list-branches') return { branches: [{ branchName: 'main' }] };
      if (op === 'create-deployment') return { jobId: 'job', zipUploadUrl: 'https://temporary-upload.invalid' };
      if (op === 'get-job') return { job: { summary: { status: 'SUCCEED' } } };
      return {};
    },
  };
  return { io, state };
}

test('disabled default deploys all stacks with inbox mode and never reads or writes Meta secrets', async () => {
  const { io, state } = fixture();
  const result = await orchestrate(io, { region: 'us-east-1', env: { AWS_STAGE: 'academy', NOTIFICATION_MODE: 'disabled', WHATSAPP_META_ENABLED: 'false', WHATSAPP_ACCESS_TOKEN: 'must-not-leak' } });
  assert.equal(result.whatsapp, 'disabled');
  assert.equal(state.deployments.length, services.length + 5);
  assert.ok(state.deployments.every(({ env }) => env.NOTIFICATION_MODE === 'disabled' && env.WHATSAPP_META_SECRET_ARN === undefined));
  assert.ok(state.deployments.every(({ env }) => !JSON.stringify(env).includes('must-not-leak')));
  assert.deepEqual(state.stored, []); assert.deepEqual(state.reads, []);
});

test('Meta-only variables are stripped from child processes while queue and secret references remain', () => {
  const safe = stripMetaInputs({ WHATSAPP_ACCESS_TOKEN: 'sentinel', WHATSAPP_APP_SECRET: 'app-secret', WHATSAPP_PHONE_NUMBER_ID: '123', WHATSAPP_TEMPLATE_REMINDER_NAME: 'reminder', WHATSAPP_QUEUE_URL: 'queue-url', WHATSAPP_QUEUE_ARN: 'queue-arn', WHATSAPP_META_SECRET_ARN: secretArn });
  assert.deepEqual(safe, { WHATSAPP_QUEUE_URL: 'queue-url', WHATSAPP_QUEUE_ARN: 'queue-arn', WHATSAPP_META_SECRET_ARN: secretArn });
});

test('dotenv loader accepts optional Meta variables without printing or transforming values', () => {
  const directory = mkdtempSync(join(tmpdir(), 'profiles-meta-env-')); const file = join(directory, '.env');
  try {
    writeFileSync(file, 'WHATSAPP_META_ENABLED=true\nWHATSAPP_ACCESS_TOKEN="private-token-value"\nWHATSAPP_GRAPH_VERSION=v26.0\nWHATSAPP_TEMPLATE_REMINDER_NAME=profiles_reminder\n');
    const env = {}; loadAcademyEnv(file, env);
    assert.equal(env.WHATSAPP_META_ENABLED, 'true'); assert.equal(env.WHATSAPP_ACCESS_TOKEN, 'private-token-value');
    assert.equal(env.WHATSAPP_GRAPH_VERSION, 'v26.0'); assert.equal(env.WHATSAPP_TEMPLATE_REMINDER_NAME, 'profiles_reminder');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('complete Meta inputs are stored before service deploy and only ARN and mode reach Serverless', async () => {
  const { io, state } = fixture(); const env = { AWS_STAGE: 'academy', ...metaEnv() };
  const result = await orchestrate(io, { region: 'us-east-1', env });
  assert.equal(state.stored.length, 1);
  assert.equal(state.stored[0].name, `cloudportfolio/whatsapp/${account}/academy`);
  assert.equal(state.stored[0].config.wabaId, '1234567890');
  assert.equal(state.calls.indexOf('secret:upsert') < state.calls.indexOf('deploy:infrastructure/auth'), true);
  for (const { env: deployed } of state.deployments) {
    assert.equal(deployed.NOTIFICATION_MODE, 'meta'); assert.equal(deployed.WHATSAPP_META_SECRET_ARN, secretArn);
    for (const key of ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_WEBHOOK_VERIFY_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID']) assert.equal(deployed[key], undefined);
  }
  assert.equal(state.builds[0].VITE_WHATSAPP_ACCESS_TOKEN, undefined);
  assert.ok(state.logs.join('\n').includes('https://identity.example.test/webhooks/meta/whatsapp'));
  for (const secret of [env.WHATSAPP_ACCESS_TOKEN, env.WHATSAPP_APP_SECRET, env.WHATSAPP_WEBHOOK_VERIFY_TOKEN]) assert.ok(!state.logs.join('\n').includes(secret));
  assert.equal(result.webhook, 'https://identity.example.test/webhooks/meta/whatsapp');
  assert.equal(result.whatsapp, 'configured');
});

test('partial Meta configuration fails before CloudFormation and does not disclose values', async () => {
  const { io, state } = fixture(); const env = { AWS_STAGE: 'academy', WHATSAPP_META_ENABLED: 'true', WHATSAPP_ACCESS_TOKEN: 'private-sentinel' };
  await assert.rejects(orchestrate(io, { region: 'us-east-1', env }), error => {
    assert.match(error.message, /incomplete/); assert.ok(!error.message.includes('private-sentinel')); return true;
  });
  assert.equal(state.deployments.length, 0); assert.equal(state.stored.length, 0);
});

test('Secrets Manager denial disables WhatsApp, continues ProFiles deployment and does not leak credentials', async () => {
  const { io, state } = fixture(); io.putWhatsAppSecret = async () => { throw new Error('AWS LabRole lacks the required Secrets Manager permission; WhatsApp was not enabled.'); };
  const env = { AWS_STAGE: 'academy', ...metaEnv() };
  const result = await orchestrate(io, { region: 'us-east-1', env });
  assert.equal(result.whatsapp, 'disabled'); assert.equal(state.deployments.length, services.length + 5);
  assert.ok(state.deployments.every(({ env: deployed }) => deployed.NOTIFICATION_MODE === 'disabled'));
  assert.ok(state.logs.join('').includes('LabRole o credenciales de despliegue no pueden usar el secreto de Secrets Manager'));
  assert.ok(!state.logs.join('').includes(env.WHATSAPP_ACCESS_TOKEN));
});

test('Secrets Manager read denial for a configured secret disables WhatsApp without exposing the secret', async () => {
  const { io, state } = fixture();
  io.readWhatsAppSecret = async () => { throw new Error('AWS LabRole lacks the required Secrets Manager permission; WhatsApp was not enabled.'); };
  const env = { AWS_STAGE: 'academy', WHATSAPP_META_ENABLED: 'true', WHATSAPP_META_SECRET_ARN: secretArn };
  const result = await orchestrate(io, { region: 'us-east-1', env });
  assert.equal(result.whatsapp, 'disabled');
  assert.equal(state.deployments.length, services.length + 5);
  assert.ok(state.deployments.every(({ env: deployed }) => deployed.NOTIFICATION_MODE === 'disabled' && deployed.WHATSAPP_META_SECRET_ARN === undefined));
  assert.ok(!state.logs.join('\n').includes(secretArn));
});

test('unverifiable LabRole read permission disables WhatsApp and continues the normal deployment', async () => {
  const { io, state } = fixture(); io.canLabRoleReadWhatsAppSecret = async () => false;
  const result = await orchestrate(io, { region: 'us-east-1', env: { AWS_STAGE: 'academy', ...metaEnv() } });
  assert.equal(result.whatsapp, 'disabled'); assert.equal(state.stored.length, 0);
  assert.equal(state.deployments.length, services.length + 5);
  assert.ok(state.deployments.every(({ env }) => env.NOTIFICATION_MODE === 'disabled' && env.WHATSAPP_META_SECRET_ARN === undefined));
  assert.ok(state.logs.join('\n').includes('LabRole does not have a verifiable'));
});

test('check-only validates Meta config but never writes secrets or deploys', async () => {
  const { io, state } = fixture();
  const result = await orchestrate(io, { region: 'us-east-1', checkOnly: true, env: { AWS_STAGE: 'academy', ...metaEnv() } });
  assert.equal(result.whatsapp, 'configured-pending-secret-write'); assert.equal(state.deployments.length, 0); assert.equal(state.stored.length, 0);
  assert.ok(state.logs.join('').includes('No se escribieron secretos'));
});

test('complete configuration is read and an existing secret must match account, region and stage', async () => {
  const { io, state } = fixture();
  const env = { AWS_STAGE: 'academy', WHATSAPP_META_ENABLED: 'true', WHATSAPP_META_SECRET_ARN: secretArn, WHATSAPP_TEMPLATE_VERIFICATION_LANGUAGE: 'es', WHATSAPP_TEMPLATE_REMINDER_LANGUAGE: 'es' };
  assert.equal(hasInlineMetaConfig(env), false);
  const result = await orchestrate(io, { region: 'us-east-1', env });
  assert.equal(result.whatsapp, 'configured'); assert.equal(state.reads.length, 1);
  assert.deepEqual(state.reads[0].context, { account, region: 'us-east-1', stage: 'academy' });
  assert.equal(state.stored.length, 0);
  assert.throws(() => validateExistingMetaSecretArn(secretArn.replace(account, '999999999999'), { account, region: 'us-east-1', stage: 'academy' }), /this AWS account/);
});

test('Secrets Manager creates a first version and uses versioned writes for safe rotation', async () => {
  const config = readMetaConfigFromEnvironment(metaEnv()); const calls = []; let current = null;
  const fake = { async send(command) {
    calls.push(command);
    if (command instanceof DescribeSecretCommand) { if (!current) throw Object.assign(new Error('not found'), { name: 'ResourceNotFoundException' }); return { ARN: secretArn }; }
    if (command instanceof CreateSecretCommand) { current = command.input.SecretString; return { ARN: secretArn }; }
    if (command instanceof PutSecretValueCommand) { current = command.input.SecretString; return { ARN: secretArn }; }
    if (command instanceof GetSecretValueCommand) return { SecretString: current };
    throw new Error('unexpected AWS operation');
  } };
  assert.equal(await upsertMetaSecret(fake, { name: metaSecretName(account, 'academy'), account, stage: 'academy', config }), secretArn);
  assert.ok(calls.some(command => command instanceof CreateSecretCommand)); assert.ok(!calls.some(command => command instanceof PutSecretValueCommand));
  calls.length = 0;
  assert.equal(await upsertMetaSecret(fake, { name: metaSecretName(account, 'academy'), account, stage: 'academy', config: { ...config, accessToken: 'rotated-token' } }), secretArn);
  assert.ok(calls.some(command => command instanceof PutSecretValueCommand)); assert.ok(calls.some(command => command instanceof GetSecretValueCommand));
  assert.equal(JSON.parse(current).accessToken, 'rotated-token');
  assert.throws(() => validateMetaConfigForEmptyRotation({ ...config, accessToken: '' }), /incomplete/);
});

function validateMetaConfigForEmptyRotation(config) {
  const env = { ...metaEnv(), WHATSAPP_ACCESS_TOKEN: config.accessToken };
  return readMetaConfigFromEnvironment(env);
}
