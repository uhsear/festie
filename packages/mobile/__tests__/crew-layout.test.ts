import { describe, expect, it } from 'vitest';
import { read } from './read-source';

const crew = read('app/(tabs)/crew.tsx');

describe('T26 mobile crew layout', () => {
  it('drops the Find "Share plan" row but keeps the Plan one', () => {
    expect(crew).not.toContain('testID="crew-action-share-plan"');
    expect(crew).toContain('crew-action-share-plan-planning');
  });

  it('keeps the crew lists clear of the floating SOS control', () => {
    expect(crew).toContain('SOS_CONTROL_CLEARANCE');
    expect(crew).toContain('paddingBottom: tabBottomPad');
    expect(crew).toContain('useListBottomInset({ base: SOS_CONTROL_CLEARANCE, includeSafeArea: false })');
  });

  it('no longer reads map-pin params', () => {
    expect(crew).not.toContain('mpLat');
  });

  it('orders Home Base, meeting points, then status in Find', () => {
    const find = read('components/crew/CrewFindTab.tsx');
    const home = find.indexOf('<CrewHomeBase');
    const points = find.indexOf('<CrewMeetingPoints');
    const status = find.indexOf('<CrewStatus');
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
