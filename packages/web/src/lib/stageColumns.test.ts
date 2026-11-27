import { describe, it, expect } from 'vitest';
import { stageColumnCounts } from './stageColumns';

describe('stageColumnCounts', () => {
  it('makes 4 stages a 2x2 block at lg and one row at xl, never 3+1', () => {
    expect(stageColumnCounts(4)).toEqual({ md: 2, lg: 2, xl: 4 });
  });

  it('gives one column per stage while they fit', () => {
    expect(stageColumnCounts(1)).toEqual({ md: 1, lg: 1, xl: 1 });
    expect(stageColumnCounts(2)).toEqual({ md: 2, lg: 2, xl: 2 });
    expect(stageColumnCounts(3)).toEqual({ md: 2, lg: 3, xl: 3 });
  });

  it('balances 5 and 6 stages at xl and caps wide lineups at 4 columns', () => {
    expect(stageColumnCounts(5).xl).toBe(3);
    expect(stageColumnCounts(6).xl).toBe(3);
    expect(stageColumnCounts(8).xl).toBe(4);
  });

  it('treats an empty list as one column', () => {
    expect(stageColumnCounts(0)).toEqual({ md: 1, lg: 1, xl: 1 });
  });
});
