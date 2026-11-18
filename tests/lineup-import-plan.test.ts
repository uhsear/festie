/**
 * Unit tests for lib/lineup-import-plan.ts (pure, no database).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeTime, planLineupImport, artistsNeedingLinks } from '../lib/lineup-import-plan.js';
import { register } from 'tsx/cjs/api';

// packages/shared loads as CommonJS with extensionless imports, which only the tsx require hook resolves.
register();
const { buildLineupCsv, defaultMapping, parseLineupTable, toImportRows } = await import(
  '../packages/shared/src/utils/lineupImport.js'
);

const CONFIG = { MAX_IMPORT_SETS: 500, MAX_STAGES: 20, MAX_DAYS: 10, MAX_SETS_PER_DAY: 200 };
const OPTIONS = { updateExisting: false, createMissing: true };

function festival(overrides: any = {}) {
  return {
    id: 'fest-1',
    name: 'Test Fest',
    b2bSeparator: 'vs',
    stages: [
      { id: 'main', name: 'Main Stage', color: '#ff3366' },
      { id: 'forest', name: 'Forest', color: '#00e8d0' },
    ],
    days: [
      { dayIndex: 0, label: 'Friday', date: '2026-08-21', sets: [] as any[] },
      { dayIndex: 1, label: 'Saturday', date: '2026-08-22', sets: [] as any[] },
    ],
    ...overrides,
  };
}

function withSets(sets: { day: number; set: any }[]) {
  const f = festival();
  for (const { day, set } of sets) f.days[day]!.sets.push(set);
  return f;
}

const alpha = { id: 'set-a', artist: 'DJ Alpha', artists: [{ name: 'DJ Alpha', links: { spotify: 'https://open.spotify.com/artist/a' }, photo: 'https://i.scdn.co/a.jpg' }], stageId: 'main', startTime: '20:00', endTime: '21:00', linkUrl: 'https://open.spotify.com/artist/a' };

function plan(rows: any[], opts: any = {}, f: any = festival(), extra: any = {}) {
  return planLineupImport({ festival: f, rows, options: { ...OPTIONS, ...opts }, config: CONFIG, ...extra });
}

const row = (n: number, fields: any) => ({ row: n, ...fields });

describe('planLineupImport: artists', () => {
  it('splits B2B on the festival separator and on b2b', () => {
    const { plan: p } = plan([
      row(2, { artist: 'Kai vs Mira', stage: 'Forest', day: 'Friday' }),
      row(3, { artist: 'Ana B2B Bo b2b Cy', stage: 'Main Stage', day: 'Friday' }),
    ]);
    assert.deepEqual(p.rows[0]!.artists, ['Kai', 'Mira']);
    assert.deepEqual(p.rows[1]!.artists, ['Ana', 'Bo', 'Cy']);
  });

  it('does not split b2b inside a word', () => {
    const { plan: p } = plan([row(2, { artist: 'Ab2bC', stage: 'Forest', day: 'Friday' })]);
    assert.deepEqual(p.rows[0]!.artists, ['Ab2bC']);
  });

  it('rejects an empty artist and more than 4 artists', () => {
    const { plan: p } = plan([
      row(2, { artist: '  ', stage: 'Forest', day: 'Friday' }),
      row(3, { artist: 'A b2b B b2b C b2b D b2b E', stage: 'Forest', day: 'Friday' }),
    ]);
    assert.equal(p.rows[0]!.errors[0]!.message, 'Artist is empty.');
    assert.equal(p.rows[1]!.errors[0]!.message, 'A set can have at most 4 artists.');
    assert.equal(p.counts.error, 2);
  });
});

describe('planLineupImport: days', () => {
  it('finds a day by label, date, number, "Day N" and prefix', () => {
    const { plan: p } = plan([
      row(2, { artist: 'A', stage: 'Forest', day: 'saturday' }),
      row(3, { artist: 'B', stage: 'Forest', day: '2026-08-21' }),
      row(4, { artist: 'C', stage: 'Forest', day: '2' }),
      row(5, { artist: 'D', stage: 'Forest', day: 'Day 1' }),
      row(6, { artist: 'E', stage: 'Forest', day: 'fri' }),
      row(7, { artist: 'F', stage: 'Forest', date: '2026-08-22' }),
    ]);
    assert.deepEqual(p.rows.map((r) => r.dayLabel), ['Saturday', 'Friday', 'Saturday', 'Friday', 'Friday', 'Saturday']);
    assert.equal(p.counts.error, 0);
  });

  it('creates a new day after the last day and reuses it', () => {
    const { plan: p, writes } = plan([
      row(2, { artist: 'A', stage: 'Forest', day: 'Sunday', date: '2026-08-23' }),
      row(3, { artist: 'B', stage: 'Main Stage', day: 'Sunday', date: '2026-08-23' }),
    ]);
    assert.deepEqual(p.newDays, [{ label: 'Sunday', date: '2026-08-23' }]);
    assert.equal(p.counts.newDays, 1);
    assert.deepEqual(writes.newDays, [{ dayIndex: 2, label: 'Sunday', date: '2026-08-23' }]);
    assert.deepEqual(writes.inserts.map((s) => s.dayIndex), [2, 2]);
  });

  it('orders several new days by date', () => {
    const { writes } = plan([
      row(2, { artist: 'A', stage: 'Forest', date: '2026-08-24' }),
      row(3, { artist: 'B', stage: 'Forest', date: '2026-08-23' }),
    ]);
    assert.deepEqual(writes.newDays.map((d) => [d.dayIndex, d.date]), [[2, '2026-08-23'], [3, '2026-08-24']]);
  });

  it('rejects a new day before the last day', () => {
    const { plan: p } = plan([row(2, { artist: 'A', stage: 'Forest', date: '2026-08-20' })]);
    assert.match(p.rows[0]!.errors[0]!.message, /New day 2026-08-20 comes before the festival's last day/);
  });

  it('rejects an unknown day with no date, and an empty day on a new set', () => {
    const { plan: p } = plan([
      row(2, { artist: 'A', stage: 'Forest', day: 'Moonday' }),
      row(3, { artist: 'B', stage: 'Forest', day: '' }),
    ]);
    assert.match(p.rows[0]!.errors[0]!.message, /^Unknown day "Moonday"\. Use one of: Friday, Saturday, or add a Date column/);
    assert.equal(p.rows[1]!.errors[0]!.message, 'Day is empty.');
  });

  it('matches a dated row to an undated day with the same label, and never duplicates it', () => {
    const f = festival({ days: [{ dayIndex: 0, label: 'Friday', date: '', sets: [] }] });
    const { plan: p, writes } = plan([row(2, { artist: 'A', stage: 'Forest', day: 'Friday', date: '2026-08-21' })], {}, f);
    assert.equal(p.counts.error, 0);
    assert.equal(p.counts.newDays, 0);
    assert.equal(p.rows[0]!.dayLabel, 'Friday');
    assert.deepEqual(writes.inserts.map((s) => s.dayIndex), [0]);
  });

  it('rejects a row whose day label belongs to a day with another date', () => {
    const { plan: p } = plan([row(2, { artist: 'A', stage: 'Forest', day: 'Friday', date: '2026-08-28' })]);
    assert.equal(p.rows[0]!.errors[0]!.message, 'Day "Friday" is dated 2026-08-21, not 2026-08-28. Fix the date or the day.');
    assert.equal(p.counts.newDays, 0);
  });

  it('creates days and stages in an empty festival', () => {
    const empty = festival({ stages: [], days: [] });
    const { plan: p, writes } = plan(
      [
        row(2, { artist: 'Aurora Lights', stage: 'Main Stage', day: 'Friday', date: '2026-08-21', startTime: '21:00', endTime: '22:30' }),
        row(3, { artist: 'Kai b2b Mira', stage: 'Forest', day: 'Friday', date: '2026-08-21', startTime: '23:30', endTime: '01:30' }),
        row(4, { artist: 'Night Owl', stage: 'Main Stage', day: 'Friday', date: '2026-08-21', startTime: '01:00', endTime: '02:30' }),
      ],
      {},
      empty,
    );
    assert.equal(p.counts.error, 0);
    assert.equal(p.counts.new, 3);
    assert.equal(p.counts.newStages, 2);
    assert.equal(p.counts.newDays, 1);
    assert.deepEqual(writes.newDays, [{ dayIndex: 0, label: 'Friday', date: '2026-08-21' }]);
  });
});

describe('planLineupImport: stages', () => {
  it('creates an unknown stage with createMissing, with the given or default colour', () => {
    const { plan: p } = plan([
      row(2, { artist: 'A', stage: 'Dome', day: 'Friday', stageColor: '#123456' }),
      row(3, { artist: 'B', stage: 'Tent', day: 'Friday', stageColor: 'red' }),
    ]);
    assert.deepEqual(p.newStages, [
      { name: 'Dome', color: '#123456' },
      { name: 'Tent', color: '#6a6a88' },
    ]);
  });

  it('rejects an unknown stage without createMissing and never falls back', () => {
    const { plan: p, writes } = plan([row(2, { artist: 'A', stage: 'Forrest', day: 'Friday' })], { createMissing: false });
    assert.equal(p.rows[0]!.status, 'error');
    assert.match(p.rows[0]!.errors[0]!.message, /^Unknown stage "Forrest"\. Use one of: Main Stage, Forest, or tick Create/);
    assert.equal(writes.inserts.length, 0);
  });

  it('matches a stage name ignoring case and spacing', () => {
    const { plan: p } = plan([row(2, { artist: 'A', stage: '  main   STAGE ', day: 'Friday' })]);
    assert.equal(p.rows[0]!.stageName, 'Main Stage');
    assert.equal(p.counts.newStages, 0);
  });

  it('uses the only stage for an empty stage cell, and errors with several stages', () => {
    const one = festival({ stages: [{ id: 'main', name: 'Main Stage', color: '#fff' }] });
    assert.equal(plan([row(2, { artist: 'A', stage: '', day: 'Friday' })], {}, one).plan.rows[0]!.stageName, 'Main Stage');
    assert.equal(plan([row(2, { artist: 'A', stage: '', day: 'Friday' })]).plan.rows[0]!.errors[0]!.message, 'Stage is empty.');
  });
});

describe('planLineupImport: times', () => {
  it('normalises times', () => {
    assert.equal(normalizeTime('9pm'), '21:00');
    assert.equal(normalizeTime('21:00:00'), '21:00');
    assert.equal(normalizeTime('9:30 AM'), '09:30');
    assert.equal(normalizeTime('12am'), '00:00');
  });

  it('treats TBA and empty as null, and rejects 25:99', () => {
    const { plan: p } = plan([
      row(2, { artist: 'A', stage: 'Forest', day: 'Friday', startTime: 'TBA', endTime: '' }),
      row(3, { artist: 'B', stage: 'Forest', day: 'Friday', startTime: '25:99' }),
    ]);
    assert.equal(p.rows[0]!.startTime, null);
    assert.equal(p.rows[0]!.endTime, null);
    assert.equal(p.rows[1]!.errors[0]!.message, 'Start time "25:99" is not a time. Use 21:00 or 9pm.');
  });

  it('warns that a start before 06:00 counts as the night before', () => {
    const { plan: p } = plan([row(2, { artist: 'A', stage: 'Forest', day: 'Friday', startTime: '1am', endTime: '2am' })]);
    assert.deepEqual(p.rows[0]!.warnings, ['Starts after midnight, so it counts as Friday night.']);
  });
});

describe('planLineupImport: matching', () => {
  it('matches by artist and day, ignoring case and spacing', () => {
    const f = withSets([{ day: 0, set: alpha }]);
    const { plan: p } = plan([row(2, { artist: 'dj  alpha', day: 'Friday', startTime: '20:00', endTime: '21:00' })], {}, f);
    assert.equal(p.rows[0]!.setId, 'set-a');
    // The spelling differs, so the artist name is a change.
    assert.equal(p.rows[0]!.status, 'changed');
    const exact = plan([row(2, { artist: 'DJ Alpha', day: 'Friday', stage: 'Main Stage', startTime: '20:00', endTime: '21:00' })], {}, f);
    assert.equal(exact.plan.rows[0]!.status, 'unchanged');
    assert.equal(exact.plan.counts.missingFromFile, 0);
  });

  it('narrows several matches by stage, and errors when still ambiguous', () => {
    const f = withSets([
      { day: 0, set: alpha },
      { day: 0, set: { ...alpha, id: 'set-a2', stageId: 'forest', startTime: '22:00', endTime: '23:00' } },
    ]);
    const narrowed = plan([row(2, { artist: 'DJ Alpha', day: 'Friday', stage: 'Forest' })], {}, f);
    assert.equal(narrowed.plan.rows[0]!.setId, 'set-a2');
    const ambiguous = plan([row(2, { artist: 'DJ Alpha', day: 'Friday' })], {}, f);
    assert.equal(ambiguous.plan.rows[0]!.errors[0]!.message, 'Matches 2 sets on Friday. Add the stage to tell them apart.');
  });

  it('matches by set id first, and rejects an id from elsewhere', () => {
    const f = withSets([{ day: 0, set: alpha }]);
    const byId = plan([row(2, { setId: 'set-a', artist: 'DJ Alpha', day: 'Friday' })], {}, f);
    assert.equal(byId.plan.rows[0]!.setId, 'set-a');
    const other = plan([row(2, { setId: 'set-zzz', artist: 'DJ Alpha', day: 'Friday' })], {}, f);
    assert.equal(other.plan.rows[0]!.errors[0]!.message, 'This id belongs to another festival.');
  });

  it('flags a second row with the same artist, day and stage', () => {
    const { plan: p } = plan([
      row(2, { artist: 'A', stage: 'Forest', day: 'Friday' }),
      row(3, { artist: 'a', stage: 'Forest', day: 'Friday' }),
    ]);
    assert.equal(p.rows[1]!.errors[0]!.message, 'Same artist, day and stage as row 2.');
  });

  it('reports an overlap with an existing set on the same stage', () => {
    const f = withSets([{ day: 0, set: alpha }]);
    const { plan: p } = plan([row(2, { artist: 'DJ Clash', stage: 'Main Stage', day: 'Friday', startTime: '20:30', endTime: '21:30' })], {}, f);
    assert.equal(p.rows[0]!.status, 'error');
    assert.equal(p.rows[0]!.errors[0]!.message, 'Overlaps "DJ Alpha" on Main Stage (20:00–21:00).');
  });

  it('ignores overlaps between two existing sets', () => {
    const f = withSets([
      { day: 0, set: alpha },
      { day: 0, set: { ...alpha, id: 'set-b', artist: 'DJ Beta', artists: [{ name: 'DJ Beta', links: {} }], startTime: '20:30' } },
    ]);
    const { plan: p } = plan([row(2, { artist: 'DJ Gamma', stage: 'Forest', day: 'Friday', startTime: '20:00', endTime: '21:00' })], {}, f);
    assert.equal(p.counts.error, 0);
  });

  it('warns about a near match on the same day', () => {
    const f = withSets([{ day: 0, set: alpha }]);
    const { plan: p } = plan([row(2, { artist: 'DJ Alfa', stage: 'Forest', day: 'Friday' })], {}, f);
    assert.equal(p.rows[0]!.status, 'new');
    assert.deepEqual(p.rows[0]!.warnings, ['Did you mean DJ Alpha?']);
  });

  it('lists existing sets the file does not mention', () => {
    const f = withSets([{ day: 1, set: { ...alpha, id: 'set-sat' } }]);
    const { plan: p } = plan([row(2, { artist: 'New One', stage: 'Forest', day: 'Friday' })], {}, f);
    assert.deepEqual(p.missingFromFile, [{ setId: 'set-sat', artist: 'DJ Alpha', dayLabel: 'Saturday' }]);
  });
});

describe('planLineupImport: changes and updates', () => {
  it('leaves an unmapped field alone and clears a mapped empty one', () => {
    const f = withSets([{ day: 0, set: alpha }]);
    const unmapped = plan([row(2, { artist: 'DJ Alpha', day: 'Friday' })], { updateExisting: true }, f);
    assert.equal(unmapped.plan.rows[0]!.status, 'unchanged');
    const cleared = plan([row(2, { artist: 'DJ Alpha', day: 'Friday', startTime: '', link: '' })], { updateExisting: true }, f);
    assert.deepEqual(cleared.plan.rows[0]!.changes, ['Start 20:00 → TBA', 'Link https://open.spotify.com/artist/a → none']);
    const after = cleared.writes.updates[0]!.after;
    assert.equal(after.startTime, null);
    assert.equal(after.endTime, '21:00');
    assert.equal(after.linkUrl, null);
    assert.equal(after.artists[0]!.photo, 'https://i.scdn.co/a.jpg');
  });

  it('writes an update only with updateExisting', () => {
    const f = withSets([{ day: 0, set: alpha }]);
    const off = plan([row(2, { artist: 'DJ Alpha', day: 'Friday', startTime: '21:00', endTime: '22:00' })], {}, f);
    assert.equal(off.plan.rows[0]!.status, 'changed');
    assert.equal(off.writes.updates.length, 0);
    const on = plan([row(2, { artist: 'DJ Alpha', day: 'Friday', startTime: '21:00', endTime: '22:00' })], { updateExisting: true }, f);
    assert.equal(on.writes.updates.length, 1);
    assert.equal(on.writes.updates[0]!.before.startTime, '20:00');
  });

  it('keeps a dropped link out and warns', () => {
    const { plan: p, writes } = plan([row(2, { artist: 'A', stage: 'Forest', day: 'Friday', link: 'javascript:alert(1)' })]);
    assert.deepEqual(p.rows[0]!.warnings, ['Link dropped. Use an https link to Spotify, SoundCloud or another allowed site.']);
    assert.equal(writes.inserts[0]!.linkUrl, null);
  });

  it('creates no stage for a matched row that is not updated', () => {
    const f = withSets([{ day: 0, set: alpha }]);
    const { plan: p } = plan([row(2, { artist: 'DJ Alpha', day: 'Friday', stage: 'Dome' })], {}, f);
    assert.equal(p.rows[0]!.status, 'changed');
    assert.equal(p.counts.newStages, 0);
  });
});

describe('planLineupImport: caps', () => {
  it('reports too many rows, stages and sets per day as problems', () => {
    const tight = { MAX_IMPORT_SETS: 2, MAX_STAGES: 2, MAX_DAYS: 10, MAX_SETS_PER_DAY: 2 };
    const p = planLineupImport({
      festival: festival(),
      rows: [
        row(2, { artist: 'A', stage: 'Dome', day: 'Saturday' }),
        row(3, { artist: 'B', stage: 'Forest', day: 'Saturday' }),
        row(4, { artist: 'C', stage: 'Forest', day: 'Saturday' }),
      ],
      options: OPTIONS,
      config: tight,
    }).plan;
    assert.deepEqual(p.problems, [
      'This file has 3 rows. The limit is 2. Split the file and import it in parts.',
      'This import would make 3 stages. The limit is 2.',
      'Saturday would have 3 sets. The limit is 2.',
    ]);
  });
});

describe('planLineupImport: Spotify', () => {
  it('fills links only for new sets without a link', () => {
    const f = withSets([{ day: 0, set: { ...alpha, artists: [{ name: 'DJ Alpha', links: {} }], linkUrl: null } }]);
    const spotify = new Map([
      ['dj alpha', { spotifyUrl: 'https://open.spotify.com/artist/x' }],
      ['kai', { spotifyUrl: 'https://open.spotify.com/artist/kai', imageUrl: 'https://i.scdn.co/kai.jpg', genres: ['house'] }],
      ['mira', { spotifyUrl: 'https://open.spotify.com/artist/mira' }],
    ]);
    const rows = [
      row(2, { artist: 'DJ Alpha', day: 'Friday', startTime: '20:30', endTime: '21:00' }),
      row(3, { artist: 'Kai b2b Mira', stage: 'Forest', day: 'Friday' }),
      row(4, { artist: 'Linked', stage: 'Forest', day: 'Saturday', link: 'https://soundcloud.com/linked' }),
    ];
    const first = plan(rows, { updateExisting: true }, f);
    assert.deepEqual(artistsNeedingLinks(first.writes), ['Kai', 'Mira']);
    const { writes } = plan(rows, { updateExisting: true }, f, { spotify });
    assert.equal(writes.spotifyMatched, 2);
    const kai = writes.inserts[0]!;
    assert.equal(kai.linkUrl, 'https://open.spotify.com/artist/kai');
    assert.deepEqual(kai.artists[0], { name: 'Kai', links: { spotify: 'https://open.spotify.com/artist/kai' }, photo: 'https://i.scdn.co/kai.jpg', genres: ['house'] });
    assert.equal(writes.inserts[1]!.linkUrl, 'https://soundcloud.com/linked');
    assert.deepEqual(writes.updates[0]!.after.artists[0]!.links, {});
  });
});

describe('lineup export round trip', () => {
  it('re-imports an unchanged export with 0 new, 0 changed and 0 errors', () => {
    const f = withSets([
      { day: 0, set: alpha },
      { day: 0, set: { id: 'set-b2b', artist: 'Kai vs Mira', artists: [{ name: 'Kai', links: {} }, { name: 'Mira', links: {} }], stageId: 'forest', startTime: '23:30', endTime: '01:30', linkUrl: null } },
      { day: 1, set: { id: 'set-tba', artist: 'Dawn', artists: [{ name: 'Dawn', links: {} }], stageId: '', startTime: null, endTime: null, linkUrl: null } },
      { day: 1, set: { ...alpha, id: 'set-a-sat' } },
    ]);
    const parsed = parseLineupTable(buildLineupCsv(f));
    const rows = toImportRows(parsed.rows, defaultMapping(parsed.rows, true), true, parsed.lines);
    assert.equal(rows.length, 4);
    for (const updateExisting of [false, true]) {
      const { plan: p, writes } = plan(rows, { updateExisting }, f);
      assert.deepEqual(
        { new: p.counts.new, changed: p.counts.changed, error: p.counts.error, unchanged: p.counts.unchanged },
        { new: 0, changed: 0, error: 0, unchanged: 4 },
      );
      assert.deepEqual(p.problems, []);
      assert.equal(writes.inserts.length + writes.updates.length, 0);
    }
  });
});

const entry = (id: string, names: string[], extra: any = {}) => ({
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

describe('planLineupImport: poster names', () => {
  const posterFestival = (lineup: any[]) => festival({ lineup });

  it('a new set takes the poster name of the announced act with the same artists, whatever the order', () => {
    const f = posterFestival([entry('lu-1', ['INFEKT', 'MODAL NODES'], { displayName: 'Port Zero presents: INFEKT vs MODAL NODES' })]);
    const { plan: p, writes } = plan([row(2, { artist: 'Modal Nodes b2b Infekt', stage: 'Forest', day: 'Friday' })], {}, f);
    assert.equal(p.rows[0]!.status, 'new');
    assert.equal(p.rows[0]!.displayName, 'Port Zero presents: INFEKT vs MODAL NODES');
    assert.equal(writes.inserts[0]!.displayName, 'Port Zero presents: INFEKT vs MODAL NODES');
  });

  it('leaves display_name empty for an act with no poster name, a cancelled act and a solo set of a B2B act', () => {
    const f = posterFestival([
      entry('lu-1', ['Kai']),
      entry('lu-2', ['Mira'], { displayName: 'MIRA!', status: 'cancelled' }),
      entry('lu-3', ['Zed', 'Ana'], { displayName: 'Zed and Ana' }),
    ]);
    const { writes } = plan(
      [
        row(2, { artist: 'Kai', stage: 'Forest', day: 'Friday' }),
        row(3, { artist: 'Mira', stage: 'Forest', day: 'Friday', startTime: '20:00', endTime: '21:00' }),
        row(4, { artist: 'Zed', stage: 'Main Stage', day: 'Friday' }),
      ],
      {},
      f,
    );
    assert.deepEqual(writes.inserts.map((s) => s.displayName), [null, null, null]);
  });

  it('does not touch a set that already exists', () => {
    const f = posterFestival([entry('lu-1', ['DJ Alpha'], { displayName: 'ALPHA' })]);
    f.days[0]!.sets.push(alpha);
    const { plan: p, writes } = plan([row(2, { artist: 'DJ Alpha', day: 'Friday', startTime: '20:30' })], { updateExisting: true }, f);
    assert.equal(p.rows[0]!.status, 'changed');
    assert.equal(p.rows[0]!.displayName, undefined);
    assert.equal('displayName' in writes.updates[0]!.after, false);
  });
});

describe('planLineupImport: announced acts that match no set', () => {
  const lineup = [
    entry('lu-kai', ['Kai'], { dayDate: '2026-08-21' }),
    entry('lu-sub', ['Subtronics'], { dayDate: '2026-08-21', displayName: 'SUBTRONICS (live)' }),
    entry('lu-mira', ['Mira'], { dayDate: '2026-08-22' }),
    entry('lu-tba', ['Nova']),
    entry('lu-gone', ['Zed'], { dayDate: '2026-08-21', status: 'cancelled' }),
  ];

  it('names an act on a day the import fills when no row spells it the same way', () => {
    const { plan: p } = plan(
      [row(2, { artist: 'Kai', stage: 'Forest', day: 'Friday' }), row(3, { artist: 'Subtronix', stage: 'Forest', day: 'Friday', startTime: '20:00', endTime: '21:00' })],
      {},
      festival({ lineup }),
    );
    assert.deepEqual(p.unmatchedActs, [{ entryId: 'lu-sub', name: 'SUBTRONICS (live)', dayLabel: 'Friday' }]);
  });

  it('skips acts on days the import does not fill, acts with no day and cancelled acts', () => {
    const { plan: p } = plan([row(2, { artist: 'Kai', stage: 'Forest', day: 'Friday' })], {}, festival({ lineup }));
    assert.deepEqual(p.unmatchedActs.map((a) => a.entryId), ['lu-sub']);
  });

  it('counts an existing set, a name that folds the same and a hand link as a match', () => {
    const f = festival({
      lineup: [
        entry('lu-1', ['Zeds Dead'], { dayDate: '2026-08-21' }),
        entry('lu-2', ['Linked Act'], { dayDate: '2026-08-21', linkedSetIds: ['set-a'] }),
        entry('lu-3', ['DJ Alpha'], { dayDate: '2026-08-21' }),
      ],
    });
    f.days[0]!.sets.push(alpha);
    const { plan: p } = plan([row(2, { artist: "Zed's Dead", stage: 'Forest', day: 'Friday' })], {}, f);
    assert.deepEqual(p.unmatchedActs, []);
  });

  it('lists nothing when the only row has an error, because that row fills no day', () => {
    const { plan: p } = plan([row(2, { artist: 'Kai', stage: 'Nowhere', day: 'Friday' })], { createMissing: false }, festival({ lineup }));
    assert.equal(p.counts.error, 1);
    assert.deepEqual(p.unmatchedActs, []);
  });

  it('is empty for a festival with no lineup', () => {
    assert.deepEqual(plan([row(2, { artist: 'Kai', stage: 'Forest', day: 'Friday' })]).plan.unmatchedActs, []);
  });
});

describe('lineup CSV round trip with announced acts', () => {
  const names = Array.from({ length: 10 }, (_, i) => `Act ${i + 1}`);
  const lineup = [
    ...names.map((n, i) => entry(`lu-${i}`, [n], { dayDate: '2026-08-21', displayName: `${n} (poster)` })),
    entry('lu-tba', ['No Day'], {}),
    entry('lu-cancelled', ['Cancelled Act'], { dayDate: '2026-08-21', status: 'cancelled' }),
    entry('lu-scheduled', ['DJ Alpha'], { dayDate: '2026-08-21' }),
  ];
  const base = () => {
    const f = festival({ lineup });
    f.days[0]!.sets.push(alpha);
    return f;
  };
  const exportRows = (f: any) => {
    const parsed = parseLineupTable(buildLineupCsv(f));
    return toImportRows(parsed.rows, defaultMapping(parsed.rows, true), true, parsed.lines);
  };

  it('exports one row per act that has no set and is not cancelled, after the sets', () => {
    const rows = exportRows(base());
    assert.equal(rows.length, 1 + 10 + 1);
    assert.deepEqual(rows[0], { row: 2, setId: 'set-a', artist: 'DJ Alpha', day: 'Friday', stage: 'Main Stage', startTime: '20:00', endTime: '21:00' });
    assert.deepEqual(rows[1], { row: 3, setId: '', artist: 'Act 1', day: 'Friday', stage: '', startTime: '', endTime: '' });
    assert.deepEqual(rows.at(-1), { row: 13, setId: '', artist: 'No Day', day: '', stage: '', startTime: '', endTime: '' });
    assert.equal(rows.some((r) => r.artist === 'Cancelled Act'), false);
  });

  it('joins a B2B act with the festival separator', () => {
    const f = festival({ lineup: [entry('lu-b', ['Kai', 'Mira'], { dayDate: '2026-08-21' })] });
    assert.equal(exportRows(f)[0]!.artist, 'Kai vs Mira');
  });

  it('shows 10 New with poster names kept after the stage and times are filled, then 10 Unchanged', () => {
    const f = base();
    // Only the 10 'Act ' rows are filled in; the DJ Alpha row and the 'No Day' row stay as exported.
    const filled = exportRows(f).map((r, i) =>
      r.artist.startsWith('Act ')
        ? { ...r, stage: 'Forest', startTime: `${String(12 + i).padStart(2, '0')}:00`, endTime: `${String(12 + i).padStart(2, '0')}:45` }
        : r,
    );
    const first = plan(filled, { updateExisting: true }, f);
    assert.deepEqual(
      { new: first.plan.counts.new, error: first.plan.counts.error, changed: first.plan.counts.changed },
      { new: 10, error: 0, changed: 0 },
    );
    assert.equal(first.plan.counts.unchanged, 2);
    assert.deepEqual(first.writes.inserts.map((s) => s.displayName), names.map((n) => `${n} (poster)`));
    assert.deepEqual(first.plan.unmatchedActs, []);

    // Apply the writes to the festival, then import the same sheet again.
    for (const s of first.writes.inserts) {
      f.days[s.dayIndex]!.sets.push({ id: s.id, artist: s.artist, artists: s.artists, stageId: s.stageId, startTime: s.startTime, endTime: s.endTime, linkUrl: s.linkUrl });
    }
    const second = plan(filled, { updateExisting: true }, f);
    assert.deepEqual(
      { new: second.plan.counts.new, changed: second.plan.counts.changed, unchanged: second.plan.counts.unchanged, error: second.plan.counts.error },
      { new: 0, changed: 0, unchanged: 12, error: 0 },
    );
  });

  const untouched = (f: any) => {
    const { plan: p, writes } = plan(exportRows(f), { updateExisting: true, createMissing: false }, f);
    assert.equal(p.counts.error, 0);
    assert.equal(p.counts.new, 0);
    assert.equal(p.counts.changed, 0);
    assert.equal(p.counts.unchanged, 12);
    assert.equal(writes.inserts.length + writes.updates.length, 0);
    assert.match(p.rows[1]!.warnings[0]!, /Not placed yet/);
  };

  it('imports an untouched export on a two-stage festival with no errors and no writes', () => {
    untouched(base());
  });

  it('imports an untouched export on a one-stage festival without making TBA sets', () => {
    const f = base();
    f.stages = [f.stages[0]!];
    untouched(f);
  });

  it('still makes a TBA set on a one-stage festival when the row has a name and no stage but names an unannounced act', () => {
    const f = base();
    f.stages = [f.stages[0]!];
    const { plan: p } = plan([row(2, { artist: 'Walk-in', day: 'Friday' })], {}, f);
    assert.equal(p.counts.new, 1);
  });
});
