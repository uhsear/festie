import { describe, expect, it } from 'vitest';
import { resolveSosPosition, type SosLocationApi } from './sosPosition';

const fix = (lat: number) => ({ coords: { latitude: lat, longitude: 2, accuracy: 5 }, timestamp: 1000 });
const never = () => new Promise<never>(() => {});
const budgets = { permissionMs: 50, seedMs: 20, freshMs: 20 };
const api = (o: Partial<SosLocationApi>): SosLocationApi => ({
  requestPermission: async () => true,
  getLastKnown: async () => null,
  getCurrent: async () => null,
  ...o,
});

describe('resolveSosPosition', () => {
  it('falls back to the seed when the fresh read hangs', async () => {
    const pos = await resolveSosPosition(api({ getLastKnown: async () => fix(1), getCurrent: never }), budgets);
    expect(pos?.lat).toBe(1);
  });
  it('prefers the fresh fix', async () => {
    const pos = await resolveSosPosition(api({ getLastKnown: async () => fix(1), getCurrent: async () => fix(3) }), budgets);
    expect(pos?.lat).toBe(3);
  });
  it('returns undefined when permission is denied or hangs', async () => {
    expect(await resolveSosPosition(api({ requestPermission: async () => false }), budgets)).toBeUndefined();
    expect(await resolveSosPosition(api({ requestPermission: never }), budgets)).toBeUndefined();
  });
  it('returns undefined when every read fails', async () => {
    const reject = () => Promise.reject(new Error('x'));
    expect(await resolveSosPosition(api({ getLastKnown: reject, getCurrent: reject }), budgets)).toBeUndefined();
  });
});
