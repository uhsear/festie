import { describe, it, expect, vi, beforeEach } from 'vitest';

// Same in-memory filesystem approach as lib/basemapCache.test.ts: a uri -> byte-size map.
const fs = vi.hoisted(() => ({ files: new Map<string, number>(), free: undefined as number | undefined }));

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
    delete() {
      fs.files.delete(this.uri);
    }
    async base64() {
      return `b64:${this.size}`;
    }
  }
  return { File, Directory, FileMode: { ReadOnly: 'r' }, Paths: { cache: 'file:///cache', get availableDiskSpace() { return fs.free; } } };
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

const { sectionFromDisk, downloadOfflineMap, mapStateFor, runMapDownload, removeOfflineMap } = await import('./useOfflineDownload');
const { setMapOutcome, getMapOutcome } = await import('../lib/offlineMapOutcome');
const { basemapCacheFile, ensureBasemapCached, checkArchiveSpace } = await import('../lib/basemapCache');

const PMTILES = 'https://festie.us/uploads/basemaps/big-2026.pmtiles';
const SITEPLAN = 'https://festie.us/uploads/siteplans/big-2026.webp';
const MIB = 1024 * 1024;

// The HEAD that reports the archive size; downloadOfflineMap reads it before it starts.
const head = (bytes: number | null) =>
  vi.fn(async () => ({ ok: true, headers: { get: () => (bytes == null ? null : String(bytes)) } }));

beforeEach(() => {
  fs.files.clear();
  fs.free = undefined;
  vi.stubGlobal('fetch', head(null));
  vi.mocked(ensureBasemapCached).mockClear();
});

describe('offline map readiness size gate', () => {
  it('counts a 40 MiB cached .pmtiles archive as offline-ready', () => {
    fs.files.set(basemapCacheFile(PMTILES).uri, 40 * MIB);
    expect(sectionFromDisk(PMTILES)).toEqual({ status: 'ready', syncedAt: 1_700_000_000_000 });
  });

  it('downloads a 40 MiB archive without refusing it and ends ready', async () => {
    const result = await downloadOfflineMap(PMTILES, null);
    expect(ensureBasemapCached).toHaveBeenCalledWith(PMTILES);
    expect(result).toEqual({ section: { status: 'ready', syncedAt: 1_700_000_000_000 }, message: null });
  });

  it('ends in error when the archive did not land on disk', async () => {
    vi.mocked(ensureBasemapCached).mockResolvedValueOnce(null);
    expect((await downloadOfflineMap(PMTILES, SITEPLAN)).section.status).toBe('error');
    expect(ensureBasemapCached).toHaveBeenCalledWith(SITEPLAN);
  });

  it('reports a missing archive as idle', () => {
    expect(sectionFromDisk(PMTILES)).toEqual({ status: 'idle', syncedAt: null });
  });
});

describe('free-space check before the map download', () => {
  it('does not start the download when the archive plus margin does not fit', async () => {
    vi.stubGlobal('fetch', head(300 * MIB));
    fs.free = 320 * MIB;
    const result = await downloadOfflineMap(PMTILES, SITEPLAN);
    expect(ensureBasemapCached).not.toHaveBeenCalled();
    expect(result.section.status).toBe('error');
    expect(result.message).toBe(
      'Not enough free space to save the map (needs 368 MB, 335 MB free). Free up some space and try again.',
    );
  });

  it('downloads when there is room', async () => {
    vi.stubGlobal('fetch', head(300 * MIB));
    fs.free = 400 * MIB;
    expect((await downloadOfflineMap(PMTILES, null)).section.status).toBe('ready');
  });

  it('downloads when the free space cannot be read', async () => {
    vi.stubGlobal('fetch', head(300 * MIB));
    expect((await downloadOfflineMap(PMTILES, null)).message).toBeNull();
    expect(ensureBasemapCached).toHaveBeenCalledWith(PMTILES);
  });

  it('downloads when the archive size is unknown', async () => {
    fs.free = 1 * MIB;
    expect((await downloadOfflineMap(PMTILES, null)).section.status).toBe('ready');
  });

  it('skips the check for an archive that is already saved', async () => {
    fs.files.set(basemapCacheFile(PMTILES).uri, 300 * MIB);
    vi.stubGlobal('fetch', head(300 * MIB));
    fs.free = 1 * MIB;
    expect((await downloadOfflineMap(PMTILES, null)).section.status).toBe('ready');
  });

  it('gives the map screen the same answer through checkArchiveSpace', async () => {
    vi.stubGlobal('fetch', head(300 * MIB));
    fs.free = 320 * MIB;
    expect((await checkArchiveSpace(PMTILES)).ok).toBe(false);
    fs.free = 400 * MIB;
    expect((await checkArchiveSpace(PMTILES)).ok).toBe(true);
  });
});

describe('map step outcome survives the card unmounting', () => {
  it('keeps the error and its message after the attempt, so a remounted card still shows why', async () => {
    fs.free = 3.7 * 1024 * MIB;
    vi.stubGlobal('fetch', head(139 * 1024 * MIB));
    const result = await downloadOfflineMap(PMTILES, null);
    expect(result.section.status).toBe('error');
    setMapOutcome(PMTILES, result);
    // A fresh hook instance (the card remounted) has no state of its own: it reads this.
    const remounted = mapStateFor(PMTILES);
    expect(remounted.section.status).toBe('error');
    expect(remounted.message).toMatch(/Not enough free space to save the map \(needs .* MB, .* MB free\)/);
    setMapOutcome(PMTILES, null);
  });

  it('a saved archive on disk wins over a stale error', () => {
    setMapOutcome(PMTILES, { section: { status: 'error', syncedAt: 1 }, message: 'old' });
    fs.files.set(basemapCacheFile(PMTILES).uri, 40 * MIB);
    expect(mapStateFor(PMTILES)).toEqual({ section: { status: 'ready', syncedAt: 1_700_000_000_000 }, message: null });
    setMapOutcome(PMTILES, null);
  });
});

describe('card-started download and remove', () => {
  it('runMapDownload stores the refusal, and a later success clears it', async () => {
    fs.free = 3.7 * 1024 * MIB;
    vi.stubGlobal('fetch', head(139 * 1024 * MIB));
    await runMapDownload(PMTILES, null);
    expect(getMapOutcome(PMTILES)?.section.status).toBe('error');
    expect(getMapOutcome(PMTILES)?.message).toMatch(/Not enough free space/);
    fs.free = undefined;
    await runMapDownload(PMTILES, null);
    expect(getMapOutcome(PMTILES)).toBeNull();
  });

  it('removing a saved map drops an old error so it does not resurface', async () => {
    setMapOutcome(PMTILES, { section: { status: 'error', syncedAt: 1 }, message: 'old' });
    fs.files.set(basemapCacheFile(PMTILES).uri, 40 * MIB);
    removeOfflineMap(PMTILES, null);
    expect(mapStateFor(PMTILES)).toEqual({ section: { status: 'idle', syncedAt: null }, message: null });
  });
});
