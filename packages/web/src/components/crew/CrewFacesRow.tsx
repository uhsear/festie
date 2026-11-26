import { useCrewFaces, useFestival } from '@festie/shared/hooks';
import { useFestivalStore } from '@festie/shared/stores';
import { resolveFestivalTimeZone, resolveStageColor } from '@festie/shared/utils';
import { useNow } from '../../hooks/useSetStatus';
import { useLastKnownFix } from '../../hooks/useLastKnownFix';
import Avatar from '../ui/Avatar';
import { cn } from '@/lib/utils';

/**
 * The crew hub's lead row: each crewmate's face, ringed in the colour of the stage
 * they stand at, with their walk time or when they were last seen.
 */
export default function CrewFacesRow() {
  const days = useFestivalStore((s) => s.days);
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const { getStageColor } = useFestival();
  const nowMs = useNow();
  const faces = useCrewFaces(nowMs, days, useLastKnownFix(), resolveFestivalTimeZone(currentFestival));
  if (faces.length === 0) return null;

  return (
    <section aria-label="Your crew right now" data-testid="crew-faces">
      <ul className="m-0 flex list-none gap-4 overflow-x-auto p-0 pb-1">
        {faces.map((f) => (
          <li key={f.userId} className="flex w-20 shrink-0 flex-col items-center gap-1 text-center">
            <span
              className={cn('rounded-full border-2 p-0.5', f.stageId ? '' : 'border-border')}
              style={f.stageId ? { borderColor: resolveStageColor(getStageColor(f.stageId), 'var(--color-border)') } : undefined}
            >
              <Avatar name={f.name} size="md" />
            </span>
            <span className="type-label w-full truncate font-semibold text-text-primary">{f.name}</span>
            <span className={cn('type-caption w-full tabular-nums', f.sos ? 'font-bold text-text-danger' : 'text-text-secondary')}>
              {f.caption}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
