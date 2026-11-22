// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAuthStore } from '../stores/authStore';
import { useAnnouncementStore } from '../stores/announcementStore';
import { useLiveLocationStore } from '../stores/liveLocationStore';
import { useUrgentBannerShowing } from './useUrgentBanner';
import type { FestivalAnnouncement, SosEntry } from '../types';

const note = (over: Partial<FestivalAnnouncement> = {}): FestivalAnnouncement => ({
  id: 'a1',
  festivalId: 'f1',
  severity: 'info',
  title: 'Gates open early',
  body: 'Doors at 2 PM.',
  screen: 'home',
  sentAt: '2026-11-01T10:00:00Z',
  ...over,
});

describe('useUrgentBannerShowing', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { id: 'u1', username: 'me' } as never });
    useAnnouncementStore.setState({ items: [], dismissed: [] });
    useLiveLocationStore.setState({ activeSosList: [] });
  });

  it('is false with nothing urgent', () => {
    useAnnouncementStore.setState({ items: [note()] });
    expect(renderHook(() => useUrgentBannerShowing()).result.current).toBe(false);
  });

  it('is true while an urgent announcement shows, false once it is dismissed', () => {
    useAnnouncementStore.setState({ items: [note({ severity: 'urgent' })] });
    expect(renderHook(() => useUrgentBannerShowing()).result.current).toBe(true);
    useAnnouncementStore.setState({ dismissed: ['a1'] });
    expect(renderHook(() => useUrgentBannerShowing()).result.current).toBe(false);
  });

  it('is true while an SOS is active', () => {
    useLiveLocationStore.setState({
      activeSosList: [{ crewId: 'c1', userId: 'u2', username: 'sam', raisedAt: new Date().toISOString() } as SosEntry],
    });
    expect(renderHook(() => useUrgentBannerShowing()).result.current).toBe(true);
  });
});
