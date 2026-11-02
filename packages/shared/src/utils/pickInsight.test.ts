import { describe, it, expect } from 'vitest';
import { pickClashRows, picksPerSetCsv, picksCsvFileName } from './pickInsight';
import { pickInsightFixture as fixture, pickInsightSet as set } from './pickInsight.fixture';

describe('pickClashRows', () => {
  it('builds copy, scales bars and skips unknown set ids', () => {
    const rows = pickClashRows(fixture);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      key: 'a|b',
      people: 8,
      peopleText: '8 people picked both',
      barPct: 100,
      title: 'Alpha and =Beta',
      detail: 'Friday · Main 11:00 PM–1:00 AM · 12:30 AM–2:00 AM',
      a11y: '8 people picked both Alpha and =Beta, Friday',
    });
    expect(rows[1].barPct).toBe(63);
  });
});

describe('picksPerSetCsv', () => {
  const lines = picksPerSetCsv(fixture).split('\r\n');
  it('has the exact header and one row per set', () => {
    expect(lines[0]).toBe('Day,Date,Stage,Start,End,Artist,Picks,Must,Want,Maybe,Set ID');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe('Friday,2026-11-06,Main,23:00,01:00,Alpha,8,3,3,2,a');
  });
  it('guards formula cells and leaves null times empty', () => {
    expect(lines[2]).toBe("Friday,2026-11-06,,00:30,02:00,'=Beta,8,3,3,2,b");
    expect(lines[3]).toBe('Friday,2026-11-06,Main,,,Tba,0,0,0,0,tba');
    const guarded = picksPerSetCsv({ ...fixture, sets: [set({ artist: '-Artist' }), set({ artist: '=SUM(A1)' })] });
    expect(guarded).toContain("'-Artist");
    expect(guarded).toContain("'=SUM(A1)");
  });
  it('has no user fields', () => {
    expect(lines[0].toLowerCase()).not.toMatch(/user/);
  });
});

describe('picksCsvFileName', () => {
  it('uses the date', () => {
    expect(picksCsvFileName('f1', new Date('2026-11-02T12:00:00Z'))).toBe('festie-picks-f1-2026-11-02.csv');
  });
});
