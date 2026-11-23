import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { useOfflineReadinessStore, useCrewStore, useFestivalDataStore } from '@festie/shared/stores';
import type { SectionReadiness } from '@festie/shared/stores';
import {
  buildOfflineSteps,
  summarizeOffline,
  festivalPhase,
  hasOfflineBasemap,
  extractSiteplan,
  headContentLength,
} from '@festie/shared/utils';
import { getMapOutcome, setMapOutcome, subscribeMapOutcome, type MapOutcome } from '../lib/offlineMapOutcome';
import {
  basemapCacheInfo,
  clearBasemapCache,
  checkArchiveSpace,
  ensureBasemapCached,
  siteplanNeedsConnection,
  subscribeBasemapCache,
} from '../lib/basemapCache';

const IDLE: SectionReadiness = { status: 'idle', syncedAt: null };

/**
 * The offline-map step. Deliberately NOT part of the shared readiness store:
 *
 *  - the mechanism is `expo-file-system`, which `@festie/shared` cannot import
 *    (shared also runs in the browser, where the module is a no-op stub), and
 *  - that store is zustand-persisted, while the archive lives in `Paths.cache`
 *    which the OS may evict at any time. A remembered "ready" would keep
 *    promising a map whose bytes are gone.
 *
 * So this status is READ FROM THE FILESYSTEM on mount and after every attempt.
 */
export function sectionFromDisk(pmtilesUrl: string | null | undefined): SectionReadiness {
  const info = basemapCacheInfo(pmtilesUrl);
  // No size gate: the archive is read by byte range (readArchiveRange), never whole.
  return info.cached ? { status: 'ready', syncedAt: info.syncedAt } : IDLE;
}

/**
 * Saves the archive (and the site-plan overlay image, best effort: it is not part of the
 * step) and re-reads the disk. ensureBasemapCached never throws and never publishes a short
 * archive when the server reports a length, so a failure is simply "still not downloaded":
 * the map keeps working online, and Retry re-runs this. No size cap: the archive is read
 * by byte range.
 *
 * A map that is not saved yet is checked against the free disk space first (HEAD length plus
 * a margin). When it does not fit, nothing is downloaded and `message` says why. If either
 * number is unknown the download runs as before.
 */
export async function downloadOfflineMap(
  pmtilesUrl: string,
  siteplanUrl: string | null,
): Promise<{ section: SectionReadiness; message: string | null }> {
  const space = await checkArchiveSpace(pmtilesUrl);
  if (!space.ok) return { section: { status: 'error', syncedAt: Date.now() }, message: space.message };
  await Promise.all([ensureBasemapCached(pmtilesUrl), siteplanUrl ? ensureBasemapCached(siteplanUrl) : null]);
  const section = sectionFromDisk(pmtilesUrl);
  return { section: section.status === 'ready' ? section : { status: 'error', syncedAt: Date.now() }, message: null };
}

/**
 * The map step as the screen should show it: a saved archive on disk is always `ready`; otherwise the
 * last attempt's syncing/error (with its message) survives here, so a card that unmounted during the
 * download still shows why the map was not saved. Nothing at all is plain `idle`.
 */
export function mapStateFor(pmtilesUrl: string | null | undefined): MapOutcome {
  const disk = sectionFromDisk(pmtilesUrl);
  if (disk.status === 'ready') return { section: disk, message: null };
  return getMapOutcome(pmtilesUrl) ?? { section: IDLE, message: null };
}

function useOfflineMapSection(pmtilesUrl: string | null, siteplanUrl: string | null) {
  // Disk and the last attempt are both readable synchronously, so derive the state at render time and
  // re-render when either changes (another hook instance, the map screen, or an attempt settling).
  const [, bump] = useState(0);
  useEffect(() => {
    const rerender = () => bump((n) => n + 1);
    const offDisk = subscribeBasemapCache(rerender);
    const offOutcome = subscribeMapOutcome(rerender);
    return () => {
      offDisk();
      offOutcome();
    };
  }, []);
  const { section, message } = mapStateFor(pmtilesUrl);
  const siteplanBytes = basemapCacheInfo(siteplanUrl).bytes;

  const download = useCallback(async () => {
    if (!pmtilesUrl) return;
    setMapOutcome(pmtilesUrl, { section: { status: 'syncing', syncedAt: null }, message: null });
    const result = await downloadOfflineMap(pmtilesUrl, siteplanUrl);
    setMapOutcome(pmtilesUrl, result.section.status === 'ready' ? null : result);
  }, [pmtilesUrl, siteplanUrl]);

  return { section, download, message, siteplanBytes };
}

/** The map step for a festival (null when it has no offline map), for the "Festival ready" checklist. */
export function useOfflineMapStatus(festivalId: string): SectionReadiness | null {
  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
  const mapUrl = offlineMapUrl(currentFestival, festivalId);
  const { section } = useOfflineMapSection(mapUrl, null);
  return mapUrl ? section : null;
}

function offlineMapUrl(
  festival: ReturnType<typeof useFestivalDataStore.getState>['currentFestival'],
  festivalId: string,
): string | null {
  // expo-file-system has no web implementation (downloadFileAsync warns and
  // resolves without writing), so the Expo web export shows NO map step rather
  // than one that could never go ready.
  return festival?.id === festivalId && hasOfflineBasemap(festival.mapConfig) && Platform.OS !== 'web'
    ? festival.mapConfig.offlineBasemap.pmtilesUrl
    : null;
}

/**
 * One offline download for a festival: the store's sections plus, when the
 * festival has an archive, the mobile-local map step. Shared by the Picks card
 * and the status chips so they never disagree.
 */
export function useOfflineDownload(festivalId: string) {
  const readiness = useOfflineReadinessStore((s) => s.byFestival[festivalId]);
  const downloadingFestivalId = useOfflineReadinessStore((s) => s.downloadingFestivalId);
  const downloadForOffline = useOfflineReadinessStore((s) => s.downloadForOffline);
  const activeCrewId = useCrewStore((s) => s.activeCrew?.id ?? null);
  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
  const days = useFestivalDataStore((s) => s.days);

  const mapUrl = offlineMapUrl(currentFestival, festivalId);
  const siteplanUrl = mapUrl ? (extractSiteplan(currentFestival?.mapConfig)?.imageUrl ?? null) : null;
  const {
    section: mapSection,
    download: downloadMap,
    message: mapMessage,
    siteplanBytes,
  } = useOfflineMapSection(mapUrl, siteplanUrl);

  // The archive size, shown before the download so people on mobile data can decide.
  const [mapBytes, setMapBytes] = useState<number | null>(null);
  useEffect(() => {
    if (!mapUrl) return;
    let live = true;
    void headContentLength(mapUrl).then((bytes) => {
      if (live) setMapBytes(bytes);
    });
    return () => {
      live = false;
    };
  }, [mapUrl]);
  const removeMap = useCallback(() => {
    if (mapUrl) clearBasemapCache(mapUrl);
    if (siteplanUrl) clearBasemapCache(siteplanUrl);
  }, [mapUrl, siteplanUrl]);

  const download = useCallback(() => {
    void downloadForOffline(festivalId, activeCrewId ?? undefined);
    void downloadMap();
  }, [downloadForOffline, downloadMap, festivalId, activeCrewId]);

  const steps = useMemo(
    () => buildOfflineSteps(readiness, { hasCrew: !!activeCrewId, map: mapUrl ? mapSection : null }),
    [readiness, activeCrewId, mapUrl, mapSection],
  );
  const summary = useMemo(
    () => summarizeOffline(steps, festivalPhase(currentFestival, days)),
    [steps, currentFestival, days],
  );
  const isDownloading = downloadingFestivalId === festivalId || mapSection.status === 'syncing';

  return {
    steps,
    summary,
    download,
    isDownloading,
    hasMap: !!mapUrl,
    mapBytes: mapUrl ? mapBytes : null,
    mapReady: mapSection.status === 'ready',
    // Why the map was not saved (not enough space). Only while the step is in error: a later
    // success or a reset to idle must not leave the old refusal on the card.
    mapMessage: mapUrl && mapSection.status === 'error' ? mapMessage : null,
    // The map is saved but the site-plan overlay still needs a connection.
    siteplanNeedsConnection:
      !!mapUrl && mapSection.status === 'ready' && siteplanNeedsConnection(siteplanUrl, siteplanBytes),
    removeMap,
  };
}
