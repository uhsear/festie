import { describe, it, expect, vi, beforeEach } from 'vitest';

// Same in-memory filesystem approach as lib/basemapCache.test.ts: a uri -> byte-size map.
const fs = vi.hoisted(() => ({ files: new Map<string, number>() }));

vi.mock('expo-file-system', () => {
  const join = (parts: unknown[]) =>
    parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/');
  class Directory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
  }
  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists() {
      return fs.files.has(this.uri);
    }
    get size() {
      return fs.files.get(this.uri) ?? 0;
    }
    get lastModified() {
      return 1_700_000_000_000;
    }
    async base64() {
      return `b64:${this.size}`;
    }
  }
  return { File, Directory, FileMode: { ReadOnly: 'r' }, Paths: { cache: 'file:///cache' } };
});
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('@festie/shared/stores', () => ({}));

const { sectionFromDisk } = await import('./useOfflineDownload');
const { basemapCacheFile, readCachedBase64, MAX_INLINE_BYTES } = await import('../lib/basemapCache');

const PMTILES = 'https://festie.us/uploads/basemaps/big-2026.pmtiles';
const SITEPLAN = 'https://festie.us/uploads/siteplans/big-2026.webp';
const MIB = 1024 * 1024;

beforeEach(() => fs.files.clear());

describe('offline map readiness size gate', () => {
  it('counts a 40 MiB cached .pmtiles archive as offline-ready', () => {
    fs.files.set(basemapCacheFile(PMTILES).uri, 40 * MIB);
    expect(sectionFromDisk(PMTILES)).toEqual({ status: 'ready', syncedAt: 1_700_000_000_000 });
  });

  it('still refuses a 40 MiB site-plan image, which is handed to the map whole', async () => {
    fs.files.set(basemapCacheFile(SITEPLAN).uri, 40 * MIB);
    expect(40 * MIB).toBeGreaterThan(MAX_INLINE_BYTES);
    expect(await readCachedBase64(SITEPLAN)).toBeNull();
  });

  it('reports a missing archive as idle', () => {
    expect(sectionFromDisk(PMTILES)).toEqual({ status: 'idle', syncedAt: null });
  });
});
