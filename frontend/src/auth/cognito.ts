const env = import.meta.env;
let configurePromise: Promise<void> | undefined;

export function configureCognito() {
  if (!env.VITE_COGNITO_USER_POOL_ID || !env.VITE_COGNITO_CLIENT_ID) return Promise.resolve();
  configurePromise ??= import('aws-amplify').then(({ Amplify }) => {
    Amplify.configure({ Auth: { Cognito: { userPoolId: env.VITE_COGNITO_USER_POOL_ID, userPoolClientId: env.VITE_COGNITO_CLIENT_ID } } });
  });
  return configurePromise;
}

export async function getCurrentCognitoUser() {
  await configureCognito();
  const { getCurrentUser } = await import('@aws-amplify/auth');
  return getCurrentUser();
}

export async function getCognitoIdToken() {
  await configureCognito();
  const { fetchAuthSession } = await import('@aws-amplify/auth');
  const session = await fetchAuthSession();
  return session.tokens?.idToken?.toString();
}

export async function signInWithCognito(username: string, password: string) {
  await configureCognito();
  const { signIn } = await import('@aws-amplify/auth');
  return signIn({ username, password });
}

export async function confirmCognitoSignIn(challengeResponse: string) {
  await configureCognito();
  const { confirmSignIn } = await import('@aws-amplify/auth');
  return confirmSignIn({ challengeResponse });
}

export async function signOutFromCognito() {
  await configureCognito();
  const { signOut } = await import('@aws-amplify/auth');
  return signOut();
}

export async function registerCognito(email: string, password: string, name: string) {
  await configureCognito();
  const { signUp } = await import('@aws-amplify/auth');
  return signUp({ username: email, password, options: { userAttributes: { email, name } } });
}

export async function confirmCognito(email: string, code: string) {
  await configureCognito();
  const { confirmSignUp } = await import('@aws-amplify/auth');
  return confirmSignUp({ username: email, confirmationCode: code });
}

export async function resendCognito(email: string) {
  await configureCognito();
  const { resendSignUpCode } = await import('@aws-amplify/auth');
  return resendSignUpCode({ username: email });
}

export async function cognitoHasOrganization(forceRefresh = false) {
  await configureCognito();
  const { fetchAuthSession } = await import('@aws-amplify/auth');
  const session = await fetchAuthSession(forceRefresh ? { forceRefresh: true } : undefined);
  const payload = session.tokens?.idToken?.payload;
  return Boolean(payload?.['custom:tenantId'] && payload?.['custom:role']);
}

export async function provisionCognito(organizationName: string) {
  const token = await getCognitoIdToken();
  const base = env.VITE_API_IDENTITY;
  if (!token || !base) throw Error('Tu sesión no está activa. Inicia sesión para continuar.');
  let response: Response;
  try {
    response = await fetch(`${base.replace(/\/$/, '')}/auth/provision`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationName }),
    });
  } catch {
    throw Error('No pudimos conectar con el servicio de registro. Comprueba tu conexión y vuelve a intentarlo.');
  }
  if (!response.ok) {
    if (response.status === 401) throw Error('Tu sesión venció. Inicia sesión nuevamente y reintenta la configuración.');
    if (response.status === 400) throw Error('Revisa el nombre de la organización e inténtalo de nuevo.');
    if (response.status === 409) throw Error('Esta cuenta ya tiene una organización asociada. Inicia sesión para continuar.');
    if (response.status === 403) throw Error('No pudimos verificar que esta cuenta pueda crear la organización. Contacta al equipo administrador.');
    throw Error('Tuvimos un problema temporal al preparar la organización. Puedes reintentar sin crear otra cuenta.');
  }
}

export async function refreshProvisionedCognitoSession() {
  await configureCognito();
  const { fetchAuthSession } = await import('@aws-amplify/auth');
  let lastError = false;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fetchAuthSession({ forceRefresh: true });
      if (await cognitoHasOrganization()) return;
    } catch { lastError = true; }
    if (attempt < 4) await new Promise(resolve => window.setTimeout(resolve, 350 * (attempt + 1)));
  }
  throw Error(lastError
    ? 'La organización quedó preparada, pero no pudimos actualizar tus permisos. Cierra sesión e inicia sesión para continuar.'
    : 'La organización quedó preparada, pero la sesión aún no muestra sus permisos. Reintenta en un momento.');
}
