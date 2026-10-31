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
