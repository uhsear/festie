import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('ios round 2 crew-safety source guards', () => {
  it('CrewSos banner View is not an accessible container', () => {
    expect(read('components/CrewSos.tsx')).not.toMatch(/style=\{styles\.banner\}[^>]*accessible\b/);
  });
  it('CrewLiveLocation chooser is not an accessible container', () => {
    expect(read('components/CrewLiveLocation.tsx')).not.toContain('styles.chooser} accessible');
  });
  it('crew.tsx hides the SOS chip on the Find tab', () => {
    expect(read('app/(tabs)/crew.tsx')).toContain("crewTab !== 'find'");
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
