import { useCallback, useState } from 'react';
import { QUEUED_WRITE_MESSAGE, UNDO_WINDOW_MS, scheduleUndoable, type WriteOutcome } from '@festie/shared/utils';
import { useToast } from '../../lib/toastContext';

/**
 * One-tap remove with Undo for crew lists (meeting points, packing, rides).
 * The row hides at once; the delete call waits out the shared undo window and
 * is never sent if the user taps Undo. A failed delete brings the row back.
 */
export function useUndoableRemove(commit: (id: string) => Promise<WriteOutcome>, failMessage: string) {
  const { toast, toastUndo } = useToast();
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() => new Set());

  const remove = useCallback(
    (id: string, label: string) => {
      const unhide = () =>
        setHiddenIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      setHiddenIds((prev) => new Set(prev).add(id));
      const action = scheduleUndoable(() => {
        commit(id)
          .then((outcome) => {
            if (outcome === 'queued') toast(QUEUED_WRITE_MESSAGE, 'info');
          })
          .catch((e: unknown) => {
            unhide();
            toast(e instanceof Error ? e.message : failMessage, 'error');
          });
      });
      toastUndo(
        `Removed ${label}`,
        () => {
          // The toast pauses on hover/focus but the delete timer does not.
          if (action.undo()) unhide();
          else toast(`Too late to undo: ${label} was already removed.`, 'info');
        },
        UNDO_WINDOW_MS,
      );
    },
    [commit, failMessage, toast, toastUndo],
  );

  return { hiddenIds, remove };
}
