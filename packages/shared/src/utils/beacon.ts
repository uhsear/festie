import { getAvatarColor, normalizeIdentityName } from './colors';

// 500 ms per phase is 1 flash per second, under the WCAG 2.3.1 limit of 3.
export const BEACON_FLASH_MS = 500;

/** The two screen colours a Beacon alternates between. The primary is the user's avatar colour. */
export function beaconColors(name: string): { primary: string; alternate: string } {
  return { primary: getAvatarColor(normalizeIdentityName(name)), alternate: '#FFFFFF' };
}
