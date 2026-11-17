import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  coverLineup,
  lineupEntryKey,
  lineupIssues,
  lineupNameKey,
  cleanLineupLinks,
  normalizeLineup,
  todayInZone,
} from '../lib/lineup.js';
import { validateFestivalIssues } from '../lib/helpers/validation.js';

const fixture = JSON.parse(
  fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'lineup-cover.json'), 'utf8'),
);
const config = { MAX_STAGES: 20, MAX_DAYS: 10, MAX_SETS_PER_DAY: 200 };

describe('lineupNameKey', () => {
  for (const [a, b] of fixture.sameKey) {
    test(`"${a}" and "${b}" share a key`, () => assert.equal(lineupNameKey(a), lineupNameKey(b)));
  }
  for (const [a, b] of fixture.differentKey) {
    test(`"${a}" and "${b}" differ`, () => assert.notEqual(lineupNameKey(a), lineupNameKey(b)));
  }

  test('strips marks on Latin letters only', () => {
    assert.equal(lineupNameKey('Bacardí'), lineupNameKey('bacardi'));
    assert.notEqual(lineupNameKey('ガ'), lineupNameKey('カ'));
  });

  test('a name of only symbols keeps its lowered text', () => {
    assert.equal(lineupNameKey('!!!'), '!!!');
  });
});

describe('coverLineup (shared fixture)', () => {
  for (const c of fixture.cases) {
    test(c.name, () => {
      const cover = coverLineup(c.lineup, c.days, c.separator);
      for (const [id, want] of Object.entries<any>(c.expected)) {
        assert.deepEqual(cover[id], want, `entry ${id}`);
      }
    });
  }
});

describe('lineupIssues', () => {
  test('refuses a second entry with the same artists, naming both lines', () => {
    const issues = lineupIssues([
      { artists: [{ name: 'INFEKT' }] },
      { artists: [{ name: 'Other' }] },
      { artists: [{ name: 'infekt' }] },
    ]);
    assert.equal(issues.length, 1);
    assert.equal(issues[0]!.code, 'lineup_duplicate');
    assert.match(issues[0]!.message, /lines 1, 3/);
  });

  test('B2B order does not make a different entry', () => {
    const issues = lineupIssues([{ artists: [{ name: 'A' }, { name: 'B' }] }, { artists: [{ name: 'B' }, { name: 'A' }] }]);
    assert.equal(issues.length, 1);
  });

  test('refuses a duplicate id', () => {
    const issues = lineupIssues([
      { id: 'x', artists: [{ name: 'A' }] },
      { id: 'x', artists: [{ name: 'B' }] },
    ]);
    assert.deepEqual(issues.map((i) => i.code), ['lineup_id_duplicate']);
  });

  test('validateFestivalIssues reports it as lineup_duplicate', () => {
    const issues = validateFestivalIssues(config, {
      name: 'F',
      lineup: [{ artists: [{ name: 'A' }] }, { artists: [{ name: 'A' }] }],
    });
    assert.equal(issues.some((i) => i.code === 'lineup_duplicate' && i.target.field === 'lineup'), true);
  });
});

describe('normalizeLineup', () => {
  let n = 0;
  const ctx = { createId: (p: string) => `${p}-new${++n}`, today: '2026-11-20' };
  const stored = [
    { id: 'lu-1', artists: [{ name: 'Kai' }], announcedAt: '2026-11-01', status: 'announced', tier: 2 },
    { id: 'lu-2', artists: [{ name: 'Mira' }], announcedAt: '2026-11-02', status: 'announced', tier: null },
  ];

  test('makes ids for new entries and stamps today', () => {
    const entry = normalizeLineup([{ artists: [{ name: 'New Act', links: {} }] }], [], ctx)[0]!;
    assert.match(entry.id, /^lu-new/);
    assert.equal(entry.announcedAt, '2026-11-20');
    assert.equal(entry.status, 'announced');
    assert.equal(entry.tier, null);
    assert.equal(entry.dayDate, null);
    assert.deepEqual(entry.linkedSetIds, []);
  });

  test('a re-paste without ids keeps every stored id and announcedAt', () => {
    const out = normalizeLineup([{ artists: [{ name: 'mira' }] }, { artists: [{ name: 'KAI' }] }], stored, ctx);
    assert.deepEqual(out.map((e: any) => [e.id, e.announcedAt]), [
      ['lu-2', '2026-11-02'],
      ['lu-1', '2026-11-01'],
    ]);
  });

  test('a known id keeps the stored announcedAt, a client date is ignored', () => {
    const entry = normalizeLineup([{ id: 'lu-1', artists: [{ name: 'Kai' }], announcedAt: '2020-01-01' }], stored, ctx)[0]!;
    assert.equal(entry.announcedAt, '2026-11-01');
  });

  test('a source id is kept for a new entry', () => {
    const entry = normalizeLineup([{ id: 'forbidden-kingdom-2dy4', artists: [{ name: '2DY4' }] }], [], ctx)[0]!;
    assert.equal(entry.id, 'forbidden-kingdom-2dy4');
    assert.equal(entry.announcedAt, '2026-11-20');
  });

  test('an id-less entry does not steal an id the same save sends explicitly', () => {
    const out = normalizeLineup([{ id: 'lu-1', artists: [{ name: 'Kai' }] }, { artists: [{ name: 'Kai Two' }] }], stored, ctx);
    assert.equal(out[0]!.id, 'lu-1');
    assert.notEqual(out[1]!.id, 'lu-1');
  });

  test('keeps tier, day, status, poster name and caps linked sets at 10', () => {
    const entry = normalizeLineup(
      [
        {
          artists: [{ name: 'A' }],
          displayName: 'Poster A',
          tier: 3,
          dayDate: '2027-02-05',
          status: 'cancelled',
          linkedSetIds: Array.from({ length: 12 }, (_, i) => `s${i}`),
        },
      ],
      [],
      ctx,
    )[0]!;
    assert.equal(entry.displayName, 'Poster A');
    assert.equal(entry.tier, 3);
    assert.equal(entry.dayDate, '2027-02-05');
    assert.equal(entry.status, 'cancelled');
    assert.equal(entry.linkedSetIds.length, 10);
  });
});

describe('lineup links', () => {
  const bad = { spotify: 'javascript:alert(1)', website: 'data:text/html,x', instagram: 'https://instagram.com/a' };
  test('normalizeLineup drops non-http(s) links on write', () => {
    const entry = normalizeLineup([{ artists: [{ name: 'A', links: bad }] }], [], { createId: (p) => `${p}-x`, today: '2026-11-20' })[0]!;
    assert.deepEqual(entry.artists[0]!.links, { instagram: 'https://instagram.com/a' });
  });
  test('cleanLineupLinks drops them from a stored row on read', () => {
    const out = cleanLineupLinks([{ id: 'x', artists: [{ name: 'A', links: bad }] }]);
    assert.deepEqual(out[0].artists[0].links, { instagram: 'https://instagram.com/a' });
    assert.deepEqual(cleanLineupLinks(null), []);
  });
});

describe('todayInZone', () => {
  test('uses the festival zone, not UTC', () => {
    const lateUtc = new Date('2026-11-20T02:00:00Z');
    assert.equal(todayInZone('America/New_York', lateUtc), '2026-11-19');
    assert.equal(todayInZone('UTC', lateUtc), '2026-11-20');
    assert.equal(todayInZone('Not/AZone', lateUtc), '2026-11-20');
  });

  test('lineupEntryKey is stable under artist order', () => {
    assert.equal(
      lineupEntryKey({ artists: [{ name: 'B' }, { name: 'A' }] }),
      lineupEntryKey({ artists: [{ name: 'A' }, { name: 'B' }] }),
    );
  });
});
