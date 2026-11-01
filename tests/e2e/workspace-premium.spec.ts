import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('cloudportfolio.accessToken', 'test-token'); localStorage.setItem('cloudportfolio.user', JSON.stringify({ email: 'test@example.test' })); });
  await page.route('**/mock-api/**', async route => {
    const url = route.request().url();
    if (url.endsWith('/budgets')) return route.fulfill({ status: 503, json: { error: 'Servicio no disponible' } });
    if (url.endsWith('/projects')) return route.fulfill({ json: { items: [{ sk: 'ITEM#p1', name: 'Proyecto de prueba', status: 'active' }], nextCursor: null } });
    return route.fulfill({ json: { items: [], nextCursor: null } });
  });
});
test('dashboard keeps available data and indicates an unavailable service', async ({ page }) => {
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Resumen ejecutivo' })).toBeVisible();
  await expect(page.getByText('Proyecto de prueba')).toBeVisible();
  await expect(page.getByText(/No se pudieron consultar:/)).toContainText('Presupuestos');
  await expect(page.getByText(/No se pudo consultar esta informaci/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Gestionar proyectos' }).click();
  await expect(page).toHaveURL(/\/app\/projects$/);
  await page.getByRole('button', { name: 'Nuevo registro' }).click();
  await expect(page.getByLabel('Nombre *')).toBeVisible();
});
test('mobile navigation opens and follows an operational route', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/app');
  const menu = page.locator('button[aria-controls=topbar-navigation]');
  await menu.click(); await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await page.screenshot({ path: test.info().outputPath('navegacion-movil.png') });
  await page.getByRole('button', { name: 'Proyectos', exact: true }).click();
  await page.getByRole('button', { name: 'Kanban' }).click(); await expect(page).toHaveURL(/\/app\/tasks$/);
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
});

test('desktop navigation exposes every group and closes on Escape', async ({ page }) => {
  await page.goto('/app');
  await expect(page.locator('.layout > aside')).toHaveCount(0);
  const group = page.getByRole('button', { name: 'Herramientas', exact: true });
  await group.click(); await expect(group).toHaveAttribute('aria-expanded', 'true');
  await page.screenshot({ path: test.info().outputPath('navegacion-escritorio.png') });
  await expect(page.getByRole('button', { name: 'Automatizaciones', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(group).toHaveAttribute('aria-expanded', 'false');
});

test('unauthenticated visitor is sent to sign in', async ({ browser }) => {
  const context = await browser.newContext(); const page = await context.newPage();
  await page.goto('/app'); await expect(page).toHaveURL(/\/login$/); await expect(page.getByRole('heading', { name: /Inicia sesi/ })).toBeVisible(); await context.close();
});

for (const [label, viewport] of [['escritorio', { width: 1440, height: 900 }], ['movil', { width: 390, height: 844 }]] as const) {
  test(`landing, dashboard and WhatsApp states at ${label}`, async ({ page, browser }) => {
    const publicContext = await browser.newContext({ viewport });
    const publicPage = await publicContext.newPage();
    await publicPage.goto('/');
    await expect(publicPage.getByRole('link', { name: /crear una organización/i })).toBeVisible();
    await publicPage.screenshot({ path: test.info().outputPath(`landing-${label}.png`), fullPage: true });
    await publicContext.close();
    await page.setViewportSize(viewport);
    await page.route('**/mock-api/identity/notifications/**', route => {
      const url = route.request().url();
      if (url.endsWith('/whatsapp')) return route.fulfill({ json: { status:'verified-test', providerAvailable:false, whatsappNumber:'+51987654321', consent:true, alertTypes:[], items:[] } });
      if (url.endsWith('/inbox')) return route.fulfill({ json: { items:[] } });
      return route.fulfill({ json: { enabled:false, alertTypes:[] } });
    });
    await page.goto('/app');
    await expect(page.getByRole('heading', { name:'Resumen ejecutivo' })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`dashboard-${label}.png`), fullPage: true });
    await page.goto('/app/notifications');
    await expect(page.getByText('Solo prueba local')).toBeVisible();
    await expect(page.getByText('No disponible', { exact:true })).toBeVisible();
    await expect(page.getByText('•••• 4321')).toBeVisible();
    await expect(page.getByText('WhatsApp conectado')).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath(`whatsapp-${label}.png`), fullPage: true });
  });
}
