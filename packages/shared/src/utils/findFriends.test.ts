import { describe, it, expect } from 'vitest';
import { compassTargets, nearStageName, NEAR_STAGE_MAX_M } from './findFriends';
import type { CrewMeetingPoint, PeerLocation } from '../types/domain';

const NOW = Date.parse('2026-07-04T22:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
/** Metres north of a point, as a latitude offset on the shared haversine sphere. */
const north = (m: number) => (m / 6_371_000) * (180 / Math.PI);

function mp(id: string, over: Partial<CrewMeetingPoint> = {}): CrewMeetingPoint {
  return {
    id,
    crew_id: 'c1',
    created_by: 'u1',
    label: `Point ${id}`,
    location: '',
    type: 'custom',
    meet_at: null,
    stage_reference: null,
    latitude: 28.5,
    longitude: -81.4,
    active: true,
    ...over,
  } as CrewMeetingPoint;
}

function peer(userId: string, username: string, over: Partial<PeerLocation> = {}): PeerLocation {
  return { crewId: 'c1', userId, username, lat: 28.6, lng: -81.3, serverAt: ago(5_000), ...over } as PeerLocation;
}

describe('compassTargets', () => {
  it('lists meeting points in compass order, then live peers by name', () => {
    const targets = compassTargets({
      meetingPoints: [
        mp('untimed'),
        mp('late', { meet_at: '2026-07-04T23:00:00.000Z' }),
        mp('soon', { meet_at: '2026-07-04T22:30:00.000Z' }),
      ],
      peers: { u3: peer('u3', 'Zoe'), u2: peer('u2', 'ana') },
      nowMs: NOW,
    });
    expect(targets.map((t) => t.key)).toEqual(['mp:soon', 'mp:late', 'mp:untimed', 'peer:u2', 'peer:u3']);
    expect(targets[3]).toEqual({ key: 'peer:u2', kind: 'peer', id: 'u2', label: 'ana', latitude: 28.6, longitude: -81.3 });
    expect(targets[0]!.kind).toBe('meeting-point');
  });

  it('keeps a peer seen 60 s ago and drops one seen 121 s ago', () => {
    const targets = compassTargets({
      meetingPoints: [],
      peers: { a: peer('a', 'Still', { serverAt: ago(60_000) }), b: peer('b', 'Gone', { serverAt: ago(121_000) }) },
      nowMs: NOW,
    });
    expect(targets.map((t) => t.id)).toEqual(['a']);
  });

  it('leaves out self, inactive points, points without coords and peers without finite coords', () => {
    const targets = compassTargets({
      meetingPoints: [mp('off', { active: false }), mp('nocoord', { latitude: null, longitude: null }), mp('nan', { latitude: NaN })],
      peers: { me: peer('me', 'Me'), bad: peer('bad', 'Bad', { lat: NaN }), ok: peer('ok', '') },
      selfUserId: 'me',
      nowMs: NOW,
    });
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ id: 'ok', label: 'Crew member' });
  });
});

describe('nearStageName', () => {
  const at = { latitude: 28.5, longitude: -81.4 };
  const stage = (label: string, m: number) => ({ label, latitude: 28.5 + north(m), longitude: -81.4 });

  it('names the stage at 149 m and not at 151 m', () => {
    expect(NEAR_STAGE_MAX_M).toBe(150);
    expect(nearStageName(at, [stage('Main Stage', 149)])).toBe('Main Stage');
    expect(nearStageName(at, [stage('Main Stage', 151)])).toBeNull();
  });

  it('is null with no stages or no coord', () => {
    expect(nearStageName(at, [])).toBeNull();
    expect(nearStageName(null, [stage('Main Stage', 10)])).toBeNull();
    expect(nearStageName(undefined, [stage('Main Stage', 10)])).toBeNull();
  });

  it('picks the nearer of two stages in range', () => {
    expect(nearStageName(at, [stage('Far', 120), stage('Near', 40)])).toBe('Near');
  });
});
