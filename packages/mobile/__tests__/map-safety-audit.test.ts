import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('Map tab SOS FAB and empty states', () => {
  const map = read('app/(tabs)/map.tsx');
  const hook = read('hooks/useSosRaise.ts');

  it('disables and spins the FAB while raising, and says SOS active for your own SOS', () => {
    expect(map).toContain('const { confirmRaise, raising } = useSosRaise');
    expect(map).toContain('disabled={raising}');
    expect(map).toContain('<ActivityIndicator');
    expect(map).toContain("{mySosActive ? 'SOS active' : 'SOS'}");
    expect(map).toContain('Your SOS is active. Open crew to mark yourself safe');
  });

  it('guards a double raise with a ref and confirms a sent SOS with a toast', () => {
    expect(hook).toContain('inFlight.current');
    expect(hook).toContain("showToast('SOS sent to your crew', { kind: 'success' })");
    expect(hook).toContain('SOS sent without your location');
    expect(hook).toContain("'SOS not sent'");
  });

  it('branches the no-festival state on load state, like the grid', () => {
    expect(map).toContain('festivalLoadState({ currentFestival, festivals');
    expect(map).toContain('COPY.festivalLoad.errorTitle');
    expect(map).toContain('<LoadingState />');
    expect(map).toContain("label: 'Choose a festival'");
  });
});
