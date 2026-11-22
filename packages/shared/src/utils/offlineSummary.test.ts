import { describe, it, expect } from 'vitest';
import { buildOfflineSteps, summarizeOffline, offlineStatusLabel, offlineActionLabel } from './offlineSummary';
import type { FestivalReadiness, SectionReadiness } from '../stores/offlineReadinessStore';

const r = (status: SectionReadiness['status'], syncedAt: number | null = status === 'ready' ? 1000 : null): SectionReadiness => ({ status, syncedAt });
const all = (status: SectionReadiness['status']): FestivalReadiness => ({
  schedule: r(status), picks: r(status), crew: r(status), weather: r(status), art: r(status),
});

describe('buildOfflineSteps', () => {
  it('leaves out crew without a crew and map when null', () => {
    const keys = buildOfflineSteps(undefined, { hasCrew: false, map: null }).map((s) => s.key);
    expect(keys).toEqual(['schedule', 'picks', 'weather', 'art']);
  });
  it('adds crew and map in order with map detail', () => {
    const steps = buildOfflineSteps(all('idle'), { hasCrew: true, map: r('idle'), mapDetail: 'x' });
    expect(steps.map((s) => s.key)).toEqual(['schedule', 'picks', 'crew', 'weather', 'art', 'map']);
    expect(steps[5]!.detail).toBe('x');
  });
});

describe('summarizeOffline', () => {
  const steps = (rd: FestivalReadiness | undefined, map: SectionReadiness | null = null) =>
    buildOfflineSteps(rd, { hasCrew: true, map });
  it('all ready is ready with Update', () => {
    const s = summarizeOffline(steps(all('ready')), 'live');
    expect(s.overall).toBe('ready');
    expect(offlineActionLabel(s)).toBe('Update');
    expect(offlineStatusLabel(s, 1000)).toContain('Available offline · synced');
  });
  it('offline, the action asks for a connection unless a download is already running', () => {
    expect(offlineActionLabel(summarizeOffline(steps(all('ready')), 'live'), true)).toBe('Connect to download');
    expect(offlineActionLabel(summarizeOffline(steps(all('syncing')), 'live'), true)).toBe('Downloading…');
  });
  it('map ready alone counts as downloaded', () => {
    const s = summarizeOffline(steps(undefined, r('ready')), 'live');
    expect(s.hasDownloaded).toBe(true);
    expect(s.overall).toBe('partial');
  });
  it('error plus ready is partial with Retry', () => {
    const s = summarizeOffline(steps({ ...all('idle'), schedule: r('ready'), art: r('error') }), 'live');
    expect(s.overall).toBe('partial');
    expect(offlineActionLabel(s)).toBe('Retry');
  });
  it('partial without an error is neutral: counts saved steps and names the pending ones', () => {
    const s = summarizeOffline(steps({ ...all('idle'), schedule: r('ready'), picks: r('ready') }), 'live');
    expect(s.overall).toBe('partial');
    expect(s.hasError).toBe(false);
    expect(s.pending).toEqual(['Crew plan', 'Weather', 'Artist art']);
    expect(offlineStatusLabel(s)).toBe('Download for offline · 2 of 5 saved');
    expect(offlineActionLabel(s)).toBe('Download');
  });
  it('partial with an error keeps the incomplete wording and Retry', () => {
    const s = summarizeOffline(steps({ ...all('idle'), schedule: r('ready'), art: r('error') }), 'live');
    expect(s.hasError).toBe(true);
    expect(offlineStatusLabel(s)).toBe('Offline download incomplete');
  });
  it('any syncing is syncing', () => {
    expect(summarizeOffline(steps({ ...all('ready'), weather: r('syncing') }), 'live').overall).toBe('syncing');
  });
  it('nothing saved is none', () => {
    const s = summarizeOffline(steps(undefined), 'pre');
    expect(s.overall).toBe('none');
    expect(offlineActionLabel(s)).toBe('Download');
    expect(s.lastSyncedAt).toBeNull();
  });
  it('post hides only when nothing saved', () => {
    expect(summarizeOffline(steps(undefined), 'post').hidden).toBe(true);
    expect(summarizeOffline(steps({ ...all('idle'), picks: r('ready') }), 'post').hidden).toBe(false);
  });
});
