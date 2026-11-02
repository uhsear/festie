import React, { useState } from 'react';
import { CircleCheck, CircleX, TriangleAlert } from 'lucide-react';
import { checklistFromError, publishFestival } from '@festie/shared/services/festivalAdmin';
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
}

interface Props {
  festivalId: string;
  name: string;
  meta: FestivalMeta;
  /** True while the form has unsaved edits; the checklist is computed from the last save. */
  dirty: boolean;
  onPublished: () => void;
  onImport: () => void;
  onEditMap: () => void;
  onChecklist?: (checklist: ChecklistItem[]) => void;
}

const STATUS = {
  done: { Icon: CircleCheck, className: 'text-accent-aqua', sr: 'Done:' },
  todo: { Icon: CircleX, className: 'text-accent-coral', sr: 'To do:' },
  warn: { Icon: TriangleAlert, className: 'text-accent-amber', sr: 'Warning:' },
} as const;

const actionClass =
  'px-2 py-0.5 rounded-md bg-accent-aqua/20 text-accent-aqua hover:bg-accent-aqua/30 transition-colors text-xs font-medium';

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
}: Props) {
  const { toast, toastError } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blockedChecklist, setBlockedChecklist] = useState<ChecklistItem[] | null>(null);
  const status = festivalStatusLine(meta);
  const checklist = blockedChecklist ?? meta.checklist ?? [];
  const isDraft = status.state === 'draft';
  const blocked = isPublishBlocked(checklist);
  const warnings = checklist.filter((i) => i.status === 'warn').map((i) => i.label);

  const publish = async () => {
    setBusy(true);
    try {
      await publishFestival(festivalId);
      toast(`${name} is live.`, 'success');
      setConfirming(false);
      setBlockedChecklist(null);
      onPublished();
    } catch (err: unknown) {
      const fresh = checklistFromError(err);
      if (fresh) {
        setBlockedChecklist(fresh);
        onChecklist?.(fresh);
      }
      setConfirming(false);
      toastError(err, "Couldn't publish festival. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const hint = blocked ? 'Finish the open items first.' : dirty ? 'Save your changes first.' : '';

  return (
    <section
      aria-label="Festival status"
      className="bg-bg-card/60 border border-glass-border rounded-lg p-4 space-y-3"
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'px-2 py-0.5 rounded-full text-xs font-semibold',
            isDraft ? 'bg-accent-amber/20 text-accent-amber' : 'bg-accent-aqua/20 text-accent-aqua',
          )}
        >
          {status.chip}
        </span>
        {status.edited && <span className="text-xs text-text-muted">{status.edited}</span>}
      </div>

      {isDraft && (
        <>
          <p className="text-sm text-text-secondary">This festival is a draft. Only admins can see it.</p>
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Before you publish</h3>
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
                  {item.key === 'sets' && item.status !== 'done' && (
                    <button type="button" onClick={onImport} className={actionClass}>
                      Import lineup
                    </button>
                  )}
                  {item.key === 'pins' && item.status === 'warn' && (
                    <button type="button" onClick={onEditMap} className={actionClass}>
                      Edit map
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={blocked || dirty}
              onClick={() => setConfirming(true)}
              className="px-4 py-2 rounded-lg bg-accent-aqua text-bg-primary text-sm font-medium hover:opacity-80 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Publish festival
            </button>
            {hint && <span className="text-xs text-text-muted">{hint}</span>}
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={(o) => !o && setConfirming(false)}
        title={`Publish ${name}?`}
        description={`Everyone can find this festival and join it. You can't turn it back into a draft.${
          warnings.length ? ` Warnings: ${warnings.join(' ')}` : ''
        }`}
        confirmLabel="Publish"
        busy={busy}
        onConfirm={publish}
      />
    </section>
  );
}
