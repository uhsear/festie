import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../services/api', () => ({
  api: { get: vi.fn(), put: vi.fn() },
}));

import { api } from '../services/api';
import { useNotificationPrefsStore, DEFAULT_NOTIFICATION_PREFS } from './notificationPrefsStore';

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };

describe('notificationPrefsStore', () => {
  beforeEach(() => {
    useNotificationPrefsStore.setState({
      prefs: DEFAULT_NOTIFICATION_PREFS,
      loaded: false,
      isLoading: false,
      error: null,
    });
    mockApi.get.mockReset();
    mockApi.put.mockReset();
  });

  it('normalizes 0/1 ints to booleans on load and keeps DND strings', async () => {
    mockApi.get.mockResolvedValue({
      crewUpdates: 1,
      setReminders: 0,
      scheduleChanges: 1,
      dndStart: '23:00',
      dndEnd: '08:00',
    });
    await useNotificationPrefsStore.getState().loadPrefs();
    const p = useNotificationPrefsStore.getState().prefs;
    expect(p.crewUpdates).toBe(true);
    expect(p.setReminders).toBe(false);
    expect(p.scheduleChanges).toBe(true);
    expect(p.dndStart).toBe('23:00');
    expect(p.dndEnd).toBe('08:00');
    expect(useNotificationPrefsStore.getState().loaded).toBe(true);
  });

  it('defaults missing toggles to true', async () => {
    mockApi.get.mockResolvedValue({});
    await useNotificationPrefsStore.getState().loadPrefs();
    const p = useNotificationPrefsStore.getState().prefs;
    expect(p.crewUpdates).toBe(true);
    expect(p.dndStart).toBeNull();
  });

  it('applies updatePrefs optimistically and PUTs the patch', async () => {
    mockApi.put.mockResolvedValue({});
    await useNotificationPrefsStore.getState().updatePrefs({ setReminders: false });
    expect(useNotificationPrefsStore.getState().prefs.setReminders).toBe(false);
    expect(mockApi.put).toHaveBeenCalledWith('/notifications/prefs', { setReminders: false });
  });

  it('rolls back on update failure', async () => {
    mockApi.put.mockRejectedValue(new Error('network down'));
    const before = useNotificationPrefsStore.getState().prefs.crewUpdates;
    await expect(useNotificationPrefsStore.getState().updatePrefs({ crewUpdates: !before })).rejects.toThrow();
    expect(useNotificationPrefsStore.getState().prefs.crewUpdates).toBe(before);
    expect(useNotificationPrefsStore.getState().error).toBeTruthy();
  });
});

describe('notificationPrefsStore quiet-hours zone', () => {

  beforeEach(() => {
    useNotificationPrefsStore.setState({ prefs: DEFAULT_NOTIFICATION_PREFS, loaded: false });
    mockApi.get.mockReset();
    mockApi.put.mockReset();
    mockApi.put.mockResolvedValue({});
  });

  it('sends the device zone when a quiet-hours window is set', async () => {
    const real = Intl.DateTimeFormat().resolvedOptions().timeZone;
    await useNotificationPrefsStore.getState().updatePrefs({ dndStart: '23:00', dndEnd: '08:00' });
    expect(mockApi.put).toHaveBeenCalledWith('/notifications/prefs', {
      dndStart: '23:00',
      dndEnd: '08:00',
      dndTimeZone: real,
    });
  });

  it('re-saves the zone on load when it differs from the device zone', async () => {
    mockApi.get.mockResolvedValue({ dndStart: '23:00', dndEnd: '08:00', dndTimeZone: 'Stale/Zone' });
    const real = Intl.DateTimeFormat().resolvedOptions().timeZone;
    await useNotificationPrefsStore.getState().loadPrefs();
    expect(mockApi.put).toHaveBeenCalledWith('/notifications/prefs', { dndTimeZone: real });
  });

  it('defaults the new prefs and maps an unsupported must-see lead to null', async () => {
    mockApi.get.mockResolvedValue({ mustSeeReminderMinutes: 20 });
    await useNotificationPrefsStore.getState().loadPrefs();
    const p = useNotificationPrefsStore.getState().prefs;
    expect(p.crewMeetingPoints).toBe(true);
    expect(p.crewPolls).toBe(true);
    expect(p.crewMoney).toBe(true);
    expect(p.crewRides).toBe(true);
    expect(p.mustSeeReminderMinutes).toBeNull();
  });

  it('keeps a supported must-see lead', async () => {
    mockApi.get.mockResolvedValue({ mustSeeReminderMinutes: 30 });
    await useNotificationPrefsStore.getState().loadPrefs();
    expect(useNotificationPrefsStore.getState().prefs.mustSeeReminderMinutes).toBe(30);
  });

  it('does not re-save when quiet hours are off', async () => {
    mockApi.get.mockResolvedValue({});
    await useNotificationPrefsStore.getState().loadPrefs();
    expect(mockApi.put).not.toHaveBeenCalled();
  });
});
