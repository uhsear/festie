import React, { useCallback, useState } from 'react';
import { useBlocker } from '@tanstack/react-router';
import ConfirmDialog from '../components/ui/ConfirmDialog';

/**
 * Asks "Discard changes?" before the admin leaves a dirty editor. Router
 * navigation (sidebar tabs, Back to app, browser back) and tab close are
 * blocked through useBlocker; in-panel buttons go through confirmLeave.
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  const [pending, setPending] = useState<(() => void) | null>(null);
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  });

  const confirmLeave = useCallback(
    (action: () => void) => {
      if (!dirty) {
        action();
        return;
      }
      setPending(() => action);
    },
    [dirty],
  );

  const routerBlocked = blocker.status === 'blocked';
  const guardDialog = (
    <ConfirmDialog
      open={routerBlocked || pending !== null}
      onOpenChange={(open) => {
        if (open) return;
        if (routerBlocked) blocker.reset();
        setPending(null);
      }}
      title="Discard changes?"
      description="You have unsaved edits. Leaving now discards them."
      confirmLabel="Discard"
      destructive
      onConfirm={() => {
        if (routerBlocked) blocker.proceed();
        const action = pending;
        setPending(null);
        action?.();
      }}
    />
  );

  return { confirmLeave, guardDialog };
}
