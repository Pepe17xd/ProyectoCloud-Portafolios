import test from 'node:test';
import assert from 'node:assert/strict';
import { orchestrate, services, spaRules } from '../scripts/deploy-academy.mjs';

function fixture() {
  const state = { calls: [], apps: [], branches: [], builds: [], deployments: [], logs: [] };
  const io = {
    log: s => state.logs.push(s),
    deploy: (dir, env) => { state.calls.push(`deploy:${dir}`); state.deployments.push({ dir, env: { ...env } }); },
    build: env => { state.calls.push('build'); state.builds.push(env); }, zip: () => state.calls.push('zip'),
    upload: async () => state.calls.push('upload'), wait: async () => {}, cleanup: () => state.calls.push('cleanup'),
    aws(args) {
      const [service, op] = args; state.calls.push(`${service}:${op}`);
      if (service === 'sts') return { Account: '123456789012' };
      if (service === 'iam') return { Role: { Arn: 'arn:aws:iam::123456789012:role/LabRole', RoleName: 'LabRole' } };
      if (service === 'cloudformation') {
        const name = args[args.indexOf('--stack-name') + 1].replace('cloudportfolio-', '').replace('-academy', '');
        const data = { auth: { UserPoolId: 'pool', UserPoolClientId: 'client' }, storage: { BucketName: 'bucket' }, events: { DomainTopicArn: 'topic', BudgetQueueArn: 'queue', WhatsAppQueueArn: 'whatsapp-arn', WhatsAppQueueUrl: 'https://sqs.example/queue' } }[name] || { HttpApiUrl: `https://${name}.example` };
        return { Stacks: [{ Outputs: Object.entries(data).map(([OutputKey, OutputValue]) => ({ OutputKey, OutputValue })) }] };
      }
      if (op === 'list-apps') return { apps: state.apps };
      if (op === 'create-app') { const app = { appId: 'app', name: 'cloudportfolio-academy', defaultDomain: 'example.amplifyapp.com' }; state.apps.push(app); return { app }; }
      if (op === 'list-branches') return { branches: state.branches };
      if (op === 'create-branch') { state.branches.push({ branchName: 'main' }); return {}; }
      if (op === 'create-deployment') return { jobId: 'job', zipUploadUrl: 'https://secret-upload.example' };
      if (op === 'get-job') return { job: { summary: { status: 'SUCCEED' } } };
      return {};
    },
  }; return { io, state };
}
test('clean lab discovers Cognito, deploys services in order and publishes Amplify', async () => {
  const { io, state } = fixture(); const result = await orchestrate(io, { region: 'us-east-1' });
  assert.deepEqual(state.deployments.map(x => x.dir), ['infrastructure/auth','infrastructure/storage','infrastructure/events', ...services.map(s => `services/${s}-service`), 'services/identity-service','services/project-service']);
  assert.equal(state.deployments[0].env.COGNITO_USER_POOL_ID, undefined);
  for (const d of state.deployments.slice(3)) { assert.equal(d.env.COGNITO_USER_POOL_ID, 'pool'); assert.equal(d.env.COGNITO_CLIENT_ID, 'client'); }
  assert.equal(state.deployments.find(x => x.dir === 'services/identity-service').env.WHATSAPP_QUEUE_ARN, 'whatsapp-arn');
  assert.equal(state.deployments.find(x => x.dir === 'services/identity-service').env.WHATSAPP_QUEUE_URL, 'https://sqs.example/queue');
  for (const name of services) assert.equal(state.builds[0][`VITE_API_${name.toUpperCase()}`], `https://${name}.example`);
  assert.equal(result.frontend, 'https://main.example.amplifyapp.com');
  assert.ok(state.calls.indexOf('upload') < state.calls.indexOf('amplify:start-deployment'));
  assert.ok(!state.logs.join(' ').includes('secret-upload'));
  assert.equal(spaRules[0].target, '/index.html'); assert.equal(spaRules[0].status, '200');
});
test('repeat deployment reuses Amplify app and branch', async () => {
  const { io, state } = fixture(); await orchestrate(io, { region: 'us-east-1' }); await orchestrate(io, { region: 'us-east-1' });
  assert.equal(state.calls.filter(x => x === 'amplify:create-app').length, 1); assert.equal(state.calls.filter(x => x === 'amplify:create-branch').length, 1);
});
test('critical failure stops immediately', async () => {
  const { io, state } = fixture(); const original = io.deploy; io.deploy = (dir, env) => { if (dir === 'infrastructure/storage') throw new Error('failed'); original(dir, env); };
  await assert.rejects(orchestrate(io, { region: 'us-east-1' }), /failed/); assert.ok(!state.calls.includes('amplify:create-app'));
});

import { readFileSync } from 'node:fs';
test('SPA rewrite matches routes and leaves common assets alone', () => {
  const pattern = new RegExp(spaRules[0].source.slice(2, -2));
  for (const route of ['/login/', '/register/', '/app', '/app/projects']) assert.match(route, pattern);
  for (const asset of ['/assets/app.js', '/assets/app.css', '/favicon.ico']) assert.doesNotMatch(asset, pattern);
});
test('Academy role substitution and Python packaging are configured in all services', () => {
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  assert.equal(lock.packages['node_modules/serverless-python-requirements'].version, '6.1.2');
  for (const name of services) {
    const yaml = readFileSync(new URL(`../services/${name}-service/serverless.yml`, import.meta.url), 'utf8');
    const modified = yaml.replace(/  iam:\s*\r?\n    role:\s*\r?\n[\s\S]*?(?=functions:)/, '  iam:\n    role: ${env:LAB_ROLE_ARN}\n');
    assert.notEqual(modified, yaml); assert.doesNotMatch(modified, /\n    role:\s*\n\s+statements:/);
    if (['resource','budget','priority'].includes(name)) {
      assert.match(yaml, /dockerizePip: true/);
      assert.match(readFileSync(new URL(`../services/${name}-service/requirements.txt`, import.meta.url), 'utf8'), /PyJWT\[crypto\]/);
      const source = readFileSync(new URL(`../services/${name}-service/app.py`, import.meta.url), 'utf8');
      assert.equal((source.match(/not os\.getenv\("AWS_LAMBDA_FUNCTION_NAME"\)/g) || []).length, 2);
    }
  }
});
test('preflight does not deploy or publish and validates account', async () => {
  const { io, state } = fixture(); await orchestrate(io, { region: 'us-east-1', checkOnly: true });
  assert.equal(state.deployments.length, 0); assert.ok(!state.calls.includes('amplify:create-app'));
  await assert.rejects(orchestrate(io, { region: 'us-east-1', account: '999999999999', checkOnly: true }), /account does not match/);
});

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAcademyEnv, validateCredentialEnvironment, safeCommandError } from '../scripts/deploy-academy.mjs';
test('dotenv loads inputs without overriding shell values or masking profiles', () => {
  const dir = mkdtempSync(join(tmpdir(), 'profiles-env-')), path = join(dir, '.env');
  try {
    writeFileSync(path, 'AWS_REGION=us-east-1\nAWS_ACCESS_KEY_ID=sample\nAWS_SECRET_ACCESS_KEY="hidden"\nAWS_SESSION_TOKEN=temporary\nAWS_PROFILE=\n');
    const env = { AWS_REGION: 'us-west-2', AWS_PROFILE: 'lab' }; loadAcademyEnv(path, env);
    assert.equal(env.AWS_REGION, 'us-west-2'); assert.equal(env.AWS_PROFILE, 'lab'); assert.equal(env.AWS_SECRET_ACCESS_KEY, 'hidden'); validateCredentialEnvironment(env);
    writeFileSync(path, 'AWS_ACCESS_KEY_ID=\nAWS_SECRET_ACCESS_KEY=\nAWS_SESSION_TOKEN=\n'); const profile = { AWS_PROFILE: 'lab' }; loadAcademyEnv(path, profile); validateCredentialEnvironment(profile); assert.equal(profile.AWS_ACCESS_KEY_ID, undefined);
    writeFileSync(path, 'VITE_SECRET=hidden\n'); assert.throws(() => loadAcademyEnv(path, {}), /unsupported/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('incomplete credentials and expiry are rejected without leaking diagnostics', () => {
  assert.throws(() => validateCredentialEnvironment({ AWS_ACCESS_KEY_ID: 'secret' }), /all three/);
  const message = safeCommandError('aws', 1, 'ExpiredToken hidden-test-secret'); assert.match(message, /expired/); assert.doesNotMatch(message, /hidden-test-secret/);
  assert.doesNotMatch(safeCommandError('aws', 1, 'unknown hidden-test-secret'), /hidden-test-secret/);
});
test('all stacks exclude environment files from packages', () => {
  for (const dir of ['infrastructure/auth','infrastructure/storage','infrastructure/events', ...services.map(s => `services/${s}-service`)]) {
    const yaml = readFileSync(new URL(`../${dir}/serverless.yml`, import.meta.url), 'utf8'); assert.match(yaml, /'!\*\*\/\.env'/); assert.match(yaml, /'!\*\*\/\.env\.\*'/);
  }
});
