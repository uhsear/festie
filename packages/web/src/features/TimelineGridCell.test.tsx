import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { FestivalSet } from '@festie/shared/types';
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

function renderCell(id: string, topSlot: number, spanSlots: number, myPick: 'want-to-see' | null = null, canPick = true) {
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
      hasConflict={false}
      canPick={canPick}
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

  it('shows the pick row only when canPick is set', () => {
    expect(renderCell('d', 0, 4, null, true).querySelectorAll('button[aria-pressed]').length).toBeGreaterThan(0);
    expect(renderCell('e', 0, 4, null, false).querySelectorAll('button[aria-pressed]').length).toBe(0);
  });
});
