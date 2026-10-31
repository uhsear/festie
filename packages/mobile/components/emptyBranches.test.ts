import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source-level guards: mobile tests run in plain node with no RN render harness.
const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');

describe('CrewStatus empty roster (C3)', () => {
  it('shows an avatar row and the member count when nobody has a status', () => {
    const src = read('CrewStatus.tsx');
    expect(src).toContain('No one has shared a status yet · ');
    expect(src).toMatch(/members\.slice\(0, 6\)\.map\(\(m\) => \(\s*<Avatar/);
  });
});

describe('NowSurface untimed start', () => {
  it('uses the weekday, not an invented clock time, when startsAtTimed is false', () => {
    const src = read('NowSurface.tsx');
    expect(src).toMatch(/startsAtTimed\s*\?\s*`Starts \$\{fmtZonedDayClock/);
    expect(src).toContain('`Starts ${fmtZonedWeekday(startsAt, timeZone)}`');
  });
});

describe('CrewPolls festival scoping (C12)', () => {
  it('derives the lineup and festivalId from festivalForCrew, not currentFestival directly', () => {
    const src = read('CrewPolls.tsx');
    expect(src).toContain('festivalForCrew(activeCrew, currentFestival)');
    expect(src).toContain('const festivalId = crewFestival?.id ?? null;');
  });
});
