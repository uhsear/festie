import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const crew = read('app/(tabs)/crew.tsx');

describe('T26 mobile crew layout', () => {
  it('drops the Find "Share plan" row but keeps the Plan one', () => {
    expect(crew).not.toContain('testID="crew-action-share-plan"');
    expect(crew).toContain('crew-action-share-plan-planning');
  });

  it('no longer reads map-pin params', () => {
    expect(crew).not.toContain('mpLat');
  });

  it('orders Home Base, meeting points, then status in Find', () => {
    const home = crew.indexOf('<CrewHomeBase');
    const points = crew.indexOf('<CrewMeetingPoints');
    const status = crew.indexOf('<CrewStatus');
    expect(home).toBeGreaterThan(-1);
    expect(home).toBeLessThan(points);
    expect(points).toBeLessThan(status);
  });

  it('has the Plan index chips', () => {
    for (const key of ['polls', 'packing', 'rides']) expect(crew).toContain(`plan-index-${key}`);
  });

  it('Now & Next shows the wrap-up card after the festival', () => {
    const fm = read('app/festival-mode.tsx');
    expect(fm).toContain('CrewWrapUp');
    expect(fm).toContain("phase === 'after'");
  });
});
