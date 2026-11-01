import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { FestivalSet } from '@festie/shared/types';
import type { ClashMark } from '@festie/shared/utils';
import TimelineGridCell from './TimelineGridCell';

const ROW_HEIGHT = 36;

function makeSet(id: string): FestivalSet {
  return {
    id,
    festivalId: 'fest-1',
    stageId: 'stage-1',
    artist: id,
    startTime: '14:00',
    endTime: '15:00',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function renderCell(
  id: string,
  topSlot: number,
  spanSlots: number,
  myPick: 'want-to-see' | null = null,
  extra: { clash?: ClashMark; compact?: boolean; tabbable?: boolean } = {},
) {
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
      others={[]}
      compact={extra.compact ?? false}
      tabbable={extra.tabbable ?? true}
      clash={extra.clash}
      hasProfile
      festival={null}
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
});
