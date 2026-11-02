import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useOfflineReadinessStore, useCrewStore, useFestivalDataStore } from '@festie/shared/stores';
import type { SectionReadiness } from '@festie/shared/stores';
import { buildOfflineSteps, summarizeOffline, festivalPhase, hasOfflineBasemap } from '@festie/shared/utils';
import { basemapCacheInfo, ensureBasemapCached, subscribeBasemapCache } from '../lib/basemapCache';

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
function sectionFromDisk(pmtilesUrl: string | null | undefined): SectionReadiness {
  const info = basemapCacheInfo(pmtilesUrl);
  return info.cached ? { status: 'ready', syncedAt: info.syncedAt } : IDLE;
}

function useOfflineMapSection(pmtilesUrl: string | null) {
  // Seed from disk during the first render rather than setting state inside an
  // effect: the cache is readable synchronously, so an effect would render IDLE
  // once and immediately re-render, and it trips react-hooks/set-state-in-effect.
  const [section, setSection] = useState<SectionReadiness>(() => sectionFromDisk(pmtilesUrl));

  const readFromDisk = useCallback(() => {
    setSection(sectionFromDisk(pmtilesUrl));
  }, [pmtilesUrl]);

  // Re-read only when the festival's archive URL changes; the initialiser above
  // covers the first render.
  const seenUrl = useRef(pmtilesUrl);
  useEffect(() => {
    if (seenUrl.current === pmtilesUrl) return;
    seenUrl.current = pmtilesUrl;
    readFromDisk();
  }, [pmtilesUrl, readFromDisk]);

  // Another hook instance (Picks card, a status chip) or the map screen may cache
  // the archive; re-read when any attempt settles so every surface agrees.
  useEffect(() => subscribeBasemapCache(readFromDisk), [readFromDisk]);

  const download = useCallback(async () => {
    if (!pmtilesUrl) return;
    setSection({ status: 'syncing', syncedAt: null });
    // ensureBasemapCached never throws and never publishes a short archive when
    // the server reports a length, so a failure here is simply "still not
    // downloaded" — the map keeps working online, and Retry re-runs this.
    await ensureBasemapCached(pmtilesUrl);
    const info = basemapCacheInfo(pmtilesUrl);
    setSection(
      info.cached ? { status: 'ready', syncedAt: info.syncedAt } : { status: 'error', syncedAt: Date.now() },
    );
  }, [pmtilesUrl]);

  return { section, download };
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

  // expo-file-system has no web implementation (downloadFileAsync warns and
  // resolves without writing), so the Expo web export shows NO map step rather
  // than one that could never go ready.
  const mapUrl =
    currentFestival?.id === festivalId && hasOfflineBasemap(currentFestival.mapConfig) && Platform.OS !== 'web'
      ? currentFestival.mapConfig.offlineBasemap.pmtilesUrl
      : null;
  const { section: mapSection, download: downloadMap } = useOfflineMapSection(mapUrl);

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

  return { steps, summary, download, isDownloading, hasMap: !!mapUrl };
}
