import { useUIStore } from '@festie/shared/stores';
import type { UndoNotifier } from '@festie/shared/hooks';

/** Mobile toast adapter for the shared undo hooks. Reads the store lazily, so it needs no hook. */
export const undoNotifier: UndoNotifier = {
  info: (m) => useUIStore.getState().showToast(m, { kind: 'info' }),
  error: (m) => useUIStore.getState().showToast(m, { kind: 'error', durationMs: 5000 }),
  undo: (m, onUndo, d) => useUIStore.getState().showToast(m, { kind: 'info', durationMs: d, onUndo }),
};
