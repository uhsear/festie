import { useCallback, useRef, useState } from 'react';
import { QUEUED_WRITE_MESSAGE, UNDO_WINDOW_MS, scheduleUndoable, type WriteOutcome } from '../utils/crewWrites';
import { mapErrorToUserMessage } from '../services/errors';

/** Platform toast adapter: web wraps useToast(), mobile wraps uiStore.showToast. */
export interface UndoNotifier {
  info: (message: string) => void;
  error: (message: string) => void;
  undo: (message: string, onUndo: () => void, durationMs: number) => void;
}

/**
 * One-tap remove with Undo for crew lists (meeting points, packing, rides).
 * The row hides at once; the delete call waits out the shared undo window and
 * is never sent if the user taps Undo. A failed delete brings the row back.
 */
export function useUndoableRemove(
  commit: (id: string) => Promise<WriteOutcome>,
  failMessage: string,
  notify: UndoNotifier,
): { hiddenIds: ReadonlySet<string>; remove: (id: string, label: string) => void } {
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() => new Set());
  // Held in a ref so callers need not memoise their notifier.
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

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
            if (outcome === 'queued') notifyRef.current.info(QUEUED_WRITE_MESSAGE);
          })
          .catch((e: unknown) => {
            unhide();
            notifyRef.current.error(mapErrorToUserMessage(e, failMessage));
          });
      });
      notifyRef.current.undo(
        `Removed ${label}`,
        () => {
          // The toast pauses on hover/focus but the delete timer does not.
          if (action.undo()) unhide();
          else notifyRef.current.info(`Too late to undo: ${label} was already removed.`);
        },
        UNDO_WINDOW_MS,
      );
    },
    [commit, failMessage],
  );

  return { hiddenIds, remove };
}
