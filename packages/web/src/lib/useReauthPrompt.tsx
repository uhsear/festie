import React, { useCallback, useRef, useState } from 'react';
import { REAUTH_COPY } from '@festie/shared/services/admin';
import PromptDialog from '../components/ui/PromptDialog';

/**
 * Password prompt for `withReauth`. `askPassword()` resolves with the typed
 * password, or `null` when the admin cancels. Render `reauthDialog` once.
 */
export function useReauthPrompt() {
  const [open, setOpen] = useState(false);
  const resolver = useRef<((value: string | null) => void) | null>(null);

  const settle = useCallback((value: string | null) => {
    resolver.current?.(value);
    resolver.current = null;
    setOpen(false);
  }, []);

  const askPassword = useCallback(
    () =>
      new Promise<string | null>((resolve) => {
        resolver.current?.(null);
        resolver.current = resolve;
        setOpen(true);
      }),
    [],
  );

  const reauthDialog = (
    <PromptDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) settle(null);
      }}
      title={REAUTH_COPY.title}
      description={REAUTH_COPY.body}
      placeholder={REAUTH_COPY.label}
      confirmLabel={REAUTH_COPY.button}
      inputType="password"
      onConfirm={(value) => settle(value)}
    />
  );

  return { askPassword, reauthDialog };
}
