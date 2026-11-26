import React, { useState } from 'react';
import { CircleCheck, CircleX, TriangleAlert } from 'lucide-react';
import { checklistFromError, publishFestival } from '@festie/shared/services/festivalAdmin';
import {
  organizerFestivalStatus,
  organizerPublicLink,
  submitForReview,
  withdrawReview,
} from '@festie/shared/services/organizer';
import type { OrgRole, OrgStatus } from '@festie/shared/services/organizer';
import { festivalStatusLine, isPublishBlocked } from '@festie/shared/utils';
import type { ChecklistItem } from '@festie/shared/utils';
import { useToast } from '../../lib/toastContext';
import ConfirmDialog from '../ui/ConfirmDialog';
import { cn } from '../../lib/utils';

export interface FestivalMeta {
  publishedAt?: string | null;
  updatedAt?: string;
  updatedByUsername?: string | null;
  checklist?: ChecklistItem[];
  /** Organizer reads only: the review request, the decline note and the public slug. */
  publishRequestedAt?: string | null;
  publishReviewNote?: string | null;
  slug?: string | null;
}

/** Set when an organization member views the panel (the /manage page). Absent for a platform admin. */
export interface OrganizerPanelContext {
  role: OrgRole;
  orgName: string;
  orgStatus: OrgStatus;
  verified: boolean;
}

interface Props {
  festivalId: string;
  name: string;
  meta: FestivalMeta;
  /** True while the form has unsaved edits; the checklist is computed from the last save. */
  dirty: boolean;
  /** Called after any status change: published, submitted or withdrawn. */
  onPublished: () => void;
  onImport: () => void;
  onEditMap: () => void;
  onChecklist?: (checklist: ChecklistItem[]) => void;
  /** Organizer mode (plan-v3 5.5): an owner sees Submit for review instead of Publish, unless verified. */
  organizer?: OrganizerPanelContext;
}

const STATUS = {
  done: { Icon: CircleCheck, className: 'text-accent-aqua', sr: 'Done:' },
  todo: { Icon: CircleX, className: 'text-accent-coral', sr: 'To do:' },
  warn: { Icon: TriangleAlert, className: 'text-accent-amber', sr: 'Warning:' },
} as const;

const actionClass =
  'inline-flex items-center min-h-11 px-3 rounded-md bg-accent-aqua/20 text-accent-aqua hover:bg-accent-aqua/30 transition-colors text-xs font-medium';

/** Draft/published chip, "Before you publish" checklist and the Publish button. */
export default function FestivalStatusPanel({
  festivalId,
  name,
  meta,
  dirty,
  onPublished,
  onImport,
  onEditMap,
  onChecklist,
  organizer,
}: Props) {
  const { toast, toastError } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blockedChecklist, setBlockedChecklist] = useState<ChecklistItem[] | null>(null);
  const status = festivalStatusLine(meta);
  const orgView = organizer ? organizerFestivalStatus({ ...meta, published: !!meta.publishedAt }, window.location.origin) : null;
  const checklist = blockedChecklist ?? meta.checklist ?? [];
  // An organizer's festival stays editable while it waits for review, so only the checklist and buttons change.
  const isDraft = orgView ? orgView.state !== 'live' : status.state === 'draft';
  const inReview = orgView?.state === 'review';
  const isOwner = organizer?.role === 'owner';
  // A viewer reads the checklist, but its shortcuts lead to editors a viewer cannot use.
  const canAct = organizer?.role !== 'viewer';
  const orgActive = organizer?.orgStatus === 'active';
  // A verified organization publishes by itself. Any other organization submits for review (owner decision 8).
  const submitsForReview = !!organizer && !organizer.verified;
  const publicLink = orgView?.state === 'live' ? organizerPublicLink(meta.slug, window.location.origin) : null;
  // Submitting ignores the days and sets items, so a festival with names only can go to review. The server
  // decides the rest of the gate (lib/helpers/validation.ts submitBlockers) and answers with the fresh checklist.
  const blocked = submitsForReview
    ? isPublishBlocked(checklist.filter((item) => item.key !== 'days' && item.key !== 'sets'))
    : isPublishBlocked(checklist);
  const warnings = checklist.filter((i) => i.status === 'warn').map((i) => i.label);

  const keepChecklist = (err: unknown) => {
    const fresh = checklistFromError(err);
    if (!fresh) return;
    setBlockedChecklist(fresh);
    onChecklist?.(fresh);
  };

  const publish = async () => {
    setBusy(true);
    try {
      await publishFestival(festivalId, organizer ? 'manage' : 'admin');
      toast(`${name} is live.`, 'success');
      setConfirming(false);
      setBlockedChecklist(null);
      onPublished();
    } catch (err: unknown) {
      keepChecklist(err);
      setConfirming(false);
      toastError(err, "Couldn't publish festival. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      await submitForReview(festivalId);
      toast('Sent. Festie usually reviews within 2 working days. We will email you.', 'success');
      setConfirming(false);
      setBlockedChecklist(null);
      onPublished();
    } catch (err: unknown) {
      keepChecklist(err);
      setConfirming(false);
      toastError(err, "Couldn't submit for review. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    setBusy(true);
    try {
      await withdrawReview(festivalId);
      toast('Request withdrawn. The draft stays as it is.', 'success');
      onPublished();
    } catch (err: unknown) {
      toastError(err, "Couldn't withdraw the request. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicLink ?? '');
      toast('Link copied.', 'success');
    } catch {
      toast('Copy failed. Select the link and copy it.', 'error');
    }
  };

  const hint =
    organizer && !orgActive
      ? organizer.orgStatus === 'suspended'
        ? "Your organization's access is paused. Contact Festie."
        : 'Festie is checking your organization. Submit unlocks when we approve you.'
      : blocked
        ? 'Finish the open items first.'
        : dirty
          ? 'Save your changes first.'
          : '';

  const actionLabel = !submitsForReview
    ? 'Publish festival'
    : orgView?.state === 'changes'
      ? 'Submit again'
      : 'Submit for review';

  return (
    <section
      aria-label="Festival status"
      className="bg-bg-card/60 border border-glass-border rounded-xl p-4 space-y-3"
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'px-2 py-0.5 rounded-full text-xs font-semibold',
            isDraft ? 'bg-accent-amber/20 text-accent-amber' : 'bg-accent-aqua/20 text-accent-aqua',
          )}
        >
          {orgView ? orgView.chip : status.chip}
        </span>
        {status.edited && <span className="text-xs text-text-muted">{status.edited}</span>}
      </div>

      {orgView && (
        <div className="space-y-2">
          <p className="text-sm text-text-secondary">{orgView.text}</p>
          {publicLink && (
            <div className="flex flex-wrap items-center gap-2">
              <a href={publicLink} className="text-sm text-accent-aqua underline break-all" target="_blank" rel="noreferrer">
                {publicLink}
              </a>
              <button type="button" onClick={() => void copyLink()} className={actionClass}>
                Copy link
              </button>
            </div>
          )}
          {inReview && <p className="text-xs text-text-muted">Festie usually reviews within 2 working days. We will email you.</p>}
          {inReview && isOwner && (
            <button type="button" disabled={busy} onClick={() => void withdraw()} className={actionClass}>
              Withdraw request
            </button>
          )}
        </div>
      )}

      {isDraft && !inReview && (
        <>
          {!organizer && <p className="text-sm text-text-secondary">This festival is a draft. Only admins can see it.</p>}
          <div>
            <h3 className="text-sm font-semibold text-text-primary">{organizer ? 'Before you submit' : 'Before you publish'}</h3>
            <p className="text-xs text-text-muted">Based on the last save.</p>
          </div>
          <ul className="space-y-1">
            {checklist.map((item) => {
              const { Icon, className, sr } = STATUS[item.status];
              return (
                <li key={item.key} className="flex items-center gap-2 text-sm text-text-primary">
                  <Icon className={cn('w-4 h-4 shrink-0', className)} aria-hidden="true" />
                  <span className="sr-only">{sr}</span>
                  <span className="flex-1">{item.label}</span>
                  {canAct && item.key === 'sets' && item.status !== 'done' && (
                    <button type="button" onClick={onImport} className={actionClass}>
                      Import lineup
                    </button>
                  )}
                  {canAct && item.key === 'pins' && item.status === 'warn' && (
                    <button type="button" onClick={onEditMap} className={actionClass}>
                      Edit map
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {(!organizer || isOwner) && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={blocked || dirty || (!!organizer && !orgActive)}
                onClick={() => setConfirming(true)}
                className="px-4 py-2 min-h-11 rounded-xl bg-accent-aqua text-bg-primary text-sm font-medium hover:opacity-80 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {actionLabel}
              </button>
              {hint && <span className="text-xs text-text-muted">{hint}</span>}
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={(o) => !o && setConfirming(false)}
        title={submitsForReview ? `Submit ${name} for review?` : `Publish ${name}?`}
        description={`${
          submitsForReview
            ? 'Festie checks it before it goes live. You can withdraw the request until then.'
            : "Everyone can find this festival and join it. You can't turn it back into a draft."
        }${warnings.length ? ` Warnings: ${warnings.join(' ')}` : ''}`}
        confirmLabel={submitsForReview ? 'Submit' : 'Publish'}
        busy={busy}
        onConfirm={submitsForReview ? submit : publish}
      />
    </section>
  );
}
