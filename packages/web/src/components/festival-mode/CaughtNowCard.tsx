import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, markCaught } from '@festie/shared/services';
import { useAuthStore, useFestivalStore } from '@festie/shared/stores';
import type { WrapResponse } from '@festie/shared/types';
import { applyCaughtMark, artistDisplayName, catchableMeta, caughtFor, selectCatchable } from '@festie/shared/utils';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useToast } from '../../lib/toastContext';

interface Props {
  festivalId: string;
  nowMs: number;
  timeZone?: string;
  getStageName: (stageId: string) => string | undefined;
  b2bSeparator?: string;
}

const buttonClass =
  'inline-flex min-h-11 items-center gap-1.5 px-4 rounded-full border border-border text-sm font-semibold text-text-secondary cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua';

/** One-tap "Caught it" for picks that are playing now or ended in the last 2 hours. */
export default function CaughtNowCard({ festivalId, nowMs, timeZone, getStageName, b2bSeparator }: Props) {
  const user = useAuthStore((s) => s.user);
  const sets = useFestivalStore((s) => s.sets);
  const days = useFestivalStore((s) => s.days);
  const picks = useFestivalStore((s) => s.currentProfile?.picks);
  const qc = useQueryClient();
  const { toastError } = useToast();
  const [overlay, setOverlay] = useState<ReadonlyMap<string, boolean | null>>(() => new Map());
  const [announcement, setAnnouncement] = useState('');

  const items = useMemo(
    () => (user ? selectCatchable({ sets, days, picks, nowMs, timeZone }) : []),
    [user, sets, days, picks, nowMs, timeZone],
  );

  const { data } = useQuery<WrapResponse>({
    queryKey: ['wrap', festivalId],
    queryFn: () => api.get(`/ratings/wrap/${festivalId}`),
    enabled: items.length > 0,
  });

  if (!user || items.length === 0) return null;

  const toggle = (setId: string) => {
    const previous = caughtFor(data, overlay, setId);
    const next = previous === true ? null : true;
    const setMark = (value: boolean | null) => setOverlay((m) => new Map(m).set(setId, value));
    setMark(next);
    setAnnouncement(next ? 'Marked as caught' : 'Mark removed');
    qc.setQueryData<WrapResponse>(['wrap', festivalId], (w) => w && applyCaughtMark(w, setId, next));
    markCaught(setId, next, user.id).catch((e) => {
      setMark(previous);
      qc.invalidateQueries({ queryKey: ['wrap', festivalId] });
      toastError(e, "Couldn't save that. Try again.");
    });
  };

  return (
    <section aria-labelledby="caught-now-title" className="rounded-xl border border-border bg-bg-card p-4">
      <h2 id="caught-now-title" className="type-heading text-text-primary">
        Did you catch it?
      </h2>
      <ul className="mt-3 flex flex-col gap-3">
        {items.map((item) => {
          const artist = artistDisplayName(item.set, b2bSeparator);
          const caught = caughtFor(data, overlay, item.set.id) === true;
          return (
            <li key={item.set.id} className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="line-clamp-2 break-words text-text-primary">{artist}</div>
                <div className="text-xs text-text-secondary">
                  {catchableMeta(item, nowMs, item.set.stageId ? getStageName(item.set.stageId) : null)}
                </div>
              </div>
              <button
                type="button"
                aria-pressed={caught}
                aria-label={`Caught ${artist}`}
                onClick={() => toggle(item.set.id)}
                className={cn(buttonClass, caught && 'border-accent-aqua text-accent-aqua')}
              >
                {caught && <Check className="w-4 h-4" aria-hidden="true" />}
                {caught ? 'Caught' : 'Caught it'}
              </button>
            </li>
          );
        })}
      </ul>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </section>
  );
}
