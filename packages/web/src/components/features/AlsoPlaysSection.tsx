import { useState } from 'react';
import { useFestivalStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { useAlsoPlays, useCanPick, usePicks } from '@festie/shared/hooks';
import { COPY } from '@festie/shared/constants';
import { artistDisplayName } from '@festie/shared/utils';
import type { FestivalSet } from '@festie/shared/types';
import Button from '../ui/Button';
import { useNow } from '../../hooks/useSetStatus';
import { useToast } from '../../lib/toastContext';

/** "Also plays": other open slots of the same act, with a one-tap way to pick them too. */
export default function AlsoPlaysSection({ set }: { set: FestivalSet }) {
  const nowMs = useNow();
  const slots = useAlsoPlays(set, nowMs);
  const stages = useFestivalStore((s) => s.stages);
  const festival = useFestivalStore((s) => s.currentFestival);
  const setDetailSet = useUIStore((s) => s.setDetailSet);
  const { getMyPick, savePick } = usePicks();
  const canPick = useCanPick();
  const { toastError } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (slots.length === 0) return null;
  const myPick = getMyPick(set.id);
  const artist = artistDisplayName(set, festival?.b2bSeparator);

  const pickToo = async (slotSetId: string) => {
    if (!festival || !myPick) return;
    setBusyId(slotSetId);
    try {
      await savePick(festival.id, slotSetId, myPick);
    } catch (err) {
      toastError(err, "Couldn't save your pick. Try again.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section aria-labelledby="also-plays-heading" className="mt-3">
      <h3
        id="also-plays-heading"
        className="mb-2 text-[length:var(--font-size-12)] uppercase tracking-wide text-text-muted"
      >
        {COPY.alsoPlays.heading}
      </h3>
      <ul className="space-y-1">
        {slots.map((slot) => {
          const stage = stages.find((st) => st.id === slot.set.stageId)?.name ?? slot.set.stageName ?? '';
          const slotPicked = !!getMyPick(slot.set.id);
          const line = COPY.alsoPlays.row(slot.when);
          return (
            <li key={slot.set.id} className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setDetailSet(slot.set)}
                aria-label={`${line}${stage ? `, ${stage}` : ''}. Open this set.`}
                className="min-h-[44px] flex-1 rounded-xl px-3 py-2 text-left cursor-pointer hover:bg-bg-input focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2"
              >
                <span className="block text-sm font-semibold text-text-primary">{line}</span>
                {stage && <span className="block text-xs text-text-muted">{stage}</span>}
              </button>
              {canPick && myPick && !slotPicked && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="min-h-11"
                  disabled={busyId === slot.set.id}
                  aria-label={COPY.alsoPlays.pickTooA11y(artist, slot.when)}
                  onClick={() => pickToo(slot.set.id)}
                >
                  {COPY.alsoPlays.pickToo}
                </Button>
              )}
              {slotPicked && <span className="text-xs text-text-muted">{COPY.alsoPlays.picked}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
