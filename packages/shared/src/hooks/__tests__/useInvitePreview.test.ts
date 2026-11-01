import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useInvitePreview } from '../useInvitePreview';
import { api } from '../../services/api';

vi.mock('../../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const preview = {
  crewName: 'Tent 9',
  ownerName: 'asir',
  memberCount: 2,
  maxMembers: 30,
  spotsLeft: 28,
  festivalId: 'f1',
  festivalName: 'EDC',
  startDate: null,
  endDate: null,
  expiresAt: null,
};

describe('useInvitePreview', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it('makes no request without a code', () => {
    const { result } = renderHook(() => useInvitePreview(null));
    expect(result.current).toEqual({ status: 'loading', preview: null });
    expect(api.get).not.toHaveBeenCalled();
  });

  it('is ready on success', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(preview);
    const { result } = renderHook(() => useInvitePreview('ABC123'));
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.preview).toEqual(preview);
    expect(api.get).toHaveBeenCalledWith('/crews/join-preview/ABC123');
  });

  it('is expired on 410', async () => {
    vi.mocked(api.get).mockRejectedValueOnce({ status: 410 });
    const { result } = renderHook(() => useInvitePreview('ABC123'));
    await waitFor(() => expect(result.current.status).toBe('expired'));
  });

  it('is unreachable on a network error', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useInvitePreview('ABC123'));
    await waitFor(() => expect(result.current.status).toBe('unreachable'));
  });

  it('reads as loading again when the code changes', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(preview);
    const { result, rerender } = renderHook(({ code }) => useInvitePreview(code), {
      initialProps: { code: 'ABC123' },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    vi.mocked(api.get).mockReturnValueOnce(new Promise(() => {}));
    rerender({ code: 'XYZ789' });
    expect(result.current).toEqual({ status: 'loading', preview: null });
  });

  it('does not update state after unmount', async () => {
    let resolve: (v: typeof preview) => void = () => {};
    vi.mocked(api.get).mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = renderHook(() => useInvitePreview('ABC123'));
    unmount();
    resolve(preview);
    await Promise.resolve();
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
