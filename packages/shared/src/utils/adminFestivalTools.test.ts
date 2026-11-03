import { describe, it, expect } from 'vitest';
import {
  setLinkRows,
  linkCoverage,
  linkCoverageText,
  backfillSummary,
  setEngagementLabel,
  parseLatLng,
} from './adminFestivalTools';

const festival = {
  stages: [{ id: 's1', name: 'Main' }],
  days: [
    {
      id: 'd1',
      label: 'Friday',
      sets: [
        {
          id: 'a',
          artist: 'A b2b B',
          stageId: 's1',
          artists: [
            { name: 'A', links: { spotify: 'https://open.spotify.com/artist/1' } },
            { name: ' ', links: {} },
            { name: 'C' },
          ],
        },
        { id: 'b', artist: 'Solo', stageId: 'gone', linkUrl: 'https://open.spotify.com/artist/2' },
      ],
    },
    { id: 'd2', date: '2026-05-02', sets: [{ id: 'c', artist: 'Z' }] },
    { id: 'd3', sets: [{ id: 'd', artist: 'Y' }] },
  ],
};

describe('setLinkRows', () => {
  const rows = setLinkRows(festival);
  it('uses artists, skips blanks but keeps the original index', () => {
    expect(rows[0]).toEqual({
      setId: 'a',
      dayLabel: 'Friday',
      stageName: 'Main',
      artists: [
        { index: 0, name: 'A', spotifyUrl: 'https://open.spotify.com/artist/1' },
        { index: 2, name: 'C', spotifyUrl: null },
      ],
    });
  });
  it('falls back to artist and linkUrl, and to empty stage name', () => {
    expect(rows[1]).toMatchObject({
      stageName: '',
      artists: [{ index: 0, name: 'Solo', spotifyUrl: 'https://open.spotify.com/artist/2' }],
    });
  });
  it('labels days by label, date, then Day n', () => {
    expect(rows.map((r) => r.dayLabel)).toEqual(['Friday', 'Friday', '2026-05-02', 'Day 3']);
  });
  it('counts artists for coverage', () => {
    const c = linkCoverage(rows);
    expect(c).toEqual({ linked: 2, total: 5 });
    expect(linkCoverageText(c)).toBe('2 of 5 artists have a Spotify link.');
    expect(linkCoverageText({ linked: 0, total: 0 })).toBe('No artists yet.');
  });
});

describe('backfillSummary', () => {
  const base = { updated: 41, skipped: 0, total: 52 };
  it('handles each case', () => {
    expect(backfillSummary({ ...base, total: 0, unmatched: [] })).toBe('Every set already has a link.');
    expect(backfillSummary({ ...base, unmatched: [] })).toBe('Linked 41 of 52 sets.');
    expect(backfillSummary({ ...base, unmatched: ['X'] })).toBe('Linked 41 of 52 sets. No match for 1 artist:');
    expect(backfillSummary({ ...base, unmatched: Array(11).fill('X') })).toBe(
      'Linked 41 of 52 sets. No match for 11 artists:',
    );
  });
});

describe('setEngagementLabel', () => {
  it('formats counts', () => {
    expect(setEngagementLabel(undefined)).toBe('');
    expect(setEngagementLabel({ picks: 0, reminders: 0 })).toBe('No picks or reminders yet');
    expect(setEngagementLabel({ picks: 3, reminders: 1 })).toBe('Picked by 3 · 1 reminder');
    expect(setEngagementLabel({ picks: 214, reminders: 61 })).toBe('Picked by 214 · 61 reminders');
  });
});

describe('parseLatLng', () => {
  it('parses valid and rejects invalid text', () => {
    expect(parseLatLng('28.53834, -81.37923')).toEqual({ latitude: 28.53834, longitude: -81.37923 });
    expect(parseLatLng('28.5 -81.3')).toEqual({ latitude: 28.5, longitude: -81.3 });
    expect(parseLatLng('+28.5,-81.3')).toEqual({ latitude: 28.5, longitude: -81.3 });
    expect(parseLatLng('91, 0')).toBeNull();
    expect(parseLatLng('abc')).toBeNull();
    expect(parseLatLng('')).toBeNull();
  });
});
