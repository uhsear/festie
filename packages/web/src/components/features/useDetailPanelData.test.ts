import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { FestivalSet, Profile } from '@festie/shared/types';
import { useFestivalStore } from '@festie/shared/stores/festivalStore';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import { useDetailPanelData } from './useDetailPanelData';

const set = { id: 'set-1', artist: 'Alpha', stageId: 'main', startTime: '10:00', endTime: '11:00' } as FestivalSet;
const me: Profile = { id: 'p-me', userId: 'u-me', festivalId: 'f1', picks: {}, notes: {}, updatedAt: '' };
// A non-crew attendee arrives with empty picks: the server sends picks only to crew mates.
const stranger: Profile = { id: 'p-x', userId: 'u-x', festivalId: 'f1', name: 'Xan', picks: {}, notes: {}, updatedAt: '' };

describe('useDetailPanelData whoTitle', () => {
  beforeEach(() => {
    useCrewStore.setState({ activeCrew: null });
    useFestivalStore.setState({ currentProfile: me, allProfiles: [me, stranger], sets: [set], pickCounts: {} });
  });

  it('shows the anonymous count when no crew mate picked the set', () => {
    useFestivalStore.setState({ pickCounts: { 'set-1': 5 } });
    const { result } = renderHook(() => useDetailPanelData(set));
    expect(result.current.others).toEqual([]);
    expect(result.current.whoTitle).toBe('5 going');
  });

  it('names crew mates who picked the set', () => {
    const mate: Profile = { ...stranger, id: 'p-m', name: 'Mo', picks: { 'set-1': 'must' } };
    useFestivalStore.setState({ allProfiles: [me, mate], pickCounts: { 'set-1': 5 } });
    const { result } = renderHook(() => useDetailPanelData(set));
    expect(result.current.whoTitle).toBe("Who's Going (1)");
  });

  it('says nobody when the count is zero or missing', () => {
    const { result } = renderHook(() => useDetailPanelData(set));
    expect(result.current.whoTitle).toBe('Nobody else going yet');
  });

  it('names the crew of the selected festival', () => {
    const mate: Profile = { ...stranger, id: 'p-m', userId: 'u-m', name: 'Mo', picks: { 'set-1': 'must' } };
    useFestivalStore.setState({ currentFestivalId: 'f1', allProfiles: [me, mate] });
    useCrewStore.setState({
      activeCrew: { id: 'c1', name: 'Orchard Crew', festivalId: 'f1' } as never,
      crewMembers: [{ userId: 'u-m' }] as never,
    });
    const { result } = renderHook(() => useDetailPanelData(set));
    expect(result.current.whoTitle).toBe('Orchard Crew (1 going)');
  });

  it('ignores a crew of another festival', () => {
    useFestivalStore.setState({ currentFestivalId: 'f1', pickCounts: { 'set-1': 5 } });
    useCrewStore.setState({
      activeCrew: { id: 'c2', name: 'Design Squad', festivalId: 'other' } as never,
      crewMembers: [],
    });
    const { result } = renderHook(() => useDetailPanelData(set));
    expect(result.current.whoTitle).toBe('5 going');
  });
});
