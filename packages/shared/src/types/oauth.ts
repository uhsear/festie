export type ProviderName = 'google' | 'apple';

export interface ProvidersConfig {
  google: { webClientId: string; iosClientId?: string | null } | null;
  apple: { servicesId?: string | null; redirectUri?: string | null } | null;
}

export interface LinkedIdentity {
  provider: ProviderName;
  email: string | null;
  isPrivateEmail: boolean;
  createdAt: string;
}

/** GET /auth/identities. `hasPassword === false` marks a provider-only account. */
export interface IdentitySummary {
  hasPassword: boolean;
  identities: LinkedIdentity[];
}

export interface ProviderCredentialBody {
  idToken: string;
  nonce?: string;
  authorizationCode?: string;
  redirectUri?: string;
  name?: { givenName?: string; familyName?: string };
}

export interface ProviderSignupPayload {
  status: 'needs-signup';
  signupToken: string;
  suggestedUsername: string;
  email: string | null;
  name: string | null;
}

export type ProviderSignInResult = { status: 'signed-in'; reactivated: boolean } | ProviderSignupPayload;

export interface ProviderSignupCompleteRequest {
  signupToken: string;
  username: string;
  dateOfBirth: string;
  tosAccepted: true;
}
