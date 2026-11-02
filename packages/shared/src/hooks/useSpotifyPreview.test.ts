import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useSpotifyPreview } from './useSpotifyPreview';
import { api } from '../services/api';
import { useUIStore } from '../stores/uiStore';

vi.mock('../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const ready = { embedType: 'artist', embedUrl: 'https://open.spotify.com/embed/artist/x', artistId: 'x' };

describe('useSpotifyPreview', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    useUIStore.setState({ offlineMode: false });
  });

  it('is none without a set id', () => {
    const { result } = renderHook(() => useSpotifyPreview(undefined));
    expect(result.current).toEqual({ status: 'none', preview: null });
    expect(api.get).not.toHaveBeenCalled();
  });

  it('is ready when the embed is present', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(ready);
    const { result } = renderHook(() => useSpotifyPreview('s1'));
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.preview).toEqual(ready);
    expect(api.get).toHaveBeenCalledWith('/spotify/preview/s1');
  });

  it('is none when embedType is null', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ embedType: null });
    const { result } = renderHook(() => useSpotifyPreview('s1'));
    await waitFor(() => expect(result.current.status).toBe('none'));
    expect(result.current.preview).toBeNull();
  });

  it('is offline without a request when offlineMode is on', () => {
    useUIStore.setState({ offlineMode: true });
    const { result } = renderHook(() => useSpotifyPreview('s1'));
    expect(result.current.status).toBe('offline');
    expect(api.get).not.toHaveBeenCalled();
  });

  it('is offline after a network error and none after another error', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(Object.assign(new Error('net'), { isNetworkError: true }));
    const a = renderHook(() => useSpotifyPreview('s1'));
    await waitFor(() => expect(a.result.current.status).toBe('offline'));
    vi.mocked(api.get).mockRejectedValueOnce(new Error('500'));
    const b = renderHook(() => useSpotifyPreview('s2'));
    await waitFor(() => expect(b.result.current.status).toBe('none'));
  });

  it('fetches again when offlineMode turns false', async () => {
    useUIStore.setState({ offlineMode: true });
    vi.mocked(api.get).mockResolvedValueOnce(ready);
    const { result } = renderHook(() => useSpotifyPreview('s1'));
    expect(result.current.status).toBe('offline');
    act(() => useUIStore.setState({ offlineMode: false }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(api.get).toHaveBeenCalledTimes(1);
  });
});
