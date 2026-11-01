import { randomUUID } from 'node:crypto';
import {
  CreateSecretCommand,
  DescribeSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

const requiredTemplates = ['verification', 'reminder', 'risk-alert', 'weekly-summary'];
const templateEnvNames = {
  verification: 'VERIFICATION',
  reminder: 'REMINDER',
  automation: 'AUTOMATION',
  'risk-alert': 'RISK_ALERT',
  'weekly-summary': 'WEEKLY_SUMMARY',
};
const configured = value => typeof value === 'string' && value.trim().length > 0;

export function readMetaConfigFromEnvironment(env) {
  const templates = {};
  for (const [key, suffix] of Object.entries(templateEnvNames)) {
    const name = env[`WHATSAPP_TEMPLATE_${suffix}_NAME`]?.trim();
    const language = env[`WHATSAPP_TEMPLATE_${suffix}_LANGUAGE`]?.trim();
    if (name) templates[key] = { name, language };
  }
  return validateMetaConfig({
    accessToken: env.WHATSAPP_ACCESS_TOKEN?.trim(),
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID?.trim(),
    wabaId: env.WHATSAPP_WABA_ID?.trim() || undefined,
    graphVersion: env.WHATSAPP_GRAPH_VERSION?.trim(),
    templatesApproved: env.WHATSAPP_TEMPLATES_APPROVED === 'true',
    appSecret: env.WHATSAPP_APP_SECRET?.trim(),
    webhookVerifyToken: env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim(),
    templates,
  });
}

export function validateMetaConfig(value) {
  const missing = [];
  for (const key of ['accessToken', 'phoneNumberId', 'graphVersion', 'appSecret', 'webhookVerifyToken']) {
    if (!configured(value?.[key])) missing.push(key);
  }
  if (configured(value?.phoneNumberId) && !/^\d+$/.test(value.phoneNumberId)) throw new Error('WhatsApp Phone Number ID must contain only digits.');
  if (configured(value?.wabaId) && !/^\d+$/.test(value.wabaId)) throw new Error('WhatsApp WABA ID must contain only digits.');
  if (configured(value?.graphVersion) && !/^v\d+\.\d+$/.test(value.graphVersion)) throw new Error('Set WHATSAPP_GRAPH_VERSION to a supported Meta Graph API version such as vX.Y.');
  if (configured(value?.webhookVerifyToken) && value.webhookVerifyToken.length < 16) throw new Error('WHATSAPP_WEBHOOK_VERIFY_TOKEN must contain at least 16 characters.');
  if (configured(value?.appSecret) && value.appSecret.length < 16) throw new Error('WHATSAPP_APP_SECRET is incomplete.');
  if (value?.templatesApproved !== true) missing.push('WHATSAPP_TEMPLATES_APPROVED=true (confirm template approval in Meta)');
  for (const key of requiredTemplates) {
    const template = value?.templates?.[key];
    if (!configured(template?.name) || !/^[a-z0-9_]{1,512}$/.test(template.name) || !configured(template?.language) || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(template.language)) missing.push(`templates.${key}`);
  }
  if (missing.length) throw new Error(`WhatsApp configuration is incomplete: ${missing.join(', ')}.`);
  for (const [key, template] of Object.entries(value.templates || {})) {
    if (!/^[a-z0-9_]{1,512}$/.test(template?.name || '') || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(template?.language || '')) throw new Error(`WhatsApp template configuration is invalid for ${key}.`);
  }
  return {
    accessToken: value.accessToken,
    phoneNumberId: value.phoneNumberId,
    ...(value.wabaId ? { wabaId: value.wabaId } : {}),
    graphVersion: value.graphVersion,
    templatesApproved: value.templatesApproved === true,
    appSecret: value.appSecret,
    webhookVerifyToken: value.webhookVerifyToken,
    templates: value.templates,
  };
}

export function metaSecretName(account, stage) {
  if (!/^\d{12}$/.test(account || '') || !/^[a-zA-Z0-9_-]{1,32}$/.test(stage || '')) throw new Error('Cannot derive the WhatsApp secret name from AWS account and stage.');
  return `cloudportfolio/whatsapp/${account}/${stage}`;
}

export function metaSecretArnPattern(region, account, stage) {
  return `arn:aws:secretsmanager:${region}:${account}:secret:${metaSecretName(account, stage)}-*`;
}

export function metaConfigRequested(env) {
  if (env.WHATSAPP_META_ENABLED && !['true', 'false'].includes(env.WHATSAPP_META_ENABLED)) throw new Error('WHATSAPP_META_ENABLED must be true or false.');
  if (env.WHATSAPP_META_ENABLED === 'true') return true;
  if (env.WHATSAPP_META_ENABLED === 'false') return false;
  return env.NOTIFICATION_MODE === 'meta' || configured(env.WHATSAPP_META_SECRET_ARN);
}

export function hasInlineMetaConfig(env) {
  return [
    'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_WABA_ID',
    'WHATSAPP_GRAPH_VERSION', 'WHATSAPP_APP_SECRET', 'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
    ...Object.values(templateEnvNames).map(suffix => `WHATSAPP_TEMPLATE_${suffix}_NAME`),
  ].some(key => configured(env[key]));
}

export function stripMetaInputs(env) {
  const safe = { ...env };
  for (const key of Object.keys(safe)) {
    if (key.startsWith('WHATSAPP_') && !['WHATSAPP_QUEUE_URL', 'WHATSAPP_QUEUE_ARN', 'WHATSAPP_META_SECRET_ARN'].includes(key)) delete safe[key];
  }
  return safe;
}

function safeSecretsManagerError(error) {
  if (error?.name === 'AccessDeniedException' || error?.name === 'AccessDenied') return 'AWS LabRole lacks the required Secrets Manager permission; WhatsApp was not enabled.';
  if (error?.name === 'ResourceNotFoundException') return 'The configured WhatsApp secret was not found in Secrets Manager.';
  return 'Could not access the WhatsApp secret in Secrets Manager; WhatsApp was not enabled.';
}

async function secretExists(client, secretId) {
  try { return await client.send(new DescribeSecretCommand({ SecretId: secretId })); }
  catch (error) {
    if (error?.name === 'ResourceNotFoundException') return null;
    throw new Error(safeSecretsManagerError(error));
  }
}

export async function upsertMetaSecret(client, { name, account, stage, config }) {
  const valid = validateMetaConfig(config);
  let arn;
  const prior = await secretExists(client, name);
  try {
    if (!prior) {
      const created = await client.send(new CreateSecretCommand({
        Name: name,
        Description: `ProFiles WhatsApp provider credentials for stage ${stage}`,
        SecretString: JSON.stringify(valid),
        Tags: [{ Key: 'Application', Value: 'ProFiles' }, { Key: 'Stage', Value: stage }, { Key: 'Account', Value: account }],
      }));
      arn = created.ARN;
    } else {
      arn = prior.ARN;
      await client.send(new PutSecretValueCommand({ SecretId: arn || name, ClientRequestToken: randomUUID(), SecretString: JSON.stringify(valid) }));
    }
    if (!arn) arn = (await secretExists(client, name))?.ARN;
    if (!arn) throw new Error('Could not resolve the Secrets Manager ARN.');
    // Verify the same role used for deployment can read the current version, as Lambda will.
    const result = await client.send(new GetSecretValueCommand({ SecretId: arn, VersionStage: 'AWSCURRENT' }));
    validateMetaConfig(JSON.parse(result.SecretString || '{}'));
    return arn;
  } catch (error) {
    if (error.message?.startsWith('AWS LabRole') || error.message?.startsWith('The configured') || error.message?.startsWith('Could not resolve')) throw error;
    throw new Error(safeSecretsManagerError(error));
  }
}

export async function readExistingMetaSecret(client, arn, { account, region, stage } = {}) {
  validateExistingMetaSecretArn(arn, { account, region, stage });
  try {
    const result = await client.send(new GetSecretValueCommand({ SecretId: arn, VersionStage: 'AWSCURRENT' }));
    return validateMetaConfig(JSON.parse(result.SecretString || '{}'));
  } catch (error) {
    if (error.message?.startsWith('WhatsApp') || error.message?.startsWith('Set WHATSAPP')) throw error;
    throw new Error(safeSecretsManagerError(error));
  }
}

export function validateExistingMetaSecretArn(arn, { account, region, stage } = {}) {
  if (!/^arn:aws:secretsmanager:[a-z0-9-]+:\d{12}:secret:[A-Za-z0-9/_+=.@-]+$/.test(arn || '')) throw new Error('WHATSAPP_META_SECRET_ARN must be a Secrets Manager ARN.');
  if (account && region && stage && !arn.startsWith(`arn:aws:secretsmanager:${region}:${account}:secret:cloudportfolio/whatsapp/${account}/${stage}-`)) throw new Error('WHATSAPP_META_SECRET_ARN must belong to this AWS account, region and stage.');
  return arn;
}
