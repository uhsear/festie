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
    expect(mappingProblems({})).toEqual([
      'Choose the column that holds the artist.',
      'Choose a Day or a Date column.',
    ]);
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
