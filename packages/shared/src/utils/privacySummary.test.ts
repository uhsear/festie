import { describe, it, expect } from 'vitest';
import { buildPrivacySummary } from './privacySummary';
import { PRIVACY_COPY as C } from '../constants/privacyCopy';

type Input = Parameters<typeof buildPrivacySummary>[0];
const input = (over: Partial<Input> = {}): Input => ({
  user: {},
  shareIntent: null,
  myStatus: null,
  crewNameById: (id: string) => (id === 'c1' ? 'Crew One' : null),
  activeCrewName: 'Crew One',
  formatClock: (iso: string) => `T(${iso})`,
  ...over,
});
const row = (r: ReturnType<typeof buildPrivacySummary>, key: string) => r.rows.find((x) => x.key === key)!;

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
    const paused = buildPrivacySummary(input({ shareIntent: { crewId: 'zz', expiresAt: 'X', paused: true } }));
    expect(row(paused, 'liveLocation').value).toBe('Paused for your crew until T(X).');
  });

  it('status location with and without a capture time', () => {
    const a = buildPrivacySummary(input({ myStatus: { latitude: 1, location_captured_at: 'Y' } }));
    expect(row(a, 'statusLocation').value).toBe('Crew One sees where you were at T(Y).');
    expect(a.canStop).toBe(true);
    const b = buildPrivacySummary(
      input({ myStatus: { latitude: 1, location_captured_at: null }, activeCrewName: null }),
    );
    expect(row(b, 'statusLocation').value).toBe('Your crew sees where you were recently.');
    expect(buildPrivacySummary(input({ myStatus: { latitude: null } })).canStop).toBe(false);
  });
});
