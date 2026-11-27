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
      canPick={false}
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

  it('lets few stages fill the card: columns grow to a cap and the grid centres', () => {
    const { container } = renderTba([mk('a', 's1'), mk('b', 's2')], true);
    const grid = container.querySelector('[data-stage-header]')!.parentElement!.parentElement!;
    expect(grid.className).toContain('minmax(220px,560px)');
    expect(grid.className).toContain('justify-center');
  });

  it('labels each pick button with its word and keeps the card inside the page gutter', () => {
    const { container } = render(
      <TBASection
        sets={[mk('a', 's1')]}
        stages={stages}
        getMyPick={() => null}
        getOtherPicks={() => []}
        conflictIds={new Set()}
        canPick
        currentFestival={null}
        getStageColor={() => '#ff3366'}
        onSavePick={vi.fn()}
        onOpenDetail={vi.fn()}
        allTba
      />,
    );
    for (const [name, word] of [['Must See', 'Must'], ['Want to See', 'Want'], ['Maybe', 'Maybe']] as const) {
      expect(screen.getByRole('button', { name })).toHaveTextContent(word);
      expect(screen.getByRole('button', { name }).className).toContain('min-h-11');
    }
    expect((container.firstElementChild as HTMLElement).className).toContain('max-md:mx-6');
  });
});
