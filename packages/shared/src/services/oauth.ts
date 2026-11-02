import { api } from './api';
import type {
  IdentitySummary,
  LinkedIdentity,
  ProviderCredentialBody,
  ProviderName,
  ProvidersConfig,
} from '../types/oauth';

export function getProviders(): Promise<ProvidersConfig> {
  return api.get<ProvidersConfig>('/auth/providers');
}

export async function getNonce(): Promise<string> {
  const res = await api.post<{ nonce: string }>('/auth/oauth/nonce', {});
  return res.nonce;
}

export function listIdentities(): Promise<IdentitySummary> {
  return api.get('/auth/identities');
}

export function linkIdentity(provider: ProviderName, body: ProviderCredentialBody): Promise<LinkedIdentity> {
  return api.post<LinkedIdentity>(`/auth/identities/${provider}`, body);
}

export function unlinkIdentity(provider: ProviderName): Promise<{ unlinked: ProviderName }> {
  return api.delete(`/auth/identities/${provider}`);
}

export function setPassword(body: { newPassword: string; confirmPassword: string }): Promise<{ success: true }> {
  return api.post('/auth/set-password', body);
}

/** Ordered provider buttons for a platform. Apple leads on iOS; Google needs Apple there (App Store 4.8). */
export function availableProviders(
  cfg: ProvidersConfig | null | undefined,
  platform: 'web' | 'ios' | 'android',
): ProviderName[] {
  if (!cfg) return [];
  const google = cfg.google != null;
  const apple = cfg.apple != null;
  if (platform === 'android') return google ? ['google'] : [];
  if (platform === 'ios') return apple ? (google ? ['apple', 'google'] : ['apple']) : [];
  const out: ProviderName[] = [];
  if (google) out.push('google');
  if (apple && cfg.apple?.servicesId) out.push('apple');
  return out;
}
