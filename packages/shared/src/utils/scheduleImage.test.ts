import { describe, it, expect } from 'vitest';
import type { FestivalDay, FestivalSet, Priority, Stage } from '../types/domain';
import {
  buildScheduleImageModel,
  defaultScheduleImageDay,
  scheduleImageFilename,
  SCHEDULE_IMAGE_LAYOUT,
  SCHEDULE_POSTER_METRICS,
} from './scheduleImage';
import type { ScheduleImageFormat } from './scheduleImage';

const stage = (id: string, color?: string): Stage => ({
  id, name: `Stage ${id}`, color, festivalId: 'f', createdAt: '', updatedAt: '',
});
const set = (id: string, startTime: string, dayIndex = 0, stageId = 'a'): FestivalSet => ({
  id, festivalId: 'f', stageId, startTime, endTime: startTime ? '23:59' : '', artist: `Artist ${id}`, dayIndex,
  createdAt: '', updatedAt: '',
});
const days: FestivalDay[] = [
  { id: 'd0', festivalId: 'f', date: '2026-09-05', label: 'Saturday', createdAt: '', updatedAt: '' },
  { id: 'd1', festivalId: 'f', date: '2026-09-06', label: 'Sunday', createdAt: '', updatedAt: '' },
];
const festival = { name: 'Test Fest' };

describe('buildScheduleImageModel', () => {
  it('keeps 12 rows in story format, all Must picks, in time order', () => {
    const sets: FestivalSet[] = [];
    const picks: Record<string, Priority> = {};
    for (let i = 0; i < 15; i++) {
      const id = `s${i}`;
      sets.push(set(id, `${String(12 + (i % 10)).padStart(2, '0')}:${i < 10 ? '00' : '30'}`));
      picks[id] = i < 4 ? 'must' : i < 9 ? 'want-to-see' : 'maybe';
    }
    const m = buildScheduleImageModel({ festival, sets, stages: [stage('a')], days, picks, dayIndex: 0, format: 'story' });
    expect(m.rows).toHaveLength(12);
    expect(m.hiddenCount).toBe(3);
    for (const id of ['s0', 's1', 's2', 's3']) expect(m.rows.some((r) => r.setId === id)).toBe(true);
    const mins = m.rows.map((r) => r.time);
    expect(mins).toEqual([...mins].sort((a, b) => {
      const f = (t: string) => ((parseInt(t, 10) % 12) + (t.endsWith('PM') ? 12 : 0)) * 60 + parseInt(t.split(':')[1]!, 10);
      return f(a) - f(b);
    }));
    expect(m.footer).toBe('+3 more picks in Festie · festie.us');
  });

  it('sorts 00:30 after 23:00', () => {
    const sets = [set('late', '00:30'), set('early', '23:00')];
    const picks: Record<string, Priority> = { late: 'must', early: 'must' };
    const m = buildScheduleImageModel({ festival, sets, stages: [stage('a')], days, picks, dayIndex: 0, format: 'story' });
    expect(m.rows.map((r) => r.setId)).toEqual(['early', 'late']);
  });

  it('counts TBA picks and builds the footer', () => {
    const sets = [set('t1', ''), set('ok', '20:00')];
    const picks: Record<string, Priority> = { t1: 'must', ok: 'must' };
    const m = buildScheduleImageModel({ festival, sets, stages: [stage('a')], days, picks, dayIndex: 0, format: 'story' });
    expect(m.rows.map((r) => r.setId)).toEqual(['ok']);
    expect(m.tbaCount).toBe(1);
    expect(m.footer).toBe('+1 with no set time yet · festie.us');
  });

  it('uses the spec footer for hidden 3 and TBA 1, and singular for hidden 1', () => {
    const mk = (n: number, tba: number) => {
      const sets: FestivalSet[] = [];
      const picks: Record<string, Priority> = {};
      for (let i = 0; i < n; i++) { sets.push(set(`s${i}`, `1${i % 10}:00`)); picks[`s${i}`] = 'must'; }
      for (let i = 0; i < tba; i++) { sets.push(set(`t${i}`, '')); picks[`t${i}`] = 'must'; }
      return buildScheduleImageModel({ festival, sets, stages: [stage('a')], days, picks, dayIndex: 0, format: 'lockscreen' });
    };
    expect(mk(9 + 3, 1).footer).toBe('+3 more picks in Festie · +1 with no set time yet · festie.us');
    expect(mk(9 + 1, 0).footer).toBe('+1 more pick in Festie · festie.us');
  });

  it('gives null stageColor for a bad colour and day label with date', () => {
    const sets = [set('x', '20:00', 0, 'a'), set('y', '21:00', 0, 'b')];
    const picks: Record<string, Priority> = { x: 'must', y: 'must' };
    const m = buildScheduleImageModel({
      festival, sets, stages: [stage('a', 'red; evil'), stage('b', '#ff3366')], days, picks, dayIndex: 0, format: 'story',
    });
    expect(m.rows[0]!.stageColor).toBeNull();
    expect(m.rows[1]!.stageColor).toBe('#ff3366');
    expect(m.dayLabel).toBe('Saturday · Sep 5');
    expect(SCHEDULE_IMAGE_LAYOUT.lockscreen.maxRows).toBe(9);
  });
});

describe('defaultScheduleImageDay', () => {
  const sets = [set('a', '20:00', 0), set('b', '20:00', 1), set('c', '', 2)];
  it('returns the selected day when it has timed picks', () => {
    expect(defaultScheduleImageDay({ sets, picks: { a: 'must', b: 'must' }, selectedDay: 1 })).toBe(1);
  });
  it('returns the first day with timed picks otherwise', () => {
    expect(defaultScheduleImageDay({ sets, picks: { b: 'must', c: 'must' }, selectedDay: 2 })).toBe(1);
  });
  it('returns null when no day has a timed pick', () => {
    expect(defaultScheduleImageDay({ sets, picks: { c: 'must' }, selectedDay: 0 })).toBeNull();
    expect(defaultScheduleImageDay({ sets, picks: undefined, selectedDay: 0 })).toBeNull();
  });
});

describe('scheduleImageFilename', () => {
  it('slugs festival and day', () => {
    expect(scheduleImageFilename('EDC Orlando', 'Saturday', 'lockscreen')).toBe('festie-edc-orlando-saturday-lockscreen.png');
    expect(scheduleImageFilename('A'.repeat(60), 'Day 1 · Sep 5', 'story')).toBe(`festie-${'a'.repeat(40)}-day-1-sep-5-story.png`);
  });
});

describe('print format', () => {
  it('is A4 portrait at 150 dpi with 24 rows and a -print.png name', () => {
    expect(SCHEDULE_IMAGE_LAYOUT.print).toMatchObject({ width: 1240, height: 1754, topReserve: 0, bottomReserve: 0, maxRows: 24 });
    expect(scheduleImageFilename('EDC Orlando', 'Saturday', 'print')).toBe('festie-edc-orlando-saturday-print.png');
    const sets = Array.from({ length: 30 }, (_, i) => set(`p${i}`, `${String(12 + (i % 12)).padStart(2, '0')}:00`));
    const picks = Object.fromEntries(sets.map((s) => [s.id, 'must' as Priority]));
    const m = buildScheduleImageModel({ festival, sets, stages: [stage('a')], days, picks, dayIndex: 0, format: 'print' });
    expect(m.rows).toHaveLength(24);
    expect(m.hiddenCount).toBe(6);
  });
});

describe('poster layout', () => {
  const M = SCHEDULE_POSTER_METRICS;
  const chrome = M.titleLine + M.dayGapTop + M.dayLine + M.dayGapBottom + M.footerGapTop + M.footerLine;
  it.each(Object.keys(SCHEDULE_IMAGE_LAYOUT) as ScheduleImageFormat[])('%s: max rows fit between the reserves', (format) => {
    const L = SCHEDULE_IMAGE_LAYOUT[format];
    const top = L.topReserve || M.padY;
    const bottom = L.bottomReserve || M.padY;
    expect(L.maxRows * L.rowHeight + chrome).toBeLessThanOrEqual(L.height - top - bottom);
    // The scaled row content still fits its row.
    const k = L.rowHeight / M.row.base;
    expect((M.row.artistLine + M.row.stageLine) * k).toBeLessThanOrEqual(L.rowHeight);
  });
});
