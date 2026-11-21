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
// Stand-in for the transfer: lands a 40 MiB archive at the cache path, as a real download would.
vi.mock('../lib/basemapCache', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/basemapCache')>();
  return {
    ...real,
    ensureBasemapCached: vi.fn(async (url: string) => {
      fs.files.set(real.basemapCacheFile(url).uri, 40 * 1024 * 1024);
      return 'file:///cache/x';
    }),
  };
});

const { sectionFromDisk, downloadOfflineMap } = await import('./useOfflineDownload');
const { basemapCacheFile, ensureBasemapCached } = await import('../lib/basemapCache');

const PMTILES = 'https://festie.us/uploads/basemaps/big-2026.pmtiles';
const SITEPLAN = 'https://festie.us/uploads/siteplans/big-2026.webp';
const MIB = 1024 * 1024;

beforeEach(() => {
  fs.files.clear();
  vi.mocked(ensureBasemapCached).mockClear();
});

describe('offline map readiness size gate', () => {
  it('counts a 40 MiB cached .pmtiles archive as offline-ready', () => {
    fs.files.set(basemapCacheFile(PMTILES).uri, 40 * MIB);
    expect(sectionFromDisk(PMTILES)).toEqual({ status: 'ready', syncedAt: 1_700_000_000_000 });
  });

  it('downloads a 40 MiB archive without refusing it and ends ready', async () => {
    const ready = await downloadOfflineMap(PMTILES, null);
    expect(ensureBasemapCached).toHaveBeenCalledWith(PMTILES);
    expect(ready).toEqual({ status: 'ready', syncedAt: 1_700_000_000_000 });
  });

  it('ends in error when the archive did not land on disk', async () => {
    vi.mocked(ensureBasemapCached).mockResolvedValueOnce(null);
    expect((await downloadOfflineMap(PMTILES, SITEPLAN)).status).toBe('error');
    expect(ensureBasemapCached).toHaveBeenCalledWith(SITEPLAN);
  });

  it('reports a missing archive as idle', () => {
    expect(sectionFromDisk(PMTILES)).toEqual({ status: 'idle', syncedAt: null });
  });
});
