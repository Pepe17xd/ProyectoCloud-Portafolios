import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { hasInlineMetaConfig, metaConfigRequested, metaSecretArnPattern, metaSecretName, readExistingMetaSecret, readMetaConfigFromEnvironment, stripMetaInputs, upsertMetaSecret, validateExistingMetaSecretArn } from './whatsapp-secrets.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const services = ['identity', 'portfolio', 'project', 'resource', 'budget', 'priority'];
export const spaRules = [{ source: '</^[^.]+$|\\.(?!(css|gif|ico|jpg|jpeg|js|png|txt|svg|woff|woff2|map|json|webp)$)([^.]+$)/>', target: '/index.html', status: '200' }];
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
// Shell variables take precedence. Empty entries never mask AWS profiles or instance roles.
const envKeys = new Set([
  'AWS_REGION', 'AWS_DEFAULT_REGION', 'AWS_ACADEMY_ALLOWED_ACCOUNT', 'LAB_ROLE_ARN', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_PROFILE', 'AWS_STAGE', 'AMPLIFY_APP_NAME', 'AMPLIFY_BRANCH', 'CORS_ORIGIN', 'NOTIFICATION_MODE', 'WHATSAPP_META_SECRET_ARN',
  'WHATSAPP_META_ENABLED', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_WABA_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_WEBHOOK_VERIFY_TOKEN', 'WHATSAPP_GRAPH_VERSION', 'WHATSAPP_TEMPLATES_APPROVED',
  'WHATSAPP_TEMPLATE_VERIFICATION_NAME', 'WHATSAPP_TEMPLATE_VERIFICATION_LANGUAGE', 'WHATSAPP_TEMPLATE_REMINDER_NAME', 'WHATSAPP_TEMPLATE_REMINDER_LANGUAGE', 'WHATSAPP_TEMPLATE_AUTOMATION_NAME', 'WHATSAPP_TEMPLATE_AUTOMATION_LANGUAGE', 'WHATSAPP_TEMPLATE_RISK_ALERT_NAME', 'WHATSAPP_TEMPLATE_RISK_ALERT_LANGUAGE', 'WHATSAPP_TEMPLATE_WEEKLY_SUMMARY_NAME', 'WHATSAPP_TEMPLATE_WEEKLY_SUMMARY_LANGUAGE',
]);
export function loadAcademyEnv(path = resolve(root, '.env'), target = process.env) {
  if (!existsSync(path)) return target;
  const lines = readFileSync(path, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || !envKeys.has(match[1])) throw new Error('Invalid or unsupported .env entry; check .env.example.');
    let value = match[2];
    if (value.startsWith('"') || value.startsWith("'")) {
      if (value.length < 2 || value.at(-1) !== value[0]) throw new Error('Invalid quoted value in .env.');
      value = value.slice(1, -1);
    } else value = value.replace(/\s+#.*$/, '').trim();
    if (value && !target[match[1]]) target[match[1]] = value;
  }
  return target;
}
export function validateCredentialEnvironment(env) {
  const keys = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'];
  if (keys.some(k => env[k]) && keys.some(k => !env[k])) throw new Error('Set all three temporary AWS credential variables, or use an AWS profile or instance role.');
  if (env.AWS_REGION && env.AWS_DEFAULT_REGION && env.AWS_REGION !== env.AWS_DEFAULT_REGION) throw new Error('AWS_REGION and AWS_DEFAULT_REGION must match.');
}
const python = process.platform === 'win32' ? 'python' : 'python3';
export function safeCommandError(bin, status, detail = '') {
  if (/ExpiredToken|ExpiredTokenException|RequestExpired|security token.*expired/i.test(detail)) return 'AWS credentials expired; renew all temporary Academy credentials and retry.';
  if (/InvalidClientTokenId|UnrecognizedClientException|InvalidToken/i.test(detail)) return 'AWS credentials are invalid; check the Academy access key, secret key and session token.';
  return `${bin} failed (exit ${status ?? 'unknown'}). Check tool configuration and AWS permissions.`;
}
function command(bin, args, options = {}) {
  const result = spawnSync(bin, args, { cwd: options.cwd || root, env: options.env || process.env, encoding: 'utf8', shell: process.platform === 'win32' && /\.cmd$/i.test(bin), maxBuffer: 20 * 1024 * 1024 });
  // Do not echo command arguments or subprocess output: these can contain credentials or signed URLs.
  if (result.error || result.status !== 0) {
    throw new Error(safeCommandError(bin, result.status, result.stderr || ''));
  }
  return result.stdout.trim();
}
function json(bin, args, options) { const s = command(bin, args, options); try { return JSON.parse(s); } catch { throw new Error(`${bin} returned invalid JSON`); } }
export function createRealIO(region) {
  const cleanProcessEnv = stripMetaInputs(process.env);
  const aws = (args) => json('aws', [...args, '--region', region, '--output', 'json'], { env: cleanProcessEnv });
  const secretsManager = new SecretsManagerClient({ region });
  return {
    aws,
    canLabRoleReadWhatsAppSecret(roleArn, resourceArn) {
      try {
        const result = aws(['iam', 'simulate-principal-policy', '--policy-source-arn', roleArn, '--action-names', 'secretsmanager:GetSecretValue', '--resource-arns', resourceArn]);
        return result.EvaluationResults?.[0]?.EvalDecision === 'allowed';
      } catch { return false; }
    },
    putWhatsAppSecret: ({ name, account, stage, config }) => upsertMetaSecret(secretsManager, { name, account, stage, config }),
    readWhatsAppSecret: (arn, context) => readExistingMetaSecret(secretsManager, arn, context),
    deploy(dir, env, stage) {
      const cwd = resolve(root, dir), original = readFileSync(resolve(cwd, 'serverless.yml'), 'utf8');
      // Only service configurations have Lambda execution roles. The temporary config
      // preserves the ordinary per-service policy when not using this orchestrator.
      const modified = original.replace(/  iam:\s*\r?\n    role:\s*\r?\n[\s\S]*?(?=functions:)/, '  iam:\n    role: ${env:LAB_ROLE_ARN}\n');
      if (dir.startsWith('services/') && modified === original) throw new Error(`Cannot apply LabRole to ${dir}`);
      const config = resolve(cwd, '.serverless-academy.yml');
      if (existsSync(config)) throw new Error(`Temporary config already exists: ${config}`);
      try { writeFileSync(config, modified, { flag: 'wx' }); command(npx, ['--no-install', 'serverless', 'deploy', '--config', '.serverless-academy.yml', '--stage', stage, '--region', region], { cwd, env }); }
      finally { if (existsSync(config)) unlinkSync(config); }
    },
    build(env) { command(npm, ['run', 'build', '--workspace', 'frontend'], { env }); },
    zip() { if (existsSync(resolve(root, 'frontend-academy.zip'))) throw new Error('frontend-academy.zip already exists; inspect it before proceeding'); command(python, ['-c', 'import os,zipfile; z=zipfile.ZipFile("frontend-academy.zip","w",zipfile.ZIP_DEFLATED); root="frontend/dist"; [(z.write(os.path.join(d,f),os.path.relpath(os.path.join(d,f),root))) for d,_,fs in os.walk(root) for f in fs]; z.close()']); },
    async upload(url) { const bytes = readFileSync(resolve(root, 'frontend-academy.zip')); const r = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/zip' }, body: bytes }); if (!r.ok) throw new Error(`Amplify upload failed (HTTP ${r.status})`); },
    async wait() { await new Promise(r => setTimeout(r, 5000)); },
    cleanup() { if (existsSync(resolve(root, 'frontend-academy.zip'))) unlinkSync(resolve(root, 'frontend-academy.zip')); },
    log: console.log,
  };
}
const requiredOutput = (o, k, stack) => { if (!o[k]) throw new Error(`Missing ${k} output in ${stack}`); return o[k]; };
export async function orchestrate(io, options = {}) {
  const region = options.region || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  const stage = options.stage || process.env.AWS_STAGE || 'academy';
  const sourceEnv = options.env || process.env;
  if (!region || !/^[a-z0-9-]+$/.test(region) || !/^[a-zA-Z0-9-]+$/.test(stage)) throw new Error('Set a valid AWS_REGION and AWS_STAGE');
  const env = stripMetaInputs({ ...sourceEnv, AWS_REGION: region, AWS_STAGE: stage });
  // Never trust stale IDs or endpoints supplied by an earlier lab.
  delete env.COGNITO_USER_POOL_ID; delete env.COGNITO_CLIENT_ID;
  for (const s of services) delete env[`${s.toUpperCase()}_API_URL`];
  const caller = io.aws(['sts', 'get-caller-identity']);
  if (!/^\d{12}$/.test(caller.Account || '')) throw new Error('Invalid AWS account');
  if (options.account && options.account !== caller.Account) throw new Error('AWS account does not match AWS_ACADEMY_ALLOWED_ACCOUNT');
  const requestedRole = options.role || `arn:aws:iam::${caller.Account}:role/LabRole`;
  const roleName = requestedRole.split('/').pop();
  const role = io.aws(['iam', 'get-role', '--role-name', roleName]).Role;
  if (!role || role.Arn !== requestedRole || !role.Arn.includes(`::${caller.Account}:`)) throw new Error('LabRole does not exist in the current account');
  env.LAB_ROLE_ARN = role.Arn;
  env.CORS_ORIGIN ||= '*';
  const outputs = (name) => Object.fromEntries((io.aws(['cloudformation', 'describe-stacks', '--stack-name', `cloudportfolio-${name}-${stage}`]).Stacks?.[0]?.Outputs || []).map(x => [x.OutputKey, x.OutputValue]));
  const deploy = (name, infra = false) => { io.log(`Desplegando ${name}`); io.deploy(`${infra ? 'infrastructure' : 'services'}/${name}${infra ? '' : '-service'}`, env, stage); };
  let metaRequested = metaConfigRequested(sourceEnv);
  let metaArn = '';
  let whatsappLimitation = '';
  if (options.checkOnly) {
    if (metaRequested && hasInlineMetaConfig(sourceEnv)) readMetaConfigFromEnvironment(sourceEnv);
    else if (metaRequested && !sourceEnv.WHATSAPP_META_SECRET_ARN?.trim()) throw new Error('WhatsApp was requested but has no complete credentials or existing secret ARN.');
    else if (metaRequested) validateExistingMetaSecretArn(sourceEnv.WHATSAPP_META_SECRET_ARN.trim(), { account: caller.Account, region, stage });
    const resourceArn = metaRequested ? (sourceEnv.WHATSAPP_META_SECRET_ARN?.trim() || metaSecretArnPattern(region, caller.Account, stage)) : '';
    const roleCanRead = metaRequested && typeof io.canLabRoleReadWhatsAppSecret === 'function' && await io.canLabRoleReadWhatsAppSecret(role.Arn, resourceArn);
    const whatsapp = !metaRequested ? 'deshabilitado' : roleCanRead ? 'configuración validada; secreto aún no escrito' : 'deshabilitado: no se pudo confirmar secretsmanager:GetSecretValue para LabRole';
    io.log(`Preflight de solo lectura: cuenta ${caller.Account}, región ${region}, rol ${role.RoleName}; WhatsApp ${whatsapp}. No se escribieron secretos ni recursos.`);
    return { account: caller.Account, region, role: role.Arn, whatsapp: !metaRequested ? 'disabled' : roleCanRead ? 'configured-pending-secret-write' : 'disabled-permission-unverified' };
  }
  if (metaRequested) {
    const suppliedArn = sourceEnv.WHATSAPP_META_SECRET_ARN?.trim();
    const inlineConfig = hasInlineMetaConfig(sourceEnv);
    if (suppliedArn && inlineConfig) throw new Error('Provide either complete WhatsApp credentials or WHATSAPP_META_SECRET_ARN, not both.');
    if (!inlineConfig && !suppliedArn) {
      throw new Error('WhatsApp was requested but credentials are incomplete; provide the complete Meta configuration or an existing WHATSAPP_META_SECRET_ARN.');
    }
    if (inlineConfig) readMetaConfigFromEnvironment(sourceEnv);
    else validateExistingMetaSecretArn(suppliedArn, { account: caller.Account, region, stage });
    const permissionResourceArn = suppliedArn || metaSecretArnPattern(region, caller.Account, stage);
    const roleCanRead = typeof io.canLabRoleReadWhatsAppSecret === 'function' && await io.canLabRoleReadWhatsAppSecret(role.Arn, permissionResourceArn);
    if (!roleCanRead) {
      metaRequested = false;
      io.log('WhatsApp disabled: LabRole does not have a verifiable secretsmanager:GetSecretValue grant for this stage. No Meta secret was written.');
    } else {
      try {
        if (inlineConfig) {
          const config = readMetaConfigFromEnvironment(sourceEnv);
          const name = metaSecretName(caller.Account, stage);
          if (typeof io.putWhatsAppSecret !== 'function') throw new Error('Secrets Manager integration is unavailable; WhatsApp was not enabled.');
          metaArn = await io.putWhatsAppSecret({ name, account: caller.Account, stage, config });
        } else {
          if (typeof io.readWhatsAppSecret !== 'function') throw new Error('Secrets Manager integration is unavailable; WhatsApp was not enabled.');
          await io.readWhatsAppSecret(suppliedArn, { account: caller.Account, region, stage });
          metaArn = suppliedArn;
        }
        env.NOTIFICATION_MODE = 'meta'; env.WHATSAPP_META_SECRET_ARN = metaArn;
      } catch (error) {
        if (!/^(?:AWS LabRole lacks|Could not access the WhatsApp secret|The configured WhatsApp secret was not found)/.test(error.message || '')) throw error;
        metaRequested = false;
        whatsappLimitation = 'deshabilitado: LabRole o credenciales de despliegue no pueden usar el secreto de Secrets Manager';
        io.log(`WhatsApp ${whatsappLimitation}. El buzón interno y el resto del despliegue continúan.`);
      }
    }
    if (!metaRequested) { env.NOTIFICATION_MODE = 'disabled'; delete env.WHATSAPP_META_SECRET_ARN; }
  } else {
    env.NOTIFICATION_MODE = 'disabled';
    delete env.WHATSAPP_META_SECRET_ARN;
  }
  deploy('auth', true);
  const auth = outputs('auth');
  env.COGNITO_USER_POOL_ID = requiredOutput(auth, 'UserPoolId', 'auth');
  env.COGNITO_CLIENT_ID = requiredOutput(auth, 'UserPoolClientId', 'auth');
  deploy('storage', true); env.DOCUMENTS_BUCKET = requiredOutput(outputs('storage'), 'BucketName', 'storage');
  deploy('events', true); const events = outputs('events');
  env.DOMAIN_TOPIC_ARN = requiredOutput(events, 'DomainTopicArn', 'events'); env.BUDGET_QUEUE_ARN = requiredOutput(events, 'BudgetQueueArn', 'events');
  env.WHATSAPP_QUEUE_ARN = requiredOutput(events, 'WhatsAppQueueArn', 'events'); env.WHATSAPP_QUEUE_URL = requiredOutput(events, 'WhatsAppQueueUrl', 'events');
  const urls = {};
  for (const name of services) {
    deploy(name);
    const o = outputs(name); const url = o.HttpApiUrl;
    if (!url || !/^https:\/\//.test(url)) throw new Error(`Missing HttpApiUrl output for ${name}`);
    urls[name] = url.replace(/\/$/, ''); env[`${name.toUpperCase()}_API_URL`] = urls[name];
  }
  // Identity and Project are the only services deployed before all references exist.
  deploy('identity'); deploy('project');
  for (const key of Object.keys(env)) if (key.startsWith('VITE_')) delete env[key];
  const vite = { VITE_AUTH_MODE: 'cognito', VITE_AWS_REGION: region, VITE_COGNITO_USER_POOL_ID: env.COGNITO_USER_POOL_ID, VITE_COGNITO_CLIENT_ID: env.COGNITO_CLIENT_ID };
  for (const name of services) vite[`VITE_API_${name.toUpperCase()}`] = urls[name];
  io.build({ ...env, ...vite }); io.zip();
  const appName = options.appName || `cloudportfolio-${stage}`; const branch = options.branch || 'main';
  try {
    const apps = io.aws(['amplify', 'list-apps']).apps || [];
    const matches = apps.filter(a => a.name === appName);
    if (matches.length > 1) throw new Error('Multiple Amplify apps share this name; specify a unique AMPLIFY_APP_NAME');
    const app = matches[0] || io.aws(['amplify', 'create-app', '--name', appName, '--platform', 'WEB']).app;
    const existingRules = app.customRules || [];
    const rules = [...existingRules.filter(rule => rule.source !== spaRules[0].source), ...spaRules];
    io.aws(['amplify', 'update-app', '--app-id', app.appId, '--custom-rules', JSON.stringify(rules)]);
    const branches = io.aws(['amplify', 'list-branches', '--app-id', app.appId]).branches || [];
    if (!branches.some(b => b.branchName === branch)) io.aws(['amplify', 'create-branch', '--app-id', app.appId, '--branch-name', branch]);
    const job = io.aws(['amplify', 'create-deployment', '--app-id', app.appId, '--branch-name', branch]);
    if (!job.zipUploadUrl || !job.jobId) throw new Error('Amplify did not return a deployment upload URL and job ID');
    await io.upload(job.zipUploadUrl);
    io.aws(['amplify', 'start-deployment', '--app-id', app.appId, '--branch-name', branch, '--job-id', job.jobId]);
    let status;
    for (let i = 0; i < 120; i++) {
      status = io.aws(['amplify', 'get-job', '--app-id', app.appId, '--branch-name', branch, '--job-id', job.jobId]).job?.summary?.status;
      if (status === 'SUCCEED') break;
      if (['FAILED', 'CANCELLED'].includes(status)) throw new Error(`Amplify deployment ${status}`);
      await io.wait();
    }
    if (status !== 'SUCCEED') throw new Error('Amplify deployment timed out');
    if (!app.defaultDomain) throw new Error('Amplify app has no default domain');
    const frontend = `https://${branch}.${app.defaultDomain}`;
    const webhook = `${urls.identity}/webhooks/meta/whatsapp`;
    io.log(`Amplify: ${frontend}\nAPIs: ${JSON.stringify(urls)}\nWebhook Meta: ${webhook}\nWhatsApp: ${metaRequested ? 'configurado en Secrets Manager; suscripción Meta manual pendiente' : whatsappLimitation || 'deshabilitado'}\nStacks: auth, storage, events, ${services.join(', ')}. Verificación real de CRUD y aislamiento pendiente.`);
    return { account: caller.Account, urls, frontend, appId: app.appId, webhook, whatsapp: metaRequested ? 'configured' : 'disabled', whatsappSecretArn: metaArn || undefined };
  } finally { io.cleanup(); }
}
function preflight() {
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Node.js 20 or later required');
  const cleanEnv = stripMetaInputs(process.env);
  command(npm, ['--version'], { env: cleanEnv }); command(python, ['--version'], { env: cleanEnv }); command('docker', ['--version'], { env: cleanEnv }); command('docker', ['info'], { env: cleanEnv }); command('aws', ['--version'], { env: cleanEnv }); command(npx, ['--no-install', 'serverless', '--version'], { env: cleanEnv });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const mode = process.argv[2] || 'check'; if (!['check', 'deploy', 'verify'].includes(mode)) throw new Error('Usage: check|deploy|verify');
    loadAcademyEnv(); validateCredentialEnvironment(process.env);
    preflight(); const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
    const io = createRealIO(region);
    await orchestrate(io, { region, stage: process.env.AWS_STAGE, account: process.env.AWS_ACADEMY_ALLOWED_ACCOUNT, role: process.env.LAB_ROLE_ARN, appName: process.env.AMPLIFY_APP_NAME, branch: process.env.AMPLIFY_BRANCH, checkOnly: mode !== 'deploy' });
  } catch (error) { console.error(`Despliegue detenido: ${error.message}`); process.exitCode = 1; }
}
