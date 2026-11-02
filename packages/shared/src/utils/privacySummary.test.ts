import { describe, it, expect } from 'vitest';
import { buildPrivacySummary } from './privacySummary';
import { PRIVACY_COPY as C } from '../constants/privacyCopy';

type Input = Parameters<typeof buildPrivacySummary>[0];
const input = (over: Partial<Input> = {}): Input => ({
  user: {},
  shareIntent: null,
  statusLocations: [],
  myStatus: null,
  crewNameById: (id: string) => (id === 'c1' ? 'Crew One' : null),
  activeCrewName: 'Crew One',
  formatClock: (iso: string) => `T(${iso})`,
  ...over,
});
const row = (r: ReturnType<typeof buildPrivacySummary>, key: string) => r.rows.find((x) => x.key === key)!;
const loc = (crewName: string, capturedAt: string | null = null) => ({ crewId: crewName, crewName, capturedAt });

describe('buildPrivacySummary', () => {
  it('all off', () => {
    const r = buildPrivacySummary(input());
    expect(r.canStop).toBe(false);
    expect(r.rows.map((x) => x.key)).toEqual([
      'publicPage',
      'picksLinks',
      'paymentHandles',
      'liveLocation',
      'statusLocation',
      'profile',
    ]);
    expect(row(r, 'publicPage').value).toBe(C.publicPage.off);
    expect(row(r, 'paymentHandles').value).toBe(C.paymentHandles.none);
    expect(row(r, 'liveLocation').value).toBe(C.liveLocation.off);
    expect(row(r, 'statusLocation').value).toBe(C.statusLocation.off);
    expect(row(r, 'statusLocation').active).toBe(false);
  });

  it('public page and two handles', () => {
    const r = buildPrivacySummary(input({ user: { publicSchedule: true, venmoHandle: 'v', paypalHandle: 'p' } }));
    expect(r.canStop).toBe(true);
    expect(row(r, 'publicPage').active).toBe(true);
    expect(row(r, 'paymentHandles').value).toBe('Your crews see Venmo · PayPal.');
  });

  it('live share and paused share', () => {
    const on = buildPrivacySummary(input({ shareIntent: { crewId: 'c1', expiresAt: 'X', paused: false } }));
    expect(row(on, 'liveLocation').value).toBe('Sharing with Crew One until T(X).');
    expect(on.canStop).toBe(true);
    const paused = buildPrivacySummary(input({ shareIntent: { crewId: 'c1', expiresAt: 'X', paused: true } }));
    expect(row(paused, 'liveLocation').value).toBe('Paused for Crew One until T(X).');
  });

  it('an unknown crew id in shareIntent says your crew', () => {
    const r = buildPrivacySummary(input({ shareIntent: { crewId: 'zz', expiresAt: 'X', paused: false } }));
    expect(row(r, 'liveLocation').value).toBe('Sharing with your crew until T(X).');
  });

  it('statusLocations with one entry, with and without a capture time', () => {
    const a = buildPrivacySummary(input({ statusLocations: [loc('Desert Crew', 'Y')] }));
    expect(row(a, 'statusLocation').value).toBe('Desert Crew sees where you were at T(Y).');
    expect(row(a, 'statusLocation').active).toBe(true);
    expect(a.canStop).toBe(true);
    const b = buildPrivacySummary(input({ statusLocations: [loc('Desert Crew')] }));
    expect(row(b, 'statusLocation').value).toBe('Desert Crew sees where you were recently.');
  });

  it('statusLocations with two entries counts the crews', () => {
    const r = buildPrivacySummary(input({ statusLocations: [loc('A', 'Y'), loc('B')] }));
    expect(row(r, 'statusLocation').value).toBe('2 crews see where you were last.');
    expect(r.canStop).toBe(true);
  });

  it('null statusLocations falls back to myStatus', () => {
    const a = buildPrivacySummary(input({ statusLocations: null, myStatus: { latitude: 1, location_captured_at: 'Y' } }));
    expect(row(a, 'statusLocation').value).toBe('Crew One sees where you were at T(Y).');
    expect(a.canStop).toBe(true);
    const b = buildPrivacySummary(
      input({ statusLocations: null, myStatus: { latitude: 1, location_captured_at: null }, activeCrewName: null }),
    );
    expect(row(b, 'statusLocation').value).toBe('Your crew sees where you were recently.');
    expect(buildPrivacySummary(input({ statusLocations: null, myStatus: { latitude: null } })).canStop).toBe(false);
  });

  it('an empty statusLocations array wins over a stale myStatus', () => {
    const r = buildPrivacySummary(input({ statusLocations: [], myStatus: { latitude: 1 } }));
    expect(r.canStop).toBe(false);
  });
});
