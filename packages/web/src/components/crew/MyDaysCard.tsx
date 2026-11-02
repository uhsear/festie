import { useCrewStore } from '@festie/shared/stores/crewStore';
import { useFestivalStore } from '@festie/shared/stores';
import { useCrewDaysIndex } from '@festie/shared/hooks';
import { formatDayChip, myDaysPayload } from '@festie/shared/utils';
import type { CrewDayAnswer } from '@festie/shared/types';
import { useToast } from '../../lib/toastContext';
import { cn } from '../../lib/utils';

const OPTIONS: Array<{ answer: CrewDayAnswer; label: string }> = [
  { answer: 'going', label: 'Going' },
  { answer: 'maybe', label: 'Maybe' },
  { answer: 'no', label: 'Not going' },
];

/** Per-day Going / Maybe / Not going for the signed-in member. Tapping the selected answer clears it. */
export default function MyDaysCard({ currentUserId }: { currentUserId: string }) {
  const { toast } = useToast();
  const crew = useCrewStore((s) => s.activeCrew);
  const festival = useFestivalStore((s) => s.currentFestival);
  const days = useFestivalStore((s) => s.days);
  const index = useCrewDaysIndex();

  if (!crew || !festival || festival.id !== crew.festivalId || days.length === 0) return null;

  const choose = (dayIndex: number, answer: CrewDayAnswer) => {
    const current = index.get(currentUserId)?.get(dayIndex);
    const next = current === answer ? null : answer;
    useCrewStore
      .getState()
      .setMyDays(crew.id, currentUserId, myDaysPayload(index, currentUserId, dayIndex, next))
      .catch(() => toast("Couldn't save your days. Try again.", 'error'));
  };

  return (
    <section aria-labelledby="my-days-heading" className="rounded-md border border-glass-border bg-bg-card p-3 space-y-2">
      <div>
        <h3 id="my-days-heading" className="text-sm font-semibold text-text-primary">
          Your days
        </h3>
        <p className="text-xs text-text-secondary">So your crew knows who&apos;s there each day.</p>
      </div>
      {days.map((day, dayIndex) => {
        const chip = formatDayChip(day);
        const current = index.get(currentUserId)?.get(dayIndex);
        return (
          <div key={day.id ?? dayIndex} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-text-primary">
              {chip.label}
              {chip.date ? <span className="text-text-muted"> {chip.date}</span> : null}
            </span>
            <div role="radiogroup" aria-label={`${chip.label}: are you going?`} className="flex gap-1">
              {OPTIONS.map((o) => (
                <button
                  key={o.answer}
                  type="button"
                  role="radio"
                  aria-checked={current === o.answer}
                  onClick={() => choose(dayIndex, o.answer)}
                  className={cn(
                    'min-h-11 px-3 rounded-full border text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua',
                    current === o.answer
                      ? 'border-accent-aqua bg-accent-aqua/15 text-text-primary'
                      : 'border-border-light text-text-secondary',
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
