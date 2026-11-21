import React, { useState } from 'react';
import { useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { SearchX } from 'lucide-react';
import { mapErrorToUserMessage } from '@festie/shared/services/api';
import { publishFestival } from '@festie/shared/services/festivalAdmin';
import { auditActionLabel } from '@festie/shared/utils';
import {
  declinePublishRequest,
  discardHeldAlerts,
  releaseHeldAlerts,
  type HeldAlertGroup,
  type ReviewQueue,
  type ReviewRequest,
} from '@festie/shared/services/adminOrganizations';
import { useToast } from '../../lib/toastContext';
import EmptyState from '../ui/EmptyState';
import ConfirmDialog from '../ui/ConfirmDialog';
import PromptDialog from '../ui/PromptDialog';
import { adminKeys } from './adminQueries';
import { useAdminSearch } from './useAdminSearch';

interface Props {
  section: 'review' | 'held';
  queue: UseQueryResult<ReviewQueue>;
}

type Action =
  | { kind: 'approve'; request: ReviewRequest }
  | { kind: 'decline'; request: ReviewRequest }
  | { kind: 'release'; held: HeldAlertGroup }
  | { kind: 'discard'; held: HeldAlertGroup }
  | null;

const smallButton =
  'inline-flex items-center justify-center min-h-11 px-3 rounded-lg border border-glass-border text-sm text-text-primary hover:bg-bg-card transition-colors disabled:opacity-50';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const people = (n: number) => (n === 1 ? '1 person' : `${n} people`);

const day = (iso: string) => {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? '' : new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/** The festivals that wait for a decision, and the attendee alerts that an organizer's save held (plan-v3 6.2, 7). */
export default function AdminReviewQueue({ section, queue }: Props) {
  const queryClient = useQueryClient();
  const { toast, toastError } = useToast();
  const [, setAdminSearch] = useAdminSearch();
  const [action, setAction] = useState<Action>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: adminKeys.reviewQueue });
    await queryClient.invalidateQueries({ queryKey: adminKeys.organizations });
  };

  const run = async (work: () => Promise<string>, fail: string) => {
    setBusy(true);
    try {
      toast(await work(), 'success');
      setAction(null);
      await refresh();
    } catch (err) {
      setAction(null);
      toastError(err, fail);
    } finally {
      setBusy(false);
    }
  };

  const approve = (request: ReviewRequest) =>
    run(async () => {
      await publishFestival(request.festivalId);
      return `${request.name} is live. The owners get an email.`;
    }, "Couldn't publish it. Open the festival to see what is missing.");

  const decline = (request: ReviewRequest, note: string) =>
    run(async () => {
      await declinePublishRequest(request.festivalId, note.trim());
      return 'Declined. The owners get the note by email.';
    }, "Couldn't decline the request. Try again.");

  const release = (held: HeldAlertGroup) =>
    run(async () => {
      const sent = await releaseHeldAlerts(held.festivalId);
      return `Sent ${plural(sent.released, 'alert')} to ${people(sent.people)}.`;
    }, "Couldn't send the alerts. Try again.");

  const discard = (held: HeldAlertGroup) =>
    run(async () => {
      await discardHeldAlerts(held.festivalId);
      return 'Discarded. Nobody was told.';
    }, "Couldn't discard the alerts. Try again.");

  if (queue.isPending) {
    return (
      <div role="status" className="py-12 text-center text-text-muted">
        Loading the queue…
      </div>
    );
  }
  if (queue.isError) {
    return (
      <EmptyState
        icon={<SearchX className="h-9 w-9" aria-hidden="true" />}
        title="Couldn't load the queue"
        description={mapErrorToUserMessage(queue.error, 'Check your connection, then try again.')}
        cta={{ label: 'Retry', onClick: () => void queue.refetch() }}
      />
    );
  }

  const { requests, held, recentEdits = [] } = queue.data;

  return (
    <div className="space-y-4">
      {section === 'review' && (
        <section aria-label="Review queue" className="space-y-3">
          <h2 className="type-heading text-text-primary">Review queue ({requests.length})</h2>
          {requests.length === 0 ? (
            <EmptyState icon={<SearchX className="h-9 w-9" aria-hidden="true" />} title="Nothing is waiting for review." />
          ) : (
            <ul className="list-none space-y-3 p-0">
              {requests.map((r) => (
                <li key={r.festivalId} className="space-y-2 rounded-lg border border-glass-border bg-bg-card/60 p-4">
                  <p className="text-base font-semibold text-text-primary">{r.name}</p>
                  <p className="text-xs text-text-muted">
                    {r.organizationName ?? 'No organization'}
                    {r.verified ? ' (verified)' : ''}. Sent {day(r.requestedAt)}.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={smallButton} aria-label={`Preview ${r.name}`} onClick={() => setAdminSearch({ tab: 'festivals', preview: r.festivalId })}>
                      Preview
                    </button>
                    <button type="button" className={smallButton} aria-label={`Approve ${r.name}`} disabled={busy} onClick={() => setAction({ kind: 'approve', request: r })}>
                      Approve
                    </button>
                    <button type="button" className={smallButton} aria-label={`Decline ${r.name}`} disabled={busy} onClick={() => setAction({ kind: 'decline', request: r })}>
                      Decline
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {section === 'review' && (
        <section aria-label="Recent organizer edits" className="space-y-3">
          <h2 className="type-heading text-text-primary">Recent organizer edits on live festivals ({recentEdits.length})</h2>
          {recentEdits.length === 0 ? (
            <p className="text-sm text-text-muted">No organizer has changed a live festival in the last 14 days.</p>
          ) : (
            <ul className="list-none space-y-2 p-0">
              {recentEdits.map((edit) => (
                <li key={edit.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-glass-border p-3">
                  <div className="min-w-0">
                    <p className="text-sm text-text-primary">
                      {edit.name}: {auditActionLabel(edit.action)}
                    </p>
                    <p className="text-xs text-text-muted">
                      {edit.organizationName ?? 'No organization'}. {day(edit.createdAt)}.
                    </p>
                  </div>
                  <button type="button" className={smallButton} aria-label={`Open ${edit.name}`} onClick={() => setAdminSearch({ tab: 'festivals', festival: edit.festivalId })}>
                    Open
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {section === 'held' && (
        <section aria-label="Held alerts" className="space-y-3">
          <h2 className="type-heading text-text-primary">Held alerts ({held.length})</h2>
          <p className="text-sm text-text-muted">
            An organizer&apos;s save does not message attendees by itself. You send these alerts, or discard them.
          </p>
          {held.length === 0 ? (
            <EmptyState icon={<SearchX className="h-9 w-9" aria-hidden="true" />} title="No alerts are held." />
          ) : (
            <ul className="list-none space-y-3 p-0">
              {held.map((h) => (
                <li key={h.festivalId} className="space-y-2 rounded-lg border border-glass-border bg-bg-card/60 p-4">
                  <p className="text-base font-semibold text-text-primary">{h.name}</p>
                  <p className="text-xs text-text-muted">
                    {h.organizationName ?? 'No organization'}. {plural(h.changes, 'held change')}, {people(h.people)} would be told.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={smallButton} aria-label={`Send the alerts for ${h.name}`} disabled={busy} onClick={() => setAction({ kind: 'release', held: h })}>
                      Send alert
                    </button>
                    <button type="button" className={smallButton} aria-label={`Discard the alerts for ${h.name}`} disabled={busy} onClick={() => setAction({ kind: 'discard', held: h })}>
                      Discard
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <ConfirmDialog
        open={action?.kind === 'approve'}
        onOpenChange={(o) => !o && setAction(null)}
        title={action?.kind === 'approve' ? `Publish ${action.request.name}?` : ''}
        description="It goes live for everyone and you cannot turn it back into a draft. Its owners get an email with the public link."
        confirmLabel="Publish"
        busy={busy}
        onConfirm={() => (action?.kind === 'approve' ? approve(action.request) : undefined)}
      />
      <PromptDialog
        open={action?.kind === 'decline'}
        onOpenChange={(o) => !o && setAction(null)}
        title={action?.kind === 'decline' ? `Decline ${action.request.name}` : ''}
        description="Write what the owners should change. They read this note by email and on the festival."
        placeholder="What should they change?"
        confirmLabel="Decline"
        maxLength={500}
        busy={busy}
        // The dialog keeps Decline disabled until the note has text, and the server needs a note.
        onConfirm={(note) => (action?.kind === 'decline' ? decline(action.request, note) : undefined)}
      />
      <ConfirmDialog
        open={action?.kind === 'release'}
        onOpenChange={(o) => !o && setAction(null)}
        title={action?.kind === 'release' ? `Send the alerts for ${action.held.name}?` : ''}
        description={
          action?.kind === 'release'
            ? `${people(action.held.people)} get one alert about ${plural(action.held.changes, 'change')}. Pressing it twice sends nothing more.`
            : undefined
        }
        confirmLabel="Send alert"
        busy={busy}
        onConfirm={() => (action?.kind === 'release' ? release(action.held) : undefined)}
      />
      <ConfirmDialog
        open={action?.kind === 'discard'}
        onOpenChange={(o) => !o && setAction(null)}
        title={action?.kind === 'discard' ? `Discard the alerts for ${action.held.name}?` : ''}
        description="Nobody is told about these changes. You cannot undo this."
        confirmLabel="Discard"
        destructive
        busy={busy}
        onConfirm={() => (action?.kind === 'discard' ? discard(action.held) : undefined)}
      />
    </div>
  );
}
