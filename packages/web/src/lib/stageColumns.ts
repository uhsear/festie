/** Columns of stage groups on the cards view at the md, lg and xl breakpoints. */
export interface StageColumnCounts {
  md: number;
  lg: number;
  xl: number;
}

/**
 * One column per stage, but never a lone orphan row: 4 stages at lg make 2x2 (not 3+1), and 5 or 6 stages at xl make 3+2 or 3+3
 * (not 4+1 or 4+2). Counts are explicit because auto-fill wraps the last stage under the others whenever the width fits n-1 columns.
 */
export function stageColumnCounts(stageGroups: number): StageColumnCounts {
  const n = Math.max(1, stageGroups);
  return {
    md: Math.min(n, 2),
    lg: n <= 3 ? n : 2,
    xl: n <= 4 || n >= 7 ? Math.min(n, 4) : 3,
  };
}
