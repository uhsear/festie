import { describe, expect, it } from 'vitest';
import { read } from '../__tests__/read-source';

describe('empty states are wired to EmptyState with an illustration', () => {
  it.each([
    ['app/(tabs)/crew.tsx', 'illustration="noCrew"', 'No crew yet'],
    ['app/(tabs)/picks.tsx', 'illustration="noPicks"', 'No picks yet'],
    ['components/CrewExpenses.tsx', 'illustration="emptyList"', 'No expenses yet'],
    ['components/CrewPolls.tsx', 'illustration="emptyList"', 'No polls yet'],
  ])('%s', (file, illustration, title) => {
    const src = read(file);
    expect(src).toContain('illustration="');
    expect(src).toContain(illustration);
    expect(src).toContain(`title="${title}"`);
  });
});
