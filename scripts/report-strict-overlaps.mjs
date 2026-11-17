// Report only. Lists festivals where the past-midnight overlap rule (06:00 day start, as in
// stageOverlapWarnings) finds a same-stage overlap that the blocking `stage_overlap` save
// check does not. Those festivals would fail to save if `stage_overlap` switched to the
// stricter rule. Reads a JSON file of festivals (an array, or { data: [...] }) and never
// touches a database. Run it against a staging export only:
//   node --import tsx/esm scripts/report-strict-overlaps.mjs festivals.json
import { readFileSync } from 'node:fs';
import { stageOverlapWarnings, validateFestivalIssues } from '../lib/helpers/validation.ts';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node --import tsx/esm scripts/report-strict-overlaps.mjs <festivals.json>');
  process.exit(2);
}

const parsed = JSON.parse(readFileSync(file, 'utf8'));
const festivals = Array.isArray(parsed) ? parsed : parsed.data;
if (!Array.isArray(festivals)) {
  console.error('Expected a JSON array of festivals, or an object with a data array.');
  process.exit(2);
}

const noCaps = { MAX_STAGES: Infinity, MAX_DAYS: Infinity, MAX_SETS_PER_DAY: Infinity };
let gained = 0;
for (const festival of festivals) {
  const blocking = validateFestivalIssues(noCaps, festival).filter((i) => i.code === 'stage_overlap').length;
  const strict = stageOverlapWarnings(festival);
  if (strict.length > 0 && blocking === 0) {
    gained += 1;
    console.log(`${festival.id ?? festival.name}: would gain ${strict.length} blocking overlap(s)`);
    for (const line of strict) console.log(`  ${line}`);
  }
}
console.log(`${gained} of ${festivals.length} festival(s) would gain a stage_overlap issue.`);
