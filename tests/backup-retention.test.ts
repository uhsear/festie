import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { selectPrune } = createRequire(import.meta.url)('../scripts/lib/backup-retention.cjs') as {
  selectPrune: (names: string[], now: number) => string[];
};

const NOW = new Date(2026, 10, 17, 12, 0, 0).getTime(); // local time, like the dump names
const p = (n: number) => String(n).padStart(2, '0');

function dumpName(hoursAgo: number, ext = '.dump.gpg'): string {
  const d = new Date(NOW - hoursAgo * 3600e3);
  return `fp_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${ext}`;
}

// A pair (dump + sidecar) per dump, like the off-site repo holds.
function pair(hoursAgo: number): [string, string] {
  return [dumpName(hoursAgo), dumpName(hoursAgo, '.dump.counts')];
}

describe('selectPrune (off-site retention)', () => {
  it('keeps recent dumps and thins old ones: 120 daily dumps with sidecars', () => {
    const names = Array.from({ length: 120 }, (_, day) => pair(day * 24)).flat();
    const pruned = new Set(selectPrune(names, NOW));
    const kept = names.filter((n) => !pruned.has(n));
    const keptDumps = kept.filter((n) => n.endsWith('.gpg'));
    // 31 daily (today..30 days back) plus one per ISO week from day 31 to 84, at most 8 more.
    assert.ok(keptDumps.length >= 31 && keptDumps.length <= 31 + 9, `kept ${keptDumps.length} dumps`);
    assert.ok(keptDumps.includes(dumpName(0)));
    assert.ok(keptDumps.includes(dumpName(30 * 24)));
    assert.ok(!keptDumps.includes(dumpName(119 * 24)));
    assert.ok(pruned.has(dumpName(100 * 24)));
  });

  it('prunes a sidecar with its dump and keeps it with its dump', () => {
    const names = Array.from({ length: 120 }, (_, day) => pair(day * 24)).flat();
    const pruned = new Set(selectPrune(names, NOW));
    for (let day = 0; day < 120; day++) {
      const [dump, counts] = pair(day * 24);
      assert.equal(pruned.has(dump), pruned.has(counts), `day ${day}: dump and sidecar must agree`);
    }
  });

  it('keeps every dump of the last 48 h and the newest per day before that (festival burst)', () => {
    const hourly = Array.from({ length: 24 * 5 }, (_, h) => dumpName(h)); // 5 days, hourly
    const pruned = new Set(selectPrune(hourly, NOW));
    for (let h = 0; h <= 48; h++) assert.ok(!pruned.has(dumpName(h)), `hour ${h} is inside 48 h`);
    const keptOlder = hourly.filter((n, h) => h > 48 && !pruned.has(n));
    // Hours 49..119 span days with one newest dump each: at most 4 days.
    assert.ok(keptOlder.length >= 1 && keptOlder.length <= 4, `kept ${keptOlder.length} older burst dumps`);
  });

  it('always keeps the newest dump, even when every dump is older than 12 weeks', () => {
    const names = [dumpName(200 * 24), dumpName(210 * 24), dumpName(220 * 24)];
    assert.deepEqual(selectPrune(names, NOW).sort(), [dumpName(210 * 24), dumpName(220 * 24)].sort());
  });

  it('never prunes files it does not recognize', () => {
    const names = ['README.md', '.gitkeep', 'fp_notadate.dump.gpg', ...pair(0)];
    assert.deepEqual(selectPrune(names, NOW), []);
  });
});
