import { useCallback, useEffect, useState } from 'react';
import { useOfflineReadinessStore } from '@festie/shared/stores/offlineReadinessStore';
import type { SectionReadiness } from '@festie/shared/stores/offlineReadinessStore';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import { useFestivalStore } from '@festie/shared/stores/festivalStore';
import { OFFLINE_MAP_COPY } from '@festie/shared/constants';
import { buildOfflineSteps, summarizeOffline, festivalPhase, hasOfflineBasemap, extractSiteplan } from '@festie/shared/utils';
import {
  basemapCacheInfo,
  basemapProgress,
  basemapSize,
  basemapSupported,
  ensureBasemapCached,
  removeBasemap,
  subscribeBasemapCache,
} from '../lib/basemapCache';

const IDLE: SectionReadiness = { status: 'idle', syncedAt: null };

/** Offline download state for one festival: the shared store sections plus the web-only map archive. */
export function useOfflineDownload(festivalId: string) {
  const readiness = useOfflineReadinessStore((s) => s.byFestival[festivalId]);
  const downloadingFestivalId = useOfflineReadinessStore((s) => s.downloadingFestivalId);
  const downloadForOffline = useOfflineReadinessStore((s) => s.downloadForOffline);
  const activeCrewId = useCrewStore((s) => s.activeCrew?.id ?? null);
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const days = useFestivalStore((s) => s.days);

  const mapConfig = currentFestival?.id === festivalId ? currentFestival.mapConfig : null;
  const mapUrl = hasOfflineBasemap(mapConfig) && basemapSupported() ? mapConfig.offlineBasemap.pmtilesUrl : null;

  const [mapSection, setMapSection] = useState<SectionReadiness>(IDLE);
  const [mapBytes, setMapBytes] = useState<number | null>(null);
  const [quotaFailure, setQuotaFailure] = useState<{ bytes: number | null; freeBytes: number | null } | null>(null);
  const [mapProgress, setMapProgress] = useState<number | null>(null);

  useEffect(() => {
    if (!mapUrl) return;
    let live = true;
    const read = () =>
      void basemapCacheInfo(mapUrl).then((info) => {
        if (!live) return;
        // A running download keeps "syncing"; its own promise settles the state.
        setMapSection((prev) =>
          prev.status === 'syncing' ? prev : info.cached ? { status: 'ready', syncedAt: info.syncedAt } : IDLE,
        );
      });
    read();
    void basemapSize(mapUrl).then((n) => {
      if (live) setMapBytes(n);
    });
    const unsubscribe = subscribeBasemapCache(() => {
      const running = basemapProgress(mapUrl);
      setMapProgress(running);
      // A running download keeps "syncing" and reports progress often, so re-read the cache only once it ends.
      if (running === null) read();
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [mapUrl]);

  const download = useCallback(async () => {
    const store = downloadForOffline(festivalId, activeCrewId ?? undefined);
    if (!mapUrl) {
      await store;
      return;
    }
    setQuotaFailure(null);
    setMapSection({ status: 'syncing', syncedAt: null });
    // The service worker stores the site-plan overlay as it passes; best effort.
    const siteplanUrl = extractSiteplan(mapConfig)?.imageUrl;
    if (siteplanUrl) void fetch(siteplanUrl).catch(() => undefined);
    const map = ensureBasemapCached(mapUrl).then(async (result) => {
      if (!result.ok && result.reason === 'quota') {
        setQuotaFailure({ bytes: result.bytes, freeBytes: result.freeBytes ?? null });
        if (result.bytes != null) setMapBytes(result.bytes);
      }
      const info = await basemapCacheInfo(mapUrl);
      setMapSection(
        info.cached ? { status: 'ready', syncedAt: info.syncedAt } : { status: 'error', syncedAt: Date.now() },
      );
    });
    await Promise.all([store, map]);
  }, [downloadForOffline, festivalId, activeCrewId, mapUrl, mapConfig]);

  const removeMap = useCallback(async () => {
    if (mapUrl) await removeBasemap(mapUrl);
  }, [mapUrl]);

  // Why the map was not saved. Only while the step is in error, so a later success or reset clears it.
  const mapMessage =
    mapUrl && quotaFailure && mapSection.status === 'error'
      ? quotaFailure.bytes != null
        ? OFFLINE_MAP_COPY.notEnoughSpace(quotaFailure.bytes, quotaFailure.freeBytes)
        : OFFLINE_MAP_COPY.notEnoughSpaceUnknownSize
      : null;

  const steps = buildOfflineSteps(readiness, {
    hasCrew: !!activeCrewId,
    map: mapUrl ? mapSection : null,
  });
  const summary = summarizeOffline(steps, festivalPhase(currentFestival, days));
  const isDownloading = downloadingFestivalId === festivalId || mapSection.status === 'syncing';

  return {
    steps,
    summary,
    download,
    isDownloading,
    mapBytes,
    hasMap: !!mapUrl,
    mapProgress,
    mapReady: mapSection.status === 'ready',
    mapMessage,
    removeMap,
  };
}
