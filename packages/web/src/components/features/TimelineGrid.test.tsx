import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { render, fireEvent } from '@testing-library/react';
import type { FestivalSet, Stage } from '@festie/shared/types';
import TimelineGrid from './TimelineGrid';

const stage = (id: string, name: string) => ({ id, name }) as Stage;
const stages = [stage('s1', 'Main'), stage('s2', 'Forest'), stage('s3', 'Bass')];

function set(id: string, stageId: string, startTime: string, endTime: string): FestivalSet {
  return {
    id, festivalId: 'f', stageId, artist: id, startTime, endTime,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  } as FestivalSet;
}
const sets = [set('alpha', 's1', '10:00', '11:00'), set('beta', 's2', '10:30', '11:30'), set('gamma', 's1', '12:00', '13:00')];

function renderGrid(vpW: number, nowIndicator: number | null = null) {
  const gridRef = createRef<HTMLDivElement>();
  const utils = render(
    <TimelineGrid
      visibleStages={stages}
      timedSets={sets}
      timeBounds={{ minMin: 600, maxMin: 840, totalSlots: 16 }}
      selectedDay={0}
      rowHeight={36}
      vpW={vpW}
      nowIndicator={nowIndicator}
      clashMarks={new Map()}
      canPick={false}
      currentFestival={null}
      gridRef={gridRef}
      getMyPick={() => null}
      crewBySet={new Map()}
      getStageColor={() => '#ff3366'}
      onSetClick={vi.fn()}
      onSavePick={vi.fn()}
    />,
  );
  return { ...utils, root: gridRef.current! };
}

describe('TimelineGrid', () => {
  it('uses two-up 169px columns and no min width on a phone', () => {
    const { root } = renderGrid(390);
    expect(root.style.gridTemplateColumns).toContain('169px');
    expect(root.className).not.toContain('min-w-[800px]');
  });

  it('keeps one tab stop and moves focus with arrow keys', () => {
    const { container } = renderGrid(1024);
    const open = (id: string) => container.querySelector<HTMLElement>(`[data-set-id="${id}"] [data-open]`)!;
    expect([...container.querySelectorAll<HTMLElement>('[data-open]')].filter((b) => b.tabIndex === 0)).toHaveLength(1);
    open('alpha').focus();
    fireEvent.keyDown(open('alpha'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(open('beta'));
    fireEvent.keyDown(open('beta'), { key: 'ArrowLeft' });
    fireEvent.keyDown(open('alpha'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(open('gamma'));
  });

  it('blanks the axis label under the NOW pill and prints the others', () => {
    // 75% of a 240 minute axis from 10:00 is 13:00, an axis label.
    const on = renderGrid(1024, 75);
    const labels = (c: HTMLElement) => [...c.querySelectorAll('[class*="sticky left-0"]')].map((n) => n.textContent);
    expect(labels(on.container)).not.toContain('1p');
    expect(labels(on.container)).toContain('12p');
    on.unmount();
    const off = renderGrid(1024, null);
    expect(labels(off.container)).toContain('1p');
    off.unmount();
    // 10:20 is 20 minutes from the 10:30 label and 20 from 10:00: neither is blanked.
    const between = renderGrid(1024, (20 / 240) * 100 + 0);
    expect(labels(between.container)).toContain('10a');
  });

  it('places the now line inside a track spanning only the time rows', () => {
    const { getByTestId } = renderGrid(1024, 75);
    const track = getByTestId('now-track');
    expect(track.style.gridRow).toBe('2 / span 16');
    expect(track.style.gridColumn).toBe('2 / -1');
    expect((track.firstElementChild as HTMLElement).style.top).toBe('75%');
  });
});
