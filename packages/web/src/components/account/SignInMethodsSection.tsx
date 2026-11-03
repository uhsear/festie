import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { PROVIDER_COPY } from '@festie/shared/constants';
import { PASSWORD_RULES } from '@festie/shared/utils';
import { validateNewPassword } from '@festie/shared/utils/authValidation';
import { mapErrorToUserMessage } from '@festie/shared/services/api';
import { withReauth } from '@festie/shared/services/admin';
import { getProviders, linkIdentity, setPassword, unlinkIdentity } from '@festie/shared/services/oauth';
import { useAuthStore } from '@festie/shared/stores/authStore';
import { useUIStore } from '@festie/shared/stores/uiStore';
import type { ProviderCredentialBody, ProviderName } from '@festie/shared/types';
import { useToast } from '../../lib/toastContext';
import { useIdentities } from '../../lib/useIdentities';
import { useReauthPrompt } from '../../lib/useReauthPrompt';
import ProviderButtons from '../auth/ProviderButtons';
import Button from '../ui/Button';
import Input from '../ui/Input';

/** Lists Password, Google and Apple with Link or Unlink, and lets a provider-only user set a password. */
export default function SignInMethodsSection() {
  const { toast } = useToast();
  const user = useAuthStore((s) => s.user);
  const offlineMode = useUIStore((s) => s.offlineMode);
  const { data, refetch } = useIdentities();
  const { data: cfg } = useQuery({ queryKey: ['auth', 'providers'], queryFn: getProviders, staleTime: 5 * 60_000 });
  const identities = data?.identities ?? [];
  const hasPassword = data?.hasPassword !== false;
  const { ask, reauthDialog } = useReauthPrompt({ hasPassword, linked: identities.map((i) => i.provider) });
  const [busy, setBusy] = useState(false);
  const [showSetPassword, setShowSetPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  if (!data) return null;

  // A provider the server does not offer stays hidden unless the user already linked it.
  const providers = (['google', 'apple'] as const).filter((p) => cfg?.[p] != null || identities.some((i) => i.provider === p));
  const methodCount = (hasPassword ? 1 : 0) + identities.length;
  const allLinked = providers.every((p) => identities.some((i) => i.provider === p));
  const errors = newPassword
    ? validateNewPassword(newPassword, confirmPassword, { username: user?.username, email: user?.email })
    : {};

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      const done = await withReauth(action, ask);
      if (done === null) return false;
      toast(success, 'success');
      await refetch();
      return true;
    } catch (err) {
      toast(mapErrorToUserMessage(err, 'That did not work. Try again.'), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const link = async (provider: ProviderName, body: ProviderCredentialBody) => {
    await run(() => linkIdentity(provider, body), PROVIDER_COPY.linked(PROVIDER_COPY.providerLabel[provider]));
  };

  const unlink = (provider: ProviderName) =>
    run(() => unlinkIdentity(provider), PROVIDER_COPY.unlinked(PROVIDER_COPY.providerLabel[provider]));

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || errors.password || errors.confirmPassword) return;
    const ok = await run(() => setPassword({ newPassword, confirmPassword }), 'Password set');
    if (ok) {
      setShowSetPassword(false);
      setNewPassword('');
      setConfirmPassword('');
    }
  };

  return (
    <section className="p-4 rounded-lg bg-bg-card border border-border space-y-3">
      <h3 className="text-sm font-semibold text-text-secondary flex items-center gap-2">
        <KeyRound className="w-4 h-4" aria-hidden="true" />
        {PROVIDER_COPY.methodsTitle}
      </h3>

      <ul className="space-y-2">
        <li className="flex items-center justify-between gap-3 min-h-11">
          <span className="text-sm text-text-primary">{PROVIDER_COPY.password}</span>
          {hasPassword ? (
            <span className="text-sm text-text-muted">Set</span>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              disabled={offlineMode || busy}
              onClick={() => setShowSetPassword((v) => !v)}
            >
              {PROVIDER_COPY.setPassword}
            </Button>
          )}
        </li>
        {providers.map((provider) => {
          const identity = identities.find((i) => i.provider === provider);
          const label = PROVIDER_COPY.providerLabel[provider];
          return (
            <li key={provider} className="flex items-center justify-between gap-3 min-h-11">
              <span className="min-w-0">
                <span className="block text-sm text-text-primary">{label}</span>
                {identity && (
                  <span className="block truncate text-xs text-text-muted">
                    {identity.isPrivateEmail ? PROVIDER_COPY.privateRelay : identity.email}
                  </span>
                )}
              </span>
              {identity ? (
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`${PROVIDER_COPY.unlink} ${label}`}
                  title={methodCount <= 1 ? PROVIDER_COPY.lastMethod : undefined}
                  disabled={offlineMode || busy || methodCount <= 1}
                  onClick={() => void unlink(provider)}
                >
                  {PROVIDER_COPY.unlink}
                </Button>
              ) : (
                <span className="text-sm text-text-muted">Not linked</span>
              )}
            </li>
          );
        })}
      </ul>

      {showSetPassword && !hasPassword && (
        <form onSubmit={submitPassword} className="space-y-3">
          <Input
            label="New password"
            type="password"
            isPassword
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password"
            autoComplete="new-password"
            error={errors.password}
          />
          <p className="text-sm text-text-muted">{PASSWORD_RULES}</p>
          <Input
            label="Confirm new password"
            type="password"
            isPassword
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
            autoComplete="new-password"
            error={confirmPassword ? errors.confirmPassword : undefined}
          />
          <Button
            type="submit"
            variant="primary"
            fullWidth
            isLoading={busy}
            disabled={offlineMode || !newPassword || !confirmPassword || Boolean(errors.password || errors.confirmPassword)}
            className="min-h-[44px]"
          >
            {PROVIDER_COPY.setPassword}
          </Button>
        </form>
      )}

      {!allLinked && (
        <ProviderButtons
          mode="link"
          only={providers.filter((p) => !identities.some((i) => i.provider === p))}
          onCredential={link}
        />
      )}
      {reauthDialog}
    </section>
  );
}
