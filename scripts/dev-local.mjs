import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'npm';
const children = [];
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
  });
}
function start(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options });
  children.push(child);
  child.once('exit', (code) => { if (code && code !== 0) { console.error(`${command} exited with code ${code}`); stop(code); } });
}
function stop(code = 0) { for (const child of children) child.kill('SIGTERM'); process.exit(code); }
process.on('SIGINT', () => stop(0)); process.on('SIGTERM', () => stop(0));

console.log('Starting DynamoDB Local and LocalStack...');
await run('docker', ['compose', '-f', 'infrastructure/docker-compose.yml', 'up', '-d', '--wait']);
// Windows host SDK requests to local emulators can hang on their container-only endpoints;
// execute the same real initializer on the Compose network instead.
await run('docker', ['run','--rm','--network','cloudportfolio-local','-e','DYNAMODB_ENDPOINT=http://dynamodb:8000','-e','LOCALSTACK_ENDPOINT=http://localstack:4566','-v',`${root}:/work`,'-w','/work','node:24-alpine','node','scripts/init-local.mjs']);
for (const service of ['identity','portfolio','project']) start(process.execPath, ['scripts/local-api.mjs', service], service === 'project' ? { env: { ...process.env, PORTFOLIO_API_URL: 'http://localhost:4102', PROJECT_API_URL: 'http://localhost:4103', BUDGET_API_URL: 'http://localhost:4105', RESOURCE_API_URL: 'http://localhost:4104', PRIORITY_API_URL: 'http://localhost:4106' } } : service === 'identity' ? { env: { ...process.env, NOTIFICATION_MODE: 'local-simulator' } } : {});
const py = process.env.PYTHON || (process.platform === 'win32' ? 'py' : 'python3');
let pyPrefix = process.platform === 'win32' ? ['-3.12'] : [];
if (process.platform === 'win32' && !process.env.PYTHON) {
  const probe = await new Promise((resolve) => { const child = spawn(py, ['-3.12', '--version'], { cwd: root, stdio: 'ignore' }); child.on('error', () => resolve(false)); child.on('exit', (code) => resolve(code === 0)); });
  if (!probe) { console.warn('Python 3.12 not installed; using compatible local Python 3.11 runtime. AWS Lambda remains configured for Python 3.12.'); pyPrefix = ['-3.11']; }
}
for (const [service, port] of [['resource',4104],['budget',4105],['priority',4106]]) {
  const cwd = path.join(root, 'services', `${service}-service`);
  start(py, [...pyPrefix, '-m', 'uvicorn', 'app:app', '--host', '0.0.0.0', '--port', String(port)], {
    cwd,
    env: { ...process.env, LOCAL_JWT_SECRET: 'local-only-change-this-secret-before-sharing', DYNAMODB_ENDPOINT: 'http://localhost:8000', SNS_ENDPOINT: 'http://localhost:4566', PROJECT_API_URL: 'http://localhost:4103', TABLE_NAME: `cloudportfolio-${service}-local`, DOMAIN_TOPIC_ARN: 'arn:aws:sns:us-east-1:000000000000:cloudportfolio-domain-local', AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'local', AWS_SECRET_ACCESS_KEY: 'local' }
  });
}
start(process.execPath, ['scripts/local-worker.mjs']);
start(process.execPath, ['scripts/notification-worker.mjs']);
start(process.execPath, ['scripts/reminder-scheduler.mjs'], { env: { ...process.env, TABLE_NAME: 'cloudportfolio-identity-local', REMINDER_TABLE_NAME: 'cloudportfolio-reminders-local', DYNAMODB_ENDPOINT: 'http://localhost:8000', AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'local', AWS_SECRET_ACCESS_KEY: 'local' } });
start(npm, process.platform === 'win32' ? ['/d','/s','/c','npm run dev --workspace frontend -- --host 0.0.0.0'] : ['run', 'dev', '--workspace', 'frontend', '--', '--host', '0.0.0.0'], { env: { ...process.env, VITE_AUTH_MODE: 'local', VITE_API_IDENTITY: 'http://localhost:4101', VITE_API_PORTFOLIO: 'http://localhost:4102', VITE_API_PROJECT: 'http://localhost:4103', VITE_API_RESOURCE: 'http://localhost:4104', VITE_API_BUDGET: 'http://localhost:4105', VITE_API_PRIORITY: 'http://localhost:4106' } });
console.log('CloudPortfolio local URLs: frontend http://localhost:5173, APIs http://localhost:4101..4106');
