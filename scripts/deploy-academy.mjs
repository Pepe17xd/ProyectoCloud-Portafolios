import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const mode = process.argv[2] || 'check';
const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
const stage = process.env.AWS_STAGE || 'academy';
const required = ['COGNITO_USER_POOL_ID', 'COGNITO_CLIENT_ID', 'CORS_ORIGIN'];
const command = (bin, args, opts = {}) => spawnSync(bin, args, { cwd: opts.cwd || root, encoding: 'utf8', shell: process.platform === 'win32', ...opts });
const run = (bin, args, opts) => {
  const result = command(bin, args, opts);
  if (result.status !== 0) throw new Error(`${bin} ${args.join(' ')} failed${result.stderr ? `: ${result.stderr.trim()}` : ''}`);
  return result.stdout.trim();
};
const log = (s) => console.log(s);
function check() {
  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const versions = { node: process.versions.node, npm: run(npmBin, ['--version']), python: null, aws: null, serverless: null };
  const py = command('python', ['--version']);
  if (!py.error && py.status === 0) versions.python = py.stdout.trim() || py.stderr.trim();
  const aws = command('aws', ['--version']);
  if (!aws.error && aws.status === 0) versions.aws = aws.stdout.trim() || aws.stderr.trim();
  const sls = command(npxBin, ['--no-install', 'serverless', '--version']);
  if (!sls.error && sls.status === 0) versions.serverless = sls.stdout.trim().split('\n')[0];
  log(`Herramientas: ${JSON.stringify(versions)}`);
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Se requiere Node.js 20 o superior.');
  if (!versions.python) throw new Error('Python no está disponible en PATH.');
  if (!versions.aws) throw new Error('AWS CLI no está disponible en PATH.');
  if (!versions.serverless) throw new Error('Instala Serverless Framework v4 y plugins requeridos antes del despliegue.');
  if (!region) throw new Error('Define AWS_REGION (o AWS_DEFAULT_REGION) para el laboratorio.');
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Faltan parámetros: ${missing.join(', ')}. No se muestran valores de configuración.`);
  const identity = command('aws', ['sts', 'get-caller-identity', '--output', 'json', '--region', region]);
  if (identity.status !== 0) throw new Error('AWS no pudo validar credenciales/permisos STS; revisa credenciales temporales de Academy.');
  const caller = JSON.parse(identity.stdout);
  if (!caller.Account || !caller.Arn) throw new Error('STS devolvió identidad incompleta.');
  log(`AWS: credenciales válidas; cuenta ${caller.Account}, región ${region}. ARN omitido.`);
  if (process.env.AWS_ACADEMY_ALLOWED_ACCOUNT && caller.Account !== process.env.AWS_ACADEMY_ALLOWED_ACCOUNT) throw new Error('La cuenta no coincide con AWS_ACADEMY_ALLOWED_ACCOUNT.');
  if (!existsSync(resolve(root, 'package-lock.json'))) throw new Error('Falta package-lock.json; npm ci no es reproducible.');
  log(`Preflight de solo lectura completado para stage=${stage}. No se consultaron ni crearon recursos.`);
}
const stacks = [
  ['infrastructure/auth', 'cloudportfolio-auth'],
  ['infrastructure/storage', 'cloudportfolio-storage'],
  ['infrastructure/events', 'cloudportfolio-events'],
  ['services/identity-service', 'cloudportfolio-identity'],
  ['services/portfolio-service', 'cloudportfolio-portfolio'],
  ['services/project-service', 'cloudportfolio-project'],
  ['services/resource-service', 'cloudportfolio-resource'],
  ['services/budget-service', 'cloudportfolio-budget'],
  ['services/priority-service', 'cloudportfolio-priority'],
];
function outputs(stack) {
  const raw = run('aws', ['cloudformation', 'describe-stacks', '--stack-name', stack, '--region', region, '--output', 'json']);
  return Object.fromEntries((JSON.parse(raw).Stacks?.[0]?.Outputs || []).map((x) => [x.OutputKey, x.OutputValue]));
}
function apiUrl(service) {
  const result = outputs(`${service}-${stage}`);
  const endpoint = result.HttpApiUrl || Object.values(result).find((value) => /^https:\/\//.test(value));
  if (!endpoint) throw new Error(`No se encontró URL de API en el stack ${service}-${stage}.`);
  return endpoint.replace(/\/$/, '');
}
function deploy() {
  check();
  log('DESPLIEGUE: se crearán/actualizarán recursos facturables en AWS. Requiere ejecutar este comando explícitamente.');
  for (const [dir, service] of stacks) {
    if (service === 'cloudportfolio-events') {
      const o = outputs('cloudportfolio-auth-' + stage);
      process.env.COGNITO_USER_POOL_ID ||= o.UserPoolId;
      process.env.COGNITO_CLIENT_ID ||= o.UserPoolClientId;
    }
    if (service === 'cloudportfolio-identity') {
      const o = outputs('cloudportfolio-events-' + stage); process.env.DOMAIN_TOPIC_ARN ||= o.DomainTopicArn;
    }
    if (service === 'cloudportfolio-portfolio') {
      const o = outputs('cloudportfolio-events-' + stage); process.env.DOMAIN_TOPIC_ARN ||= o.DomainTopicArn;
    }
    if (service === 'cloudportfolio-project') {
      const event = outputs('cloudportfolio-events-' + stage); const bucket = outputs('cloudportfolio-storage-' + stage);
      process.env.DOMAIN_TOPIC_ARN ||= event.DomainTopicArn; process.env.DOCUMENTS_BUCKET ||= bucket.BucketName;
    }
    if (service === 'cloudportfolio-budget') {
      const event = outputs('cloudportfolio-events-' + stage); process.env.DOMAIN_TOPIC_ARN ||= event.DomainTopicArn; process.env.BUDGET_QUEUE_ARN ||= event.BudgetQueueArn;
    }
    if (service === 'cloudportfolio-priority') {
      process.env.PORTFOLIO_API_URL ||= apiUrl('cloudportfolio-portfolio');
      process.env.PROJECT_API_URL ||= apiUrl('cloudportfolio-project');
      process.env.RESOURCE_API_URL ||= apiUrl('cloudportfolio-resource');
      process.env.BUDGET_API_URL ||= apiUrl('cloudportfolio-budget');
    }
    if (service.startsWith('cloudportfolio-') && service !== 'cloudportfolio-identity' && !dir.startsWith('infrastructure')) {
      process.env.IDENTITY_API_URL ||= apiUrl('cloudportfolio-identity');
    }
    if (service.startsWith('cloudportfolio-') && !dir.startsWith('infrastructure')) {
      for (const key of ['COGNITO_USER_POOL_ID', 'COGNITO_CLIENT_ID']) if (!process.env[key]) throw new Error(`No se obtuvo ${key} de Auth stack.`);
    }
    log(`Desplegando ${service}`);
    run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--no-install', 'serverless', 'deploy', '--stage', stage, '--region', region], { cwd: resolve(root, dir) });
  }
  process.env.PORTFOLIO_API_URL ||= apiUrl('cloudportfolio-portfolio');
  process.env.PROJECT_API_URL ||= apiUrl('cloudportfolio-project');
  process.env.RESOURCE_API_URL ||= apiUrl('cloudportfolio-resource');
  process.env.BUDGET_API_URL ||= apiUrl('cloudportfolio-budget');
  process.env.PRIORITY_API_URL ||= apiUrl('cloudportfolio-priority');
  log('Actualizando Identity con los endpoints de dominio para Flow y el scheduler.');
  run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--no-install', 'serverless', 'deploy', '--stage', stage, '--region', region], { cwd: resolve(root, 'services/identity-service') });
  const urls = {};
  for (const [dir, service] of stacks.filter(([d]) => d.startsWith('services/'))) {
    const o = outputs(`${service}-${stage}`); const url = Object.values(o).find((v) => /^https:\/\//.test(v)); if (url) urls[service.replace('cloudportfolio-', '')] = url;
  }
  const auth = outputs(`cloudportfolio-auth-${stage}`);
  const env = [`VITE_AUTH_MODE=cognito`, `VITE_AWS_REGION=${region}`, `VITE_COGNITO_USER_POOL_ID=${auth.UserPoolId}`, `VITE_COGNITO_CLIENT_ID=${auth.UserPoolClientId}`, ...Object.entries(urls).map(([k,v]) => `VITE_API_${k.toUpperCase()}=${v}`)].join('\n') + '\n';
  writeFileSync(resolve(root, 'frontend/.env.production.local'), env, { mode: 0o600 });
  log('Endpoints guardados en frontend/.env.production.local (ignorado por Git). Amplify no se publica con Serverless; configura variables y hosting por separado.');
}
function verify() {
  if (!region) throw new Error('Define AWS_REGION.');
  const rows = [];
  for (const [dir, service] of stacks) { try { const o = outputs(`${service}-${stage}`); rows.push({ service, status: 'deployed', outputs: Object.keys(o) }); } catch { rows.push({ service, status: 'missing/unreadable' }); } }
  log(JSON.stringify({ stage, region, stacks: rows }, null, 2));
  const config = resolve(root, 'frontend/.env.production.local');
  if (existsSync(config)) log('Frontend config presente (valores ocultos).'); else log('Frontend config aún no existe; despliega primero.');
}
try { if (mode === 'check') check(); else if (mode === 'deploy') deploy(); else if (mode === 'verify') verify(); else throw new Error('Uso: node scripts/deploy-academy.mjs check|deploy|verify'); }
catch (error) { console.error(`Preflight/despliegue detenido: ${error.message}`); process.exitCode = 1; }
