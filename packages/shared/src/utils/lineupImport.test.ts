import { describe, it, expect } from 'vitest';
import {
  parseLineupTable,
  looksLikeHeader,
  autoMapColumns,
  mappingProblems,
  toImportRows,
  planSummary,
  buildResultCsv,
  buildLineupCsv,
  defaultMapping,
  LINEUP_SAMPLE_CSV,
  LEGACY_COLUMN_ORDER,
  defaultUpdateExisting,
  groupPlanRows,
  importBlocked,
  parseNameList,
  updateBanner,
  withArtistChoice,
  type LineupImportPlanRow,
} from './lineupImport';

describe('parseLineupTable', () => {
  it('parses a Google Sheets paste (tabs)', () => {
    const r = parseLineupTable('Artist\tStage\nKai\tMain\n');
    expect(r.delimiter).toBe('\t');
    expect(r.rows).toEqual([['Artist', 'Stage'], ['Kai', 'Main']]);
  });

  it('keeps a quoted comma and a quoted line break', () => {
    const r = parseLineupTable('artist,stage\n"Smith, J","Main\nStage"\n');
    expect(r.rows[1]).toEqual(['Smith, J', 'Main\nStage']);
  });

  it('parses a semicolon file', () => {
    const r = parseLineupTable('artist;stage;day\nKai;Main;Fri\n');
    expect(r.delimiter).toBe(';');
    expect(r.rows[1]).toEqual(['Kai', 'Main', 'Fri']);
  });

  it('strips a BOM', () => {
    expect(parseLineupTable('﻿artist,day\nKai,Fri').rows[0][0]).toBe('artist');
  });
});

describe('parseLineupTable line numbers', () => {
  it('counts skipped blank lines and quoted line breaks', () => {
    const r = parseLineupTable('artist,day\n\nKai,Fri\n"Mira\nX",Sat\n\nNight Owl,Sun\n');
    expect(r.delimiter).toBe(',');
    expect(r.rows.map((x) => x[0])).toEqual(['artist', 'Kai', 'Mira\nX', 'Night Owl']);
    expect(r.lines).toEqual([1, 3, 4, 7]);
    expect(toImportRows(r.rows, { artist: 0, day: 1 }, true, r.lines).map((x) => x.row)).toEqual([3, 4, 7]);
  });
});

describe('column mapping', () => {
  it('maps ARTIST, Start Time and Stage Name', () => {
    const m = autoMapColumns(['ARTIST', 'Start Time', 'Stage Name', 'Day']);
    expect(m).toMatchObject({ artist: 0, startTime: 1, stage: 2, day: 3 });
  });

  it('uses no column twice', () => {
    const m = autoMapColumns(['time', 'start']);
    expect(m.startTime).toBe(0);
    expect(m.endTime).toBeUndefined();
  });

  it('detects headers and reports problems', () => {
    expect(looksLikeHeader(['Kai', 'Main'])).toBe(false);
    expect(looksLikeHeader(['Act', 'x'])).toBe(true);
    expect(mappingProblems({})).toEqual(['Choose the column that holds the artist.']);
    expect(mappingProblems({ artist: 0, date: 1 })).toEqual([]);
  });
});

describe('LINEUP_SAMPLE_CSV', () => {
  it('parses to 3 rows with no mapping problems', () => {
    const { rows } = parseLineupTable(LINEUP_SAMPLE_CSV);
    const mapping = autoMapColumns(rows[0]);
    expect(mappingProblems(mapping)).toEqual([]);
    const out = toImportRows(rows, mapping, looksLikeHeader(rows[0]));
    expect(out).toHaveLength(3);
    expect(out[1]).toEqual({
      row: 3,
      artist: 'Kai b2b Mira',
      stage: 'Forest',
      day: 'Friday',
      date: '2026-08-21',
      startTime: '23:30',
      endTime: '01:30',
    });
  });
});

describe('toImportRows', () => {
  it('leaves out unmapped fields and sends "" for blank mapped cells', () => {
    const out = toImportRows([['Kai', '', 'x'], ['', '', ''], ['Mira', 'Main']], { artist: 0, stage: 1 }, false);
    expect(out).toEqual([
      { row: 1, artist: 'Kai', stage: '' },
      { row: 3, artist: 'Mira', stage: 'Main' },
    ]);
    expect(out[0]).not.toHaveProperty('day');
  });

  it('works headerless with the legacy order', () => {
    const out = toImportRows([['Kai', 'Main', 'Fri', '20:00', '21:00']], LEGACY_COLUMN_ORDER, false);
    expect(out[0]).toMatchObject({ artist: 'Kai', stage: 'Main', day: 'Fri', startTime: '20:00', endTime: '21:00' });
  });
});

describe('defaultMapping', () => {
  it('maps a headerless table only to columns that exist', () => {
    expect(defaultMapping([['Kai', 'Main', 'Fri'], ['Mira', 'Forest']], false)).toEqual({ artist: 0, stage: 1, day: 2 });
  });

  it('auto-maps a header row, including set_id', () => {
    expect(defaultMapping([['set_id', 'artist', 'day']], true)).toEqual({ setId: 0, artist: 1, day: 2 });
  });
});

describe('buildLineupCsv', () => {
  it('writes one row per set that parses and maps back to the same values', () => {
    const csv = buildLineupCsv({
      b2bSeparator: 'vs',
      stages: [{ id: 'st1', name: 'Main, North' }],
      days: [
        {
          label: 'Friday',
          date: '2026-08-21',
          sets: [
            { id: 's1', artist: 'Kai vs Mira', artists: [{ name: 'Kai' }, { name: 'Mira' }], stageId: 'st1', startTime: '23:30', endTime: '01:30' },
            { id: 's2', artist: 'Solo', stageId: '', startTime: null, endTime: null },
          ],
        },
        { label: '', date: '2026-08-22', sets: [{ id: 's3', artist: 'Dawn', stageId: 'st1', startTime: 'TBA', endTime: null }] },
      ],
    });
    const parsed = parseLineupTable(csv);
    const rows = toImportRows(parsed.rows, defaultMapping(parsed.rows, true), true, parsed.lines);
    expect(rows).toEqual([
      { row: 2, setId: 's1', day: 'Friday', stage: 'Main, North', artist: 'Kai vs Mira', startTime: '23:30', endTime: '01:30' },
      { row: 3, setId: 's2', day: 'Friday', stage: '', artist: 'Solo', startTime: '', endTime: '' },
      { row: 4, setId: 's3', day: '2026-08-22', stage: 'Main, North', artist: 'Dawn', startTime: '', endTime: '' },
    ]);
  });
});

describe('planSummary', () => {
  const c = { new: 0, changed: 0, unchanged: 0, error: 0, newStages: 0, newDays: 0 };
  it('says nothing to change when all zero', () => {
    expect(planSummary(c, false)).toBe('Nothing to change.');
  });
  it('covers every part with update off', () => {
    expect(planSummary({ new: 1, changed: 1, unchanged: 1, error: 1, newStages: 1, newDays: 2 }, false)).toBe(
      'Add 1 set. Leave 2 matching sets as they are. Create 1 stage. Create 2 days. 1 row has errors.',
    );
  });
  it('covers update on', () => {
    expect(planSummary({ ...c, new: 3, changed: 2, error: 2 }, true)).toBe(
      'Add 3 sets. Update 2. 2 rows have errors.',
    );
  });
});

describe('buildResultCsv', () => {
  it('writes the header and quotes commas', () => {
    const csv = buildResultCsv({
      importId: 'i',
      created: 1,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      newStages: 0,
      newDays: 0,
      spotifyMatched: 0,
      warnings: [],
      rows: [{ row: 2, status: 'created', setId: 's1', artist: 'Smith, J', message: 'ok' }],
    });
    expect(csv.split(/\r?\n/)).toEqual(['row,status,set_id,artist,message', '2,created,s1,"Smith, J",ok']);
  });
});

describe('P6 columns', () => {
  it('maps a link column per platform, the display name and the artist id from a header', () => {
    const m = autoMapColumns(['Artist', 'Spotify', 'SoundCloud', 'Instagram', 'X', 'TikTok', 'Facebook', 'Website', 'Display name', 'Artist ID', 'Link']);
    expect(m).toEqual({
      artist: 0, spotify: 1, soundcloud: 2, instagram: 3, twitter: 4, tiktok: 5, facebook: 6, website: 7, displayName: 8, artistId: 9, link: 10,
    });
  });

  it('keeps the old single link header mapped to the link field', () => {
    expect(autoMapColumns(['artist', 'url'])).toEqual({ artist: 0, link: 1 });
  });

  it('sends platform links, display name and artist id as typed', () => {
    const out = toImportRows([['Kai', 'https://soundcloud.com/kai', 'Kai Live', 'ar-1']], { artist: 0, soundcloud: 1, displayName: 2, artistId: 3 }, false);
    expect(out).toEqual([{ row: 1, artist: 'Kai', soundcloud: 'https://soundcloud.com/kai', displayName: 'Kai Live', artistId: 'ar-1' }]);
  });
});

describe('mappingProblems with no day column', () => {
  it('accepts names only, announced rows', () => {
    expect(mappingProblems({ artist: 0 })).toEqual([]);
    expect(mappingProblems({ artist: 0, instagram: 1 })).toEqual([]);
  });

  it('asks for a day when a stage or a time is mapped, unless a set id names the set', () => {
    const message = 'Choose a Day or a Date column, or leave Stage and the times unmapped to add announced names.';
    expect(mappingProblems({ artist: 0, stage: 1 })).toEqual([message]);
    expect(mappingProblems({ artist: 0, startTime: 1 })).toEqual([message]);
    expect(mappingProblems({ artist: 0, startTime: 1, setId: 2 })).toEqual([]);
    expect(mappingProblems({ artist: 0, startTime: 1, day: 2 })).toEqual([]);
  });
});

describe('parseNameList', () => {
  it('makes one row per line, with the line as the row number, and skips blanks and headings', () => {
    expect(parseNameList('Alok\n\n# Friday\r\n- Kai b2b Mira\n2. Sub Focus  \n')).toEqual([
      { row: 1, artist: 'Alok' },
      { row: 4, artist: 'Kai b2b Mira' },
      { row: 5, artist: 'Sub Focus' },
    ]);
  });

  it('keeps a comma inside a name', () => {
    expect(parseNameList('Above & Beyond, live')).toEqual([{ row: 1, artist: 'Above & Beyond, live' }]);
  });

  it('turns a 118-act list into 118 rows that need no mapping', () => {
    const text = Array.from({ length: 118 }, (_, i) => `Act ${i}`).join('\n');
    const rows = parseNameList(text);
    expect(rows).toHaveLength(118);
    expect(rows.every((r) => Object.keys(r).join() === 'row,artist')).toBe(true);
  });
});

describe('update default and banner', () => {
  it('turns Update on when a set id column is mapped', () => {
    expect(defaultUpdateExisting({ artist: 0, setId: 1 })).toBe(true);
    expect(defaultUpdateExisting({ artist: 0 })).toBe(false);
  });

  it('shows a banner only when Update is off and rows would change', () => {
    expect(updateBanner({ changed: 3 }, false)).toBe('3 rows change existing sets or announced acts. Turn on Update to apply them.');
    expect(updateBanner({ changed: 1 }, false)).toBe('1 row changes existing sets or announced acts. Turn on Update to apply them.');
    expect(updateBanner({ changed: 3 }, true)).toBeNull();
    expect(updateBanner({ changed: 0 }, false)).toBeNull();
  });
});

describe('withArtistChoice', () => {
  const rows = [{ row: 2, artist: 'Nina Kraviz vs Kai' }, { row: 3, artist: 'Alok' }];
  it('sets the id of one name and keeps the other positions', () => {
    const first = withArtistChoice(rows, 2, 1, 'ar-kai');
    expect(first[0]!.artistId).toBe('|ar-kai');
    expect(withArtistChoice(first, 2, 0, 'ar-ru')[0]!.artistId).toBe('ar-ru|ar-kai');
    expect(first[1]).toBe(rows[1]);
  });
});

describe('groupPlanRows', () => {
  const base = { artists: ['A'], changes: [], errors: [], warnings: [] };
  const r = (row: number, extra: Partial<LineupImportPlanRow>): LineupImportPlanRow => ({ row, status: 'new', ...base, ...extra });
  const rows: LineupImportPlanRow[] = [
    r(1, { resolutions: [{ name: 'A', outcome: 'new' }] }),
    r(2, { resolutions: [{ name: 'A', outcome: 'existing', artistId: 'ar-1' }] }),
    r(3, { status: 'error', errors: [{ field: 'artist', code: 'needs_choice', message: 'Which?' }], resolutions: [{ name: 'A', outcome: 'needs_choice' }] }),
    r(4, { status: 'changed', changes: ['Start 1 → 2'] }),
    r(5, { status: 'unchanged', skipped: 'Skipped: the file says Sat.', warnings: ['Skipped: the file says Sat.'] }),
    r(6, { status: 'unchanged' }),
    r(7, { status: 'error', errors: [{ field: 'day', message: 'Unknown day' }] }),
    r(8, { warnings: ['Starts after midnight'], resolutions: [{ name: 'A', outcome: 'did_you_mean', suggestion: 'B' }] }),
    r(9, { status: 'error', errors: [{ field: 'artist', code: 'needs_choice', message: 'Which?' }, { field: 'day', message: 'Unknown day' }], resolutions: [{ name: 'A', outcome: 'needs_choice' }] }),
  ];
  const byKey = Object.fromEntries(groupPlanRows({ rows }).map((g) => [g.key, g.rows.map((x) => x.row)]));

  it('puts each row in one outcome group', () => {
    expect(byKey).toEqual({
      newArtists: [1, 8],
      existingArtists: [2],
      needsChoice: [3],
      changedSets: [4],
      skipped: [5],
      unchanged: [6],
      warnings: [8],
      errors: [7, 9],
    });
  });

  it('lists the groups in review order, empty ones included', () => {
    expect(groupPlanRows({ rows: [] }).map((g) => g.label)).toEqual([
      'New artists', 'Existing artists', 'Needs choice', 'Changed sets', 'Skipped', 'Unchanged', 'Warnings', 'Errors',
    ]);
  });

  it('blocks the commit on errors and problems', () => {
    const counts = { new: 0, changed: 0, unchanged: 0, error: 0, newStages: 0, newDays: 0, missingFromFile: 0 };
    expect(importBlocked({ counts, problems: [] })).toBe(false);
    expect(importBlocked({ counts: { ...counts, error: 1 }, problems: [] })).toBe(true);
    expect(importBlocked({ counts, problems: ['x'] })).toBe(true);
  });
});

describe('planSummary with announced names', () => {
  it('counts announced names apart from sets', () => {
    const c = { new: 5, changed: 0, unchanged: 0, error: 0, newStages: 0, newDays: 0, announced: 3 };
    expect(planSummary(c, false)).toBe('Add 2 sets. Add 3 announced names.');
    expect(planSummary({ ...c, new: 3 }, false)).toBe('Add 3 announced names.');
  });
});
