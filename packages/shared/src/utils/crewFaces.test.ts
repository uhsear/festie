import { describe, it, expect } from 'vitest';
import type { CrewWhereabout } from './dayOf';
import { selectCrewFaces } from './crewFaces';

const NOW = 1_800_000_000_000;
const row = (over: Partial<CrewWhereabout>): CrewWhereabout => ({
  userId: 'u',
  name: 'Sam',
  statusLabel: null,
  statusAt: null,
  live: null,
  liveAt: null,
  battery: null,
  lostAt: null,
  sos: false,
  ...over,
});
// About 111 m per 0.001 degree of latitude.
const stages = [
  { id: 'main', latitude: 28.0, longitude: -81.0 },
  { id: 'far', latitude: 28.1, longitude: -81.0 },
  { id: 'nocoord', latitude: null as unknown as number, longitude: null as unknown as number },
];
const noViewer = { coord: null, at: null };

describe('selectCrewFaces', () => {
  it('tags a live member with the stage they stand at and the walk time from a recent fix', () => {
    const faces = selectCrewFaces({
      whereabouts: [row({ userId: 'a', live: 'live', liveAt: NOW })],
      peers: { a: { lat: 28.0005, lng: -81.0 } },
      stages,
      viewer: { coord: { latitude: 28.0045, longitude: -81.0 }, at: NOW - 60_000 },
      nowMs: NOW,
    });
    expect(faces[0]).toMatchObject({ stageId: 'main', caption: '6 min walk' });
  });

  it('falls back to Live now when the viewer fix is old or missing', () => {
    const base = {
      whereabouts: [row({ live: 'live' as const, userId: 'a' })],
      peers: { a: { lat: 28, lng: -81 } },
      stages,
      nowMs: NOW,
    };
    expect(selectCrewFaces({ ...base, viewer: noViewer })[0]!.caption).toBe('Live now');
    const old = { coord: { latitude: 28.01, longitude: -81 }, at: NOW - 10 * 60_000 };
    expect(selectCrewFaces({ ...base, viewer: old })[0]!.caption).toBe('Live now');
  });

  it('shows how long ago a stale or lost member was seen, and no stage away from every stage', () => {
    const faces = selectCrewFaces({
      whereabouts: [
        row({ userId: 'a', live: 'stale', liveAt: NOW - 12 * 60_000 }),
        row({ userId: 'b', lostAt: NOW - 30_000 }),
      ],
      peers: { a: { lat: 28.05, lng: -81.0 } },
      stages,
      viewer: noViewer,
      nowMs: NOW,
    });
    expect(faces.map((f) => f.caption)).toEqual(['Seen 12 min ago', 'Seen 1 min ago']);
    expect(faces.map((f) => f.stageId)).toEqual([null, null]);
  });

  it('uses the status line, then a plain fallback, and flags SOS', () => {
    const faces = selectCrewFaces({
      whereabouts: [
        row({ userId: 'a', sos: true, live: 'live' }),
        row({ userId: 'b', statusLabel: 'On my way · ~5 min' }),
        row({ userId: 'c' }),
      ],
      peers: {},
      stages,
      viewer: noViewer,
      nowMs: NOW,
    });
    expect(faces.map((f) => f.caption)).toEqual(['SOS', 'On my way · ~5 min', 'No signal yet']);
    expect(faces[0]!.sos).toBe(true);
  });
});
