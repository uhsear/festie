import { describe, it, expect } from 'vitest';
import {
  backfillSummary,
  setEngagementLabel,
  parseLatLng,
} from './adminFestivalTools';

describe('backfillSummary', () => {
  const base = { updated: 41, skipped: 0, total: 52 };
  it('handles each case', () => {
    expect(backfillSummary({ ...base, total: 0, unmatched: [] })).toBe('Every set already has a link.');
    expect(backfillSummary({ ...base, unmatched: [] })).toBe('Linked 41 of 52 sets.');
    expect(backfillSummary({ ...base, unmatched: ['X'] })).toBe('Linked 41 of 52 sets. No match for 1 artist:');
    expect(backfillSummary({ ...base, unmatched: Array(11).fill('X') })).toBe(
      'Linked 41 of 52 sets. No match for 11 artists:',
    );
    expect(backfillSummary({ ...base, unmatched: [], skippedShared: ['A', 'B'] })).toBe(
      'Linked 41 of 52 sets. 2 artists are on other festivals. Add their links on the Artists tab.',
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
