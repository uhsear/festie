import { describe, it, expect } from 'vitest';
import { read } from './read-source';


describe('ios round 2 crew-safety source guards', () => {
  it('CrewSos banner View is not an accessible container', () => {
    expect(read('components/CrewSos.tsx')).not.toMatch(/style=\{styles\.banner\}[^>]*accessible\b/);
  });
  it('CrewLiveLocation chooser is not an accessible container', () => {
    expect(read('components/CrewLiveLocation.tsx')).not.toContain('styles.chooser} accessible');
  });
  it('crew.tsx has no in-page SOS chip: the one SosControl is mounted instead', () => {
    const src = read('app/(tabs)/crew.tsx');
    expect(src).not.toContain('crew-action-sos');
    expect(src).toContain('<SosControl');
  });
  it('CrewStatus header wraps', () => {
    expect(read('components/CrewStatus.tsx')).toMatch(/header: \{[^}]*flexWrap/);
  });
  it('crew-plan uses the priority color', () => {
    expect(read('app/crew-plan.tsx')).toContain('priorityColor(t, g.priority)');
  });
  it('PlanQRShare has an empty state and no legend', () => {
    const src = read('components/PlanQRShare.tsx');
    expect(src).toContain('picksCount === 0');
    expect(src).not.toContain('styles.legend');
  });
});
