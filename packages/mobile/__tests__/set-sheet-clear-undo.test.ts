import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sheet = readFileSync(join(__dirname, '..', 'app/set/[setId].tsx'), 'utf8');
const prompt = readFileSync(join(__dirname, '..', 'components/ClashPrompt.tsx'), 'utf8');

describe('T20 mobile set sheet and clash prompt', () => {
  it('clears picks through the shared undo hook', () => {
    expect(sheet).toContain('usePickClear(');
  });
  it('keeps a quiet "Clashes with" line and passes a label to onClear', () => {
    expect(prompt).toContain('clashesWith(');
    expect(prompt).toMatch(/onClear\([^,)]+,/);
  });
  it('renders toasts above the iOS formSheet, so an Undo fired from the sheet is visible', () => {
    const toaster = readFileSync(join(__dirname, '..', 'components/Toaster.tsx'), 'utf8');
    expect(toaster).toContain("from 'react-native-screens'");
    expect(toaster).toMatch(/Platform\.OS === 'ios' \? <FullWindowOverlay>\{host\}<\/FullWindowOverlay> : host/);
  });
});
