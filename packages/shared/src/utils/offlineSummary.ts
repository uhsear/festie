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
  let overall: OfflineOverall;
  if (statuses.includes('syncing')) overall = 'syncing';
  else if (steps.length > 0 && ready.length === steps.length) overall = 'ready';
  else if (!hasDownloaded && !statuses.includes('error')) overall = 'none';
  else overall = 'partial';
  const synced = ready.map((s) => s.section.syncedAt).filter((t): t is number => t != null);
  return {
    overall,
    hasDownloaded,
    lastSyncedAt: synced.length ? Math.max(...synced) : null,
    hidden: phase === 'post' && !hasDownloaded && overall !== 'syncing',
  };
}

// timeAgo reads Date.now(); shift the stamp so a caller-supplied clock gives the same delta.
function agoFrom(ms: number, nowMs?: number): string {
  return timeAgo(nowMs == null ? ms : ms + (Date.now() - nowMs));
}

export function offlineStatusLabel(summary: OfflineSummary, nowMs?: number): string {
  switch (summary.overall) {
    case 'syncing': return 'Downloading for offline…';
    case 'ready': {
      const ago = summary.lastSyncedAt == null ? 'just now' : agoFrom(summary.lastSyncedAt, nowMs);
      return `Available offline · synced ${ago}`;
    }
    case 'partial': return 'Offline download incomplete';
    default: return 'Download for offline';
  }
}

export function offlineActionLabel(summary: OfflineSummary): string {
  switch (summary.overall) {
    case 'syncing': return 'Downloading…';
    case 'ready': return 'Update';
    case 'partial': return 'Retry';
    default: return 'Download';
  }
}
