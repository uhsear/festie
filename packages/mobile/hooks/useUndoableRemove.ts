import { useUIStore } from '@festie/shared/stores';
import { useUndoableRemove as useSharedUndoableRemove, type UndoNotifier } from '@festie/shared/hooks';
import type { WriteOutcome } from '@festie/shared/utils';

// Mobile adapter: the shared hook owns the logic, toasts go to the uiStore list
// that <Toaster /> renders.
const notifier: UndoNotifier = {
  info: (m) => void useUIStore.getState().showToast(m, { kind: 'info' }),
  error: (m) => void useUIStore.getState().showToast(m, { kind: 'error', durationMs: 5000 }),
  undo: (m, onUndo, durationMs) => void useUIStore.getState().showToast(m, { kind: 'info', durationMs, onUndo }),
};

export function useUndoableRemove(commit: (id: string) => Promise<WriteOutcome>, failMessage: string) {
  return useSharedUndoableRemove(commit, failMessage, notifier);
}
