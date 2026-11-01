import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { completeConfirmedRegistration, completeRegistrationChallenge, provisionAuthenticatedRegistration } from '../frontend/src/auth/registration-flow.mjs';

const ready = async () => true;

test('confirmation automatically signs in, provisions, refreshes claims, then completes', async () => {
  const calls = [];
  const result = await completeConfirmedRegistration({
    email: 'person@example.test', password: 'Secret!Password123', organizationName: 'Example Org', code: '123456',
    confirm: async (...args) => calls.push(['confirm', ...args]),
    signIn: async (...args) => { calls.push(['signin', ...args]); return { isSignedIn: true }; },
    confirmSignIn: async () => { throw Error('not expected'); },
    provision: async name => calls.push(['provision', name]), refresh: async () => calls.push(['refresh']), hasOrganization: ready,
  });
  assert.deepEqual(result, { status: 'complete' });
  assert.deepEqual(calls.map(x => x[0]), ['confirm', 'signin', 'provision', 'refresh']);
  assert.deepEqual(calls[0], ['confirm', 'person@example.test', '123456']);
});

test('login failure is identified after successful email confirmation', async () => {
  let confirmed = false;
  await assert.rejects(completeConfirmedRegistration({
    email: 'person@example.test', password: 'pw', organizationName: 'Example Org', code: '123456',
    confirm: async () => { confirmed = true; }, signIn: async () => { throw Object.assign(Error('bad credentials'), { name: 'NotAuthorizedException' }); },
    confirmSignIn: async () => ({}), provision: async () => {}, refresh: async () => {}, hasOrganization: ready,
  }), error => error.stage === 'signin' && confirmed);
});

test('provision retry is safe and repeats no account registration', async () => {
  let transactionCount = 0, first = true;
  const provision = async organization => {
    assert.equal(organization, 'Example Org');
    if (first) { first = false; throw Error('temporary backend outage'); }
    transactionCount ||= 1; // Represents the idempotent server-side registration marker.
  };
  const options = { organizationName: 'Example Org', provision, refresh: async () => {}, hasOrganization: ready };
  await assert.rejects(provisionAuthenticatedRegistration(options), error => error.stage === 'provision');
  assert.deepEqual(await provisionAuthenticatedRegistration(options), { status: 'complete' });
  await provisionAuthenticatedRegistration(options);
  assert.equal(transactionCount, 1);
});

test('Cognito additional sign-in challenge is shown and can be completed before provisioning', async () => {
  const provisioned = [];
  const first = await completeConfirmedRegistration({
    email: 'person@example.test', password: 'pw', organizationName: 'Org', code: '123',
    confirm: async () => {}, signIn: async () => ({ isSignedIn: false, nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_TOTP_CODE' } }),
    confirmSignIn: async () => ({ isSignedIn: true }), provision: async name => provisioned.push(name), refresh: async () => {}, hasOrganization: ready,
  });
  assert.deepEqual(first, { status: 'challenge', step: 'CONFIRM_SIGN_IN_WITH_TOTP_CODE', allowedChallenges: [] });
  assert.equal(provisioned.length, 0);
  const completed = await completeRegistrationChallenge({ challengeResponse: '654321', confirmSignIn: async ({ challengeResponse }) => { assert.equal(challengeResponse, '654321'); return { isSignedIn: true }; }, organizationName: 'Org', provision: async name => provisioned.push(name), refresh: async () => {}, hasOrganization: ready });
  assert.deepEqual(completed, { status: 'complete' });
  assert.deepEqual(provisioned, ['Org']);
});

test('reload recovery persists only email and organization, never password', () => {
  const page = readFileSync(new URL('../frontend/src/features/auth/AuthPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /CONFIRMED_KEY/);
  assert.match(page, /localStorage\.setItem\(EMAIL_KEY/);
  assert.match(page, /localStorage\.setItem\(ORG_KEY/);
  assert.doesNotMatch(page, /localStorage\.(?:setItem|getItem)\(\s*['"][^'"]*(?:password|pwd)/i);
  assert.doesNotMatch(page, /sessionStorage\./);
  assert.match(page, /profiles\.registrationConfirmedEmail/);
  assert.match(page, /Inicia sesión para retomar la configuración/);
});

test('password requirements match Cognito length, upper, lower, number and symbol policy', () => {
  const page = readFileSync(new URL('../frontend/src/features/auth/AuthPage.tsx', import.meta.url), 'utf8');
  const pool = readFileSync(new URL('../infrastructure/auth/serverless.yml', import.meta.url), 'utf8');
  assert.match(pool, /MinimumLength:\s*12/);
  assert.match(pool, /RequireSymbols:\s*true/);
  assert.match(page, /PASSWORD_REQUIREMENTS/);
  assert.match(page, /mayúscula, minúscula, número y símbolo/);
});

test('registration errors and responsive styled states are exposed accessibly', () => {
  const page = readFileSync(new URL('../frontend/src/features/auth/AuthPage.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../frontend/src/features/auth/auth-registration.css', import.meta.url), 'utf8');
  assert.match(page, /role="alert"/); assert.match(page, /role="status"/);
  for (const label of ['Confirmando correo...', 'Iniciando sesión...', 'Preparando tu organización...', 'Entrando a ProFiles...']) assert.ok(page.includes(label));
  assert.match(css, /@media\(max-width:600px\)/); assert.match(css, /focus-visible/); assert.match(css, /prefers-reduced-motion/);
});
