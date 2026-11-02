// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * A short, fixed-vocabulary device name for the signed-in devices list
 * ("Chrome on Windows", "Festie app on iOS"). The raw User-Agent is never
 * stored or returned, only this label.
 */
export function describeDevice(userAgent: string | undefined, isNative: boolean): string | null {
  const ua = (userAgent ?? '').slice(0, 512);
  if (!ua) return isNative ? 'Festie app' : null;

  if (isNative) {
    if (/iPhone|iPad|iOS|Darwin|CFNetwork/i.test(ua)) return 'Festie app on iOS';
    if (/Android|okhttp/i.test(ua)) return 'Festie app on Android';
    return 'Festie app';
  }

  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\/|FxiOS/.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS/.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';

  const system = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /CrOS/.test(ua)
          ? 'ChromeOS'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Macintosh|Mac OS X/.test(ua)
              ? 'Mac'
              : /Linux/.test(ua)
                ? 'Linux'
                : null;

  return system ? `${browser} on ${system}` : browser;
}
