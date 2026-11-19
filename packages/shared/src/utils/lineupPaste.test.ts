import { describe, expect, it } from 'vitest';
import {
  describeMerge,
  describeParse,
  findNearMatches,
  lineupToText,
  mergeLineupPaste,
  parseLineupJson,
  parseLineupText,
  type LineupDraft,
} from './lineupPaste';

const stored = (id: string, names: string[], extra: Partial<LineupDraft> = {}): LineupDraft => ({
  id,
  artists: names.map((name) => ({ name, links: {} })),
  displayName: null,
  tier: null,
  dayDate: null,
  status: 'announced',
  announcedAt: '2026-11-01',
  linkedSetIds: [],
  ...extra,
});

describe('parseLineupText', () => {
  it('reads one line per entry, splits b2b, and takes the poster name after a bar', () => {
    const r = parseLineupText('Kai\nA b2b B | Poster AB\n\nMira vs Zed', 'vs');
    expect(r.entries.map((e) => e.artists.map((a) => a.name))).toEqual([['Kai'], ['A', 'B'], ['Mira', 'Zed']]);
    expect(r.entries[1]!.displayName).toBe('Poster AB');
    expect(r.skipped).toBe(1);
    expect(r.b2b).toBe(2);
  });

  it('starts tiers at headings; a list with no headings has none', () => {
    const r = parseLineupText('Solo\n# Tier 1\nTop\n## Headliners\nNext\n# Tier 5\nFive');
    expect(r.entries.map((e) => e.tier)).toEqual([null, 1, 2, 5]);
    expect(parseLineupText('A\nB').entries.every((e) => e.tier === null)).toBe(true);
  });

  it('flags lines that need a look, and blocks the ones the server would refuse', () => {
    const r = parseLineupText(
      ['A, B, C', 'A b2b B b2b C b2b D b2b E', 'Onaroi* Onara B2B roi*)', 'Odd name -', 'DPMO Presents: x', 'Tyler, The Creator', 'dup', 'DUP'].join('\n'),
    );
    const kinds = r.flags.map((f) => `${f.line}:${f.kind}${f.blocking ? '!' : ''}`);
    expect(kinds).toContain('1:list');
    expect(kinds).toContain('2:too_many!');
    expect(kinds).toContain('3:brackets');
    expect(kinds).toContain('4:stray');
    expect(kinds).toContain('5:presents');
    expect(kinds).toContain('8:duplicate!');
    expect(kinds.some((k) => k.startsWith('6:'))).toBe(false);
  });

  it('allows a trailing period or bang', () => {
    expect(parseLineupText('Fred again..\nHOL!').flags).toEqual([]);
  });
});

describe('parseLineupJson', () => {
  const sample = {
    note: 'x',
    candidates: [
      { id: 'fk-2dy4', artists: [{ name: '2DY4', links: {} }], _officialBilling: '2DY4' },
      {
        id: 'fk-a-b',
        artists: [{ name: 'A', links: { spotify: 'https://open.spotify.com/artist/1', apple: 'https://x.example', website: 'javascript:alert(1)' }, wpArtistId: '5' }, { name: 'B' }],
        displayName: 'A B2B B',
        _officialBilling: 'A B2B B',
        day: null,
      },
    ],
  };

  it('keeps ids and known links, reports dropped keys', () => {
    const r = parseLineupJson(JSON.stringify(sample));
    expect(r.entries.map((e) => e.id)).toEqual(['fk-2dy4', 'fk-a-b']);
    expect(r.linksKept).toBe(1);
    expect(r.entries[1]!.artists[0]!.links).toEqual({ spotify: 'https://open.spotify.com/artist/1' });
    expect(r.dropped).toMatchObject({ _officialBilling: 2, wpArtistId: 1, 'links.apple': 1, 'links.website': 1 });
    expect(describeParse(r)).toBe(
      '2 names (1 is b2b) · 1 links kept · dropped keys: _officialBilling (2), links.apple (1), links.website (1), wpArtistId (1), day (1)',
    );
  });

  it('accepts id, tier, dayDate and status', () => {
    const r = parseLineupJson(JSON.stringify([{ id: 'x', artists: [{ name: 'A' }], tier: 2, dayDate: '2027-02-05', status: 'cancelled' }]));
    expect(r.entries[0]).toMatchObject({ id: 'x', tier: 2, dayDate: '2027-02-05', status: 'cancelled' });
  });

  it('refuses text that is not a lineup list', () => {
    expect(parseLineupJson('Kai\nMira').error).toMatch(/not a lineup list/);
    expect(parseLineupJson('{"a":1}').error).toBeTruthy();
  });

  it('flags an entry with no artists', () => {
    const r = parseLineupJson('[{"artists":[]}]');
    expect(r.flags[0]).toMatchObject({ kind: 'invalid', blocking: true });
  });
});

describe('mergeLineupPaste', () => {
  const prev = [
    stored('lu-1', ['Kai'], { tier: 2, dayDate: '2027-02-05', linkedSetIds: ['s1'], displayName: 'Kai Live' }),
    stored('lu-2', ['Mira'], { status: 'cancelled' }),
    stored('lu-3', ['Zed']),
  ];

  it('add and update never removes, keeps id, day, status, links and linked sets', () => {
    const withLinks = [{ ...prev[0]!, artists: [{ name: 'Kai', links: { spotify: 'https://s.example/kai' } }] }, prev[1]!, prev[2]!];
    const parsed = parseLineupText('mira\nKAI\nNew Act').entries;
    const r = mergeLineupPaste(withLinks, parsed, { mode: 'add' });
    expect(r.lineup.map((e) => e.id)).toEqual(['lu-1', 'lu-2', 'lu-3', undefined]);
    expect(r.lineup[0]).toMatchObject({ dayDate: '2027-02-05', tier: 2, linkedSetIds: ['s1'], displayName: 'Kai Live', announcedAt: '2026-11-01' });
    expect(r.lineup[0]!.artists[0]!.links).toEqual({ spotify: 'https://s.example/kai' });
    expect(r.lineup[1]!.status).toBe('cancelled');
    expect(r.summary).toEqual({ matched: 2, added: 1, kept: 1, removed: 0 });
    expect(describeMerge(r.summary, 'add')).toBe('2 matched, 1 new, 1 kept');
  });

  it('replace list reports and applies removals, in paste order', () => {
    const r = mergeLineupPaste(prev, parseLineupText('Zed\nKai').entries, { mode: 'replace' });
    expect(r.lineup.map((e) => e.id)).toEqual(['lu-3', 'lu-1']);
    expect(r.removedEntries.map((e) => e.id)).toEqual(['lu-2']);
    expect(describeMerge(r.summary, 'replace')).toBe('2 matched, 0 new, 1 removed');
  });

  it('a heading sets the tier, no heading keeps it', () => {
    const r = mergeLineupPaste(prev, parseLineupText('Kai\n# Tier 3\nZed').entries, { mode: 'add' });
    expect(r.lineup.find((e) => e.id === 'lu-1')!.tier).toBe(2);
    expect(r.lineup.find((e) => e.id === 'lu-3')!.tier).toBe(3);
  });

  it('a heading-less line clears nothing, but exactTiers and exactNames let an edit clear tier and poster name', () => {
    const edited = parseLineupText('Kai\nMira').entries;
    const keep = mergeLineupPaste(prev, edited, { mode: 'add' }).lineup;
    expect(keep.find((e) => e.id === 'lu-1')).toMatchObject({ tier: 2, displayName: 'Kai Live' });
    const exact = mergeLineupPaste(prev, edited, { mode: 'replace', exactTiers: true, exactNames: true }).lineup;
    expect(exact.find((e) => e.id === 'lu-1')).toMatchObject({ tier: null, displayName: null });
    expect(parseLineupText('A\n# Tier 1\nB').hasHeadings).toBe(true);
    expect(parseLineupText('A\nB').hasHeadings).toBe(false);
  });

  it('pasted links land by name key, not position, when the B2B order differs', () => {
    const base = [stored('ab', ['A', 'B'])];
    const pasted = parseLineupJson(
      JSON.stringify([{ artists: [{ name: 'B', links: { spotify: 'https://s.example/b' } }, { name: 'A', links: { spotify: 'https://s.example/a' } }] }]),
    ).entries;
    const r = mergeLineupPaste(base, pasted, { mode: 'add' }).lineup[0]!;
    expect(r.artists.map((a) => a.name)).toEqual(['A', 'B']);
    expect(r.artists[0]!.links).toEqual({ spotify: 'https://s.example/a' });
    expect(r.artists[1]!.links).toEqual({ spotify: 'https://s.example/b' });
  });

  it('paste for one day puts matched and new lines on that day', () => {
    const r = mergeLineupPaste(prev, parseLineupText('Zed\nBrand New').entries, { mode: 'add', dayDate: '2027-02-06' });
    expect(r.lineup.find((e) => e.id === 'lu-3')!.dayDate).toBe('2027-02-06');
    expect(r.lineup[3]!.dayDate).toBe('2027-02-06');
    expect(r.lineup[0]!.dayDate).toBe('2027-02-05');
  });

  it('JSON entries carry their own id, day and status', () => {
    const parsed = parseLineupJson('[{"id":"src-1","artists":[{"name":"Fresh"}],"dayDate":"2027-02-07","status":"cancelled"}]').entries;
    const r = mergeLineupPaste(prev, parsed, { mode: 'add' });
    expect(r.lineup[3]).toMatchObject({ id: 'src-1', dayDate: '2027-02-07', status: 'cancelled' });
  });

  it('near-match lists a new line one edit from a stored key, and "Same act as" keeps the stored id', () => {
    const parsed = parseLineupText('Mirra\nZed').entries;
    const near = findNearMatches(prev, parsed);
    expect(near).toEqual([{ line: 1, name: 'Mirra', existingId: 'lu-2', existingName: 'Mira' }]);
    const r = mergeLineupPaste(prev, parsed, { mode: 'add', sameAs: { 1: 'lu-2' } });
    expect(r.lineup.map((e) => e.id)).toEqual(['lu-1', 'lu-2', 'lu-3']);
    expect(r.lineup[1]!.artists[0]!.name).toBe('Mirra');
    expect(r.lineup[1]!.status).toBe('cancelled');
    expect(r.summary.added).toBe(0);
  });

  it('short names are not offered as near matches', () => {
    expect(findNearMatches([stored('a', ['HOL'])], parseLineupText('HOT').entries)).toEqual([]);
  });

  it('lineupToText parses back to the same list', () => {
    const list = [stored('a', ['A', 'B'], { displayName: 'Poster', tier: 2 }), stored('b', ['C']), stored('c', ['D'], { tier: 1 })];
    const text = lineupToText(list);
    expect(text).toBe('C\n# Tier 1\nD\n# Tier 2\nA b2b B | Poster');
    const r = mergeLineupPaste(list, parseLineupText(text).entries, { mode: 'replace' });
    expect(r.summary).toEqual({ matched: 3, added: 0, kept: 0, removed: 0 });
    expect(r.lineup.map((e) => [e.id, e.tier])).toEqual([['b', null], ['c', 1], ['a', 2]]);
  });

  it('a re-paste of the same JSON keeps every id', () => {
    const json = JSON.stringify([{ id: 'src-1', artists: [{ name: 'One' }] }, { id: 'src-2', artists: [{ name: 'Two' }] }]);
    const first = mergeLineupPaste([], parseLineupJson(json).entries, { mode: 'add' }).lineup;
    const again = mergeLineupPaste(first, parseLineupJson(json).entries, { mode: 'replace' });
    expect(again.lineup.map((e) => e.id)).toEqual(['src-1', 'src-2']);
    expect(again.summary).toEqual({ matched: 2, added: 0, kept: 0, removed: 0 });
  });
});

// The synthetic FK-shaped fixture: the shape of the private side file, invented names.
describe('FK-shaped list', () => {
  const acts = [
    ...Array.from({ length: 10 }, (_, i) => ({ id: `fk-solo-${i}`, artists: [{ name: `Solo Act ${i}`, links: {} }], _officialBilling: `Solo Act ${i}` })),
    { id: 'fk-duo', artists: [{ name: 'Alpha', links: {} }, { name: 'Beta', links: {} }], _officialBilling: 'Alpha B2B Beta' },
    { id: 'fk-trio', artists: [{ name: 'Gamma' }, { name: 'Delta' }, { name: 'Eps*' }], displayName: 'Crew presents: Gamma B2B Delta B2B Eps*', _officialBilling: 'x' },
  ];
  it('loads 12 acts, 2 b2b, and reports the dropped key', () => {
    const r = parseLineupJson(JSON.stringify({ note: 'n', count: 12, candidates: acts }));
    expect(r.entries).toHaveLength(12);
    expect(r.b2b).toBe(2);
    expect(r.linksKept).toBe(0);
    expect(r.dropped).toEqual({ _officialBilling: 12 });
  });
});
