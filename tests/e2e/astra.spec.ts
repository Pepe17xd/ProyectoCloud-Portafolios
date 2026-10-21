import { test, expect } from '@playwright/test';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
let reminderId = '';
let reportId = '';
let actionProjectId = '';
const apiIdentity = process.env.E2E_IDENTITY_API || 'http://localhost:4101';
const apiProject = process.env.E2E_PROJECT_API || 'http://localhost:4103';
const remindersDb = DynamoDBDocumentClient.from(new DynamoDBClient({ endpoint: process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000', region: 'us-east-1', credentials: { accessKeyId: 'local', secretAccessKey: 'local' } }));
test.afterAll(() => remindersDb.destroy());

async function login(page: import('@playwright/test').Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.locator('#auth-password').fill('Demo123!');
  await page.getByRole('button', { name: /iniciar sesión/i }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function apiCall(page: import('@playwright/test').Page, url: string, method: string, token: string | null, data?: unknown) {
  try {
    return await page.request.fetch(url, { method, headers: token ? { Authorization: `Bearer ${token}` } : {}, data });
  } catch (error) {
    const route = new URL(url).pathname;
    throw new Error(`Local API request failed for ${method} ${route}: ${error instanceof Error ? error.name : 'network error'}`);
  }
}

test('landing, navegación pública, auth, asistente y notificaciones locales', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /De la visión a la ejecución/i })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Iniciar sesión' }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Registrarse' }).first().click();
  await expect(page.getByText('Registro no disponible todavía')).toBeVisible();
  await page.goto('/app');
  await expect(page.getByLabel('Correo electrónico')).toBeVisible();
  await page.getByLabel('Correo electrónico').fill('admin-a@demo.local');
  await page.locator('#auth-password').fill('incorrecta');
  await page.getByRole('button', { name: /iniciar sesión/i }).click();
  await expect(page.getByRole('alert')).toContainText(/incorrectos/i);
  await login(page, 'admin-a@demo.local');

  const token = await page.evaluate(() => localStorage.getItem('cloudportfolio.accessToken'));
  expect(token).toBeTruthy();
  const intelligence = await apiCall(page, `${apiProject}/intelligence/ask`, 'POST', token, { question: '¿Qué proyectos están atrasados?' });
  const intelligenceBody = await intelligence.json();
  expect(intelligence.status(), JSON.stringify(intelligenceBody)).toBe(200);
  expect(intelligenceBody.mode).toBe('deterministic-local-rules');
  const taskAnswer = await apiCall(page, `${apiProject}/intelligence/ask`, 'POST', token, { question: '¿Qué tareas debería revisar hoy?', tenantId: 'tenant-b' });
  expect(taskAnswer.status()).toBe(200);
  expect((await taskAnswer.json()).scope.domains).toContain('tasks');
  await expect(page.getByRole('heading', { name: 'Inteligencia ASTRA' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Centro de notificaciones' })).toBeVisible();

  const proposal = await apiCall(page, `${apiIdentity}/intelligence/proposals`, 'POST', token, { text: 'Recuérdame revisar el presupuesto mañana a las 09:00', timezone: 'America/Lima' });
  expect(proposal.status()).toBe(201);
  const proposalBody = await proposal.json();
  expect(proposalBody.confirmationRequired).toBe(true);
  const operationId = crypto.randomUUID();
  const confirmedReminder = await apiCall(page, `${apiIdentity}/intelligence/actions/${proposalBody.proposal.id}/confirm`, 'POST', token, { operationId });
  expect(confirmedReminder.status()).toBe(201);
  const reminder = (await confirmedReminder.json()).reminder;
  reminderId = reminder.id;
  expect(reminder.status).toBe('SCHEDULED');
  const replay = await apiCall(page, `${apiIdentity}/intelligence/actions/${proposalBody.proposal.id}/confirm`, 'POST', token, { operationId });
  expect(replay.status()).toBe(200);
  expect((await replay.json()).idempotentReplay).toBe(true);
  const reminderList = await apiCall(page, `${apiIdentity}/reminders`, 'GET', token);
  expect((await reminderList.json()).items.some((item: any) => item.id === reminder.id)).toBeTruthy();
  const dueAt = new Date(Date.now() - 60_000).toISOString();
  await remindersDb.send(new UpdateCommand({ TableName: 'cloudportfolio-reminders-local', Key: { pk: 'TENANT#tenant-a', sk: `REMINDER#demo-admin-a#${reminder.id}` }, UpdateExpression: 'SET dueAt = :dueAt, gsi1sk = :dueKey', ExpressionAttributeValues: { ':dueAt': dueAt, ':dueKey': `${dueAt}#${reminder.id}` } }));
  let deliveryVisible = false; let deliveredReminder: any; let oneShotComplete = false;
  for (let attempt = 0; attempt < 40 && !(deliveryVisible && oneShotComplete); attempt++) {
    await page.waitForTimeout(500);
    const [mailboxResponse, reminderResponse] = await Promise.all([apiCall(page, `${apiIdentity}/notifications/inbox`, 'GET', token), apiCall(page, `${apiIdentity}/reminders`, 'GET', token)]);
    const mailbox = await mailboxResponse.json(); const listed = await reminderResponse.json();
    deliveryVisible = mailbox.items.some((item: any) => item.reminderId === reminder.id && item.deliveryStatus === 'SIMULATED_LOCAL');
    deliveredReminder = listed.items.find((item: any) => item.id === reminder.id);
    oneShotComplete = deliveredReminder?.status === 'COMPLETED';
  }
  expect(deliveryVisible).toBeTruthy();
  expect(deliveredReminder.status).toBe('COMPLETED');
  const recurringIds: Record<string,string> = {};
  for (const recurrence of ['DAILY','WEEKLY']) {
    const recurringProposalResponse = await apiCall(page, `${apiIdentity}/intelligence/proposals`, 'POST', token, { text: `Recuérdame revisar el presupuesto mañana a las 09:00`, timezone: 'America/Lima', recurrence });
    expect(recurringProposalResponse.status()).toBe(201);
    const recurringProposal = (await recurringProposalResponse.json()).proposal;
    const recurringOperationId = crypto.randomUUID();
    const recurringCreate = await apiCall(page, `${apiIdentity}/intelligence/actions/${recurringProposal.id}/confirm`, 'POST', token, { operationId: recurringOperationId });
    expect(recurringCreate.status()).toBe(201);
    const recurringReminder = (await recurringCreate.json()).reminder;
    recurringIds[recurrence] = recurringReminder.id;
    const overdueAt = new Date(Date.now() - 60_000).toISOString();
    await remindersDb.send(new UpdateCommand({ TableName: 'cloudportfolio-reminders-local', Key: { pk: 'TENANT#tenant-a', sk: `REMINDER#demo-admin-a#${recurringReminder.id}` }, UpdateExpression: 'SET dueAt = :dueAt, gsi1sk = :dueKey', ExpressionAttributeValues: { ':dueAt': overdueAt, ':dueKey': `${overdueAt}#${recurringReminder.id}` } }));
  }
  let dailyNext: any; let weeklyNext: any; let recurringDelivered = false; let recurringRescheduled = false;
  for (let attempt = 0; attempt < 40 && !recurringRescheduled; attempt++) {
    await page.waitForTimeout(500);
    const [mailboxResponse, reminderResponse] = await Promise.all([apiCall(page, `${apiIdentity}/notifications/inbox`, 'GET', token), apiCall(page, `${apiIdentity}/reminders`, 'GET', token)]);
    const mailbox = await mailboxResponse.json(); const listed = await reminderResponse.json();
    dailyNext = listed.items.find((item: any) => item.id === recurringIds.DAILY);
    weeklyNext = listed.items.find((item: any) => item.id === recurringIds.WEEKLY);
    recurringDelivered = ['DAILY','WEEKLY'].every((key) => mailbox.items.some((item: any) => item.reminderId === recurringIds[key] && item.deliveryStatus === 'SIMULATED_LOCAL'));
    recurringRescheduled = recurringDelivered && dailyNext?.status === 'SCHEDULED' && weeklyNext?.status === 'SCHEDULED' && Date.parse(dailyNext.dueAt) > Date.now() + 22 * 60 * 60 * 1000 && Date.parse(weeklyNext.dueAt) > Date.now() + 6 * 24 * 60 * 60 * 1000;
  }
  expect(recurringDelivered).toBeTruthy();
  expect(dailyNext.status).toBe('SCHEDULED');
  expect(Date.parse(dailyNext.dueAt)).toBeGreaterThan(Date.now() + 22 * 60 * 60 * 1000);
  expect(weeklyNext.status).toBe('SCHEDULED');
  expect(Date.parse(weeklyNext.dueAt)).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
  const badProposal = await apiCall(page, `${apiIdentity}/intelligence/proposals`, 'POST', token, { text: 'Hazlo pronto, sorpréndeme' });
  expect(badProposal.status()).toBe(422);

  const actionProjectResponse = await apiCall(page, `${apiProject}/projects`, 'POST', token, { name: `E2E action project ${suffix}` });
  expect(actionProjectResponse.status()).toBe(201);
  actionProjectId = (await actionProjectResponse.json()).id;
  const taskProposalResponse = await apiCall(page, `${apiIdentity}/intelligence/proposals`, 'POST', token, { text: `Crear tarea "Preparar cronograma ${suffix}" en proyecto ${actionProjectId}` });
  expect(taskProposalResponse.status()).toBe(201);
  const taskProposal = (await taskProposalResponse.json()).proposal;
  expect(taskProposal.kind).toBe('TASK_CREATE');
  const taskOperationId = crypto.randomUUID();
  const taskAction = await apiCall(page, `${apiIdentity}/intelligence/actions/${taskProposal.id}/confirm`, 'POST', token, { operationId: taskOperationId });
  expect(taskAction.status()).toBe(201);
  const createdTask = (await taskAction.json()).task;
  expect(createdTask.projectId).toBe(actionProjectId);
  const taskReplay = await apiCall(page, `${apiIdentity}/intelligence/actions/${taskProposal.id}/confirm`, 'POST', token, { operationId: taskOperationId });
  expect(taskReplay.status()).toBe(200);
  expect((await taskReplay.json()).idempotentReplay).toBe(true);

  const generatedReport = await apiCall(page, `${apiProject}/intelligence/reports`, 'POST', token, { type: 'project-progress' });
  expect(generatedReport.status()).toBe(201);
  const report = (await generatedReport.json()).report;
  reportId = report.id;
  expect(report.csv).toContain('projectId');
  expect(report.tenantId).toBe('tenant-a');
  const reportList = await apiCall(page, `${apiProject}/intelligence/reports`, 'GET', token);
  expect((await reportList.json()).items.some((item: any) => item.id === report.id)).toBeTruthy();

  await page.locator('#reminder-prompt').fill('Recuérdame revisar el cronograma mañana a las 10:00');
  await page.getByRole('button', { name: 'Proponer' }).click();
  await expect(page.getByText(/Propuesta pendiente de confirmación/)).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar y programar' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Recordatorio persistido/ })).toBeVisible();
  const csvDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Generar CSV' }).click();
  expect((await csvDownload).suggestedFilename()).toMatch(/^astra-project-progress-.+\.csv$/);

  const prefs = await apiCall(page, `${apiIdentity}/notifications/preferences`, 'PUT', token, { enabled: true, timezone: 'America/Lima', allowedHours: { start: '00:00', end: '23:59' }, frequency: 'immediate', alertTypes: ['ProjectCreated'] });
  expect(prefs.ok()).toBeTruthy();
  const start = await apiCall(page, `${apiIdentity}/notifications/whatsapp/verification`, 'POST', token, { phoneNumber: '+15555550123', consent: true });
  expect(start.status()).toBe(202);
  expect((await start.json()).message).toMatch(/no se envió a WhatsApp/i);
  const localCode = await apiCall(page, `${apiIdentity}/notifications/verification-inbox`, 'GET', token);
  const confirmed = await apiCall(page, `${apiIdentity}/notifications/whatsapp/confirm`, 'POST', token, { code: (await localCode.json()).code });
  expect(confirmed.ok()).toBeTruthy();

  const createdEventSource = await apiCall(page, `${apiProject}/projects`, 'POST', token, { name: `E2E notification ${suffix}` });
  expect(createdEventSource.status()).toBe(201);
  const createdProject = await createdEventSource.json();
  let inbox: any = { items: [] };
  for (let attempt = 0; attempt < 20 && !inbox.items.some((item: any) => item.projectId === createdProject.id); attempt++) {
    await page.waitForTimeout(250);
    const response = await apiCall(page, `${apiIdentity}/notifications/inbox`, 'GET', token);
    inbox = await response.json();
  }
  expect(inbox.items.some((item: any) => item.projectId === createdProject.id && item.notice.includes('No enviado a WhatsApp'))).toBeTruthy();
  await apiCall(page, `${apiIdentity}/notifications/whatsapp/number`, 'DELETE', token);
  await apiCall(page, `${apiIdentity}/notifications/preferences`, 'PUT', token, { enabled: false, timezone: 'America/Lima', allowedHours: { start: '00:00', end: '23:59' }, frequency: 'immediate', alertTypes: ['ProjectCreated'] });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Abrir menú' })).toBeVisible();
  const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }));
  expect(widths.page).toBeLessThanOrEqual(widths.viewport + 1);
});

test('project API mantiene aislamiento entre tenant A y B', async ({ page }) => {
  await login(page, 'admin-a@demo.local');
  const tokenA = await page.evaluate(() => localStorage.getItem('cloudportfolio.accessToken'));
  const created = await apiCall(page, `${apiProject}/projects`, 'POST', tokenA, { name: `E2E isolation ${suffix}` });
  expect(created.status()).toBe(201);
  const project = await created.json();
  const fileText = `ASTRA local E2E ${suffix}`;
  const document = await apiCall(page, `${apiProject}/documents`, 'POST', tokenA, { projectId: project.id, fileName: `e2e-${suffix}.txt`, contentType: 'text/plain', contentLength: Buffer.byteLength(fileText) });
  expect(document.status()).toBe(201);
  const documentResult = await document.json();
  const uploaded = await page.request.put(documentResult.uploadUrl, { headers: { 'Content-Type': 'text/plain' }, data: fileText });
  expect(uploaded.ok()).toBeTruthy();
  const download = await apiCall(page, `${apiProject}/documents/${documentResult.document.id}`, 'GET', tokenA);
  expect(download.ok()).toBeTruthy();
  const downloadUrl = (await download.json()).downloadUrl;
  expect(await (await page.request.get(downloadUrl)).text()).toBe(fileText);
  await page.getByRole('button', { name: /cerrar sesión/i }).click();
  await login(page, 'admin-b@demo.local');
  const tokenB = await page.evaluate(() => localStorage.getItem('cloudportfolio.accessToken'));
  const tenantBPreferences = await apiCall(page, `${apiIdentity}/notifications/preferences`, 'GET', tokenB);
  expect(tenantBPreferences.status()).toBe(200);
  expect((await tenantBPreferences.json()).whatsappNumber).toBeUndefined();
  const tenantBReminders = await apiCall(page, `${apiIdentity}/reminders`, 'GET', tokenB);
  expect((await tenantBReminders.json()).items.some((item: any) => item.id === reminderId)).toBeFalsy();
  const tenantBReport = await apiCall(page, `${apiProject}/intelligence/reports/${reportId}`, 'GET', tokenB);
  expect(tenantBReport.status()).toBe(404);
  const hidden = await apiCall(page, `${apiProject}/projects/${project.id}`, 'GET', tokenB);
  expect(hidden.status()).toBe(404);
  await page.getByRole('button', { name: /cerrar sesión/i }).click();
  await login(page, 'manager-a@demo.local');
  const managerToken = await page.evaluate(() => localStorage.getItem('cloudportfolio.accessToken'));
  const managerCreate = await apiCall(page, `${apiProject}/projects`, 'POST', managerToken, { name: `E2E manager ${suffix}` });
  expect(managerCreate.status()).toBe(201);
  await page.getByRole('button', { name: /cerrar sesión/i }).click();
  await login(page, 'viewer-a@demo.local');
  const viewerToken = await page.evaluate(() => localStorage.getItem('cloudportfolio.accessToken'));
  const viewerWrite = await apiCall(page, `${apiProject}/projects`, 'POST', viewerToken, { name: `E2E viewer denied ${suffix}` });
  expect(viewerWrite.status()).toBe(403);
  const viewerTaskProposal = await apiCall(page, `${apiIdentity}/intelligence/proposals`, 'POST', viewerToken, { text: `Crear tarea "No autorizada" en proyecto ${project.id}` });
  expect(viewerTaskProposal.status()).toBe(403);
  const viewerReport = await apiCall(page, `${apiProject}/intelligence/reports`, 'POST', viewerToken, { type: 'project-progress' });
  expect(viewerReport.status()).toBe(403);
});
