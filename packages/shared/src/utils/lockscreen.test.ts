import { describe, expect, it } from 'vitest';
import type { FestivalDay, FestivalSet, Priority, Stage } from '../types/domain';
import { EDC_SETS, EDC_STAGES } from './lockscreen.fixture';
import type { LockscreenGridPage, LockscreenInput, LockscreenListPage } from './lockscreen';
import {
  balancedRanges,
  buildLockscreenModel,
  contrastRatio,
  fitArtistU,
  gridPages,
  inkOn,
  lockscreenFilename,
  lockscreenSizeFromScreen,
  paginateRows,
  stageMark,
  stageText,
  wrapArtist,
} from './lockscreenModel';
import { defaultScheduleImageDay } from './scheduleImage';

const stages: Stage[] = EDC_STAGES.map(([id, name, color]) => ({
  id, name, color, festivalId: 'f', createdAt: '', updatedAt: '',
}));
const sets: FestivalSet[] = EDC_SETS.map(([id, artist, stageId, startTime, endTime, dayIndex]) => ({
  id, festivalId: 'f', stageId, startTime, endTime, artist, dayIndex, createdAt: '', updatedAt: '',
}));
const days: FestivalDay[] = ['Friday', 'Saturday', 'Sunday'].map((label, i) => ({
  id: `d${i}`, festivalId: 'f', date: `2026-11-0${6 + i}`, label, dayIndex: i, createdAt: '', updatedAt: '',
}));
const friday = sets.filter((s) => s.dayIndex === 0);
const cycle: Priority[] = ['must', 'want-to-see', 'maybe'];
const pick = (list: FestivalSet[], n: number): Record<string, Priority> =>
  Object.fromEntries(list.slice(0, n).map((s, i) => [s.id, cycle[i % 3]!]));
const spread = (n: number): Record<string, Priority> =>
  Object.fromEntries(
    friday.filter((_, i) => i % Math.floor(44 / n) === 0).slice(0, n).map((s, i) => [s.id, cycle[i % 3]!]),
  );

const base: LockscreenInput = {
  festival: { name: 'EDC Orlando 2026', b2bSeparator: 'B2B' },
  sets, stages, days, picks: {}, dayIndex: 0, mode: 'picks', theme: 'dark',
  width: 1179, height: 2556, savedAt: new Date(2026, 10, 3, 14, 41),
};
type Model = ReturnType<typeof buildLockscreenModel>;
const build = (over: Partial<LockscreenInput>) => buildLockscreenModel({ ...base, ...over });
const ids = (m: Model) => m.pages.flatMap((p) => p.setIds);
const list = (m: Model, i = 0) => m.pages[i]!.body as LockscreenListPage;
const grid = (m: Model, i = 0) => m.pages[i]!.body as LockscreenGridPage;

describe('helpers', () => {
  it('balances 14 as 7+7, never 12+2', () => {
    expect(balancedRanges(14, 2)).toEqual([[0, 7], [7, 14]]);
    expect(balancedRanges(5, 2)).toEqual([[0, 3], [3, 5]]);
  });
  it('paginateRows uses the fewest pages and falls back to one row per page', () => {
    expect(paginateRows([5, 5, 5, 5], 20)).toEqual([[0, 4]]);
    expect(paginateRows([5, 5, 5, 5], 10)).toEqual([[0, 2], [2, 4]]);
    expect(paginateRows([30, 30], 10)).toEqual([[0, 1], [1, 2]]);
    expect(paginateRows([], 10)).toEqual([]);
  });
  it('fitArtistU shrinks until the longest word fits, with a floor', () => {
    expect(fitArtistU('Ab', 4, 2.6, 50)).toBe(4);
    expect(fitArtistU('Extraordinarily', 4, 2.6, 25)).toBeLessThan(4);
    expect(fitArtistU('Supercalifragilisticexpialidocious', 4, 2.6, 10)).toBe(2.6);
  });
  it('wrapArtist never splits a word: it wraps between words and ellipsizes an overlong one', () => {
    expect(wrapArtist('Fury with MC Dino', 6.4, 55)).toEqual(['Fury with MC', 'Dino']);
    const lines = wrapArtist('Supercalifragilisticexpialidocious', 4, 20);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.endsWith('…')).toBe(true);
    expect(lines[0]!).not.toContain('-');
  });
  it('gridPages cuts on whole hours with one hour height', () => {
    const { pages, hourU } = gridPages(780, 1440, [800, 900, 1000, 1300], 5, 72, false);
    expect(pages.length).toBe(2);
    expect(pages[0]!.endMinute).toBe(pages[1]!.startMinute);
    for (const p of pages) expect(p.startMinute % 60).toBe(0);
    expect(hourU).toBeGreaterThanOrEqual(11.5);
  });
  it('builds filenames and falls back to a default size', () => {
    expect(lockscreenFilename('EDC Orlando 2026', 'Friday', 'full', 1, 2)).toBe('festie-edc-orlando-fri-full-1of2.png');
    expect(lockscreenSizeFromScreen(393, 852, 3)).toEqual({ width: 1179, height: 2556 });
    expect(lockscreenSizeFromScreen(1024, 768, 2)).toEqual({ width: 1290, height: 2796 });
  });
});

describe('contrast', () => {
  it('holds 4.5 / 3 / 4.5 for every EDC stage in both themes', () => {
    for (const [, , color] of EDC_STAGES) {
      for (const theme of ['dark', 'light'] as const) {
        const bg = theme === 'dark' ? '#0a0a0a' : '#ffffff';
        expect(contrastRatio(stageText(color, theme), bg)).toBeGreaterThanOrEqual(4.5);
        const mark = stageMark(color, theme);
        expect(contrastRatio(mark, bg)).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(inkOn(mark), mark)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('list modes', () => {
  it('3 picks: XL or L, one page, nothing lost', () => {
    const picks = pick(friday, 3);
    const m = build({ picks });
    expect(m.pages).toHaveLength(1);
    expect(['XL', 'L']).toContain(list(m).tier);
    expect(ids(m).sort()).toEqual(Object.keys(picks).sort());
    expect(m.pages[0]!.header.pageChip).toBeNull();
    expect(m.pages[0]!.header.day).toBe('FRIDAY');
  });
  it('9 picks: tier M on one page inside the content band', () => {
    const m = build({ picks: spread(9) });
    expect(m.pages).toHaveLength(1);
    expect(list(m).tier).toBe('M');
    expect(ids(m)).toHaveLength(9);
    const last = list(m).rows.at(-1)!;
    expect(last.y + last.height).toBeLessThanOrEqual(m.contentEndU + 1e-6);
    expect(list(m).rows[0]!.y).toBeGreaterThanOrEqual(m.contentTopU + 11);
  });
  it('14 picks split 7+7 and keep every set', () => {
    const picks = pick(friday, 14);
    const m = build({ picks });
    expect(m.pages.map((p) => p.setIds.length)).toEqual([7, 7]);
    expect(ids(m).sort()).toEqual(Object.keys(picks).sort());
    expect(m.pages.map((p) => p.header.pageChip)).toEqual(['1/2', '2/2']);
    expect(m.pages[0]!.header.metaBottom).toMatch(/ · to \d/);
    expect(m.pages[1]!.footer.text).toContain('image 2 of 2');
    for (const p of m.pages) {
      const last = (p.body as LockscreenListPage).rows.at(-1)!;
      expect(last.y + last.height).toBeLessThanOrEqual(m.contentEndU + 1e-6);
    }
  });
  it('priority filter keeps only the chosen priorities', () => {
    const m = build({ picks: pick(friday, 9), priorities: ['must'] });
    expect(ids(m)).toHaveLength(3);
    expect(list(m).rows.every((r) => r.priority === 'must')).toBe(true);
    expect(m.pages[0]!.header.metaBottom).toBe('Must-sees · 3');
  });
  it('the big clock moves the band down and never loses a set', () => {
    const picks = spread(9);
    const normal = build({ picks });
    const tall = build({ picks, tallClock: true });
    expect(tall.contentTopU).toBeGreaterThan(normal.contentTopU);
    expect(tall.pages.length).toBeGreaterThanOrEqual(normal.pages.length);
    expect(ids(tall)).toHaveLength(9);
  });
  it('a past-midnight set sorts after 23:00 and triggers the divider', () => {
    const late: FestivalSet[] = [
      { ...friday[0]!, id: 'late', artist: 'Late One', startTime: '00:30', endTime: '02:00' },
      { ...friday[1]!, id: 'eve', artist: 'Evening', startTime: '23:00', endTime: '23:50' },
      { ...friday[2]!, id: 'aft', artist: 'Afternoon', startTime: '15:00', endTime: '16:00' },
    ];
    const m = build({ sets: late, picks: { late: 'must', eve: 'want-to-see', aft: 'maybe' } });
    expect(list(m).rows.map((r) => r.setId)).toEqual(['aft', 'eve', 'late']);
    expect(list(m).divider).toMatchObject({ beforeIndex: 2, label: 'AFTER MIDNIGHT · STILL FRIDAY' });
  });
  it('flags clashes only between the user own picks', () => {
    const a: FestivalSet = { ...friday[0]!, id: 'a', artist: 'Aaa', startTime: '20:00', endTime: '21:00', stageId: 'bacardi' };
    const b: FestivalSet = { ...friday[1]!, id: 'b', artist: 'Bbb', startTime: '20:30', endTime: '21:30', stageId: 'neon-garden' };
    const c: FestivalSet = { ...friday[2]!, id: 'c', artist: 'Ccc', startTime: '20:00', endTime: '21:00', stageId: 'neon-garden' };
    const both = build({ sets: [a, b, c], picks: { a: 'must', b: 'must' } });
    expect(list(both).rows.find((r) => r.setId === 'a')!.clash!.label).toMatch(/Bbb/);
    expect(list(both).rows.some((r) => r.setId === 'c')).toBe(false);
    const other = build({ sets: [a, b, c], picks: { a: 'must', c: 'maybe' } });
    expect(list(other).rows.find((r) => r.setId === 'a')!.clash!.label).toMatch(/Ccc/);
    const unpicked = build({ sets: [a, b, c], picks: { a: 'must' } });
    expect(list(unpicked).rows[0]!.clash).toBeNull();
  });
  it('crew mode attaches initials, skips the user, and marks solo sets', () => {
    const picks = pick(friday, 2);
    const [s0, s1] = Object.keys(picks) as [string, string];
    const member = (userId: string, name: string) => ({ userId, name });
    const m = build({
      mode: 'crew',
      picks,
      selfUserId: 'me',
      crewOverlap: {
        [s0]: {
          setId: s0,
          memberCount: 5,
          members: [member('me', 'Me Self'), member('a', 'Jordan Lee'), member('b', 'Mika'), member('c', 'Priya Rao'), member('d', 'Dee Dee'), member('e', 'Eli')],
        },
      },
    });
    const rows = list(m).rows;
    expect(rows.find((r) => r.setId === s0)!.crew).toEqual({ initials: ['JL', 'MI', 'PR'], more: 2, solo: false });
    expect(rows.find((r) => r.setId === s1)!.crew).toMatchObject({ solo: true });
    expect(m.pages[0]!.header.metaBottom).toBe('Picks + crew · 2');
  });
  it('all days builds one series per day with a day-specific header', () => {
    const picks = { ...pick(friday, 2), ...pick(sets.filter((s) => s.dayIndex === 2), 1) };
    const m = build({ picks, dayIndex: 'all' });
    expect(m.pages.map((p) => p.dayIndex)).toEqual([0, 2]);
    expect(m.pages.map((p) => p.header.day)).toEqual(['FRIDAY', 'SUNDAY']);
    expect(m.pages[1]!.footer.text).toContain('image 2 of 2');
  });
  it('an empty result has no pages', () => {
    const m = build({ picks: {} });
    expect(m.empty).toBe(true);
    expect(m.pages).toEqual([]);
  });
});

describe('theme and zones', () => {
  it('dark has a glow, sunlight has a dark top and a white sheet', () => {
    const dark = build({ picks: pick(friday, 3) });
    expect(dark.background.glow).not.toBeNull();
    expect(dark.pages[0]!.footer.showMark).toBe(true);
    const light = build({ picks: pick(friday, 3), theme: 'light' });
    expect(light.background.sheet).toMatchObject({ color: '#ffffff', radiusU: 3 });
    expect(light.background.sheet!.topU).toBeCloseTo(light.contentTopU - 2);
    expect(light.pages[0]!.footer.showMark).toBe(false);
  });
  it('content sits in 0.38 to 0.80 of the height, 0.45 with the big clock', () => {
    const m = build({ picks: pick(friday, 3) });
    expect(m.contentTopU / m.heightU).toBeCloseTo(0.38);
    expect(m.contentEndU / m.heightU).toBeCloseTo(0.8);
    expect(build({ picks: pick(friday, 3), tallClock: true }).contentTopU / m.heightU).toBeCloseTo(0.45);
  });
  it('stamps the save time and the re-save hint', () => {
    expect(build({ picks: pick(friday, 3) }).pages[0]!.footer.text).toBe(
      'festie.us · Saved Nov 3, 2:41 PM · set times can change, re-save in Festie',
    );
  });
});

describe('grid modes', () => {
  it('full Friday (44 sets, 5 stages) gives 2 pages with every set once', () => {
    const m = build({ mode: 'full', picks: pick(friday, 6) });
    expect(m.pages).toHaveLength(2);
    expect(ids(m).sort()).toEqual(friday.map((s) => s.id).sort());
    const [a, b] = [grid(m, 0), grid(m, 1)];
    expect(a.hourU).toBe(b.hourU);
    expect(a.endMinute).toBe(b.startMinute);
    expect(a.startMinute % 60).toBe(0);
    expect(a.columns).toHaveLength(5);
    for (const p of [a, b]) {
      expect(p.gridY + ((p.endMinute - p.startMinute) / 60) * p.hourU).toBeLessThanOrEqual(m.contentEndU + 1e-6);
    }
    expect(m.pages[0]!.header.metaBottom).toMatch(/^Full lineup · /);
  });
  it('highlights picks and flags sets cut by a page edge as carry-overs', () => {
    const picks = pick(friday, 6);
    const m = build({ mode: 'full', picks });
    const blocks = m.pages.flatMap((p) => (p.body as LockscreenGridPage).blocks);
    expect(new Set(blocks.filter((b) => b.picked).map((b) => b.setId))).toEqual(new Set(Object.keys(picks)));
    expect(blocks.filter((b) => !b.picked).every((b) => b.fill === m.palette.surface)).toBe(true);
    const cut = grid(m, 1).startMinute;
    const carried = grid(m, 1).blocks.filter((b) => b.carryOver);
    for (const c of carried) {
      expect(c.carryLabel).toMatch(/^↑ /);
      expect(c.y).toBeCloseTo(grid(m, 1).gridY);
      const start = friday.find((s) => s.id === c.setId)!.startTime;
      expect(parseInt(start, 10) * 60 + parseInt(start.slice(3), 10)).toBeLessThan(cut);
    }
    expect(m.pages[1]!.setIds.some((id) => carried.some((c) => c.setId === id))).toBe(false);
  });
  it('the one image option forces a single page', () => {
    const m = build({ mode: 'full', picks: pick(friday, 3), onePage: true });
    expect(m.pages).toHaveLength(1);
    expect(ids(m)).toHaveLength(44);
  });
  it('2 stages for an afternoon fit one page and show time inline', () => {
    const two = friday.filter((s) => ['kinetic-field', 'bacardi'].includes(s.stageId) && s.startTime < '19:00' && s.endTime <= '19:00');
    const m = build({ mode: 'stages', sets: two, stageIds: ['kinetic-field', 'bacardi'] });
    expect(m.pages).toHaveLength(1);
    expect(grid(m).columns).toHaveLength(2);
    expect(m.pages[0]!.header.metaBottom).toMatch(/^2 stages · /);
    const withText = grid(m).blocks.filter((b) => b.textMode === 'full');
    expect(withText.length).toBeGreaterThan(0);
    expect(withText.every((b) => b.inlineTime !== null)).toBe(true);
  });
  it('stages mode keeps only the chosen stages', () => {
    const m = build({ mode: 'stages', stageIds: ['neon-garden'] });
    expect(grid(m).columns.map((c) => c.stageId)).toEqual(['neon-garden']);
    expect(ids(m).sort()).toEqual(friday.filter((s) => s.stageId === 'neon-garden').map((s) => s.id).sort());
  });
  it('late sets stay on the same day and draw a dashed midnight line', () => {
    const late: FestivalSet[] = [
      { ...friday[0]!, id: 'x1', startTime: '22:00', endTime: '23:30', stageId: 'bacardi' },
      { ...friday[1]!, id: 'x2', startTime: '00:30', endTime: '02:00', stageId: 'bacardi' },
    ];
    const m = build({ mode: 'full', sets: late });
    const g = grid(m);
    expect(g.hours.some((h) => h.dashed && h.label === '12a')).toBe(true);
    expect(ids(m).sort()).toEqual(['x1', 'x2']);
    expect(g.blocks.find((b) => b.setId === 'x2')!.y).toBeGreaterThan(g.blocks.find((b) => b.setId === 'x1')!.y);
  });
  it('picked blocks use readable ink; sunlight adds an outline; must gets a ring', () => {
    const id = friday[0]!.id;
    const m = build({ mode: 'full', picks: { [id]: 'must' }, theme: 'light' });
    const b = m.pages.flatMap((p) => (p.body as LockscreenGridPage).blocks).find((x) => x.setId === id)!;
    expect(b.outline).toBe('#0b0b12');
    expect(b.ring).toBe(true);
    expect(contrastRatio(b.ink, b.fill)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('defaultScheduleImageDay with a mode', () => {
  it('full needs sets, not picks', () => {
    expect(defaultScheduleImageDay({ sets, picks: undefined, selectedDay: 1 })).toBeNull();
    expect(defaultScheduleImageDay({ sets, picks: undefined, selectedDay: 1, mode: 'full' })).toBe(1);
  });

  describe('lock-screen polish', () => {
    const fullFriday = () => build({ mode: 'full', picks: pick(friday, 6) });

    it('5-column grid blocks never split inside a word', () => {
      for (const p of fullFriday().pages) {
        for (const b of (p.body as LockscreenGridPage).blocks) {
          const words = new Set(b.artist.split(/\s+/));
          for (const line of b.artistLines) {
            for (const w of line.split(' ').filter((x) => x !== '↑' && !/^\d/.test(x))) {
              const stem = w.replace(/…$/, '');
              expect(w.endsWith('-')).toBe(false);
              // Either a whole artist word, or the clipped head of one that ends in an ellipsis.
              expect(words.has(w) || (w !== stem && [...words].some((x) => x.startsWith(stem)))).toBe(true);
            }
          }
        }
      }
    });
    it('a long single word shrinks to the floor, then ellipsizes, in a 5-column block', () => {
      const long = { ...sets.find((s) => s.dayIndex === 0)!, id: 'long', artist: 'Supercalifragilisticexpialidocious', startTime: '16:00', endTime: '18:00' };
      const m = buildLockscreenModel({ ...base, sets: [long, ...sets], mode: 'full', onePage: true, picks: {} });
      const b = grid(m).blocks.find((x) => x.setId === 'long')!;
      expect(b.artistSizeU).toBe(2.6);
      expect(b.artistLines).toHaveLength(1);
      expect(b.artistLines[0]).toMatch(/…$/);
    });
    it('reserves the legend below the last hour label', () => {
      const m = fullFriday();
      for (const p of m.pages) {
        const g = p.body as LockscreenGridPage;
        const lastHour = g.hours.at(-1)!;
        expect(g.legendX).toBeGreaterThanOrEqual(m.sideU + g.gutterWidth);
        expect(g.legendY).toBeGreaterThanOrEqual(lastHour.y);
        expect(g.legendY + 3).toBeLessThanOrEqual(m.contentEndU + 1e-6);
      }
    });
    it('keeps the header on one short line and every page below the content top', () => {
      const saturday = sets.filter((s) => s.dayIndex === 1);
      for (const [picks, dayIndex] of [[pick(friday, 14), 0], [spread(30), 0], [pick(saturday, 36), 1]] as const) {
        for (const mode of ['picks', 'full'] as const) {
          const m = build({ picks, mode, dayIndex });
          expect(m.pages.length).toBeGreaterThan(0);
          for (const p of m.pages) {
            expect(p.header.y).toBeGreaterThanOrEqual(m.contentTopU);
            expect(p.header.metaBottom).not.toMatch(/until|\n/);
            expect(p.header.metaSizeU).toBeGreaterThanOrEqual(2.2);
            const first = p.body.kind === 'list' ? p.body.rows[0]!.y : p.body.headerY;
            expect(first).toBeGreaterThanOrEqual(p.header.y + p.header.height);
          }
        }
      }
    });
    it('a two-line list row is taller than a one-line row', () => {
      const m = build({ picks: pick(friday, 4) });
      const rows = list(m).rows;
      const two = rows.filter((r) => r.artistLines.length === 2);
      const one = rows.filter((r) => r.artistLines.length === 1);
      if (two.length && one.length) expect(two[0]!.height).toBeGreaterThan(one[0]!.height);
      for (const r of rows) for (const l of r.artistLines) expect(l.endsWith('-')).toBe(false);
    });
  });
});
