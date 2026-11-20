import { api } from './api';
import type { CrewPoll } from '../types';

const pollsPath = (crewId: string) => `/crews/${encodeURIComponent(crewId)}/polls`;

export async function fetchCrewPolls(crewId: string): Promise<CrewPoll[]> {
  const res = await api.get<{ polls: CrewPoll[] } | CrewPoll[]>(pollsPath(crewId));
  const list = Array.isArray(res) ? res : res?.polls || [];
  return list.map((p) => ({
    ...p,
    votes: (p.votes || []).filter((v) => v && v.user_id && typeof v.option === 'number'),
  }));
}

export const createCrewPoll = (
  crewId: string,
  payload: { question: string; options: string[]; closesAt?: string; multiAnswer: boolean },
) => api.post(pollsPath(crewId), payload);

export const voteCrewPoll = (crewId: string, pollId: string, optionIndexes: number[]) =>
  api.post(`${pollsPath(crewId)}/${encodeURIComponent(pollId)}/vote`, { optionIndexes });
