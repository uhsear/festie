import { useMemo } from 'react';
import type { UndoNotifier } from '@festie/shared/hooks';
import { useToast } from './toastContext';

/** Web toast adapter for the shared undo hooks (usePickClear, useBulkAddPicks). */
export function useUndoNotifier(): UndoNotifier {
  const { toast, toastUndo } = useToast();
  return useMemo(
    () => ({
      info: (m) => toast(m, 'info'),
      error: (m) => toast(m, 'error', 5000),
      undo: (m, onUndo, d) => toastUndo(m, onUndo, d),
    }),
    [toast, toastUndo],
  );
}
