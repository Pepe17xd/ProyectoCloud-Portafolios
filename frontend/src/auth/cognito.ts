const env = import.meta.env;
let configurePromise: Promise<void> | undefined;

export function configureCognito() {
  if (!env.VITE_COGNITO_USER_POOL_ID || !env.VITE_COGNITO_CLIENT_ID) return Promise.resolve();
  configurePromise ??= import('aws-amplify').then(({ Amplify }) => {
    Amplify.configure({ Auth: { Cognito: {
      userPoolId: env.VITE_COGNITO_USER_POOL_ID,
      userPoolClientId: env.VITE_COGNITO_CLIENT_ID,
    } } });
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
export async function cognitoHasOrganization() {
  await configureCognito();
  const { fetchAuthSession } = await import('@aws-amplify/auth');
  const session = await fetchAuthSession();
  const payload = session.tokens?.idToken?.payload;
  return Boolean(payload?.['custom:tenantId'] && payload?.['custom:role']);
}
export async function provisionCognito(organizationName: string) {
  const token = await getCognitoIdToken();
  const base = env.VITE_API_IDENTITY;
  if (!token || !base) throw Error('No se pudo validar la sesión. Inicia sesión nuevamente.');
  const response = await fetch(`${base.replace(/\/$/, '')}/auth/provision`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationName }) });
  if (!response.ok) throw Error('No se pudo completar la organización. Vuelve a intentarlo.');
  const { fetchAuthSession } = await import('@aws-amplify/auth');
  await fetchAuthSession({ forceRefresh: true });
  if (!await cognitoHasOrganization()) throw Error('La sesión aún no contiene la organización. Vuelve a intentarlo.');
}
