import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@festie/shared/services';
import { ratingCaption } from '@festie/shared/constants';
import { useToast } from '../../lib/toastContext';
import { useHaptics } from '../../hooks/useHaptics';
import { RATING_META, RATING_SCALE } from '../../lib/ratingIcon';
import { cn } from '../../lib/utils';
import SetRatingSummary from './SetRatingSummary';

const RATINGS = RATING_SCALE.map((n) => ({ n, ...RATING_META[n]! }));

interface Rating {
  setId: string;
  rating: number;
  note?: string | null;
}

interface Props {
  setId: string;
  festivalId: string;
  /** Compact (smaller buttons) for use inside set cards; default full-size. */
  compact?: boolean;
  /** Fires after a rating saved (not after a removal). */
  onRated?: (rating: number) => void;
  /** Show the one-line memory field once a rating exists. */
  showMemory?: boolean;
}

const MEMORY_MAX = 140;

export default function RatingButtons({ setId, festivalId, compact = false, onRated, showMemory = true }: Props) {
  const { toast, toastError } = useToast();
  const qc = useQueryClient();
  const { select } = useHaptics();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const { data: ratings = [] } = useQuery<Rating[]>({
    queryKey: ['ratings', festivalId],
    queryFn: async () => {
      const res = await api.get<{ ratings: Rating[] }>(`/ratings/festival/${festivalId}`);
      return Array.isArray(res) ? res : res?.ratings || [];
    },
    enabled: !!festivalId,
    staleTime: 60_000,
  });

  const currentRating = ratings.find((r) => r.setId === setId);
  const current = currentRating?.rating ?? null;
  const savedNote = currentRating?.note?.trim() || '';

  // Offline-aware rate + remove. If navigator.onLine === false AND the
  // AppShell's offline queue bridge is ready, enqueue with a deterministic
  // clientId so toggling the same rating several times offline collapses to
  // one replayed call. TanStack Query's optimistic cache update still
  // applies instantly either way.
  const rate = useMutation({
    mutationFn: async ({ rating, note }: { rating: number; note?: string }) => {
      const body = { rating, ...(note !== undefined ? { note } : {}) };
      const bridge = window.__festieQueue;
      if (!navigator.onLine && bridge?.queueMutation) {
        return bridge.queueMutation({
          type: 'api',
          clientId: `rate-${setId}`,
          url: `/ratings/${setId}`,
          method: 'POST',
          body,
        });
      }
      return api.post(`/ratings/${setId}`, body);
    },
    onMutate: async ({ rating, note }) => {
      // Optimistic: update the ratings query cache so the UI responds instantly.
      await qc.cancelQueries({ queryKey: ['ratings', festivalId] });
      const prev = qc.getQueryData<Rating[]>(['ratings', festivalId]) || [];
      const kept = prev.find((r) => r.setId === setId)?.note ?? null;
      const next = [...prev.filter((r) => r.setId !== setId), { setId, rating, note: note ?? kept }];
      qc.setQueryData(['ratings', festivalId], next);
      return { prev };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['ratings', festivalId], ctx.prev);
      toastError(e, "Couldn't save your rating. Try again.");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ratings', festivalId] }),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const bridge = window.__festieQueue;
      if (!navigator.onLine && bridge?.queueMutation) {
        return bridge.queueMutation({
          type: 'api',
          clientId: `rate-${setId}`,
          url: `/ratings/${setId}`,
          method: 'DELETE',
        });
      }
      return api.delete(`/ratings/${setId}`);
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ['ratings', festivalId] });
      const prev = qc.getQueryData<Rating[]>(['ratings', festivalId]) || [];
      qc.setQueryData(
        ['ratings', festivalId],
        prev.filter((r) => r.setId !== setId),
      );
      return { prev };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['ratings', festivalId], ctx.prev);
      toastError(e, "Couldn't remove your rating. Try again.");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ratings', festivalId] }),
  });

  const handleClick = async (n: number) => {
    if (busy) return;
    setBusy(true);
    try {
      select();
      if (current === n) {
        await remove.mutateAsync();
      } else {
        await rate.mutateAsync({ rating: n });
        onRated?.(n);
      }
    } finally {
      setBusy(false);
    }
  };

  const saveMemory = async () => {
    if (busy || current === null) return;
    setBusy(true);
    try {
      await rate.mutateAsync({ rating: current, note: draft.trim() });
      setEditing(false);
      toast('Memory saved', 'success');
    } catch {
      // onError already toasted and rolled back; keep the draft open for a retry.
    } finally {
      setBusy(false);
    }
  };

  const iconSize = compact ? 'w-4 h-4' : 'w-5 h-5';

  return (
    <div>
      <div
        className={cn('flex items-start justify-center gap-2', compact && 'scale-90 origin-left')}
        role="radiogroup"
        aria-label="Rate this set"
      >
        {RATINGS.map((r) => {
          const active = current === r.n;
          return (
            <div key={r.n} className="flex flex-col items-center gap-1">
              <button
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={`${r.label} (${r.n} of 5)`}
                disabled={busy}
                onClick={() => handleClick(r.n)}
                className={cn(
                  'w-11 h-11 rounded-full flex items-center justify-center transition-[background-color,box-shadow,transform]',
                  active
                    ? 'bg-accent-amber/25 scale-110 shadow-[0_0_12px_theme(colors.accent-amber/40)] ring-2 ring-accent-amber/60 text-accent-amber'
                    : 'bg-bg-card/60 border border-border hover:border-border-light text-text-secondary',
                )}
              >
                <r.Icon className={iconSize} aria-hidden="true" />
              </button>
              <span
                aria-hidden="true"
                className={cn(
                  'text-[10px] font-semibold',
                  active ? 'text-accent-amber' : 'text-text-secondary',
                )}
              >
                {r.label}
              </span>
            </div>
          );
        })}
      </div>
      <p
        aria-hidden="true"
        className={cn(
          'mt-2 text-center text-xs',
          current != null ? 'text-accent-amber' : 'text-text-muted',
        )}
      >
        {ratingCaption(current)}
      </p>
      {showMemory && current !== null && (
        <div className="mt-2 text-center text-sm">
          {editing ? (
            <div className="flex flex-col gap-2">
              <input
                type="text"
                value={draft}
                maxLength={MEMORY_MAX}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="What do you want to remember?"
                aria-label="Memory"
                className="w-full min-h-9 rounded-lg border border-border bg-bg-card px-3 text-sm"
              />
              <div className="flex justify-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={saveMemory}
                  className="min-h-9 px-3 rounded-full bg-accent-aqua text-bg-primary text-xs font-semibold cursor-pointer"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="min-h-9 px-3 rounded-full border border-border text-xs font-semibold text-text-secondary cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2">
              {savedNote && <span className="text-text-primary italic">“{savedNote}”</span>}
              <button
                type="button"
                onClick={() => {
                  setDraft(savedNote);
                  setEditing(true);
                }}
                className="min-h-9 px-2 text-xs font-semibold text-accent-aqua cursor-pointer"
              >
                {savedNote ? 'Edit' : 'Add a memory'}
              </button>
            </div>
          )}
        </div>
      )}
      {!compact && <SetRatingSummary setId={setId} festivalId={festivalId} />}
    </div>
  );
}
