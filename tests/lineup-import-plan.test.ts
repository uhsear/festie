/**
 * Unit tests for lib/lineup-import-plan.ts (pure, no database).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeTime, planLineupImport, artistsNeedingLinks, artistLookupKeys } from '../lib/lineup-import-plan.js';
import { artistNameKey } from '../lib/artist-key.js';
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
    assert.deepEqual(cleared.plan.rows[0]!.changes, ['Start 20:00 → TBA', 'Spotify link https://open.spotify.com/artist/a → none']);
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
    assert.deepEqual(p.rows[0]!.warnings, ['Link dropped. Use an https link.']);
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
    // A SoundCloud link is not a Spotify link, so that artist still goes to the Spotify search.
    assert.deepEqual(artistsNeedingLinks(first.writes), ['Kai', 'Mira', 'Linked']);
    const { writes } = plan(rows, { updateExisting: true }, f, { spotify });
    assert.equal(writes.spotifyMatched, 2);
    const kai = writes.inserts[0]!;
    assert.equal(kai.linkUrl, 'https://open.spotify.com/artist/kai');
    assert.deepEqual(kai.artists[0], { name: 'Kai', links: { spotify: 'https://open.spotify.com/artist/kai' }, photo: 'https://i.scdn.co/kai.jpg', genres: ['house'] });
    assert.equal(writes.inserts[1]!.linkUrl, null);
    assert.deepEqual(writes.inserts[1]!.artists[0]!.links, { soundcloud: 'https://soundcloud.com/linked' });
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

// ── P6: fixes, formats, announced rows and artist matching ─────────────────

const SPOTIFY_22 = 'https://open.spotify.com/artist/0TnOYISbd1XYRBk9myaseg';

describe('planLineupImport: day and match fixes', () => {
  it('folds curly quotes in artist and stage names', () => {
    const f = withSets([{ day: 0, set: { ...alpha, id: 'set-z', artist: "Zed's Dead", artists: [{ name: "Zed's Dead", links: {} }], linkUrl: null } }]);
    f.stages.push({ id: 'pete', name: "Pete's Tent", color: '#111111' });
    const { plan: p, writes } = plan([
      row(2, { artist: 'Zed’s Dead', day: 'Friday', startTime: '20:00', endTime: '21:00' }),
      row(3, { artist: 'New Act', day: 'Friday', stage: 'Pete’s Tent', startTime: '10:00', endTime: '11:00' }),
    ], {}, f);
    assert.equal(p.rows[0]!.setId, 'set-z');
    assert.equal(p.rows[1]!.status, 'new');
    assert.equal(writes.newStages.length, 0);
  });

  it('skips a set id row whose day differs, and lets the other rows commit', () => {
    const f = withSets([{ day: 0, set: alpha }]);
    const { plan: p, writes } = plan([
      row(2, { setId: 'set-a', artist: 'DJ Alpha', day: 'Saturday', startTime: '22:00', endTime: '23:00' }),
      row(3, { artist: 'Fresh', day: 'Friday', stage: 'Forest' }),
    ], { updateExisting: true }, f);
    const skipped = p.rows[0]!;
    assert.equal(skipped.status, 'unchanged');
    assert.equal(
      skipped.skipped,
      'Skipped: the file says Saturday, the stored day is Friday. Import cannot move a set to another day. Move it in the editor, then import again.',
    );
    assert.deepEqual(skipped.warnings, [skipped.skipped]);
    assert.equal(p.counts.skipped, 1);
    assert.equal(p.counts.error, 0);
    assert.equal(writes.updates.length, 0);
    assert.equal(writes.inserts.length, 1);
    assert.deepEqual(p.missingFromFile, []);
  });

  it('moves the set when the option is on: day change, day move write, overlap check on the new day', () => {
    const f = withSets([
      { day: 0, set: alpha },
      { day: 1, set: { ...alpha, id: 'set-b', artist: 'DJ Beta', artists: [{ name: 'DJ Beta', links: {} }], startTime: '20:30', endTime: '21:30', linkUrl: null } },
    ]);
    const clash = plan([row(2, { setId: 'set-a', artist: 'DJ Alpha', day: 'Saturday' })], { updateExisting: true, moveDays: true }, f);
    assert.equal(clash.plan.rows[0]!.status, 'error');
    assert.match(clash.plan.rows[0]!.errors[0]!.message, /Overlaps "DJ Beta"/);

    const ok = plan([row(2, { setId: 'set-a', artist: 'DJ Alpha', day: 'Saturday', startTime: '22:00', endTime: '23:00' })], { updateExisting: true, moveDays: true }, f);
    assert.equal(ok.plan.rows[0]!.status, 'changed');
    assert.deepEqual(ok.plan.rows[0]!.changes.slice(0, 1), ['Day Friday → Saturday']);
    assert.equal(ok.plan.rows[0]!.dayLabel, 'Saturday');
    assert.deepEqual(ok.writes.updates[0]!.dayMove, { from: 0, to: 1 });
    assert.equal(ok.plan.counts.skipped, 0);

    const off = plan([row(2, { setId: 'set-a', artist: 'DJ Alpha', day: 'Saturday', startTime: '22:00', endTime: '23:00' })], { updateExisting: false, moveDays: true }, f);
    assert.equal(off.writes.updates.length, 0);
  });

  it('creates the new day for a move onto a day that does not exist yet', () => {
    const f = withSets([{ day: 1, set: alpha }]);
    const { plan: p, writes } = plan([row(2, { setId: 'set-a', artist: 'DJ Alpha', day: 'Sunday', date: '2026-08-23' })], { updateExisting: true, moveDays: true }, f);
    assert.equal(p.rows[0]!.status, 'changed');
    assert.deepEqual(writes.newDays, [{ dayIndex: 2, label: 'Sunday', date: '2026-08-23' }]);
    assert.deepEqual(writes.updates[0]!.dayMove, { from: 1, to: 2 });
  });

  it('warns that a row without a set id adds a second set on another day', () => {
    const f = withSets([{ day: 0, set: alpha }]);
    const { plan: p } = plan([row(2, { artist: 'DJ Alpha', day: 'Saturday', stage: 'Main Stage', startTime: '10:00', endTime: '11:00' })], {}, f);
    assert.equal(p.rows[0]!.status, 'new');
    assert.deepEqual(p.rows[0]!.warnings, [
      'This artist already has a set on Friday. This row adds a second set on Saturday. Use the export file to change a day.',
    ]);
  });

  it('names the stage and the export file when two sets still match', () => {
    const twin = { ...alpha, id: 'set-a2', startTime: '22:00', endTime: '23:00' };
    const f = withSets([{ day: 0, set: alpha }, { day: 0, set: twin }]);
    const withStage = plan([row(2, { artist: 'DJ Alpha', day: 'Friday', stage: 'Main Stage' })], {}, f);
    assert.equal(withStage.plan.rows[0]!.errors[0]!.message, 'Matches 2 sets on Friday at Main Stage. Use the export file with set_id.');
    const noStage = plan([row(2, { artist: 'DJ Alpha', day: 'Friday' })], {}, f);
    assert.equal(noStage.plan.rows[0]!.errors[0]!.message, 'Matches 2 sets on Friday. Add the stage to tell them apart.');
  });
});

describe('planLineupImport: columns', () => {
  it('writes one link per platform on the first artist and keeps link_url on Spotify', () => {
    const { plan: p, writes } = plan([
      row(2, { artist: 'A', day: 'Friday', stage: 'Forest', spotify: SPOTIFY_22, soundcloud: 'https://soundcloud.com/a-artist', instagram: 'https://instagram.com/a.artist/?igshid=x' }),
    ]);
    assert.deepEqual(p.rows[0]!.warnings, []);
    assert.deepEqual(writes.inserts[0]!.artists[0]!.links, {
      spotify: SPOTIFY_22,
      soundcloud: 'https://soundcloud.com/a-artist',
      instagram: 'https://www.instagram.com/a.artist',
    });
    assert.equal(writes.inserts[0]!.linkUrl, SPOTIFY_22);
  });

  it('reads the platform of the single link column from its host', () => {
    const { writes } = plan([
      row(2, { artist: 'A', day: 'Friday', stage: 'Forest', link: 'https://soundcloud.com/a-artist' }),
      row(3, { artist: 'B', day: 'Friday', stage: 'Main Stage', link: 'https://www.bartist.com/' }),
      row(4, { artist: 'C', day: 'Saturday', stage: 'Forest', link: SPOTIFY_22 }),
    ]);
    assert.deepEqual(writes.inserts[0]!.artists[0]!.links, { soundcloud: 'https://soundcloud.com/a-artist' });
    assert.deepEqual(writes.inserts[1]!.artists[0]!.links, { website: 'https://www.bartist.com' });
    assert.deepEqual(writes.inserts[2]!.artists[0]!.links, { spotify: SPOTIFY_22 });
    assert.equal(writes.inserts[0]!.linkUrl, null);
  });

  it('drops a link that fails the platform rules and says which one', () => {
    const { plan: p, writes } = plan([
      row(2, { artist: 'A', day: 'Friday', stage: 'Forest', spotify: 'https://open.spotify.com/track/0TnOYISbd1XYRBk9myaseg', instagram: 'https://instagram.com/p/abc' }),
    ]);
    assert.deepEqual(p.rows[0]!.warnings, [
      'Spotify link dropped. This is a Spotify track link. Open the artist page and copy that link.',
      'Instagram link dropped. This is a post. Copy the profile link.',
    ]);
    assert.deepEqual(writes.inserts[0]!.artists[0]!.links, {});
  });

  it('clears one platform with an empty cell and leaves unmapped platforms alone', () => {
    const f = withSets([{ day: 0, set: { ...alpha, artists: [{ name: 'DJ Alpha', links: { spotify: SPOTIFY_22, instagram: 'https://www.instagram.com/alpha' } }], linkUrl: SPOTIFY_22 } }]);
    const { plan: p, writes } = plan([row(2, { artist: 'DJ Alpha', day: 'Friday', instagram: '' })], { updateExisting: true }, f);
    assert.deepEqual(p.rows[0]!.changes, ['Instagram link https://www.instagram.com/alpha → none']);
    assert.deepEqual(writes.updates[0]!.after.artists[0]!.links, { spotify: SPOTIFY_22 });
    assert.equal(writes.updates[0]!.after.linkUrl, SPOTIFY_22);
  });

  it('writes the display name of a new set, changes it on a match, and clears it with an empty cell', () => {
    const f = withSets([{ day: 0, set: { ...alpha, displayName: 'Alpha Live' } }]);
    const fresh = plan([row(2, { artist: 'A', day: 'Friday', stage: 'Forest', displayName: 'A (Live)' })], {}, f);
    assert.equal(fresh.writes.inserts[0]!.displayName, 'A (Live)');
    const rename = plan([row(2, { artist: 'DJ Alpha', day: 'Friday', displayName: 'Alpha Unplugged' })], { updateExisting: true }, f);
    assert.deepEqual(rename.plan.rows[0]!.changes, ['Display name Alpha Live → Alpha Unplugged']);
    const clear = plan([row(2, { artist: 'DJ Alpha', day: 'Friday', displayName: '' })], { updateExisting: true }, f);
    assert.equal(clear.writes.updates[0]!.after.displayName, null);
    const unmapped = plan([row(2, { artist: 'DJ Alpha', day: 'Friday' })], { updateExisting: true }, f);
    assert.equal(unmapped.plan.rows[0]!.status, 'unchanged');
  });
});

describe('planLineupImport: announced rows', () => {
  const entry = (id: string, names: string[], extra: any = {}) => ({
    id, artists: names.map((name) => ({ name, links: {} })), displayName: null, tier: null, dayDate: null, status: 'announced', announcedAt: '2026-01-01', linkedSetIds: [], ...extra,
  });

  it('turns names with no day, stage or time into announced entries, one per line', () => {
    const rows = ['Alok', 'Kai vs Mira', 'Sub Focus'].map((artist, i) => row(i + 1, { artist }));
    const { plan: p, writes } = plan(rows);
    assert.deepEqual(p.rows.map((r) => [r.status, r.target]), [['new', 'announced'], ['new', 'announced'], ['new', 'announced']]);
    assert.equal(p.counts.announced, 3);
    assert.equal(p.counts.error, 0);
    assert.equal(writes.inserts.length, 0);
    assert.deepEqual(writes.announced.inserts.map((i) => i.entry.artists.map((a) => a.name)), [['Alok'], ['Kai', 'Mira'], ['Sub Focus']]);
    const first = writes.announced.inserts[0]!.entry;
    assert.deepEqual({ tier: first.tier, dayDate: first.dayDate, status: first.status, linkedSetIds: first.linkedSetIds }, { tier: null, dayDate: null, status: 'announced', linkedSetIds: [] });
    assert.match(first.announcedAt, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('pastes a 118-act list with no manual work', () => {
    const rows = Array.from({ length: 118 }, (_, i) => row(i + 1, { artist: `Act Number ${i}` }));
    const { plan: p, writes } = plan(rows);
    assert.equal(p.counts.new, 118);
    assert.equal(p.counts.error, 0);
    assert.deepEqual(p.problems, []);
    assert.equal(writes.announced.inserts.length, 118);
  });

  it('matches a stored entry by name key: unchanged, and a new link makes it changed', () => {
    const f = festival({ lineup: [entry('lu-1', ['Alok'])] });
    const same = plan([row(1, { artist: 'alok' })], { updateExisting: true }, f);
    assert.equal(same.plan.rows[0]!.status, 'unchanged');
    const linked = plan([row(1, { artist: 'Alok', instagram: 'https://instagram.com/alok' })], { updateExisting: true }, f);
    assert.equal(linked.plan.rows[0]!.status, 'changed');
    assert.deepEqual(linked.writes.announced.updates[0]!.after.artists[0]!.links, { instagram: 'https://www.instagram.com/alok' });
    assert.equal(linked.writes.announced.updates[0]!.after.id, 'lu-1');
    const off = plan([row(1, { artist: 'Alok', instagram: 'https://instagram.com/alok' })], {}, f);
    assert.equal(off.writes.announced.updates.length, 0);
  });

  it('refuses a name twice in one file and warns about a near-miss spelling', () => {
    const f = festival({ lineup: [entry('lu-1', ['Subtronics'])] });
    const { plan: p } = plan([row(1, { artist: 'Alok' }), row(2, { artist: 'ALOK' }), row(3, { artist: 'Subtronic' })], {}, f);
    assert.equal(p.rows[1]!.errors[0]!.message, 'Same act as row 1.');
    assert.deepEqual(p.rows[2]!.warnings, ['Did you mean Subtronics?']);
    assert.equal(p.rows[2]!.resolutions[0]!.outcome, 'did_you_mean');
  });

  it('keeps a row with a stage but no day as an error, not an announced entry', () => {
    const { plan: p } = plan([row(1, { artist: 'Alok', stage: 'Forest' })]);
    assert.equal(p.rows[0]!.target, undefined);
    assert.equal(p.rows[0]!.errors[0]!.message, 'Day is empty.');
  });

  it('stops past the lineup limit', () => {
    const f = festival({ lineup: Array.from({ length: 500 }, (_, i) => entry(`lu-${i}`, [`Stored ${i}`])) });
    const { plan: p } = plan([row(1, { artist: 'One More' })], {}, f);
    assert.match(p.problems[0]!, /would have 501 entries/);
  });
});

describe('planLineupImport: artist matching', () => {
  const ref = (id: string, name: string, label = '', extra: any = {}) => ({ id, name, label, links: {}, photo: null, genres: [], mergedInto: null, ...extra });
  function lookup(refs: any[]) {
    const byKey = new Map<string, any[]>();
    for (const r of refs) if (!r.mergedInto) byKey.set(artistNameKey(r.name), [...(byKey.get(artistNameKey(r.name)) ?? []), r]);
    return { byKey, byId: new Map(refs.map((r) => [r.id, r])) };
  }
  const NINA = [ref('ar-uk', 'Nina Kraviz', 'UK', { links: { spotify: SPOTIFY_22 } }), ref('ar-ru', 'Nina Kraviz', 'Russia')];

  it('auto-matches one live artist and copies its links', () => {
    const artists = lookup([ref('ar-1', 'Alok', '', { links: { instagram: 'https://www.instagram.com/alok' }, photo: 'https://i.scdn.co/alok.jpg', genres: ['house'] })]);
    const { plan: p, writes } = plan([row(1, { artist: 'ALOK', day: 'Friday', stage: 'Forest' })], {}, festival(), { artists });
    assert.deepEqual(p.rows[0]!.resolutions, [{ name: 'ALOK', outcome: 'existing', artistId: 'ar-1' }]);
    assert.deepEqual(writes.inserts[0]!.artists[0], { name: 'ALOK', id: 'ar-1', links: { instagram: 'https://www.instagram.com/alok' }, photo: 'https://i.scdn.co/alok.jpg', genres: ['house'] });
    assert.deepEqual(writes.artistIds, ['ar-1']);
  });

  it('stops same-name artists at Needs choice and blocks the commit', () => {
    const { plan: p, writes } = plan([row(1, { artist: 'Nina Kraviz', day: 'Friday', stage: 'Forest' })], {}, festival(), { artists: lookup(NINA) });
    const r = p.rows[0]!;
    assert.equal(r.status, 'error');
    assert.equal(r.errors[0]!.code, 'needs_choice');
    assert.equal(r.resolutions[0]!.outcome, 'needs_choice');
    assert.deepEqual(r.resolutions[0]!.candidates, [
      { id: 'ar-uk', label: 'UK', hint: 'open.spotify.com/artist/0TnOYISbd1XYRBk9myaseg' },
      { id: 'ar-ru', label: 'Russia', hint: '' },
    ]);
    assert.equal(p.counts.needsChoice, 1);
    assert.equal(p.counts.error, 1);
    assert.equal(writes.inserts.length, 0);
  });

  it('stops an announced row at Needs choice too', () => {
    const { plan: p } = plan([row(1, { artist: 'Nina Kraviz' })], {}, festival(), { artists: lookup(NINA) });
    assert.equal(p.rows[0]!.target, 'announced');
    assert.equal(p.rows[0]!.status, 'error');
    assert.equal(p.counts.needsChoice, 1);
  });

  it('resolves the choice with an artist id, one id per name of a B2B set', () => {
    const artists = lookup([...NINA, ref('ar-kai', 'Kai')]);
    const { plan: p, writes } = plan([row(1, { artist: 'Nina Kraviz vs Kai', artistId: 'ar-ru|', day: 'Friday', stage: 'Forest' })], {}, festival(), { artists });
    assert.equal(p.rows[0]!.status, 'new');
    assert.deepEqual(p.rows[0]!.resolutions.map((r) => [r.outcome, r.artistId]), [['existing', 'ar-ru'], ['existing', 'ar-kai']]);
    assert.deepEqual(writes.inserts[0]!.artists.map((a) => a.id), ['ar-ru', 'ar-kai']);
  });

  it('checks every name of a B2B set on its own', () => {
    const artists = lookup([...NINA, ref('ar-kai', 'Kai')]);
    const { plan: p } = plan([row(1, { artist: 'Nina Kraviz vs Kai', day: 'Friday', stage: 'Forest' })], {}, festival(), { artists });
    assert.deepEqual(p.rows[0]!.resolutions.map((r) => r.outcome), ['needs_choice', 'existing']);
  });

  it('refuses an unknown id, a merged id and too many ids', () => {
    const artists = lookup([...NINA, ref('ar-old', 'Old Name', '', { mergedInto: 'ar-uk' })]);
    const { plan: p } = plan([
      row(1, { artist: 'Alok', artistId: 'ar-nope', day: 'Friday', stage: 'Forest' }),
      row(2, { artist: 'Old Name', artistId: 'ar-old', day: 'Friday', stage: 'Main Stage' }),
      row(3, { artist: 'Alok', artistId: 'a|b', day: 'Saturday', stage: 'Forest' }),
    ], {}, festival(), { artists });
    assert.equal(p.rows[0]!.errors[0]!.message, 'Artist id "ar-nope" is not known. Remove the id, or pick the artist again.');
    assert.equal(p.rows[1]!.errors[0]!.message, 'Artist id "ar-old" was merged into another artist. Remove the id, or pick the artist again.');
    assert.equal(p.rows[2]!.errors[0]!.message, '2 artist ids for 1 names. Use one id per name, with | between them.');
  });

  it('keeps the stored artist of a matched set, so a time update never stops at Needs choice', () => {
    const f = withSets([{ day: 0, set: { ...alpha, artist: 'Nina Kraviz', artists: [{ name: 'Nina Kraviz', id: 'ar-ru', links: {} }], linkUrl: null } }]);
    const { plan: p, writes } = plan([row(1, { artist: 'Nina Kraviz', day: 'Friday', startTime: '21:00', endTime: '22:00' })], { updateExisting: true }, f, { artists: lookup(NINA) });
    assert.equal(p.rows[0]!.status, 'changed');
    assert.deepEqual(p.rows[0]!.resolutions, [{ name: 'Nina Kraviz', outcome: 'existing', artistId: 'ar-ru' }]);
    assert.equal(writes.updates[0]!.after.artists[0]!.id, 'ar-ru');
    assert.deepEqual(writes.artistIds, []);
  });

  it('lets an id re-point a stored artist that has none, and reports it as a change', () => {
    const f = withSets([{ day: 0, set: { ...alpha, artist: 'Nina Kraviz', artists: [{ name: 'Nina Kraviz', links: {} }], linkUrl: null } }]);
    const { plan: p } = plan([row(1, { artist: 'Nina Kraviz', artistId: 'ar-uk', day: 'Friday' })], { updateExisting: true }, f, { artists: lookup(NINA) });
    assert.deepEqual(p.rows[0]!.changes, ['Artist Nina Kraviz linked to artist ar-uk']);
  });

  it('does not search Spotify for an artist from the repository', () => {
    const artists = lookup([ref('ar-1', 'Alok')]);
    const first = plan([row(1, { artist: 'Alok', day: 'Friday', stage: 'Forest' }), row(2, { artist: 'Newcomer', day: 'Friday', stage: 'Main Stage' })], {}, festival(), { artists });
    assert.deepEqual(artistsNeedingLinks(first.writes), ['Newcomer']);
  });

  it('lists the name keys and ids a lookup needs', () => {
    const { keys, ids } = artistLookupKeys(festival(), [
      row(1, { artist: 'Zed’s Dead vs Kai', artistId: 'ar-1|ar-2' }),
      row(2, { artist: 'Kai' }),
    ] as any);
    assert.deepEqual([...keys].sort(), [artistNameKey('Kai'), artistNameKey('Zeds Dead')].sort());
    assert.deepEqual(ids.sort(), ['ar-1', 'ar-2']);
  });
});
