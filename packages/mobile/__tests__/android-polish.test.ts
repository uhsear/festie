import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source-level guards: mobile tests run in plain node with no RN render harness.
const read = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');

describe('android polish', () => {
  it('confirms before a long-press removes a packing item', () => {
    const src = read('components/CrewPacking.tsx');
    expect(src).toContain('onLongPress: () => confirmDelete(item)');
    expect(src).toMatch(/Alert\.alert\('Remove item'/);
  });
  it('keeps the crew header title on one line', () => {
    expect(read('app/(tabs)/crew.tsx')).not.toContain('titleLines');
  });
  it('applies the Fabric label fix to the set sheet pick buttons', () => {
    const src = read('app/set/[setId].tsx');
    expect(src).toMatch(/textBreakStrategy="simple"\s*>\s*\{option\.short \+ '\u00A0'\}/);
  });
});
