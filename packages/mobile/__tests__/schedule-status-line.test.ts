// Source-level guards (mobile vitest runs in plain node, no RN renderer).
import { read } from './read-source';

describe('Lineup and Picks header status line', () => {
  it('ScheduleControls renders one status line, not a freshness chip beside a separate save chip', () => {
    const src = read('components/schedule/ScheduleControls.tsx');
    expect(src).toContain('<ScheduleStatusLine showSave={!!currentProfile} />');
    expect(src).not.toContain('<SaveStatusChip');
    expect(src).not.toContain('<FreshnessChip');
  });

  it('the line holds a minimum height and keeps both the freshness and save chips', () => {
    const src = read('components/ScheduleStatusLine.tsx');
    expect(src).toContain('<FreshnessChip surface="schedule" />');
    expect(src).toContain('<SaveStatusChip />');
    expect(src).toMatch(/minHeight: 32/);
  });
});
