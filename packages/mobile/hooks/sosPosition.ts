import type { SosPosition } from '@festie/shared/services';

interface Fix {
  coords: { latitude: number; longitude: number; accuracy: number | null };
  timestamp: number;
}

export interface SosLocationApi {
  requestPermission: () => Promise<boolean>;
  getLastKnown: () => Promise<Fix | null>;
  getCurrent: () => Promise<Fix | null>;
}

export interface SosPositionBudgets {
  permissionMs: number;
  seedMs: number;
  freshMs: number;
}

const timeout = (ms: number) => new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));
const bounded = <T>(p: Promise<T | null>, ms: number) => Promise.race([p.catch(() => null), timeout(ms)]);

/**
 * Best available fix for an SOS. The permission prompt, the cached seed and the
 * fresh read each get their own budget, so a hung fresh read (no GPS fix
 * indoors) still falls back to the seed and never delays the alert beyond the
 * sum of the budgets. Returns undefined when no fix is available.
 */
export async function resolveSosPosition(
  api: SosLocationApi,
  budgets: SosPositionBudgets,
): Promise<SosPosition | undefined> {
  const granted = await bounded(api.requestPermission(), budgets.permissionMs);
  if (!granted) return undefined;
  const seed = await bounded(api.getLastKnown(), budgets.seedMs);
  const fresh = await bounded(api.getCurrent(), budgets.freshMs);
  const pos = fresh ?? seed;
  if (!pos) return undefined;
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: pos.coords.accuracy ?? undefined,
    capturedAt: new Date(pos.timestamp).toISOString(),
  };
}
