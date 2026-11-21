import { describe, it, expect, vi, beforeEach } from 'vitest';

// The mobile harness is node-only, so `expo-file-system` is replaced with a tiny
// in-memory filesystem: a uri -> byte-size map plus a settable download impl.
// That is exactly the level at which this module's contract is decidable —
// which paths it writes, when it re-downloads, and what it leaves behind on a
// failed transfer.
const fs = vi.hoisted(() => ({
  files: new Map<string, number>(),
  dirs: new Set<string>(),
  handles: [] as { closed: boolean }[],
  download: vi.fn(),
}));

vi.mock('expo-file-system', () => {
  const join = (parts: unknown[]) =>
    parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/');

  class Directory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists() {
      return fs.dirs.has(this.uri);
    }
    create() {
      fs.dirs.add(this.uri);
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
      return fs.files.has(this.uri) ? 1_700_000_000_000 : null;
    }
    delete() {
      fs.files.delete(this.uri);
    }
    rename(newName: string) {
      const size = fs.files.get(this.uri) ?? 0;
      fs.files.delete(this.uri);
      this.uri = this.uri.replace(/[^/]+$/, newName);
      fs.files.set(this.uri, size);
    }
    async base64() {
      return `b64:${fs.files.get(this.uri) ?? 0}`;
    }
    open() {
      const uri = this.uri;
      // Byte n of any mocked file is n % 251, so a read's content shows where it started.
      const handle = {
        offset: 0 as number | null,
        closed: false,
        async readBytes(length: number) {
          const size = fs.files.get(uri) ?? 0;
          const start = handle.offset ?? 0;
          const n = Math.max(0, Math.min(length, size - start));
          handle.offset = start + n;
          return Uint8Array.from({ length: n }, (_, i) => (start + i) % 251);
        },
        close() {
          handle.closed = true;
          fs.handles.push(handle);
        },
      };
      return handle;
    }
    static downloadFileAsync = fs.download;
  }

  return { File, Directory, FileMode: { ReadOnly: 'r' }, Paths: { cache: 'file:///cache' } };
});

const { basemapCacheKey, basemapCacheFile, basemapCacheInfo, ensureBasemapCached, clearBasemapCache, subscribeBasemapCache, readCachedBase64, isBasemapRemoved, MAX_INLINE_BYTES, readArchiveRange, bytesToBase64, MAX_RANGE_BYTES } = await import(
  './basemapCache'
);

const URL_A = 'https://festie.us/uploads/basemaps/nc-2026.pmtiles';
const cachePath = (url: string) => `file:///cache/festie-basemaps/${basemapCacheKey(url)}`;

/** Make the mocked download write `bytes` to its destination and resolve. */
function downloadWrites(bytes: number) {
  fs.download.mockImplementation(async (_url: string, dest: { uri: string }) => {
    fs.files.set(dest.uri, bytes);
    return dest;
  });
}

beforeEach(() => {
  fs.files.clear();
  fs.dirs.clear();
  fs.download.mockReset();
  downloadWrites(1_513_213);
});

describe('basemapCacheKey', () => {
  it('is stable for a URL and distinct across URLs', () => {
    expect(basemapCacheKey(URL_A)).toBe(basemapCacheKey(URL_A));
    expect(basemapCacheKey(URL_A)).not.toBe(basemapCacheKey(URL_A.replace('nc', 'fk')));
    expect(basemapCacheKey(URL_A)).toMatch(/^[0-9a-f]{8}\.pmtiles$/);
  });
});

describe('ensureBasemapCached', () => {
  it('rejects a non-https URL without touching the network', async () => {
    expect(await ensureBasemapCached('http://festie.us/a.pmtiles')).toBeNull();
    expect(fs.download).not.toHaveBeenCalled();
  });

  it('downloads once, then serves the local copy without re-downloading', async () => {
    const uri = await ensureBasemapCached(URL_A);
    expect(uri).toBe(cachePath(URL_A));
    expect(fs.download).toHaveBeenCalledTimes(1);

    expect(await ensureBasemapCached(URL_A)).toBe(cachePath(URL_A));
    expect(fs.download).toHaveBeenCalledTimes(1);
  });

  it('stages into a .part file so the cache path is never a partial archive', async () => {
    // The transfer fails after writing some bytes — exactly the documented
    // Android behaviour. Nothing may land at the final cache path.
    fs.download.mockImplementation(async (_url: string, dest: { uri: string }) => {
      fs.files.set(dest.uri, 512);
      throw new Error('connection reset');
    });

    expect(await ensureBasemapCached(URL_A)).toBeNull();
    expect(fs.files.has(cachePath(URL_A))).toBe(false);
    expect(basemapCacheInfo(URL_A).cached).toBe(false);
    // No staged leftovers: the staging name is unique per attempt, so a failed
    // transfer that did not clean up would orphan a file nothing reclaims.
    expect([...fs.files.keys()].filter((f) => f.endsWith('.part'))).toEqual([]);

    // The next attempt succeeds and leaves nothing staged behind.
    downloadWrites(1_513_213);
    expect(await ensureBasemapCached(URL_A)).toBe(cachePath(URL_A));
    expect(fs.files.get(cachePath(URL_A))).toBe(1_513_213);
    expect([...fs.files.keys()].filter((f) => f.endsWith('.part'))).toEqual([]);
  });

  it('treats an empty download as a failure and leaves nothing cached', async () => {
    downloadWrites(0);
    expect(await ensureBasemapCached(URL_A)).toBeNull();
    expect(fs.files.has(cachePath(URL_A))).toBe(false);
  });

  it('re-downloads over a zero-byte file left at the cache path', async () => {
    fs.files.set(cachePath(URL_A), 0);
    expect(await ensureBasemapCached(URL_A)).toBe(cachePath(URL_A));
    expect(fs.download).toHaveBeenCalledTimes(1);
    expect(fs.files.get(cachePath(URL_A))).toBe(1_513_213);
  });
});

describe('subscribeBasemapCache', () => {
  it('notifies subscribers once per settled attempt, and not after unsubscribe', async () => {
    const cb = vi.fn();
    const unsubscribe = subscribeBasemapCache(cb);
    await Promise.all([ensureBasemapCached(URL_A), ensureBasemapCached(URL_A)]);
    expect(cb).toHaveBeenCalledTimes(1);
    unsubscribe();
    await ensureBasemapCached(URL_A);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe('basemapCacheInfo', () => {
  it('reports nothing cached for a missing file or a null URL', () => {
    expect(basemapCacheInfo(null)).toEqual({ cached: false, bytes: 0, syncedAt: null });
    expect(basemapCacheInfo(URL_A)).toEqual({ cached: false, bytes: 0, syncedAt: null });
  });

  it('reads readiness from the filesystem, not from remembered state', async () => {
    await ensureBasemapCached(URL_A);
    expect(basemapCacheInfo(URL_A)).toEqual({
      cached: true,
      bytes: 1_513_213,
      syncedAt: 1_700_000_000_000,
    });

    // OS cache eviction: the bytes go, and readiness must go with them.
    basemapCacheFile(URL_A).delete();
    expect(basemapCacheInfo(URL_A).cached).toBe(false);
  });
});

describe('readCachedBase64', () => {
  beforeEach(() => fs.files.clear());

  it('returns the bytes of a saved file and null for a missing, empty or oversized one', async () => {
    expect(await readCachedBase64(URL_A)).toBeNull();
    fs.files.set(basemapCacheFile(URL_A).uri, 0);
    expect(await readCachedBase64(URL_A)).toBeNull();
    fs.files.set(basemapCacheFile(URL_A).uri, 1234);
    expect(await readCachedBase64(URL_A)).toBe('b64:1234');
    fs.files.set(basemapCacheFile(URL_A).uri, MAX_INLINE_BYTES + 1);
    expect(await readCachedBase64(URL_A)).toBeNull();
  });

  it('applies the whole-file limit to a site-plan image, not to a .pmtiles archive', async () => {
    const SITEPLAN = 'https://festie.us/uploads/siteplans/x.webp';
    fs.files.set(basemapCacheFile(SITEPLAN).uri, 40 * 1024 * 1024);
    expect(await readCachedBase64(SITEPLAN)).toBeNull();
    // A 40 MiB archive is cached and read by range, so its size never blocks it.
    fs.files.set(basemapCacheFile(URL_A).uri, 40 * 1024 * 1024);
    expect(basemapCacheInfo(URL_A)).toMatchObject({ cached: true, bytes: 40 * 1024 * 1024 });
    expect(await readArchiveRange(URL_A, 39 * 1024 * 1024, 4)).not.toBeNull();
  });

  it('keeps an image URL extension so the site plan shares the cache', () => {
    expect(basemapCacheKey('https://festie.us/uploads/siteplans/x.webp')).toMatch(/^[0-9a-f]{8}\.webp$/);
    expect(basemapCacheKey(URL_A)).toMatch(/^[0-9a-f]{8}\.pmtiles$/);
  });
});

describe('bytesToBase64', () => {
  it('matches the standard encoding for every padding length', () => {
    const enc = (text: string) => bytesToBase64(new TextEncoder().encode(text));
    expect(enc('')).toBe('');
    expect(enc('f')).toBe('Zg==');
    expect(enc('fo')).toBe('Zm8=');
    expect(enc('foo')).toBe('Zm9v');
    expect(enc('PMTiles')).toBe(Buffer.from('PMTiles').toString('base64'));
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(bytesToBase64(all)).toBe(Buffer.from(all).toString('base64'));
  });
});

describe('readArchiveRange', () => {
  beforeEach(() => {
    fs.handles.length = 0;
  });
  const decode = (b64: string | null) => [...Buffer.from(b64 ?? '', 'base64')];

  it('returns only the requested slice and closes the handle', async () => {
    fs.files.set(cachePath(URL_A), 1000);
    expect(decode(await readArchiveRange(URL_A, 250, 4))).toEqual([250, 0, 1, 2]);
    expect(fs.handles).toHaveLength(1);
  });

  it('clips a range that runs past the end of the file', async () => {
    fs.files.set(cachePath(URL_A), 10);
    expect(decode(await readArchiveRange(URL_A, 8, 100))).toEqual([8, 9]);
  });

  it('returns null for a missing file, a start past the end, or no url', async () => {
    expect(await readArchiveRange(URL_A, 0, 4)).toBeNull();
    fs.files.set(cachePath(URL_A), 10);
    expect(await readArchiveRange(URL_A, 10, 4)).toBeNull();
    expect(await readArchiveRange(null, 0, 4)).toBeNull();
  });

  it('rejects anything the document should never ask for, without touching the file', async () => {
    fs.files.set(cachePath(URL_A), 1000);
    for (const [offset, length] of [
      [-1, 4],
      [0, 0],
      [0, -5],
      [1.5, 4],
      [0, MAX_RANGE_BYTES + 1],
      ['0', 4],
      [0, '4'],
      [Number.NaN, 4],
      [0, Infinity],
      [undefined, 4],
    ] as const) {
      expect(await readArchiveRange(URL_A, offset, length)).toBeNull();
    }
    expect(fs.handles).toHaveLength(0);
  });
});

describe('clearBasemapCache', () => {
  it('deletes the saved archive and tells subscribers so the card re-reads the disk', async () => {
    await ensureBasemapCached(URL_A);
    expect(basemapCacheInfo(URL_A).cached).toBe(true);
    const cb = vi.fn();
    const off = subscribeBasemapCache(cb);
    expect(clearBasemapCache(URL_A)).toBe(true);
    expect(basemapCacheInfo(URL_A).cached).toBe(false);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(clearBasemapCache(URL_A)).toBe(false);
    expect(cb).toHaveBeenCalledTimes(1);
    off();
  });

  it('remembers a user delete until an explicit download asks for the file again', async () => {
    await ensureBasemapCached(URL_A);
    expect(isBasemapRemoved(URL_A)).toBe(false);
    clearBasemapCache(URL_A);
    expect(isBasemapRemoved(URL_A)).toBe(true);
    await ensureBasemapCached(URL_A);
    expect(isBasemapRemoved(URL_A)).toBe(false);
  });
});
