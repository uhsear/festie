import type { FestivalReadiness, SectionReadiness } from '../stores/offlineReadinessStore';
import type { FestivalPhase } from './festivalTime';
import { timeAgo } from './timeAgo';

export interface OfflineStep { key: string; label: string; section: SectionReadiness; detail?: string }
export type OfflineOverall = 'none' | 'syncing' | 'ready' | 'partial';
export interface OfflineSummary {
  overall: OfflineOverall;
  /** Any step ready, the map step included. */
  hasDownloaded: boolean;
  lastSyncedAt: number | null;
  /** Any step failed. Only this makes a partial download a fault; otherwise steps are just not saved yet. */
  hasError: boolean;
  savedCount: number;
  totalCount: number;
  /** Labels of the steps not saved yet. */
  pending: string[];
  /** Past festival and nothing saved. */
  hidden: boolean;
}

const IDLE: SectionReadiness = { status: 'idle', syncedAt: null };

export function buildOfflineSteps(
  readiness: FestivalReadiness | undefined,
  opts: { hasCrew: boolean; map: SectionReadiness | null; mapDetail?: string },
): OfflineStep[] {
  const sec = (k: keyof FestivalReadiness): SectionReadiness => readiness?.[k] ?? IDLE;
  const steps: OfflineStep[] = [
    { key: 'schedule', label: 'Schedule', section: sec('schedule') },
    { key: 'picks', label: 'My picks', section: sec('picks') },
  ];
  // No crew row without a crew, so a user with no crew can reach "ready".
  if (opts.hasCrew) steps.push({ key: 'crew', label: 'Crew plan', section: sec('crew') });
  steps.push(
    { key: 'weather', label: 'Weather', section: sec('weather') },
    { key: 'art', label: 'Artist art', section: sec('art') },
  );
  if (opts.map) steps.push({ key: 'map', label: 'Offline map', section: opts.map, detail: opts.mapDetail });
  return steps;
}

export function summarizeOffline(steps: OfflineStep[], phase: FestivalPhase | null): OfflineSummary {
  const statuses = steps.map((s) => s.section.status);
  const ready = steps.filter((s) => s.section.status === 'ready');
  const hasDownloaded = ready.length > 0;
  const hasError = statuses.includes('error');
  let overall: OfflineOverall;
  if (statuses.includes('syncing')) overall = 'syncing';
  else if (steps.length > 0 && ready.length === steps.length) overall = 'ready';
  else if (!hasDownloaded && !hasError) overall = 'none';
  else overall = 'partial';
  const synced = ready.map((s) => s.section.syncedAt).filter((t): t is number => t != null);
  return {
    overall,
    hasDownloaded,
    lastSyncedAt: synced.length ? Math.max(...synced) : null,
    hasError,
    savedCount: ready.length,
    totalCount: steps.length,
    pending: steps.filter((s) => s.section.status !== 'ready').map((s) => s.label),
    hidden: phase === 'post' && !hasDownloaded && overall !== 'syncing',
  };
}

// timeAgo reads Date.now(); shift the stamp so a caller-supplied clock gives the same delta.
function agoFrom(ms: number, nowMs?: number): string {
  return timeAgo(nowMs == null ? ms : ms + (Date.now() - nowMs));
}

/**
 * `hasMap` false: the download saves schedule, picks and crew but no map, so an offer to
 * "download for offline" on an unmapped festival's Map screen would read as a map download.
 */
export function offlineStatusLabel(summary: OfflineSummary, nowMs?: number, hasMap = true): string {
  const offer = hasMap ? 'Download for offline' : 'Save schedule offline';
  switch (summary.overall) {
    case 'syncing': return 'Downloading for offline…';
    case 'ready': {
      const ago = summary.lastSyncedAt == null ? 'just now' : agoFrom(summary.lastSyncedAt, nowMs);
      return `Available offline · synced ${ago}`;
    }
    case 'partial':
      return summary.hasError
        ? 'Offline download incomplete'
        : `${offer} · ${summary.savedCount} of ${summary.totalCount} saved`;
    default: return offer;
  }
}

/** Downloading needs signal, so offline the action says so instead of failing every step. */
export function offlineActionLabel(summary: OfflineSummary, offline = false): string {
  if (offline && summary.overall !== 'syncing') return 'Connect to download';
  switch (summary.overall) {
    case 'syncing': return 'Downloading…';
    case 'ready': return 'Update';
    case 'partial': return summary.hasError ? 'Retry' : 'Download';
    default: return 'Download';
  }
}
