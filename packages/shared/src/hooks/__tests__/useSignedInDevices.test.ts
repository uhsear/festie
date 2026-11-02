import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useSignedInDevices, deviceSubtitle, deviceTitle } from '../useSignedInDevices';
import { api } from '../../services/api';
import { ACCOUNT_COPY } from '../../constants/accountCopy';

vi.mock('../../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  setAuthToken: vi.fn(),
  clearAuthToken: vi.fn(),
  getAuthToken: vi.fn(),
  getApiBase: vi.fn(() => '/api/v1'),
}));

const rows = [
  { id: 'a', device: 'Chrome on Windows', createdAt: '2026-10-01T00:00:00Z', lastAccess: '2026-10-02T00:00:00Z', current: false },
  { id: 'b', device: null, createdAt: '2026-10-01T00:00:00Z', lastAccess: '2026-10-05T00:00:00Z', current: false },
  { id: 'c', device: 'Festie app on iOS', createdAt: '2026-09-01T00:00:00Z', lastAccess: '2026-09-02T00:00:00Z', current: true },
];

describe('useSignedInDevices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue(rows);
    vi.mocked(api.delete).mockResolvedValue(undefined);
  });

  it('sorts current first then newest first', async () => {
    const { result } = renderHook(() => useSignedInDevices());
    await waitFor(() => expect(result.current.devices).toHaveLength(3));
    expect(result.current.devices.map((d) => d.id)).toEqual(['c', 'b', 'a']);
    expect(api.get).toHaveBeenCalledWith('/auth/sessions');
  });

  it('does not fetch when disabled', () => {
    renderHook(() => useSignedInDevices(false));
    expect(api.get).not.toHaveBeenCalled();
  });

  it('signOut removes one row', async () => {
    const { result } = renderHook(() => useSignedInDevices());
    await waitFor(() => expect(result.current.devices).toHaveLength(3));
    await act(async () => {
      await result.current.signOut('a');
    });
    expect(api.delete).toHaveBeenCalledWith('/auth/sessions/a');
    expect(result.current.devices.map((d) => d.id)).toEqual(['c', 'b']);
  });

  it('signOutOthers keeps only the current row', async () => {
    const { result } = renderHook(() => useSignedInDevices());
    await waitFor(() => expect(result.current.devices).toHaveLength(3));
    await act(async () => {
      await result.current.signOutOthers();
    });
    expect(api.delete).toHaveBeenCalledWith('/auth/sessions');
    expect(result.current.devices.map((d) => d.id)).toEqual(['c']);
  });

  it('sets a mapped error when the load fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useSignedInDevices());
    await waitFor(() => expect(result.current.error).toBe('boom'));
    expect(result.current.devices).toEqual([]);
  });

  it('titles and subtitles', () => {
    expect(deviceSubtitle(rows[2])).toBe('This device');
    expect(deviceSubtitle(rows[0])).toMatch(/^Last active \d+d ago$/);
    expect(deviceTitle(rows[1])).toBe(ACCOUNT_COPY.unknownDevice);
  });
});
