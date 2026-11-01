function stageError(stage, cause) {
  const error = new Error(cause instanceof Error ? cause.message : String(cause || ''));
  error.stage = stage;
  error.cause = cause;
  if (cause instanceof Error && cause.name) error.name = cause.name;
  return error;
}

async function provisionAndRefresh({ organizationName, provision, refresh, hasOrganization }) {
  try { await provision(organizationName); } catch (error) { throw stageError('provision', error); }
  try {
    await refresh();
    if (!await hasOrganization()) throw new Error('La sesión todavía no muestra tu organización.');
  } catch (error) { throw stageError('refresh', error); }
  return { status: 'complete' };
}

export async function provisionAuthenticatedRegistration(options) {
  return provisionAndRefresh(options);
}

async function continueSignIn({ signInResult, challengeResponse, confirmSignIn, ...rest }) {
  let result = signInResult;
  if (challengeResponse !== undefined) {
    try { result = await confirmSignIn({ challengeResponse }); }
    catch (error) { throw stageError('challenge', error); }
  }
  if (!result?.isSignedIn) {
    return { status: 'challenge', step: result?.nextStep?.signInStep || 'UNKNOWN', allowedChallenges: result?.nextStep?.allowedMFATypes || [] };
  }
  return provisionAndRefresh(rest);
}

export async function completeConfirmedRegistration({ email, password, organizationName, code, confirm, signIn, confirmSignIn, provision, refresh, hasOrganization }) {
  try { await confirm(email, code); } catch (error) { throw stageError('confirmation', error); }
  let signInResult;
  try { signInResult = await signIn(email, password); } catch (error) { throw stageError('signin', error); }
  return continueSignIn({ signInResult, confirmSignIn, organizationName, provision, refresh, hasOrganization });
}

export async function completeRegistrationChallenge({ challengeResponse, confirmSignIn, organizationName, provision, refresh, hasOrganization }) {
  return continueSignIn({ challengeResponse, confirmSignIn, organizationName, provision, refresh, hasOrganization });
}
