import { useQuery } from '@tanstack/react-query';
import { api } from '@festie/shared';
import { useAuthStore, useCrewStore, useUIStore } from '@festie/shared/stores';
import { crewTabBadge } from '@festie/shared/utils';

export type AttentionPoll = { id: string; closed?: boolean; votes?: { user_id?: string | null }[] };
type Balance = { userId: string; balance: number };

export const pollsQueryOptions = (crewId: string | undefined) => ({
  queryKey: ['polls', crewId],
  queryFn: async (): Promise<AttentionPoll[]> => {
    const res = await api.get<{ polls: AttentionPoll[] } | AttentionPoll[]>(`/crews/${crewId}/polls`);
    return Array.isArray(res) ? res : res?.polls || [];
  },
  enabled: !!crewId,
});

export const balancesQueryOptions = (crewId: string | undefined) => ({
  queryKey: ['expense-balances', crewId],
  queryFn: async (): Promise<Balance[]> => {
    const res = await api.get<Balance[] | { balances: Balance[] }>(`/crews/${crewId}/expenses/balances`);
    return Array.isArray(res) ? res : res?.balances || [];
  },
  enabled: !!crewId,
});

/** Crew tab badge: open polls not seen or voted on, else a dot for a changed balance. */
export function useCrewAttention() {
  const user = useAuthStore((s) => s.user);
  const crewId = useCrewStore((s) => s.activeCrew?.id);
  const seen = useUIStore((s) => (crewId ? s.crewBadgeSeen[crewId] : undefined));
  const { data: polls = [] } = useQuery(pollsQueryOptions(crewId));
  const { data: balances = [] } = useQuery(balancesQueryOptions(crewId));
  if (!crewId) return { count: 0, dot: false, label: null };
  const myBalance = balances.find((b) => b.userId === user?.id)?.balance;
  return crewTabBadge({ polls, myBalance, userId: user?.id, seen });
}
