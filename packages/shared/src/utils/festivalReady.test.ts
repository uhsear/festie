import { describe, it, expect } from 'vitest';
import type { FestivalReadiness, ReadinessStatus } from '../stores/offlineReadinessStore';
import { countOpenInterests, formatReadyProgress, getFestivalReadyChecklist, isFestivalDownloaded } from './festivalReady';

const none = { pickCount: 0, hasCrew: false, remindersOn: false, offlineReady: false };

const readiness = (schedule: ReadinessStatus, picks: ReadinessStatus): FestivalReadiness => {
  const s = (status: ReadinessStatus) => ({ status, syncedAt: null });
  return { schedule: s(schedule), picks: s(picks), crew: s('idle'), weather: s('idle'), art: s('idle') };
};

describe('interest marks in the checklist', () => {
  const lineup = [{ id: 'lu-a' }, { id: 'lu-b' }];

  it('an open mark on an act in the lineup completes the picks item', () => {
    const interestCount = countOpenInterests({ 'lu-a': { state: 'open' } }, lineup);
    expect(interestCount).toBe(1);
    const r = getFestivalReadyChecklist({ ...none, interestCount, hasLineup: true });
    expect(r.items[0]).toMatchObject({ key: 'picks', done: true, label: 'Mark acts or pick sets' });
  });

  it('a mark on an id missing from the lineup, or a converted mark, does not count', () => {
    expect(countOpenInterests({ 'lu-gone': { state: 'open' } }, lineup)).toBe(0);
    expect(countOpenInterests({ 'lu-a': { state: 'converted', sets: ['s1'] } }, lineup)).toBe(0);
    expect(countOpenInterests(undefined, lineup)).toBe(0);
    const r = getFestivalReadyChecklist({ ...none, interestCount: 0, hasLineup: true });
    expect(r.items[0]?.done).toBe(false);
  });

  it('keeps today\'s label for a festival with no lineup', () => {
    expect(getFestivalReadyChecklist(none).items[0]?.label).toBe('Pick your first sets');
  });
});

describe('getFestivalReadyChecklist', () => {
  it('starts with nothing done, in order', () => {
    const r = getFestivalReadyChecklist(none);
    expect(r.doneCount).toBe(0);
    expect(r.total).toBe(4);
    expect(r.items.map((i) => i.key)).toEqual(['picks', 'crew', 'reminders', 'offline']);
  });

  it.each([
    ['picks', { pickCount: 2 }],
    ['crew', { hasCrew: true }],
    ['reminders', { remindersOn: true }],
    ['offline', { offlineReady: true }],
  ] as const)('%s flag marks only its own item', (key, patch) => {
    const r = getFestivalReadyChecklist({ ...none, ...patch });
    expect(r.doneCount).toBe(1);
    expect(r.items.filter((i) => i.done).map((i) => i.key)).toEqual([key]);
  });

  it('writes a11y strings', () => {
    const r = getFestivalReadyChecklist({ ...none, hasCrew: true });
    expect(r.items[0].a11y).toMatch(/, not done yet$/);
    expect(r.items[1].a11y).toMatch(/, done$/);
  });
});

describe('isFestivalDownloaded', () => {
  it('needs schedule and picks both ready', () => {
    expect(isFestivalDownloaded(undefined)).toBe(false);
    expect(isFestivalDownloaded(readiness('ready', 'idle'))).toBe(false);
    expect(isFestivalDownloaded(readiness('ready', 'ready'))).toBe(true);
  });
});

describe('formatReadyProgress', () => {
  it('formats the count', () => {
    expect(formatReadyProgress(2, 4)).toBe('2 of 4 done');
  });
});
