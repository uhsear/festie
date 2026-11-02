// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Push and email links are absolute web URLs on the public origin, so one link
 * works on web and on mobile (mobile strips the origin, see pushTarget.ts).
 */
export function appOrigin(config: any): string {
  return String(config?.PUBLIC_ORIGIN || 'https://festie.us').replace(/\/+$/, '');
}

export function appLink(config: any, path: string): string {
  return appOrigin(config) + path;
}
