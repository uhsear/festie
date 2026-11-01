import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

describe('T21 mobile Picks views (source guard)', () => {
  const picks = read('app/(tabs)/picks.tsx');

  it('picks.tsx wires My day, plan lists, clash cards and stages', () => {
    for (const needle of ['buildMyDay', 'buildPlanList', '<ClashCards', 'stages']) {
      expect(picks).toContain(needle);
    }
  });

  it('picks.tsx drops the inline clash banner', () => {
    expect(picks).not.toContain('ClashBannerInline');
    expect(picks).not.toContain('Tap to decide');
  });

  it('PlanRows.tsx uses typeStyle and the reminder lead label', () => {
    const rows = read('components/PlanRows.tsx');
    expect(rows).toContain('typeStyle(');
    expect(rows).toContain('reminderLeadLabel');
  });
});
