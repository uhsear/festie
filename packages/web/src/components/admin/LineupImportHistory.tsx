import React, { useCallback, useEffect, useState } from 'react';
import { lineupImportApi } from '@festie/shared/services/lineupImport';
import { undoReleaseWarning, type TimeReleasePanelData } from '@festie/shared/utils/timeReleases';
import {
  announcementEmailNote,
  daysAnnouncementSummary,
  type DaysAnnouncementCount,
  type LineupAnnouncementCount,
  type LineupImportHistoryItem,
  type LineupImportUndoResult,
  lineupAudienceSummary,
} from '@festie/shared/utils/lineupImport';
import { useToast } from '../../lib/toastContext';
import { mapErrorToUserMessage } from '@festie/shared/services/api';
import ConfirmDialog from '../ui/ConfirmDialog';
import EmptyState from '../ui/EmptyState';

interface Props {
  festivalId: string;
  festivalName: string;
  /** Change this value to reload history and the announcement count. */
  refreshKey?: number;
  /** The release panel data the sibling panel already loaded; only the undo warning reads it. */
  releases?: TimeReleasePanelData | null;
}

const KEPT_REASON = { picked: 'picked by someone', edited: 'edited since the import' } as const;

const buttonClass =
  'px-3 py-1.5 rounded-md bg-accent-aqua/20 text-accent-aqua hover:bg-accent-aqua/30 disabled:opacity-50 transition-colors text-sm font-medium';

export default function LineupImportHistory({ festivalId, festivalName, refreshKey = 0, releases = null }: Props) {
  const [imports, setImports] = useState<LineupImportHistoryItem[]>([]);
  const [lineupCount, setLineupCount] = useState<LineupAnnouncementCount | null>(null);
  const [daysCount, setDaysCount] = useState<DaysAnnouncementCount | null>(null);
  const [daysOpen, setDaysOpen] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [undoTarget, setUndoTarget] = useState<LineupImportHistoryItem | null>(null);
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastUndo, setLastUndo] = useState<LineupImportUndoResult | null>(null);
  const { toast, toastError } = useToast();

  const reload = useCallback(async () => {
    try {
      setLoadError(null);
      const [history, announcement, days] = await Promise.all([
        lineupImportApi.history(festivalId),
        lineupImportApi.announcement(festivalId),
        lineupImportApi.daysAnnouncement(festivalId),
      ]);
      setImports(history.imports);
      setLineupCount(announcement);
      setDaysCount(days);
    } catch (err: unknown) {
      setLoadError(err);
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

  const recipients = lineupCount?.recipients ?? null;
  const lineupEmailNote = lineupCount ? announcementEmailNote(lineupCount) : null;
  // Push may be done while the daily email limit cut some followers: the server accepts another press for them.
  const canAnnounceLineup = !!lineupCount && (lineupCount.recipients > 0 || lineupCount.emailCut > 0);
  const days = daysCount ? daysAnnouncementSummary(daysCount) : null;

  const doAnnounceDays = async () => {
    setBusy(true);
    try {
      const result = await lineupImportApi.announceDays(festivalId);
      toast(`Days announcement queued for ${result.recipients} people.`, 'success');
      setDaysOpen(false);
      await reload();
    } catch (err: unknown) {
      setDaysOpen(false);
      toastError(err, "Couldn't send the days announcement. Try again.");
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
        {loadError && imports.length === 0 ? (
          <EmptyState
            title="Couldn't load import history"
            description={mapErrorToUserMessage(loadError, 'Check your connection, then try again.')}
            cta={{ label: 'Retry', onClick: () => void reload() }}
          />
        ) : imports.length === 0 ? (
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
          Send a push and an inbox alert to people who follow {festivalName} or went to an earlier edition. Followers
          also get an email. Editions match when the name is the same apart from the year.
        </p>
        {lineupCount && <p className="text-sm text-text-muted mb-3">{lineupAudienceSummary(lineupCount)}</p>}
        {lineupEmailNote && <p className="text-sm text-text-muted mb-3">{lineupEmailNote}</p>}
        <button
          type="button"
          className={buttonClass}
          disabled={!canAnnounceLineup || busy}
          onClick={() => setAnnounceOpen(true)}
        >
          {`Announce to ${recipients ?? 0} people`}
        </button>
        {lineupCount && !canAnnounceLineup && (
          <p className="text-sm text-text-muted mt-2">No one to notify right now.</p>
        )}
      </section>

      <section>
        <h3 className="type-heading text-text-primary mb-3">Announce days</h3>
        <p className="text-sm text-text-muted mb-3">
          Tell followers and everyone with a profile in {festivalName} that acts have days. Nothing sends until you
          press the button. A save or an import never sends it.
        </p>
        {days && (
          <>
            <p className="text-sm text-text-primary mb-2">{days.counts}</p>
            {days.warning && <p className="text-sm text-accent-amber mb-2">{days.warning}</p>}
            {days.emailNote && <p className="text-sm text-text-muted mb-2">{days.emailNote}</p>}
            {days.blocked && <p className="text-sm text-text-muted mb-2">{days.blocked}</p>}
          </>
        )}
        <button
          type="button"
          className={buttonClass}
          disabled={!days || !!days.blocked || busy}
          onClick={() => setDaysOpen(true)}
        >
          Announce days
        </button>
      </section>

      <ConfirmDialog
        open={!!undoTarget}
        onOpenChange={(o) => !o && setUndoTarget(null)}
        title="Undo this import?"
        description={[
          'This removes the sets it added and puts back the sets it changed. Sets that people picked, or that someone edited after the import, stay.',
          releases && undoReleaseWarning(undoTarget?.touchedDates, releases.dates, releases.orphanDates),
        ]
          .filter(Boolean)
          .join(' ')}
        confirmLabel="Undo import"
        destructive
        busy={busy}
        onConfirm={doUndo}
      />
      <ConfirmDialog
        open={announceOpen}
        onOpenChange={setAnnounceOpen}
        title="Announce the lineup?"
        description={`This sends one push to ${recipients ?? 0} people. Followers also get one email. Each person gets it once for this festival.`}
        confirmLabel="Send"
        busy={busy}
        onConfirm={doAnnounce}
      />
      <ConfirmDialog
        open={daysOpen}
        onOpenChange={setDaysOpen}
        title="Announce the days?"
        description={`${days?.counts ?? ''} Each person gets it once for this festival.`}
        confirmLabel="Send"
        busy={busy}
        onConfirm={doAnnounceDays}
      />
    </div>
  );
}
