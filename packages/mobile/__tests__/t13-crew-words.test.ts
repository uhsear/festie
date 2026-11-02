import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('T13 crew words', () => {
  it.each(['app/crew-compare.tsx', 'app/crew-plan.tsx', 'app/(tabs)/map.tsx', 'app/(tabs)/crew.tsx'])(
    '%s says "Sign in to", not "Log in to"',
    (f) => {
      expect(read(f)).not.toContain('Log in to');
    },
  );
  it.each(['app/find.tsx', 'app/(tabs)/crew.tsx'])('%s does not say "Find each other"', (f) => {
    expect(read(f)).not.toContain('Find each other');
  });
  it('meeting points use the shared kinds', () => {
    const src = read('components/CrewMeetingPoints.tsx');
    expect(src).not.toContain('Pre-show');
    expect(src).toContain('MEETING_POINT_KINDS');
  });
  it('map header is "Map", not the crew name', () => {
    expect(read('app/(tabs)/map.tsx')).not.toContain('<HeaderTitle>{activeCrew.name}');
  });
});
