import type { FestivalSet } from '../types';

// Superset FestivalSet fixture for tests. Callers whose defaults differ wrap it in a
// local adapter that passes the differing fields as overrides.
export function makeFestivalSet(overrides: Partial<FestivalSet> = {}): FestivalSet {
  return {
    id: 'set-1',
    festivalId: 'fest-1',
    stageId: 'stage-1',
    startTime: '14:00',
    endTime: '15:00',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}
