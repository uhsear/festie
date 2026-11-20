import { api } from './api';
import type { CreateCrewExpenseRequest, CrewExpense, CrewSettlementPlan } from '../types';

const expensesPath = (crewId: string) => `/crews/${encodeURIComponent(crewId)}/expenses`;

export async function fetchCrewExpenses(crewId: string): Promise<CrewExpense[]> {
  const res = await api.get<CrewExpense[]>(expensesPath(crewId));
  return Array.isArray(res) ? res : [];
}

export async function fetchCrewSettlementPlan(crewId: string): Promise<CrewSettlementPlan> {
  const res = await api.get<CrewSettlementPlan>(`${expensesPath(crewId)}/settlement-plan`);
  return { balances: res?.balances ?? [], settlements: res?.settlements ?? [], currency: res?.currency };
}

export const createCrewExpense = (crewId: string, payload: CreateCrewExpenseRequest) =>
  api.post(expensesPath(crewId), payload);

export const deleteCrewExpense = (crewId: string, id: string) =>
  api.delete(`${expensesPath(crewId)}/${encodeURIComponent(id)}`);
