import { useCallback, useEffect, useState } from 'react';
import { useOfflineReadinessStore } from '@festie/shared/stores/offlineReadinessStore';
import type { SectionReadiness } from '@festie/shared/stores/offlineReadinessStore';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import { useFestivalStore } from '@festie/shared/stores/festivalStore';
import { buildOfflineSteps, summarizeOffline, festivalPhase, hasOfflineBasemap } from '@festie/shared/utils';
import {
  basemapCacheInfo,
  basemapSize,
  basemapSupported,
  ensureBasemapCached,
  subscribeBasemapCache,
} from '../lib/basemapCache';

const IDLE: SectionReadiness = { status: 'idle', syncedAt: null };

const toMb = (bytes: number) => Math.max(1, Math.round(bytes / 1_000_000));

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
  const [quotaFailed, setQuotaFailed] = useState(false);

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
    const unsubscribe = subscribeBasemapCache(read);
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
    setQuotaFailed(false);
    setMapSection({ status: 'syncing', syncedAt: null });
    const map = ensureBasemapCached(mapUrl).then(async (result) => {
      if (!result.ok && result.reason === 'quota') {
        setQuotaFailed(true);
        if (result.bytes != null) setMapBytes(result.bytes);
      }
      const info = await basemapCacheInfo(mapUrl);
      setMapSection(
        info.cached ? { status: 'ready', syncedAt: info.syncedAt } : { status: 'error', syncedAt: Date.now() },
      );
    });
    await Promise.all([store, map]);
  }, [downloadForOffline, festivalId, activeCrewId, mapUrl]);

  const mapDetail =
    quotaFailed && mapSection.status === 'error'
      ? `Not enough space for the map (${mapBytes != null ? toMb(mapBytes) : '?'} MB). Free up space, then retry.`
      : undefined;

  const steps = buildOfflineSteps(readiness, {
    hasCrew: !!activeCrewId,
    map: mapUrl ? mapSection : null,
    mapDetail,
  });
  const summary = summarizeOffline(steps, festivalPhase(currentFestival, days));
  const isDownloading = downloadingFestivalId === festivalId || mapSection.status === 'syncing';

  return { steps, summary, download, isDownloading, mapBytes, hasMap: !!mapUrl };
}
