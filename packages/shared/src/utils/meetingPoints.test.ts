import { describe, it, expect } from 'vitest';
import { meetingPointDirectionsUrl, splitMeetingPoints } from './meetingPoints';

describe('meetingPointDirectionsUrl', () => {
  it('uses coordinates when present', () => {
    expect(meetingPointDirectionsUrl({ latitude: 28.1, longitude: -81.2, location: 'Big tree' })).toBe(
      'https://maps.google.com/?q=28.1%2C-81.2',
    );
  });
  it('falls back to the encoded text location', () => {
    expect(meetingPointDirectionsUrl({ latitude: null, longitude: null, location: 'Gate A & B' })).toBe(
      'https://maps.google.com/?q=Gate%20A%20%26%20B',
    );
  });
});

describe('splitMeetingPoints', () => {
  const NOW = Date.parse('2026-09-04T21:00:00Z');
  const pt = (id: string, meet_at: string | null, expires_at: string | null) => ({ id, meet_at, expires_at });

  it('moves expired points to past, dedupes, sorts newest first, keeps recurring in current', () => {
    const { current, past } = splitMeetingPoints(
      [
        pt('live', '2026-09-04T22:00:00Z', '2026-09-04T22:30:00Z'),
        pt('daily', '2026-09-04T15:00:00Z', null),
        pt('old', '2026-09-04T19:00:00Z', '2026-09-04T19:30:00Z'),
      ],
      [pt('old', '2026-09-04T19:00:00Z', '2026-09-04T19:30:00Z'), pt('older', '2026-09-04T17:00:00Z', '2026-09-04T17:30:00Z'), pt('nodate', null, '2026-09-04T16:00:00Z')],
      NOW,
    );
    expect(current.map((p) => p.id)).toEqual(['live', 'daily']);
    expect(past.map((p) => p.id)).toEqual(['old', 'older', 'nodate']);
  });
});
