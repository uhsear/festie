// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCrewStore } from '../stores/crewStore';
import { useLiveLocationStore } from '../stores/liveLocationStore';
import { useAutoArrive } from './useAutoArrive';
import type { CrewMeetingPoint, CrewMemberStatus } from '../types';

const point = { id: 'p1', label: 'Big tree', latitude: 28.1, longitude: -81.2 } as CrewMeetingPoint;
const mine = {
  crew_id: 'c1',
  user_id: 'me',
  status: 'on-my-way',
  target_meeting_point_id: 'p1',
  eta_minutes: 5,
  note: null,
  updated_at: new Date().toISOString(),
} as CrewMemberStatus;
// 0.0001 degrees of latitude is about 11 m.
const nearby = (extra = 0) => ({ lat: 28.1 + 0.0001 + extra, lng: -81.2 });

describe('useAutoArrive', () => {
  const updateMyStatus = vi.fn().mockResolvedValue('sent');
  const onArrive = vi.fn();

  beforeEach(() => {
    updateMyStatus.mockClear();
    onArrive.mockClear();
    useCrewStore.setState({ crewStatuses: [mine], updateMyStatus } as never);
    useLiveLocationStore.getState().stopSharing();
  });

  const mount = () => renderHook(() => useAutoArrive({ crewId: 'c1', userId: 'me', meetingPoints: [point], onArrive }));

  it('flips to here once when within range while sharing', async () => {
    mount();
    await act(async () => {
      useLiveLocationStore.getState().startSharing('c1');
      useLiveLocationStore.getState().recordSent(nearby(), Date.now());
    });
    expect(updateMyStatus).toHaveBeenCalledTimes(1);
    expect(updateMyStatus.mock.calls[0]![1]).toMatchObject({ status: 'here', targetMeetingPointId: 'p1' });
    expect(onArrive).toHaveBeenCalledWith('Big tree');

    await act(async () => {
      useLiveLocationStore.getState().recordSent(nearby(0.00001), Date.now());
    });
    expect(updateMyStatus).toHaveBeenCalledTimes(1);
  });

  it('does nothing while sharing to another crew', async () => {
    mount();
    await act(async () => {
      useLiveLocationStore.getState().startSharing('other');
      useLiveLocationStore.getState().recordSent(nearby(), Date.now());
    });
    expect(updateMyStatus).not.toHaveBeenCalled();
  });
});
