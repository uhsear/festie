'use strict';
// Tiered off-site retention for backup-offsite-git.sh.
// Keep: every dump from the last 48 h, the newest per day for 30 days, the newest
// per ISO week for 12 weeks, and always the newest dump. A dump's `.counts`
// sidecar follows its dump. Names the pattern does not match are never pruned.
//
// CLI: ls dumps/ | node scripts/lib/backup-retention.cjs   (prints names to delete)

const NAME = /^(fp_(\d{8})_(\d{6})(?:_weekly)?\.dump)(?:\.gpg|\.counts)?$/;
const HOUR = 3600e3;
const DAY = 24 * HOUR;

function isoWeek(year, month, day) {
  const date = new Date(Date.UTC(year, month, day));
  const dow = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dow); // Thursday of this ISO week
  const week = Math.ceil(((date - Date.UTC(date.getUTCFullYear(), 0, 1)) / DAY + 1) / 7);
  return `${date.getUTCFullYear()}-W${week}`;
}

function parse(name) {
  const m = NAME.exec(name);
  if (!m) return null;
  const [, base, d, t] = m;
  const year = +d.slice(0, 4);
  const month = +d.slice(4, 6) - 1;
  const day = +d.slice(6, 8);
  return {
    base,
    dayKey: d,
    // Names carry the host's local time, so build local dates.
    ms: new Date(year, month, day, +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6)).getTime(),
    weekKey: isoWeek(year, month, day),
  };
}

// Returns the names to delete from `names`.
function selectPrune(names, now = Date.now()) {
  const dumps = new Map();
  for (const name of names) {
    const p = parse(name);
    if (p) dumps.set(p.base, p);
  }
  const newestFirst = [...dumps.values()].sort((a, b) => b.ms - a.ms || (a.base < b.base ? 1 : -1));
  const keep = new Set();
  if (newestFirst.length) keep.add(newestFirst[0].base);
  const days = new Set();
  const weeks = new Set();
  for (const p of newestFirst) {
    const age = now - p.ms;
    if (age <= 48 * HOUR) keep.add(p.base);
    if (age <= 30 * DAY && !days.has(p.dayKey)) {
      days.add(p.dayKey);
      keep.add(p.base);
    }
    if (age <= 84 * DAY && !weeks.has(p.weekKey)) {
      weeks.add(p.weekKey);
      keep.add(p.base);
    }
  }
  return names.filter((name) => {
    const p = parse(name);
    return p && !keep.has(p.base);
  });
}

module.exports = { selectPrune };

if (require.main === module) {
  const input = require('node:fs').readFileSync(0, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  for (const name of selectPrune(input)) console.log(name);
}
