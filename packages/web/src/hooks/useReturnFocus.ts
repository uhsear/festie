import { useRef } from 'react';

/**
 * Focus return for Radix-based dialogs opened without a Radix Trigger.
 * Radix's modal Content cancels its own focus restore and focuses
 * `triggerRef`, which is null when the dialog is controlled, so focus fell to
 * `body`. Pass these to the Content: they remember what had focus on open
 * and restore it on close, or leave focus on `body` if that element is gone.
 * `fallback` finds a replacement when the opener is gone or was just `body`.
 */
export function useReturnFocus(fallback?: () => HTMLElement | null) {
  const returnTo = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      const active = document.activeElement;
      returnTo.current = active instanceof HTMLElement && active !== document.body ? active : null;
    },
    onCloseAutoFocus: (event: Event) => {
      event.preventDefault();
      const el = returnTo.current;
      returnTo.current = null;
      (el?.isConnected ? el : fallback?.())?.focus();
    },
  };
}
