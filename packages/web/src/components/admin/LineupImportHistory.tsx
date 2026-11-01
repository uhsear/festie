import React, { useCallback, useEffect, useState } from 'react';
import { lineupImportApi } from '@festie/shared/services/lineupImport';
import type { LineupImportHistoryItem, LineupImportUndoResult } from '@festie/shared/utils/lineupImport';
import { useToast } from '../../lib/toastContext';
import ConfirmDialog from '../ui/ConfirmDialog';

interface Props {
  festivalId: string;
  festivalName: string;
  /** Change this value to reload history and the announcement count. */
  refreshKey?: number;
}

const KEPT_REASON = { picked: 'picked by someone', edited: 'edited since the import' } as const;

const buttonClass =
  'px-3 py-1.5 rounded-md bg-accent-aqua/20 text-accent-aqua hover:bg-accent-aqua/30 disabled:opacity-50 transition-colors text-sm font-medium';

export default function LineupImportHistory({ festivalId, festivalName, refreshKey = 0 }: Props) {
  const [imports, setImports] = useState<LineupImportHistoryItem[]>([]);
  const [recipients, setRecipients] = useState<number | null>(null);
  const [undoTarget, setUndoTarget] = useState<LineupImportHistoryItem | null>(null);
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastUndo, setLastUndo] = useState<LineupImportUndoResult | null>(null);
  const { toast, toastError } = useToast();

  const reload = useCallback(async () => {
    try {
      const [history, announcement] = await Promise.all([
        lineupImportApi.history(festivalId),
        lineupImportApi.announcement(festivalId),
      ]);
      setImports(history.imports);
      setRecipients(announcement.recipients);
    } catch (err: unknown) {
      toastError(err, "Couldn't load import history. Try again.");
    }
  }, [festivalId, toastError]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  const doUndo = async () => {
    if (!undoTarget) return;
    setBusy(true);
    try {
      const result = await lineupImportApi.undo(festivalId, undoTarget.id);
      const stayed = result.kept.length ? ` ${result.kept.length} sets stayed.` : '';
      toast(`Import undone. Removed ${result.removed} sets and restored ${result.restored}.${stayed}`, 'success');
      setLastUndo(result);
      setUndoTarget(null);
      await reload();
    } catch (err: unknown) {
      setUndoTarget(null);
      toastError(err, "Couldn't undo the import. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const doAnnounce = async () => {
    setBusy(true);
    try {
      const result = await lineupImportApi.announce(festivalId);
      toast(`Announcement queued for ${result.recipients} people.`, 'success');
      setAnnounceOpen(false);
      await reload();
    } catch (err: unknown) {
      setAnnounceOpen(false);
      toastError(err, "Couldn't send the announcement. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      <section>
        <h3 className="type-heading text-text-primary mb-3">Import history</h3>
        {imports.length === 0 ? (
          <p className="text-sm text-text-muted">No imports yet.</p>
        ) : (
          <ul className="space-y-2">
            {imports.map((item) => (
              <li
                key={item.id}
                className="bg-bg-card/60 border border-glass-border rounded-lg p-3 flex items-center justify-between gap-3"
              >
                <div className="text-sm">
                  <p className="text-text-primary">
                    {new Date(item.createdAt).toLocaleString()}
                    {item.createdBy ? ` by ${item.createdBy}` : ''}
                  </p>
                  <p className="text-text-muted">
                    Added {item.counts.created} · Updated {item.counts.updated} · {item.counts.newStages} stages ·{' '}
                    {item.counts.newDays} days
                  </p>
                  {item.undoneAt && (
                    <p className="text-text-muted">Undone {new Date(item.undoneAt).toLocaleDateString()}</p>
                  )}
                </div>
                {item.canUndo && (
                  <button type="button" className={buttonClass} onClick={() => setUndoTarget(item)}>
                    Undo import
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {lastUndo && lastUndo.kept.length > 0 && (
          <ul className="mt-3 text-sm text-text-muted space-y-1">
            {lastUndo.kept.map((k) => (
              <li key={k.setId}>
                {k.artist}: {KEPT_REASON[k.reason]}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="type-heading text-text-primary mb-3">Announce lineup</h3>
        <p className="text-sm text-text-muted mb-3">
          Send a push and an email to people who went to an earlier edition of {festivalName}. Editions match when the
          name is the same apart from the year.
        </p>
        <button
          type="button"
          className={buttonClass}
          disabled={!recipients || busy}
          onClick={() => setAnnounceOpen(true)}
        >
          {`Announce to ${recipients ?? 0} people`}
        </button>
        {recipients === 0 && <p className="text-sm text-text-muted mt-2">No one to notify right now.</p>}
      </section>

      <ConfirmDialog
        open={!!undoTarget}
        onOpenChange={(o) => !o && setUndoTarget(null)}
        title="Undo this import?"
        description="This removes the sets it added and puts back the sets it changed. Sets that people picked, or that someone edited after the import, stay."
        confirmLabel="Undo import"
        destructive
        busy={busy}
        onConfirm={doUndo}
      />
      <ConfirmDialog
        open={announceOpen}
        onOpenChange={setAnnounceOpen}
        title="Announce the lineup?"
        description={`This sends one push and one email to ${recipients ?? 0} people. Each person gets it once for this festival.`}
        confirmLabel="Send"
        busy={busy}
        onConfirm={doAnnounce}
      />
    </div>
  );
}
