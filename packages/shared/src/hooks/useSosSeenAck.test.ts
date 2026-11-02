// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSosSeenAck, resetSosSeenAcks } from './useSosSeenAck';
import { markSosSeen } from '../services/checkin';
import { useAuthStore } from '../stores/authStore';
import { useCrewStore } from '../stores/crewStore';
import { useLiveLocationStore } from '../stores/liveLocationStore';
import type { Crew, SosEntry, User } from '../types';

vi.mock('../services/checkin', () => ({ markSosSeen: vi.fn() }));

const sos = (userId: string): SosEntry => ({ crewId: 'c1', userId, username: userId, raisedAt: '2026-06-06T12:00:00.000Z' });

describe('useSosSeenAck', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(markSosSeen).mockResolvedValue(undefined);
    resetSosSeenAcks();
    useAuthStore.setState({ user: { id: 'me' } as unknown as User });
    useCrewStore.setState({ activeCrew: { id: 'c1' } as unknown as Crew });
    useLiveLocationStore.getState().reset();
    useLiveLocationStore.setState({ crewId: 'c1' });
  });

  it('acks once per SOS and never for the user own SOS', async () => {
    renderHook(() => useSosSeenAck());
    act(() => {
      useLiveLocationStore.getState().applySos(sos('me'));
      useLiveLocationStore.getState().applySos(sos('u2'));
    });
    await waitFor(() => expect(markSosSeen).toHaveBeenCalledTimes(1));
    expect(markSosSeen).toHaveBeenCalledWith('c1', 'u2');
    act(() => useLiveLocationStore.getState().applySos({ ...sos('u2'), message: 'again' }));
    expect(markSosSeen).toHaveBeenCalledTimes(1);
  });

  it('retries after a rejected request', async () => {
    vi.mocked(markSosSeen).mockRejectedValueOnce(new Error('offline'));
    renderHook(() => useSosSeenAck());
    act(() => useLiveLocationStore.getState().applySos(sos('u2')));
    await waitFor(() => expect(markSosSeen).toHaveBeenCalledTimes(1));
    await act(async () => {});
    act(() => useLiveLocationStore.getState().applySos({ ...sos('u2'), message: 'again' }));
    await waitFor(() => expect(markSosSeen).toHaveBeenCalledTimes(2));
  });
});
