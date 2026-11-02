import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { FestivalSet, Stage } from '@festie/shared/types';
import TBASection from './TBASection';

const stages = [{ id: 's1', name: 'Main' }, { id: 's2', name: 'Forest' }] as Stage[];
const mk = (id: string, stageId: string) => ({ id, stageId, artist: id, festivalId: 'f' }) as FestivalSet;

function renderTba(sets: FestivalSet[], allTba?: boolean) {
  return render(
    <TBASection
      sets={sets}
      stages={stages}
      getMyPick={() => null}
      getOtherPicks={() => []}
      conflictIds={new Set()}
      currentProfile={null}
      currentFestival={null}
      getStageColor={() => '#ff3366'}
      onSavePick={vi.fn()}
      onOpenDetail={vi.fn()}
      allTba={allTba}
    />,
  );
}

describe('TBASection', () => {
  it('groups by stage in festival order with counts, unknown stage last', () => {
    const { container } = renderTba([mk('z', 's2'), mk('y', 's1'), mk('x', 's1'), mk('w', 'gone')]);
    const headers = [...container.querySelectorAll('[data-stage-header]')].map((h) =>
      h.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(headers).toEqual(['Main · 2', 'Forest · 1', 'Stage not set · 1']);
  });

  it('shows the times-not-out heading when allTba', () => {
    renderTba([mk('a', 's1')], true);
    expect(screen.getByText("Set times aren't out yet")).toBeTruthy();
    expect(screen.getByText(/Pick sets now/)).toBeTruthy();
  });
});
