import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { OFFLINE_MAP_COPY } from '@festie/shared/constants';
import { useOfflineDownload } from './useOfflineDownload';

const h = vi.hoisted(() => ({
  removeBasemap: vi.fn(async (_url: string) => true),
  downloadForOffline: vi.fn(async () => {}),
  readiness: { byFestival: {} as Record<string, unknown>, downloadingFestivalId: null as string | null },
  crew: { activeCrew: { id: 'crew-1' } as { id: string } | null },
  festival: {
    currentFestival: null as unknown,
    days: [] as unknown[],
  },
  cache: {
    supported: true,
    info: { cached: false, syncedAt: null as number | null },
    size: 4_200_000 as number | null,
    ensure: { ok: true } as unknown,
  },
}));

vi.mock('@festie/shared/stores/offlineReadinessStore', () => ({
  useOfflineReadinessStore: (sel: (s: unknown) => unknown) =>
    sel({ ...h.readiness, downloadForOffline: h.downloadForOffline }),
}));
vi.mock('@festie/shared/stores/crewStore', () => ({
  useCrewStore: (sel: (s: unknown) => unknown) => sel(h.crew),
}));
vi.mock('@festie/shared/stores/festivalStore', () => ({
  useFestivalStore: (sel: (s: unknown) => unknown) => sel(h.festival),
}));
vi.mock('../lib/basemapCache', () => ({
  basemapSupported: () => h.cache.supported,
  basemapCacheInfo: vi.fn(async () => h.cache.info),
  basemapSize: vi.fn(async () => h.cache.size),
  ensureBasemapCached: vi.fn(async () => {
    if ((h.cache.ensure as { ok: boolean }).ok) h.cache.info = { cached: true, syncedAt: 123 };
    return h.cache.ensure;
  }),
  basemapProgress: () => null,
  removeBasemap: (url: string) => h.removeBasemap(url),
  subscribeBasemapCache: () => () => {},
}));

const ready = { status: 'ready', syncedAt: 1 };
const allReady = { schedule: ready, picks: ready, crew: ready, weather: ready, art: ready };
const withMap = { id: 'f1', mapConfig: { offlineBasemap: { pmtilesUrl: 'https://cdn.example.com/a.pmtiles' } } };

describe('useOfflineDownload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.readiness = { byFestival: {}, downloadingFestivalId: null };
    h.crew = { activeCrew: { id: 'crew-1' } };
    h.festival = { currentFestival: withMap, days: [] };
    h.cache = { supported: true, info: { cached: false, syncedAt: null }, size: 4_200_000, ensure: { ok: true } };
  });

  it('has no map step without an offline basemap', () => {
    h.festival = { currentFestival: { id: 'f1', mapConfig: null }, days: [] };
    const { result } = renderHook(() => useOfflineDownload('f1'));
    expect(result.current.hasMap).toBe(false);
    expect(result.current.steps.some((s) => s.key === 'map')).toBe(false);
  });

  it('has no map step when the cache API is unsupported', () => {
    h.cache.supported = false;
    const { result } = renderHook(() => useOfflineDownload('f1'));
    expect(result.current.hasMap).toBe(false);
  });

  it('adds an idle map step and reads the size', async () => {
    const { result } = renderHook(() => useOfflineDownload('f1'));
    expect(result.current.steps.find((s) => s.key === 'map')?.section.status).toBe('idle');
    await waitFor(() => expect(result.current.mapBytes).toBe(4_200_000));
  });

  it('reads a cached map as ready', async () => {
    h.cache.info = { cached: true, syncedAt: 99 };
    const { result } = renderHook(() => useOfflineDownload('f1'));
    await waitFor(() => expect(result.current.steps.find((s) => s.key === 'map')?.section.status).toBe('ready'));
  });

  it('download runs the store download and the map, then reports ready', async () => {
    h.readiness.byFestival = { f1: allReady };
    const { result } = renderHook(() => useOfflineDownload('f1'));
    await act(async () => {
      await result.current.download();
    });
    expect(h.downloadForOffline).toHaveBeenCalledWith('f1', 'crew-1');
    expect(result.current.summary.overall).toBe('ready');
  });

  it('does not claim 0 MB free when the browser gave no free-space estimate', async () => {
    h.readiness.byFestival = { f1: allReady };
    h.cache.ensure = { ok: false, reason: 'quota', bytes: 6_000_000 };
    const { result } = renderHook(() => useOfflineDownload('f1'));
    await act(async () => {
      await result.current.download();
    });
    expect(result.current.mapMessage).toContain('needs 6 MB)');
    expect(result.current.mapMessage).not.toContain('0 MB free');
  });

  it('shows the not-enough-space detail after a quota failure while other rows finish', async () => {
    h.readiness.byFestival = { f1: allReady };
    h.cache.ensure = { ok: false, reason: 'quota', bytes: 4_200_000, freeBytes: 1_300_000 };
    const { result } = renderHook(() => useOfflineDownload('f1'));
    await act(async () => {
      await result.current.download();
    });
    const map = result.current.steps.find((s) => s.key === 'map');
    expect(map?.section.status).toBe('error');
    expect(result.current.mapMessage).toBe(OFFLINE_MAP_COPY.notEnoughSpace(4_200_000, 1_300_000));
    expect(result.current.mapMessage).toContain('needs 5 MB, 1 MB free');
    expect(result.current.summary.overall).toBe('partial');
  });

  it('says the download failed when the map did not save for a reason other than space', async () => {
    h.readiness.byFestival = { f1: allReady };
    h.cache.ensure = { ok: false, reason: 'network' };
    const { result } = renderHook(() => useOfflineDownload('f1'));
    await act(async () => {
      await result.current.download();
    });
    expect(result.current.steps.find((s) => s.key === 'map')?.section.status).toBe('error');
    expect(result.current.mapMessage).toBe(OFFLINE_MAP_COPY.downloadFailed);
  });

  it('exposes the map step for the checklist, or null without a map', () => {
    const { result } = renderHook(() => useOfflineDownload('f1'));
    expect(result.current.mapStatus?.status).toBe('idle');
    h.festival = { currentFestival: { id: 'f1', mapConfig: null }, days: [] };
    const none = renderHook(() => useOfflineDownload('f1'));
    expect(none.result.current.mapStatus).toBeNull();
  });

  it('passes an undefined crew id when there is no crew', async () => {
    h.crew = { activeCrew: null };
    const { result } = renderHook(() => useOfflineDownload('f1'));
    await act(async () => {
      await result.current.download();
    });
    expect(h.downloadForOffline).toHaveBeenCalledWith('f1', undefined);
  });

  it('removeMap deletes the festival archive by its URL and flags a cached map as ready', async () => {
    h.cache.info = { cached: true, syncedAt: 99 };
    const { result } = renderHook(() => useOfflineDownload('f1'));
    await waitFor(() => expect(result.current.mapReady).toBe(true));
    await act(async () => {
      await result.current.removeMap();
    });
    expect(h.removeBasemap).toHaveBeenCalledWith('https://cdn.example.com/a.pmtiles');
  });
});
