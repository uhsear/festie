import { describe, expect, it } from 'vitest';
import type { WrapFestival, WrapPlannedSet, WrapRatedSet, WrapResponse } from '../types/wrap';
import { buildWrapCards, isWrapUnlocked, selectSetsToRate, summarizePlan, wrapByline, wrapCardShareText } from './wrap';

const festival: WrapFestival = {
  id: 'f1',
  name: 'Test Fest',
  timeZone: 'America/Los_Angeles',
  days: [
    { date: '2026-04-24', label: 'Friday' },
    { date: '2026-04-25', label: null },
    { date: '2026-04-26', label: null },
  ],
};

function planned(over: Partial<WrapPlannedSet> & { setId: string }): WrapPlannedSet {
  return {
    artist: over.setId.toUpperCase(),
    stageId: 'st1',
    stageName: 'Main',
    dayIndex: 0,
    startTime: '20:00',
    endTime: '21:00',
    priority: 'want-to-see',
    rating: null,
    note: null,
    crewAlso: null,
    caught: null,
    ...over,
  };
}

function rated(over: Partial<WrapRatedSet> & { setId: string; rating: number }): WrapRatedSet {
  return {
    note: null,
    artist: over.setId.toUpperCase(),
    stageId: 'st1',
    stageName: 'Main',
    dayIndex: 0,
    startTime: '20:00',
    endTime: '21:00',
    ...over,
  };
}

function wrap(over: Partial<WrapResponse> = {}): WrapResponse {
  return {
    stats: { totalRated: 0, avgRating: null, stagesVisited: 0, daysAttended: 0, totalHours: 0 },
    topSets: [],
    allRatings: [],
    festival,
    planned: [],
    crew: null,
    ...over,
  };
}

describe('summarizePlan', () => {
  it('counts sets, must-sees, stages and days', () => {
    const s = summarizePlan([
      planned({ setId: 'a', priority: 'must' }),
      planned({ setId: 'b', stageId: 'st2', dayIndex: 1 }),
    ]);
    expect(s).toMatchObject({ planned: 2, mustSees: 1, stages: 2, days: 2, hours: 2 });
  });

  it('counts a set past midnight as positive hours', () => {
    expect(summarizePlan([planned({ setId: 'a', startTime: '23:00', endTime: '01:00' })]).hours).toBe(2);
  });

  it('counts a zero-length set as 0 hours', () => {
    expect(summarizePlan([planned({ setId: 'a', startTime: '20:00', endTime: '20:00' })]).hours).toBe(0);
  });

  it('counts hours and stages over seen sets once any set is marked', () => {
    const s = summarizePlan([
      planned({ setId: 'a', caught: true }),
      planned({ setId: 'b', stageId: 'st2', caught: false }),
      planned({ setId: 'c', stageId: 'st3' }),
    ]);
    expect(s).toMatchObject({ planned: 3, stages: 1, hours: 1 });
  });

  it('falls back to every pick when no set is marked', () => {
    const s = summarizePlan([planned({ setId: 'a' }), planned({ setId: 'b', stageId: 'st2' })]);
    expect(s).toMatchObject({ stages: 2, hours: 2 });
  });

  it('detects clashes among picks', () => {
    const s = summarizePlan([
      planned({ setId: 'a', startTime: '20:00', endTime: '21:00' }),
      planned({ setId: 'b', startTime: '20:30', endTime: '21:30' }),
    ]);
    expect(s.clashes).toHaveLength(1);
  });
});

describe('buildWrapCards', () => {
  it('returns [] when nothing is planned or rated', () => {
    expect(buildWrapCards(wrap())).toEqual([]);
  });

  it('builds a plan card and a summary card from picks alone, in order', () => {
    const cards = buildWrapCards(wrap({ planned: [planned({ setId: 'a', priority: 'must' })] }));
    expect(cards.map((c) => c.kind)).toEqual(['plan', 'summary']);
    expect(cards[0]).toMatchObject({
      kicker: 'YOUR PLAN',
      headline: '1 set planned',
      sub: '1 must-see · 1 day · 1 stage',
      rows: [{ primary: 'A', secondary: 'Main' }],
    });
    expect(cards[1]!.headline).toBe('1.0 hours of music');
    expect(cards[1]!.stats).toEqual([
      { label: 'Planned', value: '1' },
      { label: 'Rated', value: '0' },
      { label: 'Stages', value: '1' },
      { label: 'Days', value: '1' },
    ]);
  });

  it('counts summary hours and stages over seen sets once any set is marked, keeping the plan card on every pick', () => {
    const cards = buildWrapCards(
      wrap({
        planned: [
          planned({ setId: 'a', caught: true, startTime: '20:00', endTime: '22:00' }),
          planned({ setId: 'b', stageId: 'st2', caught: false }),
        ],
      }),
    );
    expect(cards[0]!.sub).toBe('0 must-sees · 1 day · 2 stages');
    const summary = cards.find((c) => c.kind === 'summary')!;
    expect(summary.headline).toBe('2.0 hours of music');
    expect(summary.stats).toContainEqual({ label: 'Stages', value: '1' });
  });

  it('uses plural forms and limits plan rows to 5 must-sees by day then start', () => {
    const sets = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) =>
      planned({ setId: id, priority: 'must', dayIndex: 1 - (i % 2), startTime: `1${i}:00`, endTime: `1${i}:30` }),
    );
    const card = buildWrapCards(wrap({ planned: sets }))[0]!;
    expect(card.headline).toBe('6 sets planned');
    expect(card.sub).toBe('6 must-sees · 2 days · 1 stage');
    expect(card.rows).toHaveLength(5);
    expect(card.rows![0]!.primary).toBe('B');
  });

  it('builds the top card with the lead artist and rated count', () => {
    const top = [rated({ setId: 'x', rating: 5 }), rated({ setId: 'y', rating: 4, stageName: null })];
    const cards = buildWrapCards(
      wrap({
        topSets: top,
        allRatings: top,
        stats: { totalRated: 3, avgRating: 4, stagesVisited: 1, daysAttended: 1, totalHours: 3 },
      }),
    );
    expect(cards.map((c) => c.kind)).toEqual(['top', 'summary']);
    expect(cards[0]).toMatchObject({ kicker: 'YOUR TOP SETS', headline: 'X', sub: '#1 of 3 sets you rated' });
    expect(cards[0]!.rows![1]).toEqual({ primary: 'Y', secondary: null, rating: 4 });
    expect(cards[1]!.headline).toBe('3.0 hours of music');
    expect(cards[1]!.rows).toHaveLength(2);
  });

  it('uses the singular for one rated set and "Unknown artist" for a missing artist', () => {
    const top = [rated({ setId: 'x', rating: 5, artist: null })];
    const card = buildWrapCards(
      wrap({
        topSets: top,
        allRatings: top,
        stats: { totalRated: 1, avgRating: 5, stagesVisited: 1, daysAttended: 1, totalHours: 1 },
      }),
    )[0]!;
    expect(card.headline).toBe('Unknown artist');
    expect(card.sub).toBe('#1 of 1 set you rated');
  });

  it('builds the clash card and picks the hard clash as hardest', () => {
    const cards = buildWrapCards(
      wrap({
        planned: [
          planned({ setId: 'a', startTime: '20:00', endTime: '22:00' }),
          planned({ setId: 'b', startTime: '20:00', endTime: '22:00' }),
          planned({ setId: 'c', priority: 'must', startTime: '21:30', endTime: '22:30' }),
          planned({ setId: 'd', priority: 'must', startTime: '22:15', endTime: '23:00' }),
        ],
      }),
    );
    const clash = cards.find((c) => c.kind === 'clash')!;
    expect(clash.kicker).toBe('CLASHES SURVIVED');
    expect(clash.headline).toBe('You survived 4 clashes');
    expect(clash.sub).toBe('Hardest call: C vs D');
  });

  it('uses the longest overlap when no clash is hard, and singular "clash"', () => {
    const clash = buildWrapCards(
      wrap({
        planned: [
          planned({ setId: 'a', startTime: '20:00', endTime: '21:00' }),
          planned({ setId: 'b', startTime: '20:30', endTime: '21:30' }),
        ],
      }),
    ).find((c) => c.kind === 'clash')!;
    expect(clash.headline).toBe('You survived 1 clash');
    expect(clash.sub).toBe('Hardest call: A vs B');
  });

  it('omits the crew card when crew is null and builds it when a crewmate agrees', () => {
    const sets = [
      planned({ setId: 'a', crewAlso: 1 }),
      planned({ setId: 'b', crewAlso: 3, startTime: '22:00', endTime: '23:00' }),
      planned({ setId: 'c', crewAlso: 0, startTime: '23:00', endTime: '23:30' }),
    ];
    expect(buildWrapCards(wrap({ planned: sets })).some((c) => c.kind === 'crew')).toBe(false);
    const crew = { id: 'c1', name: 'Squad', memberCount: 5, photoAlbumUrl: null };
    const card = buildWrapCards(wrap({ planned: sets, crew })).find((c) => c.kind === 'crew')!;
    expect(card.kicker).toBe('YOUR CREW');
    expect(card.headline).toBe('Squad agreed on 2 sets');
    expect(card.rows).toEqual([
      { primary: 'B', secondary: 'Main', badge: '4 of 5' },
      { primary: 'A', secondary: 'Main', badge: '2 of 5' },
    ]);
  });

  it('omits the crew card when no set has a crewmate', () => {
    const crew = { id: 'c1', name: 'Squad', memberCount: 5, photoAlbumUrl: null };
    const cards = buildWrapCards(wrap({ planned: [planned({ setId: 'a', crewAlso: 0 })], crew }));
    expect(cards.some((c) => c.kind === 'crew')).toBe(false);
  });

  it('builds the memory card from the highest rating, then the latest day', () => {
    const all = [
      rated({ setId: 'a', rating: 4, note: 'low', dayIndex: 2 }),
      rated({ setId: 'b', rating: 5, note: 'early', dayIndex: 0 }),
      rated({ setId: 'c', rating: 5, note: 'late', dayIndex: 1, stageName: 'Dome' }),
      rated({ setId: 'd', rating: 5, note: '   ', dayIndex: 2 }),
    ];
    const memory = buildWrapCards(wrap({ allRatings: all, topSets: [all[0]!] })).find((c) => c.kind === 'memory')!;
    expect(memory.kicker).toBe('A MOMENT TO REMEMBER');
    expect(memory.headline).toBe('C');
    expect(memory.quote).toEqual({ text: 'late', by: 'C · Dome' });
  });

  it('orders cards plan, top, clash, crew, memory, summary', () => {
    const r = rated({ setId: 'a', rating: 5, note: 'wow' });
    const cards = buildWrapCards(
      wrap({
        planned: [
          planned({ setId: 'a', crewAlso: 1, startTime: '20:00', endTime: '21:00' }),
          planned({ setId: 'b', startTime: '20:30', endTime: '21:30' }),
        ],
        topSets: [r],
        allRatings: [r],
        crew: { id: 'c', name: 'Squad', memberCount: 2, photoAlbumUrl: null },
        stats: { totalRated: 1, avgRating: 5, stagesVisited: 1, daysAttended: 1, totalHours: 1 },
      }),
    );
    expect(cards.map((c) => c.kind)).toEqual(['plan', 'top', 'clash', 'crew', 'memory', 'summary']);
  });
});

describe('selectSetsToRate', () => {
  // 2026-04-25 09:00 UTC is 02:00 PDT on the morning of day 1 (Apr 25).
  const nowMs = Date.UTC(2026, 3, 25, 9, 0);

  it('keeps ended unrated sets, same-day by start time, and drops TBA and rated', () => {
    const sets = [
      planned({ setId: 'late', dayIndex: 0, startTime: '22:00', endTime: '23:00' }),
      planned({ setId: 'early', dayIndex: 0, startTime: '18:00', endTime: '19:00' }),
      planned({ setId: 'done', dayIndex: 0, rating: 4 }),
      planned({ setId: 'tba', dayIndex: null }),
      planned({ setId: 'nostart', startTime: null }),
      planned({ setId: 'future', dayIndex: 1, startTime: '20:00', endTime: '21:00' }),
    ];
    expect(selectSetsToRate(sets, festival, nowMs).map((s) => s.setId)).toEqual(['early', 'late']);
  });

  it('reads times in the festival zone, not UTC', () => {
    // Day 0 21:00 to 22:00 PDT ends at 05:00 UTC Apr 25; one minute earlier it has not ended.
    const sets = [planned({ setId: 'a', dayIndex: 0, startTime: '21:00', endTime: '22:00' })];
    const endUtc = Date.UTC(2026, 3, 25, 5, 0);
    expect(selectSetsToRate(sets, festival, endUtc - 60_000)).toHaveLength(0);
    expect(selectSetsToRate(sets, festival, endUtc)).toHaveLength(1);
  });

  it('sorts yesterday before the day before', () => {
    const sets = [planned({ setId: 'd0', dayIndex: 0 }), planned({ setId: 'd1', dayIndex: 1 })];
    const later = Date.UTC(2026, 3, 27, 12, 0);
    expect(selectSetsToRate(sets, festival, later).map((s) => s.setId)).toEqual(['d1', 'd0']);
  });
});

describe('isWrapUnlocked', () => {
  it('is locked during the festival and open after the last day', () => {
    expect(isWrapUnlocked(festival, new Date(Date.UTC(2026, 3, 25, 12, 0)))).toBe(false);
    expect(isWrapUnlocked(festival, new Date(Date.UTC(2026, 4, 5, 12, 0)))).toBe(true);
  });
});

describe('wrapByline', () => {
  it('joins handle and dates', () => {
    expect(wrapByline(festival, 'asir', true)).toBe('@asir · Apr 24 – Apr 26, 2026');
  });
  it('drops the handle when hidden or missing', () => {
    expect(wrapByline(festival, 'asir', false)).toBe('Apr 24 – Apr 26, 2026');
    expect(wrapByline(festival, null, true)).toBe('Apr 24 – Apr 26, 2026');
  });
  it('shows only the handle when there are no days', () => {
    expect(wrapByline({ ...festival, days: [] }, 'asir', true)).toBe('@asir');
  });
  it('returns null when both parts are missing', () => {
    expect(wrapByline({ ...festival, days: [] }, null, true)).toBeNull();
  });
});

describe('wrapCardShareText', () => {
  it('writes festival, sentence-case kicker, headline, sub and the site', () => {
    const text = wrapCardShareText(
      { kind: 'plan', kicker: 'YOUR PLAN', headline: '3 sets planned', sub: '1 must-see · 1 day · 1 stage' },
      'Test Fest',
    );
    expect(text).toBe('My Test Fest wrap\nYour plan: 3 sets planned\n1 must-see · 1 day · 1 stage\nfestie.us');
  });
  it('skips a missing sub', () => {
    expect(wrapCardShareText({ kind: 'plan', kicker: 'YOUR PLAN', headline: 'h' }, 'F')).toBe(
      'My F wrap\nYour plan: h\nfestie.us',
    );
  });
});
