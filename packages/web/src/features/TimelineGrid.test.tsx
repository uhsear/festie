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

function renderGrid(vpW: number) {
  const gridRef = createRef<HTMLDivElement>();
  const utils = render(
    <TimelineGrid
      visibleStages={stages}
      timedSets={sets}
      timeBounds={{ minMin: 600, maxMin: 840, totalSlots: 16 }}
      selectedDay={0}
      rowHeight={36}
      vpW={vpW}
      nowIndicator={null}
      clashMarks={new Map()}
      currentProfile={null}
      currentFestival={null}
      gridRef={gridRef}
      getMyPick={() => null}
      getOtherPicks={() => []}
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
});
