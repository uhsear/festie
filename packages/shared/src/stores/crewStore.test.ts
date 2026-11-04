import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useCrewStore, parseActivityPage } from './crewStore';
import { useAuthStore } from './authStore';
import { api } from '../services/api';
import type { Crew, CrewMember, CrewMemberStatus, CrewPoll, PollSetRef } from '../types/domain';

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockCrew: Crew = {
  id: 'crew-1',
  name: 'Test Crew',
  owner: 'user-1',
  members: [],
  inviteCode: 'ABC123',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockMembers: CrewMember[] = [
  { userId: 'user-1', name: 'Alice', role: 'owner' },
  { userId: 'user-2', name: 'Bob', role: 'member' },
];

function resetStore() {
  useCrewStore.setState({
    crews: [],
    activeCrew: null,
    crewMembers: [],
    crewOverlap: {},
    polls: [],
    meetingPoints: [],
    expenses: [],
    expenseBalances: [],
    expenseCurrency: 'USD',
    packingItems: [],
    rideOffers: [],
    activity: [],
    crewLoading: false,
    error: null,
    _cachedAt: null,
    _cachedCrewId: null,
  });
}

describe('crewStore', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('starts with empty crews', () => {
      expect(useCrewStore.getState().crews).toEqual([]);
    });

    it('starts with null activeCrew', () => {
      expect(useCrewStore.getState().activeCrew).toBeNull();
    });

    it('starts with empty crewMembers', () => {
      expect(useCrewStore.getState().crewMembers).toEqual([]);
    });

    it('starts with empty crewOverlap', () => {
      expect(useCrewStore.getState().crewOverlap).toEqual({});
    });

    it('starts not loading', () => {
      expect(useCrewStore.getState().crewLoading).toBe(false);
    });

    it('starts with null error', () => {
      expect(useCrewStore.getState().error).toBeNull();
    });
  });

  describe('crew lock and Plan B', () => {
    it('setCrewLocked merges inviteLocked into activeCrew and crews', async () => {
      useCrewStore.setState({ crews: [mockCrew], activeCrew: mockCrew });
      vi.mocked(api.put).mockResolvedValueOnce({ ...mockCrew, inviteLocked: true });
      const crew = await useCrewStore.getState().setCrewLocked('crew-1', true);
      expect(api.put).toHaveBeenCalledWith('/crews/crew-1', { inviteLocked: true });
      expect(crew.inviteLocked).toBe(true);
      expect(useCrewStore.getState().activeCrew?.inviteLocked).toBe(true);
      expect(useCrewStore.getState().crews[0]?.inviteLocked).toBe(true);
    });

    it('applyHomeBaseUpdate keeps Plan B without a planB key and clears it on null', () => {
      const withPlanB = { ...mockCrew, homeBasePlanB: 'Top of the hour' };
      useCrewStore.setState({ crews: [withPlanB], activeCrew: withPlanB });
      useCrewStore.getState().applyHomeBaseUpdate('crew-1', { location: 'Gate', time: null });
      expect(useCrewStore.getState().activeCrew?.homeBasePlanB).toBe('Top of the hour');
      expect(useCrewStore.getState().crews[0]?.homeBasePlanB).toBe('Top of the hour');
      useCrewStore.getState().applyHomeBaseUpdate('crew-1', { location: 'Gate', time: null, planB: null });
      expect(useCrewStore.getState().activeCrew?.homeBasePlanB).toBeNull();
      expect(useCrewStore.getState().crews[0]?.homeBasePlanB).toBeNull();
    });
  });

  describe('updateHomeBase outcome', () => {
    const payload = { location: 'Gate', time: null };
    it('returns sent and merges the returned crew', async () => {
      useCrewStore.setState({ crews: [mockCrew], activeCrew: mockCrew });
      vi.mocked(api.put).mockResolvedValueOnce({ crew: { ...mockCrew, homeBaseLocation: 'Gate' } });
      await expect(useCrewStore.getState().updateHomeBase('crew-1', payload)).resolves.toBe('sent');
      expect(useCrewStore.getState().activeCrew).toMatchObject({ homeBaseLocation: 'Gate' });
    });

    it('returns queued and leaves the crew untouched when saved offline', async () => {
      useCrewStore.setState({ crews: [mockCrew], activeCrew: mockCrew });
      vi.mocked(api.put).mockResolvedValueOnce({ ...payload, _optimistic: true });
      await expect(useCrewStore.getState().updateHomeBase('crew-1', payload)).resolves.toBe('queued');
      expect(useCrewStore.getState().activeCrew).toEqual(mockCrew);
    });
  });

  describe('loadCrews', () => {
    it('sets crewLoading true then false on success', async () => {
      vi.mocked(api.get).mockResolvedValueOnce([mockCrew]);
      await useCrewStore.getState().loadCrews();
      expect(useCrewStore.getState().crewLoading).toBe(false);
      expect(useCrewStore.getState().crews).toEqual([mockCrew]);
    });

    it('sets error and throws on failure', async () => {
      vi.mocked(api.get).mockRejectedValueOnce(new Error('Network error'));
      await expect(useCrewStore.getState().loadCrews()).rejects.toThrow('Network error');
      expect(useCrewStore.getState().error).toBe('Network error');
      expect(useCrewStore.getState().crewLoading).toBe(false);
    });

    it('clears previous error on load', async () => {
      useCrewStore.setState({ error: 'old error' });
      vi.mocked(api.get).mockResolvedValueOnce([]);
      await useCrewStore.getState().loadCrews();
      expect(useCrewStore.getState().error).toBeNull();
    });

    it('handles non-Error thrown values', async () => {
      vi.mocked(api.get).mockRejectedValueOnce('string error');
      await expect(useCrewStore.getState().loadCrews()).rejects.toBe('string error');
      expect(useCrewStore.getState().error).toBe('Failed to load crews');
    });
  });

  describe('selectCrew', () => {
    it('clears a different crew before fetching', async () => {
      useCrewStore.setState({
        activeCrew: { ...mockCrew, id: 'crew-old' },
        crewMembers: mockMembers,
      });
      vi.mocked(api.get).mockResolvedValueOnce({ ...mockCrew, members: mockMembers });
      const promise = useCrewStore.getState().selectCrew('crew-1');
      // A different crew must never remain visible while the new one loads.
      expect(useCrewStore.getState().activeCrew).toBeNull();
      expect(useCrewStore.getState().crewMembers).toEqual([]);
      await promise;
    });

    it('sets activeCrew and members on success', async () => {
      vi.mocked(api.get).mockResolvedValueOnce({ ...mockCrew, members: mockMembers });
      await useCrewStore.getState().selectCrew('crew-1');
      expect(useCrewStore.getState().activeCrew).toEqual({ ...mockCrew, members: mockMembers });
      expect(useCrewStore.getState().crewMembers).toEqual(mockMembers);
      expect(useCrewStore.getState().crewLoading).toBe(false);
    });

    it('keeps the active crew when same-crew revalidation fails', async () => {
      useCrewStore.setState({
        activeCrew: mockCrew,
        crewMembers: mockMembers,
        _cachedAt: null,
        _cachedCrewId: null,
      });
      vi.mocked(api.get).mockRejectedValueOnce(new Error('Rate limited'));

      const refresh = useCrewStore.getState().selectCrew(mockCrew.id);
      expect(useCrewStore.getState().activeCrew).toEqual(mockCrew);
      expect(useCrewStore.getState().crewMembers).toEqual(mockMembers);

      await expect(refresh).rejects.toThrow('Rate limited');
      expect(useCrewStore.getState().activeCrew).toEqual(mockCrew);
      expect(useCrewStore.getState().crewMembers).toEqual(mockMembers);
    });

    it('handles missing members gracefully', async () => {
      vi.mocked(api.get).mockResolvedValueOnce({ ...mockCrew });
      await useCrewStore.getState().selectCrew('crew-1');
      expect(useCrewStore.getState().crewMembers).toEqual([]);
    });

    it('sets error on failure', async () => {
      vi.mocked(api.get).mockRejectedValueOnce(new Error('Not found'));
      await expect(useCrewStore.getState().selectCrew('crew-1')).rejects.toThrow();
      expect(useCrewStore.getState().error).toBe('Not found');
    });

    it('handles non-Error thrown values', async () => {
      vi.mocked(api.get).mockRejectedValueOnce('string error');
      await expect(useCrewStore.getState().selectCrew('crew-1')).rejects.toBe('string error');
      expect(useCrewStore.getState().error).toBe('Failed to load crew');
    });
  });

  describe('createCrew', () => {
    it('adds crew to list and sets as active', async () => {
      const crewWithMembers = {
        ...mockCrew,
        members: [{ id: 'cm-1', userId: 'user-1', name: 'Alice', role: 'owner' as const }],
      };
      vi.mocked(api.post).mockResolvedValueOnce(crewWithMembers);
      const result = await useCrewStore.getState().createCrew({ name: 'Test Crew' });
      expect(result).toEqual(crewWithMembers);
      expect(useCrewStore.getState().crews).toHaveLength(1);
      expect(useCrewStore.getState().activeCrew).toEqual(crewWithMembers);
      expect(useCrewStore.getState().crewMembers[0]!.role).toBe('owner');
    });

    it('throws on failure', async () => {
      vi.mocked(api.post).mockRejectedValueOnce(new Error('Create failed'));
      await expect(useCrewStore.getState().createCrew({ name: 'Fail' })).rejects.toThrow();
      expect(useCrewStore.getState().error).toBe('Create failed');
    });

    it('handles non-Error thrown values', async () => {
      vi.mocked(api.post).mockRejectedValueOnce('string error');
      await expect(useCrewStore.getState().createCrew({ name: 'Fail' })).rejects.toBe('string error');
      expect(useCrewStore.getState().error).toBe('Failed to create crew');
    });
  });

  describe('joinByCode', () => {
    it('adds crew to list on success', async () => {
      vi.mocked(api.post).mockResolvedValueOnce(mockCrew);
      await useCrewStore.getState().joinByCode({ inviteCode: 'ABC123' });
      expect(useCrewStore.getState().crews).toHaveLength(1);
    });

    it('returns the crew online', async () => {
      vi.mocked(api.post).mockResolvedValueOnce(mockCrew);
      await expect(useCrewStore.getState().joinByCode({ inviteCode: 'ABC123' })).resolves.toEqual(mockCrew);
    });

    it('does not add an alreadyMember crew twice', async () => {
      useCrewStore.setState({ crews: [mockCrew] });
      vi.mocked(api.post).mockResolvedValueOnce({ ...mockCrew, alreadyMember: true });
      await useCrewStore.getState().joinByCode({ inviteCode: 'ABC123' });
      expect(useCrewStore.getState().crews).toHaveLength(1);
    });

    it('returns null when the join is queued offline', async () => {
      vi.mocked(api.post).mockImplementationOnce(async (_p, body, opts) => {
        (opts as { onOptimisticCreate: (r: unknown) => void }).onOptimisticCreate({ ...(body as object), id: 'tmp' });
        return { id: 'tmp' };
      });
      await expect(useCrewStore.getState().joinByCode({ inviteCode: 'ABC123' })).resolves.toBeNull();
      expect(useCrewStore.getState().crews[0]?._optimistic).toBe(true);
    });

    it('throws on failure', async () => {
      vi.mocked(api.post).mockRejectedValueOnce(new Error('Invalid code'));
      await expect(useCrewStore.getState().joinByCode({ inviteCode: 'BAD' })).rejects.toThrow();
      expect(useCrewStore.getState().error).toBe('Invalid code');
    });

    it('handles non-Error thrown values', async () => {
      vi.mocked(api.post).mockRejectedValueOnce('string error');
      await expect(useCrewStore.getState().joinByCode({ inviteCode: 'BAD' })).rejects.toBe('string error');
      expect(useCrewStore.getState().error).toBe('Failed to join crew');
    });
  });

  describe('leaveCrew', () => {
    it('removes crew from list and clears activeCrew if matching', async () => {
      useCrewStore.setState({
        crews: [mockCrew],
        activeCrew: mockCrew,
        crewMembers: mockMembers,
      });
      vi.mocked(api.delete).mockResolvedValueOnce(undefined);
      await useCrewStore.getState().leaveCrew('crew-1');
      expect(useCrewStore.getState().crews).toHaveLength(0);
      expect(useCrewStore.getState().activeCrew).toBeNull();
      expect(useCrewStore.getState().crewMembers).toEqual([]);
    });

    it('keeps activeCrew if leaving a different crew', async () => {
      const otherCrew = { ...mockCrew, id: 'crew-2', name: 'Other' };
      useCrewStore.setState({
        crews: [mockCrew, otherCrew],
        activeCrew: mockCrew,
        crewMembers: mockMembers,
      });
      vi.mocked(api.delete).mockResolvedValueOnce(undefined);
      await useCrewStore.getState().leaveCrew('crew-2');
      expect(useCrewStore.getState().crews).toHaveLength(1);
      expect(useCrewStore.getState().activeCrew).toEqual(mockCrew);
    });

    it('sets error and throws on failure', async () => {
      vi.mocked(api.delete).mockRejectedValueOnce(new Error('Cannot leave'));
      await expect(useCrewStore.getState().leaveCrew('crew-1')).rejects.toThrow('Cannot leave');
      expect(useCrewStore.getState().error).toBe('Cannot leave');
    });

    it('handles non-Error thrown values', async () => {
      vi.mocked(api.delete).mockRejectedValueOnce('string error');
      await expect(useCrewStore.getState().leaveCrew('crew-1')).rejects.toBe('string error');
      expect(useCrewStore.getState().error).toBe('Failed to leave crew');
    });
  });

  describe('kickMember', () => {
    it('removes member from crewMembers list', async () => {
      useCrewStore.setState({ crewMembers: mockMembers });
      vi.mocked(api.delete).mockResolvedValueOnce(undefined);
      await useCrewStore.getState().kickMember('crew-1', 'user-2');
      expect(useCrewStore.getState().crewMembers).toHaveLength(1);
      expect(useCrewStore.getState().crewMembers[0]!.userId).toBe('user-1');
    });

    it('sets error and throws on failure', async () => {
      vi.mocked(api.delete).mockRejectedValueOnce(new Error('Not allowed'));
      await expect(useCrewStore.getState().kickMember('crew-1', 'cm-2')).rejects.toThrow('Not allowed');
      expect(useCrewStore.getState().error).toBe('Not allowed');
    });

    it('handles non-Error thrown values', async () => {
      vi.mocked(api.delete).mockRejectedValueOnce('string error');
      await expect(useCrewStore.getState().kickMember('crew-1', 'cm-2')).rejects.toBe('string error');
      expect(useCrewStore.getState().error).toBe('Failed to kick member');
    });
  });

  describe('transferOwnership', () => {
    it('updates roles after transfer', async () => {
      useCrewStore.setState({ crewMembers: mockMembers });
      vi.mocked(api.put).mockResolvedValueOnce(undefined);
      await useCrewStore.getState().transferOwnership('crew-1', 'user-2');
      const members = useCrewStore.getState().crewMembers;
      expect(members.find((m) => m.userId === 'user-2')!.role).toBe('owner');
      expect(members.find((m) => m.userId === 'user-1')!.role).toBe('member');
    });

    it('sets error and throws on failure', async () => {
      vi.mocked(api.put).mockRejectedValueOnce(new Error('Transfer denied'));
      await expect(useCrewStore.getState().transferOwnership('crew-1', 'cm-2')).rejects.toThrow('Transfer denied');
      expect(useCrewStore.getState().error).toBe('Transfer denied');
    });

    it('handles non-Error thrown values', async () => {
      vi.mocked(api.put).mockRejectedValueOnce('string error');
      await expect(useCrewStore.getState().transferOwnership('crew-1', 'cm-2')).rejects.toBe('string error');
      expect(useCrewStore.getState().error).toBe('Failed to transfer ownership');
    });
  });

  describe('regenerateInvite', () => {
    it('updates activeCrew inviteCode', async () => {
      useCrewStore.setState({ activeCrew: mockCrew });
      vi.mocked(api.post).mockResolvedValueOnce({ inviteCode: 'NEW456' });
      const code = await useCrewStore.getState().regenerateInvite('crew-1');
      expect(code).toBe('NEW456');
      expect(useCrewStore.getState().activeCrew!.inviteCode).toBe('NEW456');
    });

    it('refreshes inviteExpiresAt from the response', async () => {
      useCrewStore.setState({ activeCrew: { ...mockCrew, inviteExpiresAt: '2020-01-01T00:00:00.000Z' } });
      vi.mocked(api.post).mockResolvedValueOnce({ inviteCode: 'NEW456', inviteExpiresAt: '2099-01-08T00:00:00.000Z' });
      await useCrewStore.getState().regenerateInvite('crew-1');
      expect(useCrewStore.getState().activeCrew!.inviteExpiresAt).toBe('2099-01-08T00:00:00.000Z');
    });

    it('leaves activeCrew null if no active crew', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({ inviteCode: 'NEW456' });
      await useCrewStore.getState().regenerateInvite('crew-1');
      expect(useCrewStore.getState().activeCrew).toBeNull();
    });

    it('sets error and throws on failure', async () => {
      vi.mocked(api.post).mockRejectedValueOnce(new Error('Forbidden'));
      await expect(useCrewStore.getState().regenerateInvite('crew-1')).rejects.toThrow('Forbidden');
      expect(useCrewStore.getState().error).toBe('Forbidden');
    });

    it('handles non-Error thrown values', async () => {
      vi.mocked(api.post).mockRejectedValueOnce('string error');
      await expect(useCrewStore.getState().regenerateInvite('crew-1')).rejects.toBe('string error');
      expect(useCrewStore.getState().error).toBe('Failed to regenerate invite');
    });
  });

  describe('deleteCrew', () => {
    it('removes crew from list and clears activeCrew if matching', async () => {
      useCrewStore.setState({ crews: [mockCrew], activeCrew: mockCrew });
      vi.mocked(api.delete).mockResolvedValueOnce(undefined);
      await useCrewStore.getState().deleteCrew('crew-1');
      expect(useCrewStore.getState().crews).toHaveLength(0);
      expect(useCrewStore.getState().activeCrew).toBeNull();
    });

    it('keeps activeCrew when deleting a different crew', async () => {
      const otherCrew = { ...mockCrew, id: 'crew-2', name: 'Other' };
      useCrewStore.setState({ crews: [mockCrew, otherCrew], activeCrew: mockCrew });
      vi.mocked(api.delete).mockResolvedValueOnce(undefined);
      await useCrewStore.getState().deleteCrew('crew-2');
      expect(useCrewStore.getState().crews).toHaveLength(1);
      expect(useCrewStore.getState().activeCrew).toEqual(mockCrew);
    });

    it('sets error and throws on failure', async () => {
      vi.mocked(api.delete).mockRejectedValueOnce(new Error('Cannot delete'));
      await expect(useCrewStore.getState().deleteCrew('crew-1')).rejects.toThrow('Cannot delete');
      expect(useCrewStore.getState().error).toBe('Cannot delete');
    });

    it('handles non-Error thrown values', async () => {
      vi.mocked(api.delete).mockRejectedValueOnce('string error');
      await expect(useCrewStore.getState().deleteCrew('crew-1')).rejects.toBe('string error');
      expect(useCrewStore.getState().error).toBe('Failed to delete crew');
    });
  });

  describe('loadOverlap', () => {
    it('sets crewOverlap on success', async () => {
      const a = { userId: 'u1', username: 'a', name: 'Al' };
      const b = { userId: 'u2', username: 'b', name: null };
      vi.mocked(api.get).mockResolvedValueOnce({
        crewId: 'crew-1',
        festivalId: 'fest-1',
        memberCount: 3,
        overlap: { s1: [a, b], s2: [a] },
      });
      await useCrewStore.getState().loadOverlap('crew-1', 'fest-1');
      expect(useCrewStore.getState().crewOverlap).toEqual({
        s1: {
          setId: 's1',
          memberCount: 2,
          members: [
            { userId: 'u1', username: 'a', name: 'Al' },
            { userId: 'u2', username: 'b', name: undefined },
          ],
        },
      });
    });

    it('sets error and throws on failure', async () => {
      vi.mocked(api.get).mockRejectedValueOnce(new Error('Not found'));
      await expect(useCrewStore.getState().loadOverlap('crew-1', 'fest-1')).rejects.toThrow('Not found');
      expect(useCrewStore.getState().error).toBe('Not found');
    });

    it('handles non-Error thrown values', async () => {
      vi.mocked(api.get).mockRejectedValueOnce('string error');
      await expect(useCrewStore.getState().loadOverlap('crew-1', 'fest-1')).rejects.toBe('string error');
      expect(useCrewStore.getState().error).toBe('Failed to load overlap');
    });
  });

  describe('forceAddMember', () => {
    it('updates activeCrew and crews list on success', async () => {
      const updatedCrew = { ...mockCrew, members: mockMembers };
      useCrewStore.setState({ crews: [mockCrew], activeCrew: mockCrew });
      vi.mocked(api.post).mockResolvedValueOnce(updatedCrew);
      await useCrewStore.getState().forceAddMember('crew-1', 'user-2');
      expect(useCrewStore.getState().activeCrew).toEqual(updatedCrew);
      expect(useCrewStore.getState().crewMembers).toEqual(mockMembers);
    });

    it('does not update activeCrew when it does not match crewId', async () => {
      const otherCrew = { ...mockCrew, id: 'crew-other' };
      const updatedCrew = { ...mockCrew, members: mockMembers };
      useCrewStore.setState({ crews: [mockCrew], activeCrew: otherCrew });
      vi.mocked(api.post).mockResolvedValueOnce(updatedCrew);
      await useCrewStore.getState().forceAddMember('crew-1', 'user-2');
      expect(useCrewStore.getState().activeCrew).toEqual(otherCrew);
    });

    it('updates crews list when crewId matches an entry', async () => {
      const crew2 = { ...mockCrew, id: 'crew-2', name: 'Crew 2' };
      const updatedCrew = { ...mockCrew, members: mockMembers };
      useCrewStore.setState({ crews: [mockCrew, crew2], activeCrew: mockCrew });
      vi.mocked(api.post).mockResolvedValueOnce(updatedCrew);
      await useCrewStore.getState().forceAddMember('crew-1', 'user-2');
      const crews = useCrewStore.getState().crews;
      expect(crews).toHaveLength(2);
      expect(crews[0]).toEqual(updatedCrew);
      expect(crews[1]).toEqual(crew2);
    });

    it('sets error and throws on failure', async () => {
      vi.mocked(api.post).mockRejectedValueOnce(new Error('Already a member'));
      await expect(useCrewStore.getState().forceAddMember('crew-1', 'user-2')).rejects.toThrow('Already a member');
      expect(useCrewStore.getState().error).toBe('Already a member');
    });

    it('handles non-Error thrown values', async () => {
      vi.mocked(api.post).mockRejectedValueOnce('string error');
      await expect(useCrewStore.getState().forceAddMember('crew-1', 'user-2')).rejects.toBe('string error');
      expect(useCrewStore.getState().error).toBe('Failed to add member');
    });
  });

  describe('setError', () => {
    it('sets error string', () => {
      useCrewStore.getState().setError('Something broke');
      expect(useCrewStore.getState().error).toBe('Something broke');
    });

    it('clears error with null', () => {
      useCrewStore.getState().setError('err');
      useCrewStore.getState().setError(null);
      expect(useCrewStore.getState().error).toBeNull();
    });
  });

  describe('loadExpenses', () => {
    it('loads expenses and balances together', async () => {
      const expenses = [
        {
          id: 'e1',
          crew_id: 'crew-1',
          paid_by: 'user-1',
          paid_by_name: 'Alice',
          description: 'Dinner',
          amount: '40.00',
          split_with: ['user-1', 'user-2'],
          category: 'food',
          created_at: '2026-01-01T00:00:00Z',
        },
      ];
      const balances = [{ userId: 'user-1', username: 'Alice', balance: 20 }];
      // The settlement-plan endpoint returns BOTH balances and the netted plan.
      const settlements = [
        {
          fromUserId: 'user-2',
          fromName: 'Bob',
          toUserId: 'user-1',
          toName: 'Alice',
          amountCents: 2000,
          amount: 20,
          payeeHandles: { venmo: null, cashapp: null, paypal: null },
        },
      ];
      vi.mocked(api.get).mockResolvedValueOnce(expenses).mockResolvedValueOnce({ balances, settlements });
      await useCrewStore.getState().loadExpenses('crew-1');
      expect(useCrewStore.getState().expenses).toEqual(expenses);
      expect(useCrewStore.getState().expenseBalances).toEqual(balances);
      expect(useCrewStore.getState().settlements).toEqual(settlements);
      expect(api.get).toHaveBeenCalledWith('/crews/crew-1/expenses');
      expect(api.get).toHaveBeenCalledWith('/crews/crew-1/expenses/settlement-plan');
    });

    it('defaults balances and settlements to empty when the plan is empty', async () => {
      vi.mocked(api.get)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce({ balances: [{ userId: 'u', username: 'U', balance: 5 }], settlements: [] });
      await useCrewStore.getState().loadExpenses('crew-1');
      expect(useCrewStore.getState().expenseBalances).toHaveLength(1);
      expect(useCrewStore.getState().settlements).toHaveLength(0);
    });

    it('sets error and throws on failure', async () => {
      vi.mocked(api.get).mockRejectedValueOnce(new Error('boom'));
      await expect(useCrewStore.getState().loadExpenses('crew-1')).rejects.toThrow('boom');
      expect(useCrewStore.getState().error).toBe('boom');
    });
  });

  describe('addExpense', () => {
    it('posts then refetches expenses + balances', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({});
      vi.mocked(api.get)
        .mockResolvedValueOnce([{ id: 'e1' }])
        .mockResolvedValueOnce([]);
      await useCrewStore.getState().addExpense('crew-1', {
        description: 'Beer',
        amount: 12,
        splitWith: ['user-1'],
        category: 'drinks',
      });
      // Phase-2 offline optimism passes an onOptimisticCreate option (only
      // invoked on the offline-queue path); the body is unchanged.
      expect(api.post).toHaveBeenCalledWith(
        '/crews/crew-1/expenses',
        { description: 'Beer', amount: 12, splitWith: ['user-1'], category: 'drinks' },
        expect.objectContaining({ onOptimisticCreate: expect.any(Function) }),
      );
      expect(useCrewStore.getState().expenses).toEqual([{ id: 'e1' }]);
    });
  });

  describe('removeExpense', () => {
    it('deletes then refetches', async () => {
      vi.mocked(api.delete).mockResolvedValueOnce({});
      vi.mocked(api.get).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await expect(useCrewStore.getState().removeExpense('crew-1', 'e1')).resolves.toBe('sent');
      expect(api.delete).toHaveBeenCalledWith('/crews/crew-1/expenses/e1');
    });

    it('reports a delete queued offline as queued', async () => {
      vi.mocked(api.delete).mockResolvedValueOnce({ _optimistic: true });
      vi.mocked(api.get).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await expect(useCrewStore.getState().removeExpense('crew-1', 'e1')).resolves.toBe('queued');
    });
  });

  describe('settleExpense', () => {
    it('posts settle then refetches', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({});
      vi.mocked(api.get).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await useCrewStore.getState().settleExpense('crew-1', { toUserId: 'user-2', amount: 10 });
      expect(api.post).toHaveBeenCalledWith(
        '/crews/crew-1/expenses/settle',
        { toUserId: 'user-2', amount: 10 },
      );
    });
  });

  describe('expense edit, currency, confirm and remind', () => {
    const request = { description: 'Gas', amount: 60, splitWith: ['user-1', 'user-2'], category: 'transport' };

    it('updateExpense sends PUT then reloads', async () => {
      vi.mocked(api.put).mockResolvedValueOnce({ id: 'e1' });
      vi.mocked(api.get).mockResolvedValueOnce([{ id: 'e1' }]).mockResolvedValueOnce({ balances: [], settlements: [] });
      await expect(useCrewStore.getState().updateExpense('crew-1', 'e1', request)).resolves.toBe('sent');
      expect(api.put).toHaveBeenCalledWith('/crews/crew-1/expenses/e1', request);
      expect(api.get).toHaveBeenCalledWith('/crews/crew-1/expenses');
      expect(useCrewStore.getState().expenses).toEqual([{ id: 'e1' }]);
    });

    it('loadBalances sets expenseCurrency from the plan, USD when absent', async () => {
      vi.mocked(api.get)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce({ balances: [], settlements: [], currency: 'EUR' });
      await useCrewStore.getState().loadExpenses('crew-1');
      expect(useCrewStore.getState().expenseCurrency).toBe('EUR');
      vi.mocked(api.get).mockResolvedValueOnce([]).mockResolvedValueOnce({ balances: [], settlements: [] });
      await useCrewStore.getState().loadExpenses('crew-1');
      expect(useCrewStore.getState().expenseCurrency).toBe('USD');
    });

    it('setExpenseCurrency sets at once and rolls back on error', async () => {
      useCrewStore.setState({ expenseCurrency: 'USD' });
      vi.mocked(api.put).mockResolvedValueOnce({ currency: 'EUR' });
      await expect(useCrewStore.getState().setExpenseCurrency('crew-1', 'EUR')).resolves.toBe('sent');
      expect(useCrewStore.getState().expenseCurrency).toBe('EUR');
      expect(api.put).toHaveBeenCalledWith('/crews/crew-1/expenses/currency', { currency: 'EUR' });

      vi.mocked(api.put).mockRejectedValueOnce(new Error('403'));
      await expect(useCrewStore.getState().setExpenseCurrency('crew-1', 'GBP')).rejects.toThrow('403');
      expect(useCrewStore.getState().expenseCurrency).toBe('EUR');
    });

    it('confirmPayment sets the local flag', async () => {
      const row = { id: 'p1', crew_id: 'crew-1', category: 'settlement' };
      useCrewStore.setState({ expenses: [row as never] });
      vi.mocked(api.post).mockResolvedValueOnce({});
      vi.mocked(api.get).mockRejectedValueOnce(new Error('offline refetch'));
      await expect(useCrewStore.getState().confirmPayment('crew-1', 'p1', false)).resolves.toBe('sent');
      expect(api.post).toHaveBeenCalledWith('/crews/crew-1/expenses/p1/confirm', { received: false });
      const after = useCrewStore.getState().expenses[0]!;
      expect(after.disputed_at).toEqual(expect.any(String));
      expect(after.confirmed_at).toBeUndefined();
    });

    it('remindPayment rethrows the 409 so the caller can show its message', async () => {
      const conflict = Object.assign(new Error('You already reminded Sam today. Try again tomorrow.'), { status: 409 });
      vi.mocked(api.post).mockRejectedValueOnce(conflict);
      await expect(useCrewStore.getState().remindPayment('crew-1', 'user-2')).rejects.toBe(conflict);
      // Online-only: a reminder queued offline would fire hours later.
      expect(api.post).toHaveBeenCalledWith('/crews/crew-1/expenses/remind', { userId: 'user-2' }, { _bypassOfflineQueue: true });
    });
  });

  describe('packing batch and ride seats', () => {
    const offer = (passenger_ids: string[]) =>
      ({ id: 'r1', crew_id: 'crew-1', created_by: 'user-2', seats: 2, passenger_ids }) as never;

    it('addPackingItems prepends the returned items', async () => {
      useCrewStore.setState({ packingItems: [{ id: 'old' } as never] });
      vi.mocked(api.post).mockResolvedValueOnce({ items: [{ id: 'a' }, { id: 'b' }] });
      await expect(useCrewStore.getState().addPackingItems('crew-1', ['Tent', 'Cooler'])).resolves.toBe('sent');
      expect(api.post).toHaveBeenCalledWith(
        '/crews/crew-1/packing/batch',
        { labels: ['Tent', 'Cooler'] },
        expect.objectContaining({ onOptimisticCreate: expect.any(Function) }),
      );
      expect(useCrewStore.getState().packingItems.map((i) => i.id)).toEqual(['a', 'b', 'old']);
    });

    it('takeRideSeat adds me, then replaces the offer with the server copy', async () => {
      useCrewStore.setState({ rideOffers: [offer([])] });
      vi.mocked(api.post).mockResolvedValueOnce({ offer: { ...offer(['user-1']), seats: 3 } });
      await expect(useCrewStore.getState().takeRideSeat('crew-1', 'r1', 'user-1')).resolves.toBe('sent');
      expect(api.post).toHaveBeenCalledWith('/crews/crew-1/rides/r1/seat');
      expect(useCrewStore.getState().rideOffers[0]!.seats).toBe(3);
    });

    it('takeRideSeat rolls back on 409 and keeps a concurrent rider', async () => {
      useCrewStore.setState({ rideOffers: [offer([])] });
      vi.mocked(api.post).mockImplementationOnce(async () => {
        useCrewStore.setState({ rideOffers: [offer(['user-1', 'user-3'])] });
        throw new Error('This ride is full.');
      });
      await expect(useCrewStore.getState().takeRideSeat('crew-1', 'r1', 'user-1')).rejects.toThrow('full');
      expect(useCrewStore.getState().rideOffers[0]!.passenger_ids).toEqual(['user-3']);
    });

    it('leaveRideSeat removes me and rolls back on error', async () => {
      useCrewStore.setState({ rideOffers: [offer(['user-1'])] });
      vi.mocked(api.delete).mockRejectedValueOnce(new Error('boom'));
      await expect(useCrewStore.getState().leaveRideSeat('crew-1', 'r1', 'user-1')).rejects.toThrow('boom');
      expect(useCrewStore.getState().rideOffers[0]!.passenger_ids).toEqual(['user-1']);
    });
  });

  describe('closePoll — server-side meeting point', () => {
    const meetingPoint = {
      id: 'mp-1',
      crew_id: 'crew-1',
      created_by: 'user-1',
      label: 'Fisher',
      location: 'Main Stage',
      type: 'set',
      meet_at: '2026-07-01T21:00:00Z',
      stage_reference: 'Main Stage',
      active: true,
      created_at: '2026-01-01T00:00:00Z',
    };

    function makePoll(): CrewPoll {
      return {
        id: 'poll-1',
        crew_id: 'crew-1',
        created_by: 'user-1',
        question: 'Which set at 9pm?',
        options: ['Fisher', 'Chris Lake'],
        votes: [],
        closes_at: null,
        closed: false,
        created_at: '2026-01-01T00:00:00Z',
      };
    }

    it('upserts the returned meeting point and seeds the reminder with winningSetId', async () => {
      useCrewStore.setState({ polls: [makePoll()], meetingPoints: [] });
      vi.mocked(api.delete).mockResolvedValueOnce({ closed: {}, meetingPoint, winningSetId: 'set-9pm' });
      const seedReminder = vi.fn().mockResolvedValue(undefined);

      await useCrewStore.getState().closePoll('crew-1', 'poll-1', { festivalId: 'fest-1', seedReminder });

      // The poll stays in state, marked closed, for the Decided group.
      expect(useCrewStore.getState().polls).toHaveLength(1);
      expect(useCrewStore.getState().polls[0]!.closed).toBe(true);
      expect(useCrewStore.getState().meetingPoints[0]!.label).toBe('Fisher');
      expect(seedReminder).toHaveBeenCalledWith('set-9pm', 'fest-1');
      expect(api.post).not.toHaveBeenCalled();
    });

    it('seeds nothing when winningSetId is null', async () => {
      useCrewStore.setState({ polls: [makePoll()], meetingPoints: [] });
      vi.mocked(api.delete).mockResolvedValueOnce({ closed: {}, meetingPoint: null, winningSetId: null });
      const seedReminder = vi.fn();

      await useCrewStore.getState().closePoll('crew-1', 'poll-1', { festivalId: 'fest-1', seedReminder });

      expect(seedReminder).not.toHaveBeenCalled();
      expect(useCrewStore.getState().meetingPoints).toHaveLength(0);
      expect(api.post).not.toHaveBeenCalled();
    });

    it('seeds nothing for an offline-queued close that returns no body', async () => {
      useCrewStore.setState({ polls: [makePoll()], meetingPoints: [] });
      vi.mocked(api.delete).mockResolvedValueOnce(undefined);
      const seedReminder = vi.fn();

      await useCrewStore.getState().closePoll('crew-1', 'poll-1', { festivalId: 'fest-1', seedReminder });

      expect(useCrewStore.getState().polls[0]!.closed).toBe(true);
      expect(seedReminder).not.toHaveBeenCalled();
    });

    it('still closes when the reminder seed fails', async () => {
      useCrewStore.setState({ polls: [makePoll()], meetingPoints: [] });
      vi.mocked(api.delete).mockResolvedValueOnce({ closed: {}, meetingPoint, winningSetId: 'set-9pm' });
      const seedReminder = vi.fn().mockRejectedValue(new Error('reminder failed'));

      await expect(
        useCrewStore.getState().closePoll('crew-1', 'poll-1', { festivalId: 'fest-1', seedReminder }),
      ).resolves.toBeUndefined();
      expect(useCrewStore.getState().polls[0]!.closed).toBe(true);
    });
  });

  describe('createPoll — schedule-aware linkage (M2)', () => {
    it('sends setRefs in the POST body and stores set_refs on the poll', async () => {
      const setRefs: (PollSetRef | null)[] = [
        { setId: 's1', label: 'A', stageReference: 'Stage 1', meetAt: null },
        null,
      ];
      vi.mocked(api.post).mockResolvedValueOnce({
        poll: {
          id: 'srv-poll',
          crew_id: 'crew-1',
          created_by: 'user-1',
          question: 'Q',
          options: ['A', 'B'],
          votes: [],
          closes_at: null,
          closed: false,
          created_at: '2026-01-01T00:00:00Z',
          set_refs: setRefs,
        },
      });

      const poll = await useCrewStore.getState().createPoll('crew-1', { question: 'Q', options: ['A', 'B'] }, setRefs);

      const body = vi.mocked(api.post).mock.calls[0]![1] as Record<string, unknown>;
      expect(body).toEqual({ question: 'Q', options: ['A', 'B'], setRefs });
      expect(poll.set_refs).toEqual(setRefs);
      expect(useCrewStore.getState().polls[0]!.set_refs).toEqual(setRefs);
    });

    it('omits setRefs when no option links to a set', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        poll: {
          id: 'srv-poll',
          crew_id: 'crew-1',
          created_by: 'user-1',
          question: 'Q',
          options: ['A', 'B'],
          votes: [],
          closes_at: null,
          closed: false,
          created_at: '2026-01-01T00:00:00Z',
        },
      });
      const poll = await useCrewStore
        .getState()
        .createPoll('crew-1', { question: 'Q', options: ['A', 'B'] }, [null, null]);
      expect(poll.set_refs).toBeUndefined();
      expect(vi.mocked(api.post).mock.calls[0]![1]).toEqual({ question: 'Q', options: ['A', 'B'] });
    });
  });

  describe('parseActivityPage', () => {
    it('handles envelope, bare array, { activity } and null', () => {
      expect(parseActivityPage({ items: [{ id: 'a1' }], nextCursor: 'x' })).toEqual([{ id: 'a1' }]);
      expect(parseActivityPage([{ id: 'a2' }])).toEqual([{ id: 'a2' }]);
      expect(parseActivityPage({ activity: [{ id: 'a3' }] })).toEqual([{ id: 'a3' }]);
      expect(parseActivityPage(null)).toEqual([]);
    });
  });

  describe('loadActivity', () => {
    it('reads the { items } pagination envelope', async () => {
      const items = [
        {
          id: 'a1',
          crew_id: 'crew-1',
          user_id: 'user-1',
          username: 'Alice',
          type: 'expense-added',
          detail: 'Dinner $40',
          created_at: '2026-01-01T00:00:00Z',
        },
      ];
      vi.mocked(api.get).mockResolvedValueOnce({ items, nextCursor: null });
      await useCrewStore.getState().loadActivity('crew-1');
      expect(useCrewStore.getState().activity).toEqual(items);
      expect(api.get).toHaveBeenCalledWith('/crews/crew-1/activity');
    });

    it('accepts a bare array too', async () => {
      vi.mocked(api.get).mockResolvedValueOnce([{ id: 'a1' }]);
      await useCrewStore.getState().loadActivity('crew-1');
      expect(useCrewStore.getState().activity).toEqual([{ id: 'a1' }]);
    });

    it('sets error and throws on failure', async () => {
      vi.mocked(api.get).mockRejectedValueOnce(new Error('nope'));
      await expect(useCrewStore.getState().loadActivity('crew-1')).rejects.toThrow('nope');
      expect(useCrewStore.getState().error).toBe('nope');
    });

    it('loadOlderActivity appends page 2 and a later loadActivity keeps it', async () => {
      const row = (id: string, at: string) => ({ id, created_at: at });
      const page1 = [row('a3', '2026-01-03T00:00:00Z'), row('a2', '2026-01-02T00:00:00Z')];
      const page2 = [row('a1', '2026-01-01T00:00:00Z')];
      useCrewStore.setState({ activity: [], activityNextCursor: null });
      vi.mocked(api.get).mockResolvedValueOnce({ items: page1, nextCursor: 'c1' });
      await useCrewStore.getState().loadActivity('crew-1');
      expect(useCrewStore.getState().activityNextCursor).toBe('c1');

      vi.mocked(api.get).mockResolvedValueOnce({ items: page2, nextCursor: null });
      await useCrewStore.getState().loadOlderActivity('crew-1');
      expect(api.get).toHaveBeenLastCalledWith('/crews/crew-1/activity?cursor=c1');
      expect(useCrewStore.getState().activity.map((a) => a.id)).toEqual(['a3', 'a2', 'a1']);
      expect(useCrewStore.getState().activityNextCursor).toBeNull();

      vi.mocked(api.get).mockResolvedValueOnce({ items: page1, nextCursor: 'c1' });
      await useCrewStore.getState().loadActivity('crew-1');
      expect(useCrewStore.getState().activity.map((a) => a.id)).toEqual(['a3', 'a2', 'a1']);
      expect(useCrewStore.getState().activityNextCursor).toBeNull();
    });

    it('loadOlderActivity does nothing without a cursor', async () => {
      useCrewStore.setState({ activityNextCursor: null });
      vi.mocked(api.get).mockClear();
      await useCrewStore.getState().loadOlderActivity('crew-1');
      expect(api.get).not.toHaveBeenCalled();
    });
  });

  describe('multi-answer votes, nudge', () => {
    const basePoll = (votes: CrewPoll['votes']): CrewPoll => ({
      id: 'poll-1',
      crew_id: 'crew-1',
      created_by: 'user-1',
      question: 'Q',
      options: ['A', 'B', 'C'],
      votes,
      closes_at: null,
      closed: false,
      multi_answer: true,
      created_at: '2026-01-01T00:00:00Z',
    });

    it('writes one entry per index and rolls back to my prior entries', async () => {
      useAuthStore.setState({ user: { id: 'user-1' } as never });
      useCrewStore.setState({ polls: [basePoll([{ option: 2, user_id: 'user-1' }])] });
      vi.mocked(api.post).mockImplementationOnce(async () => {
        expect(useCrewStore.getState().polls[0]!.votes.filter((v) => v.user_id === 'user-1')).toHaveLength(2);
        throw new Error('nope');
      });
      await expect(useCrewStore.getState().votePoll('crew-1', 'poll-1', [0, 1])).rejects.toThrow('nope');
      expect(api.post).toHaveBeenLastCalledWith('/crews/crew-1/polls/poll-1/vote', { optionIndexes: [0, 1] });
      expect(useCrewStore.getState().polls[0]!.votes).toEqual([{ option: 2, user_id: 'user-1' }]);
    });

    it('an empty array removes my entries', async () => {
      useAuthStore.setState({ user: { id: 'user-1' } as never });
      useCrewStore.setState({
        polls: [basePoll([{ option: 1, user_id: 'user-1' }, { option: 0, user_id: 'user-2' }])],
      });
      vi.mocked(api.post).mockImplementationOnce(async () => {
        expect(useCrewStore.getState().polls[0]!.votes).toEqual([{ option: 0, user_id: 'user-2' }]);
        return { voted: true };
      });
      vi.mocked(api.get).mockResolvedValueOnce({ polls: [] });
      await useCrewStore.getState().votePoll('crew-1', 'poll-1', []);
    });

    it('nudgePoll sets nudged_at and returns the count', async () => {
      useCrewStore.setState({ polls: [basePoll([])] });
      vi.mocked(api.post).mockResolvedValueOnce({ nudged: 3 });
      await expect(useCrewStore.getState().nudgePoll('crew-1', 'poll-1')).resolves.toBe(3);
      expect(api.post).toHaveBeenLastCalledWith('/crews/crew-1/polls/poll-1/nudge', {}, { _bypassOfflineQueue: true });
      expect(useCrewStore.getState().polls[0]!.nudged_at).toBeTruthy();
    });

    it('nudgePoll sets error and re-throws on failure', async () => {
      useCrewStore.setState({ polls: [basePoll([])] });
      vi.mocked(api.post).mockRejectedValueOnce(new Error('A reminder was already sent for this poll.'));
      await expect(useCrewStore.getState().nudgePoll('crew-1', 'poll-1')).rejects.toThrow();
      expect(useCrewStore.getState().error).toBeTruthy();
    });
  });

  // WF4: both votePoll and updateMyStatus write optimistically, await a round-
  // trip, then on an ONLINE reject roll back. A whole-array snapshot restore
  // clobbers a sibling change (another member's vote/status) that a socket
  // setter applied while the write was in flight; the rollback must scope to
  // only the row this action touched, against the LATEST state.
  describe('handOverAndLeave', () => {
    it('transfers then leaves and returns left', async () => {
      vi.mocked(api.put).mockResolvedValueOnce({});
      vi.mocked(api.delete).mockResolvedValueOnce({});
      await expect(useCrewStore.getState().handOverAndLeave('crew-1', 'user-2')).resolves.toBe('left');
      expect(api.put).toHaveBeenCalledWith('/crews/crew-1/transfer', { userId: 'user-2' });
      expect(api.delete).toHaveBeenCalledWith('/crews/crew-1/leave');
    });

    it('returns owner-changed when leave rejects', async () => {
      vi.mocked(api.put).mockResolvedValueOnce({});
      vi.mocked(api.delete).mockRejectedValueOnce(new Error('boom'));
      await expect(useCrewStore.getState().handOverAndLeave('crew-1', 'user-2')).resolves.toBe('owner-changed');
      expect(useCrewStore.getState().error).toBeTruthy();
    });

    it('throws when transfer rejects and never leaves', async () => {
      vi.mocked(api.put).mockRejectedValueOnce(new Error('Transfer denied'));
      await expect(useCrewStore.getState().handOverAndLeave('crew-1', 'user-2')).rejects.toThrow('Transfer denied');
      expect(api.delete).not.toHaveBeenCalled();
    });
  });

  describe('forceAddByUsername', () => {
    it('strips @, matches exactly ignoring case, and returns the matched username', async () => {
      vi.mocked(api.get).mockResolvedValueOnce([
        { id: 'u-9', username: 'asirhelper' },
        { id: 'u-2', username: 'Asir' },
      ]);
      vi.mocked(api.post).mockResolvedValueOnce({ ...mockCrew, members: [] });
      const name = await useCrewStore.getState().forceAddByUsername('crew-1', ' @asir ');
      expect(name).toBe('Asir');
      expect(api.get).toHaveBeenCalledWith('/crews/search-users?q=asir');
      expect(api.post).toHaveBeenCalledWith('/crews/crew-1/members', { userId: 'u-2' });
    });

    it('throws and sets the error when there is no exact match', async () => {
      vi.mocked(api.get).mockResolvedValueOnce([{ id: 'u-9', username: 'asirhelper' }]);
      await expect(useCrewStore.getState().forceAddByUsername('crew-1', 'x')).rejects.toThrow(
        'No user called "x". Check the spelling.',
      );
      expect(useCrewStore.getState().error).toBe('No user called "x". Check the spelling.');
      expect(api.post).not.toHaveBeenCalled();
    });
  });

  describe('optimistic rollback preserves concurrent socket updates', () => {
    it('votePoll rolls back only my vote, keeping a concurrent peer vote', async () => {
      useAuthStore.setState({ user: { id: 'user-1' } as never });
      const poll: CrewPoll = {
        id: 'poll-1',
        crew_id: 'crew-1',
        created_by: 'user-1',
        question: 'Which stage?',
        options: ['A', 'B', 'C'],
        votes: [{ option: 2, user_id: 'user-1' }],
        closes_at: null,
        closed: false,
        created_at: '2026-01-01T00:00:00Z',
      };
      useCrewStore.setState({ polls: [poll] });

      // The in-flight POST: a peer's vote lands via the socket setter, THEN the
      // write rejects — modelling a concurrent update during the round-trip.
      vi.mocked(api.post).mockImplementationOnce(async () => {
        useCrewStore.getState().applyPollVote('poll-1', 'user-2', [0]);
        throw new Error('poll closed');
      });

      await expect(useCrewStore.getState().votePoll('crew-1', 'poll-1', [1])).rejects.toThrow('poll closed');

      const votes = useCrewStore.getState().polls[0]!.votes;
      // Peer's concurrent vote survived the rollback (the bug clobbered it).
      expect(votes.find((v) => v.user_id === 'user-2')?.option).toBe(0);
      // My optimistic vote rolled back to my PRIOR vote (option 2), not dropped.
      expect(votes.find((v) => v.user_id === 'user-1')?.option).toBe(2);
    });

    it('setMyDays updates optimistically and sends the deterministic clientId', async () => {
      useCrewStore.setState({ crewDays: [{ userId: 'user-2', dayIndex: 0, answer: 'no' }] });
      vi.mocked(api.put).mockResolvedValueOnce({ days: [{ userId: 'user-1', dayIndex: 1, answer: 'going' }] });
      const outcome = await useCrewStore.getState().setMyDays('crew-1', 'user-1', {
        days: [{ dayIndex: 1, answer: 'going' }],
      });
      expect(outcome).toBe('sent');
      expect(vi.mocked(api.put).mock.calls[0]![2]).toMatchObject({
        clientId: 'PUT:/crews/crew-1/days:days-crew-1-user-1',
        offlineLabel: 'Update my days',
      });
      expect(useCrewStore.getState().crewDays).toHaveLength(2);
    });

    it('setMyDays rolls back only my rows on an online reject', async () => {
      useCrewStore.setState({
        crewDays: [
          { userId: 'user-1', dayIndex: 0, answer: 'going' },
          { userId: 'user-2', dayIndex: 0, answer: 'no' },
        ],
      });
      vi.mocked(api.put).mockImplementationOnce(async () => {
        useCrewStore.getState().applyCrewDays({
          crewId: 'crew-1',
          userId: 'user-3',
          days: [{ userId: 'user-3', dayIndex: 1, answer: 'maybe' }],
        });
        throw new Error('rejected');
      });
      useCrewStore.setState({ activeCrew: mockCrew });
      await expect(
        useCrewStore.getState().setMyDays('crew-1', 'user-1', { days: [{ dayIndex: 0, answer: 'no' }] }),
      ).rejects.toThrow('rejected');
      const rows = useCrewStore.getState().crewDays;
      expect(rows.find((d) => d.userId === 'user-1')).toMatchObject({ dayIndex: 0, answer: 'going' });
      expect(rows.find((d) => d.userId === 'user-3')).toBeDefined();
      expect(rows.find((d) => d.userId === 'user-2')).toBeDefined();
    });

    it('setMeetingPointComing adds my id, then rolls it back on reject', async () => {
      useCrewStore.setState({ meetingPoints: [{ id: 'mp1', coming: ['user-2'] } as never] });
      vi.mocked(api.put).mockRejectedValueOnce(new Error('rejected'));
      await expect(useCrewStore.getState().setMeetingPointComing('crew-1', 'mp1', 'user-1', true)).rejects.toThrow(
        'rejected',
      );
      expect(useCrewStore.getState().meetingPoints[0]!.coming).toEqual(['user-2']);
      expect(vi.mocked(api.put).mock.calls[0]![2]).toMatchObject({
        clientId: 'PUT:/crews/crew-1/meeting-points/mp1/coming:coming-mp1-user-1',
        offlineLabel: "Update I'll be there",
      });
    });

    it('setMeetingPointComing replaces the row with the server row', async () => {
      useCrewStore.setState({ meetingPoints: [{ id: 'mp1', coming: [] } as never] });
      vi.mocked(api.put).mockResolvedValueOnce({ meetingPoint: { id: 'mp1', coming: ['user-1', 'user-2'] } });
      await useCrewStore.getState().setMeetingPointComing('crew-1', 'mp1', 'user-1', true);
      expect(useCrewStore.getState().meetingPoints[0]!.coming).toEqual(['user-1', 'user-2']);
    });

    it('loadCrewDays treats a 404 as no answers', async () => {
      useCrewStore.setState({ activeCrew: mockCrew, crewDays: [{ userId: 'u', dayIndex: 0, answer: 'no' }] });
      vi.mocked(api.get).mockRejectedValueOnce(Object.assign(new Error('Not found'), { status: 404 }));
      await expect(useCrewStore.getState().loadCrewDays(mockCrew.id)).resolves.toBeUndefined();
      expect(useCrewStore.getState().crewDays).toEqual([]);
    });

    it('applyCrewDays replaces that user rows and ignores another crew', () => {
      useCrewStore.setState({
        activeCrew: mockCrew,
        crewDays: [
          { userId: 'u1', dayIndex: 0, answer: 'no' },
          { userId: 'u2', dayIndex: 0, answer: 'no' },
        ],
      });
      useCrewStore.getState().applyCrewDays({ crewId: 'other', userId: 'u1', days: [] });
      expect(useCrewStore.getState().crewDays).toHaveLength(2);
      useCrewStore.getState().applyCrewDays({ crewId: mockCrew.id, userId: 'u1', days: [] });
      expect(useCrewStore.getState().crewDays).toEqual([{ userId: 'u2', dayIndex: 0, answer: 'no' }]);
    });

    it('updateMyStatus rolls back only my row, keeping a concurrent peer status', async () => {
      const mine: CrewMemberStatus = {
        crew_id: 'crew-1',
        user_id: 'user-1',
        status: 'here',
        target_meeting_point_id: null,
        eta_minutes: null,
        note: null,
        updated_at: '2026-01-01T00:00:00Z',
      };
      useCrewStore.setState({ crewStatuses: [mine] });

      vi.mocked(api.put).mockImplementationOnce(async () => {
        useCrewStore.getState().applyStatusUpdate({
          crew_id: 'crew-1',
          user_id: 'user-2',
          status: 'on-my-way',
          target_meeting_point_id: null,
          eta_minutes: null,
          note: null,
          updated_at: '2026-01-01T00:05:00Z',
        });
        throw new Error('rejected');
      });

      await expect(useCrewStore.getState().updateMyStatus('crew-1', { status: 'on-my-way' }, 'user-1')).rejects.toThrow(
        'rejected',
      );

      const statuses = useCrewStore.getState().crewStatuses;
      // Peer's concurrent status survived the rollback (the bug clobbered it).
      expect(statuses.find((s) => s.user_id === 'user-2')?.status).toBe('on-my-way');
      // My row rolled back to my PRIOR status ('here'), not dropped.
      expect(statuses.find((s) => s.user_id === 'user-1')?.status).toBe('here');
    });
  });
});
