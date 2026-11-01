import type { WriteOutcome } from '@festie/shared/utils';
import { useUndoableRemove as useSharedUndoableRemove } from '@festie/shared/hooks';
import { useToast } from '../../lib/toastContext';

/**
 * One-tap remove with Undo for crew lists (meeting points, packing, rides).
 * Thin web wrapper: the logic lives in the shared hook; this wires it to the
 * web toast host.
 */
export function useUndoableRemove(commit: (id: string) => Promise<WriteOutcome>, failMessage: string) {
  const { toast, toastUndo } = useToast();
  return useSharedUndoableRemove(commit, failMessage, {
    info: (m) => toast(m, 'info'),
    error: (m) => toast(m, 'error', 5000),
    undo: toastUndo,
  });
}
