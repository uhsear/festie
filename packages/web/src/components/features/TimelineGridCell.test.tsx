import { describe, it, expect, vi } from 'vitest';
import { makeFestivalSet } from '@festie/shared/test-fixtures/festivalSet';
import { fireEvent, render, screen } from '@testing-library/react';
import type { FestivalSet } from '@festie/shared/types';
import type { ClashMark, GridCrewAvatars } from '@festie/shared/utils';
import TimelineGridCell from './TimelineGridCell';
import { useArtistSheetStore } from '@festie/shared/stores/artistSheetStore';

const ROW_HEIGHT = 36;

function makeSet(id: string): FestivalSet {
  return makeFestivalSet({ id, artist: id });
}

function renderCell(
  id: string,
  topSlot: number,
  spanSlots: number,
  myPick: 'want-to-see' | null = null,
  extra: { clash?: ClashMark; compact?: boolean; tabbable?: boolean; canPick?: boolean; crew?: GridCrewAvatars } = {},
) {
  const onNavKey = vi.fn();
  const { container } = render(
    <TimelineGridCell
      set={makeSet(id)}
      stageName="Main"
      stageColor="#ff3366"
      columnIndex={0}
      topSlot={topSlot}
      spanSlots={spanSlots}
      rowHeight={ROW_HEIGHT}
      myPick={myPick}
      crew={extra.crew}
      compact={extra.compact ?? false}
      tabbable={extra.tabbable ?? true}
      clash={extra.clash}
      canPick={extra.canPick ?? true}
      festival={null}
      onNavKey={onNavKey}
      onActivate={vi.fn()}
      onSetClick={vi.fn()}
      onSavePick={vi.fn()}
    />,
  );
  return container.querySelector<HTMLElement>(`[data-set-id="${id}"]`)!;
}

function bounds(el: HTMLElement) {
  const rowStart = Number(el.style.gridRow.split(' / ')[0]) - 2;
  const top = rowStart * ROW_HEIGHT + parseFloat(el.style.marginTop);
  return { top, bottom: top + parseFloat(el.style.height) };
}

describe('TimelineGridCell artist name', () => {
  function renderNamed(set: FestivalSet, onSetClick = vi.fn()) {
    useArtistSheetStore.setState({ target: null, isOpen: false });
    render(
      <TimelineGridCell
        set={set}
        stageName="Main"
        stageColor="#ff3366"
        columnIndex={0}
        topSlot={0}
        spanSlots={4}
        rowHeight={ROW_HEIGHT}
        myPick={null}
        crew={undefined}
        compact={false}
        tabbable
        canPick
        festival={null}
        onNavKey={vi.fn()}
        onActivate={vi.fn()}
        onSetClick={onSetClick}
        onSavePick={vi.fn()}
      />,
    );
    return onSetClick;
  }

  it('opens the artist sheet and not the set, and the cell button still opens the set', () => {
    const onSetClick = renderNamed(makeSet('a'));
    fireEvent.click(screen.getByRole('button', { name: 'Open a' }));
    expect(useArtistSheetStore.getState()).toMatchObject({ isOpen: true, target: { title: 'a' } });
    expect(onSetClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^a, .* to .*, Main$/ }));
    expect(onSetClick).toHaveBeenCalledTimes(1);
  });

  it('opens each B2B artist on its own', () => {
    renderNamed(makeFestivalSet({ id: 'b', artist: 'X b2b Y', artists: [{ name: 'X' }, { name: 'Y' }] }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Y' }));
    expect(useArtistSheetStore.getState().target?.title).toBe('Y');
  });
});

describe('TimelineGridCell block placement', () => {
  it('keeps back-to-back sets with fractional slots from overlapping', () => {
    const a = renderCell('a', 0, 55 / 15);
    const b = renderCell('b', 55 / 15, 4);
    expect(a.style.gridRow).toBe('2 / 6');
    expect(b.style.gridRow).toBe('5 / 10');
    expect(bounds(a).bottom).toBeLessThanOrEqual(bounds(b).top);
  });

  it('uses the on-light accent ink for an active want-to-see pick', () => {
    const el = renderCell('c', 0, 4, 'want-to-see');
    const btn = el.querySelector<HTMLElement>('button[aria-pressed="true"]')!;
    expect(btn.className).toContain('--text-on-light-accent');
    expect(btn.getAttribute('aria-label')).not.toContain('(selected)');
  });

  it('shows the pick row only when canPick is set', () => {
    expect(renderCell('d', 0, 4, null, { canPick: true }).querySelectorAll('button[aria-pressed]').length).toBeGreaterThan(0);
    expect(renderCell('e', 0, 4, null, { canPick: false }).querySelectorAll('button[aria-pressed]').length).toBe(0);
  });

  it('draws a hatched bar for each clash segment and names the clash for screen readers', () => {
    const clash: ClashMark = { segments: [{ from: 0.5, to: 1 }], withIds: ['b'], text: 'Clashes with Beta · Forest' };
    const el = renderCell('d', 0, 4, 'want-to-see', { clash });
    const bars = el.querySelectorAll<HTMLElement>('span[aria-hidden="true"][style*="top"]');
    expect(bars).toHaveLength(1);
    expect(bars[0]!.style.top).toBe('50%');
    expect(bars[0]!.style.height).toBe('50%');
    expect(el.textContent).toContain('Clashes with Beta · Forest');
    expect(el.querySelector<HTMLElement>('[data-open]')!.title).toBe('Clashes with Beta · Forest');
  });

  it('compact hides the pick buttons and shows the pick icon', () => {
    const el = renderCell('e', 0, 4, 'want-to-see', { compact: true });
    expect(el.querySelector('button[aria-pressed]')).toBeNull();
    expect(el.querySelector('svg')).not.toBeNull();
  });

  it('tabbable=false takes the open button out of the tab order', () => {
    const el = renderCell('f', 0, 4, null, { tabbable: false });
    expect(el.querySelector<HTMLElement>('[data-open]')!.tabIndex).toBe(-1);
  });

  const crew: GridCrewAvatars = {
    total: 5,
    overflow: 2,
    label: '5 crew members picked this',
    shown: [
      { key: 'u1', name: 'Amy Lee', priority: 'must' },
      { key: 'u2', name: 'Bo', priority: 'want-to-see' },
      { key: 'u3', name: 'Cy', priority: 'maybe' },
    ],
  };

  const AVATAR = '[class*="ring-[1.5px]"]';

  it('draws up to three avatars plus +N and names the crew for screen readers', () => {
    const el = renderCell('a', 0, 4, null, { crew });
    expect(el.querySelectorAll(AVATAR)).toHaveLength(3);
    expect(el.textContent).toContain('+2');
    expect(el.textContent).toContain('5 crew members picked this: Amy Lee (must)');
  });

  it('falls back to the count on compact cells', () => {
    const el = renderCell('a', 0, 4, null, { crew, compact: true });
    expect(el.querySelectorAll(AVATAR)).toHaveLength(0);
    expect(el.textContent).not.toContain('+2');
    expect(el.textContent).toContain('5');
  });

  it('with no active crew (no avatars) shows the plain count on a full-size cell', () => {
    const el = renderCell('a', 0, 4, null, { crew: { total: 4, shown: [], overflow: 0, label: '4 others picked this' } });
    expect(el.querySelectorAll(AVATAR)).toHaveLength(0);
    expect(el.textContent).toContain('4');
    expect(el.textContent).toContain('4 others picked this');
    expect(el.textContent).not.toContain('others picked this:');
  });
});

describe('TimelineGridCell keyboard', () => {
  it('reports key presses from the open and pick buttons with its set id, and focus as activation', () => {
    const onNavKey = vi.fn();
    const onActivate = vi.fn();
    const { container } = render(
      <TimelineGridCell
        set={makeSet('a')}
        stageName="Main"
        stageColor="#ff3366"
        columnIndex={0}
        topSlot={0}
        spanSlots={4}
        rowHeight={ROW_HEIGHT}
        myPick={null}
        crew={undefined}
        compact={false}
        tabbable
        canPick
        festival={null}
        onNavKey={onNavKey}
        onActivate={onActivate}
        onSetClick={vi.fn()}
        onSavePick={vi.fn()}
      />,
    );
    const open = container.querySelector<HTMLElement>('[data-open]')!;
    const pick = container.querySelector<HTMLElement>('button[aria-pressed]')!;
    fireEvent.keyDown(open, { key: 'ArrowRight' });
    fireEvent.keyDown(pick, { key: 'ArrowDown' });
    expect(onNavKey.mock.calls.map(([e, id]) => [e.key, id])).toEqual([
      ['ArrowRight', 'a'],
      ['ArrowDown', 'a'],
    ]);
    fireEvent.focus(pick);
    expect(onActivate).toHaveBeenCalledWith('a');
  });

  it('activates on click with no focus event (Safari does not focus buttons on click)', () => {
    const onActivate = vi.fn();
    const { container } = render(
      <TimelineGridCell
        set={makeSet('a')}
        stageName="Main"
        stageColor="#ff3366"
        columnIndex={0}
        topSlot={0}
        spanSlots={4}
        rowHeight={ROW_HEIGHT}
        myPick={null}
        crew={undefined}
        compact={false}
        tabbable
        canPick
        festival={null}
        onNavKey={vi.fn()}
        onActivate={onActivate}
        onSetClick={vi.fn()}
        onSavePick={vi.fn()}
      />,
    );
    fireEvent.click(container.querySelector<HTMLElement>('[data-open]')!);
    expect(onActivate).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector<HTMLElement>('button[aria-pressed]')!);
    expect(onActivate).toHaveBeenCalledTimes(2);
    expect(onActivate).toHaveBeenLastCalledWith('a');
  });
});
