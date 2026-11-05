import { useFestivalStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { usePicks, useSetContext } from '@festie/shared/hooks';
import { COPY, PRIORITY_LABELS } from '@festie/shared/constants';
import { artistDisplayName } from '@festie/shared/utils';
import type { SetContextEntry } from '@festie/shared/utils';
import type { FestivalSet } from '@festie/shared/types';

/** "On <stage> that night" neighbours and "Playing at the same time". Each part hides when empty. */
export default function SetContextSection({ set }: { set: FestivalSet }) {
  const { before, after, overlaps } = useSetContext(set);
  const stages = useFestivalStore((s) => s.stages);
  const separator = useFestivalStore((s) => s.currentFestival?.b2bSeparator);
  const setDetailSet = useUIStore((s) => s.setDetailSet);
  const { getMyPick } = usePicks();

  const stageName = (s: FestivalSet) => stages.find((st) => st.id === s.stageId)?.name ?? s.stageName ?? '';

  const row = (e: SetContextEntry, lead?: string) => {
    const artist = artistDisplayName(e.set, separator);
    const stage = stageName(e.set);
    const pick = getMyPick(e.set.id);
    return (
      <li key={e.set.id}>
        <button
          type="button"
          onClick={() => setDetailSet(e.set)}
          aria-label={COPY.setContext.openA11y(artist, stage, e.time)}
          className="flex min-h-[44px] w-full items-center gap-2 rounded-xl px-3 py-2 text-left cursor-pointer hover:bg-bg-input focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-text-primary">
              {lead && <span className="font-normal text-text-muted">{lead}: </span>}
              {artist}
            </span>
            <span className="block text-xs text-text-muted">{lead ? e.time : `${stage} · ${e.time}`}</span>
          </span>
          {pick && <span className="text-xs text-accent-aqua">{PRIORITY_LABELS[pick]}</span>}
        </button>
      </li>
    );
  };

  const neighbours = [
    before && row(before, COPY.setContext.before),
    after && row(after, COPY.setContext.after),
  ].filter(Boolean);

  return (
    <>
      {neighbours.length > 0 && (
        <section aria-labelledby="set-context-stage-heading" className="mt-3">
          <h3
            id="set-context-stage-heading"
            className="mb-2 text-[length:var(--font-size-12)] uppercase tracking-wide text-text-muted"
          >
            {COPY.setContext.stageHeading(stageName(set))}
          </h3>
          <ul className="space-y-1">{neighbours}</ul>
        </section>
      )}
      {overlaps.length > 0 && (
        <section aria-labelledby="set-context-overlap-heading" className="mt-3">
          <h3
            id="set-context-overlap-heading"
            className="mb-2 text-[length:var(--font-size-12)] uppercase tracking-wide text-text-muted"
          >
            {COPY.setContext.overlapHeading}
          </h3>
          <ul className="space-y-1">{overlaps.map((e) => row(e))}</ul>
        </section>
      )}
    </>
  );
}
