/**
 * Server origin for API and socket traffic. Production builds use festie.us; a test build
 * sets EXPO_PUBLIC_API_ORIGIN at bundle time (e.g. http://10.0.2.2:4001 for staging on the
 * Android emulator rig).
 */
export function resolveApiOrigin(value: string | undefined): string {
  const origin = value?.trim().replace(/\/+$/, '');
  return origin ? origin : 'https://festie.us';
}

export const API_ORIGIN = resolveApiOrigin(process.env.EXPO_PUBLIC_API_ORIGIN);
