import React, { useCallback, useRef, useState } from 'react';
import { REAUTH_COPY, type ReauthBody } from '@festie/shared/services/admin';
import { PROVIDER_COPY } from '@festie/shared/constants';
import type { ProviderName } from '@festie/shared/types';
import PromptDialog from '../components/ui/PromptDialog';
import Dialog from '../components/ui/Dialog';
import ProviderButtons from '../components/auth/ProviderButtons';

type Answer = string | ReauthBody | null;

interface ReauthPromptOptions {
  /** False for a provider-only account: the dialog asks for a Google or Apple sign-in instead. */
  hasPassword?: boolean;
  /** Providers the user linked; names them in the dialog text. */
  linked?: ProviderName[];
}

/**
 * Re-auth prompt for `withReauth`. `ask()` resolves with the typed password, a
 * provider token body for a provider-only account, or `null` when the user cancels.
 * Render `reauthDialog` once. `askPassword` is the same function under its older name.
 */
export function useReauthPrompt({ hasPassword = true, linked }: ReauthPromptOptions = {}) {
  const [open, setOpen] = useState(false);
  const resolver = useRef<((value: Answer) => void) | null>(null);

  const settle = useCallback((value: Answer) => {
    resolver.current?.(value);
    resolver.current = null;
    setOpen(false);
  }, []);

  const ask = useCallback(
    () =>
      new Promise<Answer>((resolve) => {
        resolver.current?.(null);
        resolver.current = resolve;
        setOpen(true);
      }),
    [],
  );

  const onOpenChange = (next: boolean) => {
    if (!next) settle(null);
  };

  const label = (linked?.length ? linked : (['google', 'apple'] as const))
    .map((p) => PROVIDER_COPY.providerLabel[p])
    .join(' or ');

  const reauthDialog = hasPassword ? (
    <PromptDialog
      open={open}
      onOpenChange={onOpenChange}
      title={REAUTH_COPY.title}
      description={REAUTH_COPY.body}
      placeholder={REAUTH_COPY.label}
      confirmLabel={REAUTH_COPY.button}
      inputType="password"
      onConfirm={(value) => settle(value)}
    />
  ) : (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={REAUTH_COPY.title}
      description={PROVIDER_COPY.reauthProviderBody(label)}
    >
      <ProviderButtons
        mode="reauth"
        only={linked}
        onCredential={(provider, { idToken, nonce, authorizationCode }) =>
          settle({
            provider,
            idToken,
            ...(nonce ? { nonce } : {}),
            ...(authorizationCode ? { authorizationCode } : {}),
          })
        }
      />
    </Dialog>
  );

  return { ask, askPassword: ask, reauthDialog };
}
