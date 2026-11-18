import React, { useCallback, useEffect, useState } from 'react';
import { timeReleaseApi } from '@festie/shared/services/timeReleases';
import {
  TIME_RELEASE_HELP,
  TIME_RELEASE_NOTE_MAX,
  timeReleaseConfirmText,
  timeReleaseOrphanText,
  timeReleasePartialText,
  timeReleasePrompts,
  timeReleaseRowText,
  timeReleaseState,
  type TimeReleaseDate,
  type TimeReleasePanelData,
} from '@festie/shared/utils/timeReleases';
import { mapErrorToUserMessage } from '@festie/shared/services/api';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';
import Dialog from '../ui/Dialog';
import EmptyState from '../ui/EmptyState';

interface Props {
  festivalId: string;
  /** Change this value to reload the panel, for example after a save or an import. */
  refreshKey?: number | string;
}

const rowButton =
  'px-3 py-1.5 rounded-md bg-accent-aqua/20 text-accent-aqua hover:bg-accent-aqua/30 disabled:opacity-50 transition-colors text-sm font-medium';

/**
 * "Send set-times alert", one festival date at a time. A save, an import and a publish never send it:
 * the admin presses Send here, after the dialog shows who it reaches and the exact title.
 */
export default function SetTimeReleasePanel({ festivalId, refreshKey = 0 }: Props) {
  const [panel, setPanel] = useState<TimeReleasePanelData | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [target, setTarget] = useState<TimeReleaseDate | null>(null);
  const [note, setNote] = useState('');
  const [partialOk, setPartialOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const { toast, toastError } = useToast();

  const reload = useCallback(async () => {
    try {
      setLoadError(null);
      setPanel(await timeReleaseApi.panel(festivalId));
    } catch (err: unknown) {
      setLoadError(err);
    }
  }, [festivalId]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  const open = (row: TimeReleaseDate) => {
    setTarget(row);
    setNote('');
    setPartialOk(false);
  };

  const send = async () => {
    if (!target) return;
    const partial = target.timed < target.total;
    setBusy(true);
    try {
      const result = await timeReleaseApi.send(festivalId, {
        dates: [target.date],
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(partial ? { confirmPartial: true } : {}),
      });
      toast(`Set-times alert queued for up to ${result.recipients} people.`, 'success');
      setTarget(null);
      await reload();
    } catch (err: unknown) {
      setTarget(null);
      toastError(err, "Couldn't send the set-times alert. Try again.");
      await reload();
    } finally {
      setBusy(false);
    }
  };

  if (loadError && !panel) {
    return (
      <EmptyState
        title="Couldn't load set-time alerts"
        description={mapErrorToUserMessage(loadError, 'Check your connection, then try again.')}
        cta={{ label: 'Retry', onClick: () => void reload() }}
      />
    );
  }
  if (!panel) return null;

  const nowMs = Date.now();
  const prompts = timeReleasePrompts(panel);
  const partialText = target ? timeReleasePartialText(target) : null;
  const sendDisabled = busy || (!!partialText && !partialOk);

  return (
    <section aria-label="Set-time alerts" className="space-y-3">
      <h3 className="type-heading text-text-primary">Set-time alerts</h3>
      <p className="text-sm text-text-muted">
        Tell followers and everyone with a profile in {panel.festivalName} that a day's set times are out. Each day
        sends once. A save, an import or a publish never sends it.
      </p>
      {panel.emailOff === 'no_postal_address' && <p className="text-sm text-text-muted">Email off: no postal address.</p>}
      {prompts.map((text) => (
        <p key={text} role="status" className="text-sm text-accent-amber">
          {text}
        </p>
      ))}
      {panel.dates.length === 0 ? (
        <p className="text-sm text-text-muted">Give a day a date to send its set times.</p>
      ) : (
        <ul className="space-y-2">
          {panel.dates.map((row) => {
            const state = timeReleaseState(row, nowMs);
            const canPress = panel.canSend && row.timed > 0 && (state === 'unsent' || state === 'stuck');
            return (
              <li
                key={row.date}
                className="bg-bg-card/60 border border-glass-border rounded-lg p-3 flex items-center justify-between gap-3"
              >
                <span className="text-sm text-text-primary">{timeReleaseRowText(row, nowMs)}</span>
                {canPress && (
                  <button type="button" className={rowButton} disabled={busy} onClick={() => open(row)}>
                    {state === 'stuck' ? 'Retry' : 'Send alert'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!panel.canSend && (
        <p className="text-sm text-text-muted">
          Alerts send only for a published festival that is not over.
        </p>
      )}
      {panel.orphanDates.map((o) => (
        <p key={o.date} className="text-sm text-text-muted">
          {timeReleaseOrphanText(o)}
        </p>
      ))}

      <Dialog
        open={!!target}
        onOpenChange={(o) => {
          if (!o && !busy) setTarget(null);
        }}
        title="Send the set-times alert?"
        description={target ? timeReleaseConfirmText(panel.recipientsNow, target.previewTitle) : undefined}
      >
        <p className="text-sm text-text-muted">{TIME_RELEASE_HELP}</p>
        <label className="block text-sm text-text-primary">
          Custom line (optional)
          <input
            type="text"
            maxLength={TIME_RELEASE_NOTE_MAX}
            value={note}
            placeholder={panel.defaultBody}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-primary border border-glass-border text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
          />
        </label>
        {partialText && (
          <label className="flex items-start gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={partialOk}
              onChange={(e) => setPartialOk(e.target.checked)}
              className="mt-1"
            />
            <span>
              {partialText} Send anyway. This date cannot be sent again.
            </span>
          </label>
        )}
        <div className="flex gap-2">
          <Button type="button" variant="secondary" disabled={busy} className="flex-1 min-h-11" onClick={() => setTarget(null)}>
            Cancel
          </Button>
          <Button type="button" isLoading={busy} disabled={sendDisabled} className="flex-1 min-h-11" onClick={() => void send()}>
            Send
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
