export type RegistrationFlowResult = { status: 'complete' } | { status: 'challenge'; step: string; allowedChallenges: string[] };
export function completeConfirmedRegistration(options: {
  email: string; password: string; organizationName: string; code: string;
  confirm: (email: string, code: string) => Promise<unknown>;
  signIn: (email: string, password: string) => Promise<any>;
  confirmSignIn: (options: { challengeResponse: string }) => Promise<any>;
  provision: (organizationName: string) => Promise<unknown>;
  refresh: () => Promise<unknown>; hasOrganization: () => Promise<boolean>;
}): Promise<RegistrationFlowResult>;
export function completeRegistrationChallenge(options: {
  challengeResponse: string; confirmSignIn: (options: { challengeResponse: string }) => Promise<any>;
  organizationName: string; provision: (organizationName: string) => Promise<unknown>;
  refresh: () => Promise<unknown>; hasOrganization: () => Promise<boolean>;
}): Promise<RegistrationFlowResult>;
export function provisionAuthenticatedRegistration(options: {
  organizationName: string; provision: (organizationName: string) => Promise<unknown>;
  refresh: () => Promise<unknown>; hasOrganization: () => Promise<boolean>;
}): Promise<{ status: 'complete' }>;
