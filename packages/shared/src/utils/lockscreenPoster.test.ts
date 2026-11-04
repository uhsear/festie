import { describe, expect, it } from 'vitest';
import type { FestivalDay, FestivalSet, Priority, Stage } from '../types/domain';
import { EDC_SETS, EDC_STAGES } from './lockscreen.fixture';
import type { LockscreenInput, LockscreenMode } from './lockscreen';
import { buildLockscreenModel } from './lockscreenModel';
import { gradientColors, mixHex } from './lockscreenPoster';

const stages: Stage[] = EDC_STAGES.map(([id, name, color]) => ({ id, name, color, festivalId: 'f', createdAt: '', updatedAt: '' }));
const sets: FestivalSet[] = EDC_SETS.map(([id, artist, stageId, startTime, endTime, dayIndex]) => ({
  id, festivalId: 'f', stageId, startTime, endTime, artist, dayIndex, createdAt: '', updatedAt: '',
}));
const days: FestivalDay[] = ['Friday', 'Saturday', 'Sunday'].map((label, i) => ({
  id: `d${i}`, festivalId: 'f', date: `2026-11-0${6 + i}`, label, dayIndex: i, createdAt: '', updatedAt: '',
}));
const cycle: Priority[] = ['must', 'want-to-see', 'maybe'];
const picks = Object.fromEntries(sets.filter((s) => s.dayIndex === 0).slice(0, 12).map((s, i) => [s.id, cycle[i % 3]!]));
const base: LockscreenInput = {
  festival: { name: 'EDC Orlando 2026', b2bSeparator: 'B2B' },
  sets, stages, days, picks, dayIndex: 0, mode: 'picks', theme: 'dark', style: 'poster',
  width: 1179, height: 2556, savedAt: new Date(2026, 10, 3, 14, 41),
};
const MODES: LockscreenMode[] = ['picks', 'full', 'stages', 'crew'];

describe('poster style', () => {
  it('standard style has no poster art', () => {
    const m = buildLockscreenModel({ ...base, style: undefined });
    expect(m.style).toBe('standard');
    expect(m.poster).toBeNull();
    expect(m.pages.every((p) => !p.poster)).toBe(true);
  });

  for (const theme of ['dark', 'light'] as const) {
    for (const mode of MODES) {
      it(`${mode}/${theme}: art and panel respect the safe zones`, () => {
        const m = buildLockscreenModel({ ...base, mode, theme, priorities: mode === 'picks' ? ['must', 'want-to-see'] : undefined });
        expect(m.pages.length).toBeGreaterThan(0);
        const art = m.poster!;
        expect(art.panel.y).toBeGreaterThanOrEqual(m.contentTopU - 1e-6);
        expect(art.panel.y + art.panel.height).toBeLessThanOrEqual(m.contentEndU + 1e-6);
        expect(art.panel.x).toBeGreaterThan(0);
        expect(art.panel.x + art.panel.width).toBeLessThan(100);
        expect(art.beams.length).toBeGreaterThan(0);
        for (const b of art.beams) expect(b.y + b.height).toBeLessThanOrEqual(m.contentTopU);
        for (const p of m.pages) {
          const last = p.body.kind === 'list' ? p.body.rows.at(-1)!.y + p.body.rows.at(-1)!.height : p.body.legendY;
          expect(last).toBeLessThanOrEqual(m.contentEndU + 3.3);
          expect(p.poster!.dayColors).toHaveLength([...p.header.day].length);
          expect(p.poster!.rule.length).toBeGreaterThan(0);
          for (const r of p.poster!.rule) expect(r.y).toBeGreaterThanOrEqual(m.contentTopU);
        }
      });
    }
  }

  it('wraps on whole words in every list row', () => {
    const m = buildLockscreenModel({ ...base, picks: Object.fromEntries(sets.filter((s) => s.dayIndex === 0).slice(0, 30).map((s) => [s.id, 'must' as Priority])) });
    for (const p of m.pages) {
      if (p.body.kind !== 'list') continue;
      for (const row of p.body.rows) {
        const words = new Set(row.artist.split(/\s+/));
        for (const line of row.artistLines) for (const w of line.split(' ')) expect(words.has(w) || w.endsWith('…')).toBe(true);
      }
    }
  });

  it('gradient runs from the first to the last colour', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    const g = gradientColors('FRIDAY', '#00e8d0', '#ff3366');
    expect(g).toHaveLength(6);
    expect(g[0]).toBe('#00e8d0');
    expect(g[5]).toBe('#ff3366');
  });
});
