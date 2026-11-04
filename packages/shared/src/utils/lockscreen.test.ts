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
  LOCKSCREEN_FOOTER_MAX,
} from './lockscreenModel';
import { defaultScheduleImageDay } from './scheduleImage';
import { getSetTimeBounds } from './setStatus';

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
  it('normalizes decomposed artist names to NFC so the width table counts one glyph', () => {
    const nfd = sets.map((s) => (s.id === 'edco26-d0-me-n-u' ? { ...s, artist: 'Menü' } : s));
    const m = build({ sets: nfd, picks: { 'edco26-d0-me-n-u': 'must' } });
    expect(list(m).rows[0]!.artistLines).toEqual(['Menü']);
  });
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
    expect(list(m).rows[0]!.y).toBeGreaterThanOrEqual(m.contentTopU + 8.5);
  });
  it('14 picks fit one image at tier S, keeping the stage chip and a 4.2u artist floor', () => {
    const picks = pick(friday, 14);
    const m = build({ picks });
    expect(m.pages).toHaveLength(1);
    expect(ids(m).sort()).toEqual(Object.keys(picks).sort());
    const l = list(m);
    expect(l.tier).toBe('S');
    expect(l.chipSizeU).toBeGreaterThanOrEqual(2.6);
    expect(l.rows.every((r) => r.stageShort.length > 0 && r.artistSizeU >= 4.2)).toBe(true);
    const last = l.rows.at(-1)!;
    expect(last.y + last.height).toBeLessThanOrEqual(m.contentEndU + 1e-6);
  });
  it('30 picks fit two images that share one tier', () => {
    const picks = spread(30);
    const m = build({ picks });
    expect(m.pages).toHaveLength(2);
    expect(ids(m).sort()).toEqual(Object.keys(picks).sort());
    expect(new Set(m.pages.map((p) => (p.body as LockscreenListPage).tier)).size).toBe(1);
    expect(m.pages.map((p) => p.header.pageChip)).toEqual(['1/2', '2/2']);
    expect(m.pages[0]!.header.metaBottom).toMatch(/ · to \d/);
    expect(m.pages[1]!.footer.text).toContain('2 of 2');
    for (const p of m.pages) {
      const rows = (p.body as LockscreenListPage).rows;
      expect(rows.at(-1)!.y + rows.at(-1)!.height).toBeLessThanOrEqual(m.contentEndU + 1e-6);
      // Every time line ends above the torch and camera buttons.
      for (const r of rows) expect(r.y + (r.height + 4 * 1.1) / 2).toBeLessThanOrEqual(0.875 * m.heightU + 1e-6);
    }
  });
  it('fewer images beat bigger text: the largest tier is chosen only after the page count', () => {
    for (const n of [3, 9, 14]) {
      const m = build({ picks: pick(friday, n) });
      expect(m.pages).toHaveLength(1);
    }
    expect(list(build({ picks: pick(friday, 3) })).tier).toBe('XL');
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
      crewLoaded: true,
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
  it('crew mode never marks solo before the overlap has loaded', () => {
    const m = build({ mode: 'crew', picks: pick(friday, 2), crewOverlap: {} });
    expect(list(m).rows.every((r) => r.crew?.solo === false)).toBe(true);
  });
  it('counts picks with no set time in the header', () => {
    const tba: FestivalSet = { ...friday[0]!, id: 'tba', startTime: '', endTime: '' };
    const m = build({ sets: [...sets, tba], picks: { ...pick(friday, 2), tba: 'must' } });
    expect(m.pages[0]!.header.metaBottom).toBe('My picks · 2 · +1 no set time');
    const filtered = build({ sets: [...sets, tba], picks: { ...pick(friday, 2), tba: 'maybe' }, priorities: ['must'] });
    expect(filtered.pages[0]!.header.metaBottom).not.toContain('no set time');
  });
  it('all days builds one series per day with a day-specific header', () => {
    const picks = { ...pick(friday, 2), ...pick(sets.filter((s) => s.dayIndex === 2), 1) };
    const m = build({ picks, dayIndex: 'all' });
    expect(m.pages.map((p) => p.dayIndex)).toEqual([0, 2]);
    expect(m.pages.map((p) => p.header.day)).toEqual(['FRIDAY', 'SUNDAY']);
    expect(m.pages[1]!.footer.text).toContain('2 of 2');
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
  it('content sits in 0.38 to 0.92 of the height, 0.45 with the big clock', () => {
    const m = build({ picks: pick(friday, 3) });
    expect(m.contentTopU / m.heightU).toBeCloseTo(0.38);
    expect(m.contentEndU / m.heightU).toBeCloseTo(0.92);
    expect(build({ picks: pick(friday, 3), tallClock: true }).contentTopU / m.heightU).toBeCloseTo(0.45);
  });
  it('stamps the save time in a centred footer of at most 33 characters, clear of the corner buttons', () => {
    const one = build({ picks: pick(friday, 3) });
    expect(one.pages[0]!.footer.text).toBe('festie.us · Saved Nov 3 2:41 PM');
    const widest = new Date(2026, 10, 16, 12, 41);
    const single = build({ picks: pick(friday, 3), savedAt: widest }).pages[0]!.footer;
    const paged = build({ picks: spread(30), savedAt: widest }).pages[1]!.footer;
    expect(single.text).toBe('festie.us · Saved Nov 16 12:41 PM');
    expect(paged.text).toBe('Saved Nov 16 12:41 PM · 2 of 2');
    for (const f of [single, paged]) {
      expect(f.text.length).toBeLessThanOrEqual(LOCKSCREEN_FOOTER_MAX);
      expect(f.x).toBe(26);
      expect(f.x + f.width).toBe(74);
      expect((f.y + 0.8 * f.sizeU) / one.heightU).toBeCloseTo(0.945);
    }
  });
  it('clock: widgets starts content at 0.50; tallClock stays an alias for big', () => {
    const at = (over: Partial<LockscreenInput>) => build({ picks: pick(friday, 3), ...over });
    const m = at({});
    expect(at({ clock: 'widgets' }).contentTopU / m.heightU).toBeCloseTo(0.5);
    expect(at({ clock: 'big' }).contentTopU).toBeCloseTo(at({ tallClock: true }).contentTopU);
    expect(at({ clock: 'normal', tallClock: true }).contentTopU / m.heightU).toBeCloseTo(0.38);
    expect(ids(at({ clock: 'widgets' }))).toHaveLength(3);
  });
  it('the compact header keeps a long day label and one meta line', () => {
    // The model's header width table: capitals 0.66em, spaces 0.25em, other glyphs 0.55em; meta 0.5em.
    const dayEm = (w: string) => [...w].reduce((n, ch) => n + (ch === ' ' ? 0.25 : /[A-Z]/.test(ch) ? 0.66 : 0.55), 0);
    const fits = (h: ReturnType<typeof build>['pages'][number]['header']) => {
      const meta = [h.metaTop, h.metaBottom].filter(Boolean).join(' · ');
      return dayEm(h.day) * h.daySizeU + (h.pageChip ? 11 : 0) + 2 + meta.length * 0.5 * h.metaSizeU;
    };
    const opening = days.map((d, i) => (i === 0 ? { ...d, label: 'Day 1 - Opening Night' } : d));
    const one = build({ days: opening, picks: pick(friday, 3) }).pages[0]!.header;
    expect(one.height).toBe(8.5);
    expect(one.day).toBe('DAY 1 - OPENING NIGHT');
    expect(one.daySizeU).toBeGreaterThanOrEqual(4.8);
    expect(one.daySizeU).toBeLessThanOrEqual(5.6);
    expect(fits(one)).toBeLessThanOrEqual(88 + 1e-6);
    for (const p of build({ days: opening, picks: spread(30) }).pages) {
      expect(fits(p.header)).toBeLessThanOrEqual(88 + 1e-6);
      expect(p.header.metaBottom).toContain('My picks · 30');
    }
    const friday1 = build({ picks: pick(friday, 3) }).pages[0]!.header;
    expect(friday1.daySizeU).toBe(5.6);
    expect(friday1.metaTop).toBe('EDC Orlando · Nov 6');
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
      expect(b.artistSizeU).toBe(2.8);
      expect(b.artistLines).toHaveLength(1);
      expect(b.artistLines[0]).toMatch(/…$/);
    });
    it('sizes the list time column to fit the widest time', () => {
      const late = { ...sets.find((s) => s.dayIndex === 0)!, id: 'late', artist: 'Late One', startTime: '22:30', endTime: '23:30' };
      const m = buildLockscreenModel({ ...base, sets: [late, ...sets], mode: 'picks', picks: { late: 'must' } });
      const l = list(m);
      const need = (l.timeSizeU * 0.6 * 5) + 0.3 * 2.27 + 2.27 * 0.76 * 2;
      expect(l.layout.timeWidth).toBeGreaterThanOrEqual(need);
    });
    it('a two-word name wraps onto extra lines in a short tile before any ellipsis', () => {
      const two = { ...sets.find((s) => s.dayIndex === 0)!, id: 'two', artist: 'Adventure Club Sunset', startTime: '16:00', endTime: '17:00' };
      const m = buildLockscreenModel({ ...base, sets: [two, ...sets], mode: 'full', onePage: true, picks: {} });
      const b = grid(m).blocks.find((x) => x.setId === 'two')!;
      if (b.textMode !== 'none' && !b.ellipsis) expect(b.artistLines.join(' ')).toBe(b.artist);
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

describe('clashes, names and emphasis', () => {
  const at = (id: string, artist: string, stageId: string, startTime: string, endTime: string): FestivalSet => ({
    ...friday[0]!, id, artist, stageId, startTime, endTime,
  });
  const late = [
    at('a', 'Chris Lorenzo', 'stereo-bloom', '22:30', '23:45'),
    at('b', 'Kaskade', 'kinetic-field', '23:30', '00:45'),
    at('c', 'Josh Baker', 'neon-garden', '23:30', '01:00'),
    at('d', 'Sub Focus', 'circuit-grounds', '00:15', '01:15'),
    at('e', 'Eric Prydz', 'kinetic-field', '01:00', '02:30'),
    at('f', 'Early Act', 'bacardi', '20:00', '21:00'),
  ];
  const all = (chosen: FestivalSet[]) => Object.fromEntries(chosen.map((s, i) => [s.id, cycle[i % 3]!]));

  it('past midnight: 11:30 PM, 12:15 AM and 1:00 AM read in order, one clash group, the repeated time shown once', () => {
    const m = build({ sets: late, picks: all(late) });
    const rows = list(m).rows;
    expect(rows.map((r) => `${r.time} ${r.period}`)).toEqual(['8:00 PM', '10:30 PM', '11:30 PM', '11:30 PM', '12:15 AM', '1:00 AM']);
    expect(rows.map((r) => r.timeRepeat)).toEqual([false, false, false, true, false, false]);
    expect(list(m).divider).toMatchObject({ beforeIndex: 4 });
    const group = rows[1]!.clashGroup;
    expect(group).not.toBeNull();
    expect(rows.slice(1).every((r) => r.clashGroup === group)).toBe(true);
    expect(rows[0]!.clashGroup).toBeNull();
    // One bracket per run; the after-midnight divider does not split a run of rows.
    expect(list(m).clashSpans).toHaveLength(1);
    const span = list(m).clashSpans[0]!;
    expect(span.y).toBeGreaterThan(rows[1]!.y);
    expect(span.y + span.height).toBeLessThan(rows[5]!.y + rows[5]!.height);
    expect(span.x).toBeGreaterThanOrEqual(4);
  });
  it('the clash colour is neutral: never the old Maybe orange, never the Maybe colour', () => {
    for (const theme of ['dark', 'light'] as const) {
      const c = build({ picks: pick(friday, 3), theme }).palette;
      expect(c.clash.toLowerCase()).not.toBe('#ffb020');
      expect(c.maybe.toLowerCase()).not.toBe('#ffb020');
      expect(c.clash).not.toBe(c.maybe);
      expect(contrastRatio(c.clash, theme === 'dark' ? '#0a0a0a' : '#ffffff')).toBeGreaterThanOrEqual(3);
    }
  });
  it('Must, Want and Maybe: colour only on the must star, a softer Maybe name', () => {
    const m = build({ picks: pick(friday, 3) });
    const c = m.palette;
    const by = (p: Priority) => list(m).rows.find((r) => r.priority === p)!;
    expect(by('must').glyphColor).toBe(c.must);
    expect(by('want-to-see').glyphColor).toBe(c.text);
    expect(by('maybe').glyphColor).toBe(c.text2);
    expect(by('must').artistColor).toBe(c.text);
    expect(by('maybe').artistColor).toBe(c.maybe);
    expect(contrastRatio(c.maybe, '#0a0a0a')).toBeGreaterThanOrEqual(4.5);
  });
  it('long and B2B names shrink before they ellipsize, and a cut word ends the name', () => {
    const names = [
      at('n1', 'Interplanetary Criminal', 'stereo-bloom', '18:00', '19:00'),
      at('n2', 'Bullet Tooth B2B Sidney Charles', 'stereo-bloom', '19:00', '20:00'),
      at('n3', 'Dom Dolla B2B John Summit B2B Mau P', 'kinetic-field', '20:00', '21:30'),
      at('n4', 'Luke Dean B2B George Smeddles', 'bacardi', '22:30', '23:30'),
      at('n5', 'Supercalifragilisticexpialidocious', 'neon-garden', '23:30', '23:59'),
    ];
    for (const n of [4, 5]) {
      const rows = list(build({ sets: names.slice(0, n), picks: all(names.slice(0, n)) })).rows;
      for (const r of rows) {
        const cut = r.artistLines.findIndex((l) => l.endsWith('…'));
        // A cut word is always the last thing drawn.
        if (cut >= 0) expect(cut).toBe(r.artistLines.length - 1);
        if (r.setId !== 'n5') expect(r.artistLines.join(' ')).toBe(r.artist);
        expect(r.artistSizeU).toBeGreaterThanOrEqual(4.2);
      }
    }
    const cutLines = wrapArtist('Interplanetary Criminal', 6, 30);
    expect(cutLines).toHaveLength(1);
    expect(cutLines[0]).toMatch(/^Interpl.*…$/);
  });
  it('splits a set tag off the name', () => {
    const m = build({ sets: [at('t', 'Alesso (Sunset Set)', 'kinetic-field', '17:28', '18:44')], picks: { t: 'must' } });
    expect(list(m).rows[0]).toMatchObject({ artist: 'Alesso', tag: 'Sunset Set' });
  });
});

describe('from now', () => {
  const picks = pick(friday, 14);
  it('drops sets that ended by fromMs, using the shared set bounds', () => {
    const fromMs = new Date(2026, 10, 6, 19, 0).getTime();
    const m = build({ picks, fromMs });
    const kept = new Set(ids(m));
    for (const id of Object.keys(picks)) {
      const ended = getSetTimeBounds(sets.find((s) => s.id === id)!, days)!.endMs <= fromMs;
      expect(kept.has(id)).toBe(!ended);
    }
    expect(kept.size).toBeGreaterThan(0);
    expect(kept.size).toBeLessThan(14);
  });
  it('leaves the model unchanged when omitted or before every set', () => {
    const plain = build({ picks });
    expect(build({ picks, fromMs: undefined })).toEqual(plain);
    expect(ids(build({ picks, fromMs: new Date(2026, 10, 6, 6, 0).getTime() }))).toEqual(ids(plain));
  });
  it('drops a whole day in all-days mode once it has ended', () => {
    const both = { ...pick(friday, 2), ...pick(sets.filter((s) => s.dayIndex === 2), 1) };
    const m = build({ picks: both, dayIndex: 'all', fromMs: new Date(2026, 10, 7, 12, 0).getTime() });
    expect(m.pages.map((p) => p.dayIndex)).toEqual([2]);
  });
});

describe('grid legibility', () => {
  it('no grid text below 2.8u; the legend sits between the corner buttons; unpicked names are text2', () => {
    for (const onePage of [false, true]) {
      const m = build({ mode: 'full', picks: pick(friday, 6), onePage });
      for (const p of m.pages) {
        const g = p.body as LockscreenGridPage;
        expect(g.labelSizeU).toBeGreaterThanOrEqual(2.8);
        expect(g.legendX).toBeGreaterThanOrEqual(26);
        expect(g.legendX + g.legendWidth).toBeLessThanOrEqual(74);
        for (const b of g.blocks) {
          expect(b.artistSizeU).toBeGreaterThanOrEqual(2.8);
          if (!b.picked) expect(b.ink).toBe(m.palette.text2);
        }
      }
    }
  });
  it('a short carry-over block keeps the name and drops the start time', () => {
    const m = build({ mode: 'full', picks: pick(friday, 6) });
    for (const b of grid(m, 1).blocks.filter((x) => x.carryOver)) {
      expect(b.carryLabel).toBe(b.textMode === 'full' ? `↑ ${b.time} ${b.artist}` : `↑ ${b.artist}`);
    }
  });
});
