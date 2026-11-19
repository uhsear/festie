import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  defaultUpdateExisting,
  groupPlanRows,
  importBlocked,
  parseNameList,
  updateOffBanner,
  withArtistChoice,
} from '@festie/shared/utils';

const src = readFileSync(join(__dirname, '..', 'app', 'admin', 'lineup-import.tsx'), 'utf8');

describe('lineup import screen imports', () => {
  it('imports only its own deps and @festie/shared', () => {
    expect(src).not.toMatch(/from 'socket\.io-client'|from 'papaparse'/);
  });
});

describe('lineup import logic the screen uses', () => {
  it('parses a list of names into announced rows', () => {
    expect(parseNameList('Alok\nKai b2b Mira')).toEqual([
      { row: 1, artist: 'Alok' },
      { row: 2, artist: 'Kai b2b Mira' },
    ]);
  });

  it('turns Update on for an export file and shows the banner otherwise', () => {
    expect(defaultUpdateExisting({ artist: 0, setId: 1 })).toBe(true);
    expect(updateOffBanner({ changed: 2 }, false)).toBe('2 rows change existing sets or announced acts. Turn on Update to apply them.');
  });

  it('keeps one id per B2B name and blocks a plan with errors', () => {
    expect(withArtistChoice([{ row: 4, artist: 'A b2b B' }], 4, 1, 'ar-b')[0]!.artistId).toBe('|ar-b');
    expect(importBlocked({ counts: { new: 0, changed: 0, unchanged: 0, error: 1, newStages: 0, newDays: 0, missingFromFile: 0, skipped: 0 }, problems: [] })).toBe(true);
  });

  it('groups a Needs choice row apart from other errors', () => {
    const row = {
      row: 1, status: 'error' as const, artists: ['Nina Kraviz'], changes: [], warnings: [],
      errors: [{ field: 'artist' as const, code: 'needs_choice' as const, message: 'Which?' }],
      resolutions: [{ name: 'Nina Kraviz', outcome: 'needs_choice' as const }],
    };
    const keys = Object.fromEntries(groupPlanRows({ rows: [row] }).map((g) => [g.key, g.rows.length]));
    expect(keys.needsChoice).toBe(1);
    expect(keys.errors).toBe(0);
  });
});
