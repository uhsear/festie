import { describe, it, expect } from 'vitest';
import {
  encodePlanSnapshot,
  decodePlanSnapshot,
  PLAN_SNAPSHOT_VERSION,
  MAX_ENCODED_LENGTH,
  MAX_PICKS,
  buildPlanSnapshotInput,
  type PlanSnapshotInput,
} from './planSnapshot';
import type { CrewMeetingPoint, Priority } from '../types';

const base: PlanSnapshotInput = {
  festivalId: 'fest-123',
  festivalName: 'North Coast 2026',
  picks: [
    { setId: 'set-a', priority: 'must' },
    { setId: 'set-b', priority: 'want' },
    { setId: 'set-c', priority: 'maybe' },
  ],
  meetingPoint: { label: 'Big tree by stage 2', lat: 41.881, lng: -87.623 },
};

describe('planSnapshot round-trip', () => {
  it('encodes then decodes back to the same data', () => {
    const encoded = encodePlanSnapshot(base);
    const result = decodePlanSnapshot(encoded);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.v).toBe(PLAN_SNAPSHOT_VERSION);
    expect(result.data.festivalId).toBe(base.festivalId);
    expect(result.data.festivalName).toBe(base.festivalName);
    expect(result.data.picks).toEqual(base.picks);
    expect(result.data.meetingPoint).toEqual(base.meetingPoint);
  });

  it('produces a URL/QR-safe string (base64url alphabet only)', () => {
    const encoded = encodePlanSnapshot(base);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('round-trips with no meeting point', () => {
    const { meetingPoint, ...rest } = base;
    void meetingPoint;
    const result = decodePlanSnapshot(encodePlanSnapshot(rest));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.meetingPoint).toBeUndefined();
  });

  it('round-trips unicode festival names', () => {
    const result = decodePlanSnapshot(encodePlanSnapshot({ ...base, festivalName: 'Tomorrowland — Café ☀️ 2026' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.festivalName).toBe('Tomorrowland — Café ☀️ 2026');
  });

  it('truncates picks beyond MAX_PICKS', () => {
    const many = Array.from({ length: MAX_PICKS + 20 }, (_, i) => ({
      setId: `set-${i}`,
      priority: 'must' as const,
    }));
    const result = decodePlanSnapshot(encodePlanSnapshot({ ...base, picks: many }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.picks).toHaveLength(MAX_PICKS);
  });
});

describe('planSnapshot version mismatch', () => {
  it('rejects an envelope with an unknown version', () => {
    // Hand-build an envelope with v=99 using the same base64url scheme.
    const payload = JSON.stringify({ ...base, v: 99 });
    const b64url = Buffer.from(payload, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const result = decodePlanSnapshot(b64url);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/version/i);
  });
});

describe('planSnapshot oversized rejection', () => {
  it('rejects input longer than MAX_ENCODED_LENGTH before decoding', () => {
    const huge = 'A'.repeat(MAX_ENCODED_LENGTH + 1);
    const result = decodePlanSnapshot(huge);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/size/i);
  });

  it('rejects a payload whose decoded picks exceed MAX_PICKS', () => {
    // Bypass the encoder's truncation by hand-crafting an over-long pick list.
    const picks = Array.from({ length: MAX_PICKS + 1 }, (_, i) => ({
      setId: `s${i}`,
      priority: 'must',
    }));
    const payload = JSON.stringify({ v: PLAN_SNAPSHOT_VERSION, ...base, picks });
    const b64url = Buffer.from(payload, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    // Only assert if the crafted string is within the size cap (it is — small ids).
    expect(b64url.length).toBeLessThanOrEqual(MAX_ENCODED_LENGTH);
    const result = decodePlanSnapshot(b64url);
    expect(result.ok).toBe(false);
  });
});

describe('planSnapshot malformed input', () => {
  it('rejects empty string', () => {
    const r = decodePlanSnapshot('');
    expect(r.ok).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(decodePlanSnapshot(null).ok).toBe(false);
    expect(decodePlanSnapshot(undefined).ok).toBe(false);
    expect(decodePlanSnapshot(42).ok).toBe(false);
    expect(decodePlanSnapshot({}).ok).toBe(false);
  });

  it('rejects non-base64url characters', () => {
    const r = decodePlanSnapshot('!!!not base64!!!');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/base64url/i);
  });

  it('rejects valid base64url that is not JSON', () => {
    const notJson = Buffer.from('this is not json', 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const r = decodePlanSnapshot(notJson);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/json/i);
  });

  it('rejects JSON with wrong field types', () => {
    const bad = Buffer.from(
      JSON.stringify({ v: PLAN_SNAPSHOT_VERSION, festivalId: 5, festivalName: 'x', picks: [] }),
      'utf8',
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const r = decodePlanSnapshot(bad);
    expect(r.ok).toBe(false);
  });

  it('rejects an out-of-range meeting-point coordinate', () => {
    const bad = Buffer.from(
      JSON.stringify({
        v: PLAN_SNAPSHOT_VERSION,
        festivalId: 'f',
        festivalName: 'x',
        picks: [],
        meetingPoint: { label: 'X', lat: 999, lng: 0 },
      }),
      'utf8',
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const r = decodePlanSnapshot(bad);
    expect(r.ok).toBe(false);
  });

  it('rejects extra/unknown keys via strict schema', () => {
    const bad = Buffer.from(
      JSON.stringify({
        v: PLAN_SNAPSHOT_VERSION,
        festivalId: 'f',
        festivalName: 'x',
        picks: [],
        evil: 'injected',
      }),
      'utf8',
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const r = decodePlanSnapshot(bad);
    expect(r.ok).toBe(false);
  });
});

describe('buildPlanSnapshotInput', () => {
  const festival = { id: 'f1', name: 'Fest' };
  const mp = (id: string, over: Partial<CrewMeetingPoint> = {}) =>
    ({ id, label: id, active: true, latitude: 1, longitude: 2, meet_at: null, ...over }) as CrewMeetingPoint;

  it('ranks must first', () => {
    const r = buildPlanSnapshotInput({
      festival,
      picks: { a: 'maybe', b: 'must', c: 'want-to-see' },
      meetingPoints: [],
      nowMs: 0,
    });
    expect(r.input.picks.map((p) => p.setId)).toEqual(['b', 'c', 'a']);
    expect(r.input.picks[1]!.priority).toBe('want');
    expect(r.picksCount).toBe(3);
  });

  it('caps at MAX_PICKS keeping the best', () => {
    const picks: Record<string, Priority> = {};
    for (let i = 0; i < 60; i++) picks[`m${i}`] = 'maybe';
    picks['top'] = 'must';
    const r = buildPlanSnapshotInput({ festival, picks, meetingPoints: [], nowMs: 0 });
    expect(r.input.picks).toHaveLength(MAX_PICKS);
    expect(r.input.picks[0]!.setId).toBe('top');
  });

  it('picks the soonest future meeting point', () => {
    const now = Date.parse('2026-06-01T12:00:00Z');
    const r = buildPlanSnapshotInput({
      festival,
      picks: {},
      meetingPoints: [
        mp('past', { meet_at: '2026-06-01T10:00:00Z' }),
        mp('later', { meet_at: '2026-06-01T20:00:00Z' }),
        mp('soon', { meet_at: '2026-06-01T14:00:00Z' }),
      ],
      nowMs: now,
    });
    expect(r.meetingPoint?.id).toBe('soon');
    expect(r.input.meetingPoint).toEqual({ label: 'soon', lat: 1, lng: 2 });
  });

  it('falls back to any active point with coords, else none', () => {
    const r = buildPlanSnapshotInput({
      festival,
      picks: {},
      meetingPoints: [mp('off', { active: false }), mp('nocoord', { latitude: null }), mp('any')],
      nowMs: 0,
    });
    expect(r.meetingPoint?.id).toBe('any');
    const none = buildPlanSnapshotInput({ festival, picks: undefined, meetingPoints: undefined, nowMs: 0 });
    expect(none.meetingPoint).toBeNull();
    expect(none.input.meetingPoint).toBeUndefined();
  });
});
