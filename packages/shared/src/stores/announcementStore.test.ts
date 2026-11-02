import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAnnouncementStore } from './announcementStore';
import { announcementsApi } from '../services/announcements';
import type { FestivalAnnouncement } from '../types/announcement';

vi.mock('../services/announcements', () => ({
  announcementsApi: { list: vi.fn() },
}));

const list = vi.mocked(announcementsApi.list);

const item = (id: string): FestivalAnnouncement => ({
  id,
  festivalId: 'f1',
  severity: 'info',
  title: 't',
  body: 'b',
  screen: 'home',
  sentAt: '2026-11-01T10:00:00Z',
});

describe('announcementStore', () => {
  beforeEach(() => {
    list.mockReset();
    localStorage.clear();
    useAnnouncementStore.setState({ festivalId: null, items: [], dismissed: [] });
  });

  it('load sets items and festivalId', async () => {
    list.mockResolvedValue([item('a')]);
    await useAnnouncementStore.getState().load('f1');
    expect(list).toHaveBeenCalledWith('f1');
    expect(useAnnouncementStore.getState().items).toEqual([item('a')]);
    expect(useAnnouncementStore.getState().festivalId).toBe('f1');
  });

  it('a failed load keeps old items and warns', async () => {
    list.mockResolvedValueOnce([item('a')]);
    await useAnnouncementStore.getState().load('f1');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = new Error('down');
    list.mockRejectedValueOnce(err);
    await useAnnouncementStore.getState().load('f1');
    expect(useAnnouncementStore.getState().items).toEqual([item('a')]);
    expect(warn).toHaveBeenCalledWith('announcements: load failed', err);
    warn.mockRestore();
  });

  it('switching festival clears old items, even when the fetch fails', async () => {
    list.mockResolvedValueOnce([item('a')]);
    await useAnnouncementStore.getState().load('f1');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    list.mockRejectedValueOnce(new Error('offline'));
    await useAnnouncementStore.getState().load('f2');
    expect(useAnnouncementStore.getState().festivalId).toBe('f2');
    expect(useAnnouncementStore.getState().items).toEqual([]);
    warn.mockRestore();
  });

  it('a late response for the previous festival does not overwrite the current one', async () => {
    let resolveA!: (v: FestivalAnnouncement[]) => void;
    list.mockReturnValueOnce(new Promise((r) => (resolveA = r)));
    list.mockResolvedValueOnce([item('b')]);
    const loadA = useAnnouncementStore.getState().load('f1');
    await useAnnouncementStore.getState().load('f2');
    resolveA([item('a')]);
    await loadA;
    expect(useAnnouncementStore.getState().festivalId).toBe('f2');
    expect(useAnnouncementStore.getState().items).toEqual([item('b')]);
  });

  it('load(null) clears items without fetching', async () => {
    useAnnouncementStore.setState({ festivalId: 'f1', items: [item('a')] });
    await useAnnouncementStore.getState().load(null);
    expect(useAnnouncementStore.getState().items).toEqual([]);
    expect(list).not.toHaveBeenCalled();
  });

  it('dismiss persists and keeps the newest 50 ids', () => {
    for (let i = 0; i < 55; i++) useAnnouncementStore.getState().dismiss(`id${i}`);
    const { dismissed } = useAnnouncementStore.getState();
    expect(dismissed).toHaveLength(50);
    expect(dismissed[0]).toBe('id5');
    expect(dismissed[49]).toBe('id54');
    const saved = JSON.parse(localStorage.getItem('festie-announcements')!);
    expect(saved.state.dismissed).toEqual(dismissed);
  });

  it('persists only dismissed', async () => {
    list.mockResolvedValue([item('a')]);
    await useAnnouncementStore.getState().load('f1');
    useAnnouncementStore.getState().dismiss('a');
    const saved = JSON.parse(localStorage.getItem('festie-announcements')!);
    expect(Object.keys(saved.state)).toEqual(['dismissed']);
  });
});
