import { useState } from 'react';
import { useFestivalStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { useFestival, usePicks, useSetContext } from '@festie/shared/hooks';
import { COPY, PRIORITY_LABELS } from '@festie/shared/constants';
import { artistDisplayName } from '@festie/shared/utils';
import type { SetContextEntry } from '@festie/shared/utils';
import type { FestivalSet } from '@festie/shared/types';
import ArtistName, { RowOpenButton } from './ArtistName';

/** "Also on <stage>" neighbours and "Playing at the same time". Each part hides when empty. */
// The same preview length as the mobile section, so the sheet does not grow past the first three overlaps.
const OVERLAP_PREVIEW_LIMIT = 3;

export default function SetContextSection({ set }: { set: FestivalSet }) {
  const { before, after, overlaps } = useSetContext(set);
  const { getStageName } = useFestival();
  const separator = useFestivalStore((s) => s.currentFestival?.b2bSeparator);
  const setDetailSet = useUIStore((s) => s.setDetailSet);
  const { getMyPick } = usePicks();
  const [showAllOverlaps, setShowAllOverlaps] = useState(false);

  const stageName = (s: FestivalSet) => getStageName(s.stageId) ?? s.stageName ?? '';

  const row = (e: SetContextEntry, lead?: string) => {
    const artist = artistDisplayName(e.set, separator);
    const stage = stageName(e.set);
    const pick = getMyPick(e.set.id);
    return (
      <li key={e.set.id}>
        <div className="relative flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-bg-input">
          <RowOpenButton label={COPY.setContext.openA11y(artist, stage, e.time)} onClick={() => setDetailSet(e.set)} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-text-primary">
              {lead && <span className="font-normal text-text-muted">{lead}: </span>}
              <ArtistName set={e.set} separator={separator} />
            </span>
            <span className="block text-xs text-text-muted">{lead ? e.time : `${stage} · ${e.time}`}</span>
          </span>
          {pick && <span className="text-sm font-medium text-accent-aqua">{PRIORITY_LABELS[pick]}</span>}
        </div>
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
          <ul className="space-y-1">
            {(showAllOverlaps ? overlaps : overlaps.slice(0, OVERLAP_PREVIEW_LIMIT)).map((e) => row(e))}
          </ul>
          {!showAllOverlaps && overlaps.length > OVERLAP_PREVIEW_LIMIT && (
            <button
              type="button"
              className="mt-1 min-h-11 px-3 text-sm font-semibold text-accent-aqua cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua"
              aria-label={COPY.setContext.overlapSeeAllA11y(overlaps.length)}
              onClick={() => setShowAllOverlaps(true)}
            >
              {COPY.setContext.overlapSeeAll(overlaps.length)}
            </button>
          )}
        </section>
      )}
    </>
  );
}
