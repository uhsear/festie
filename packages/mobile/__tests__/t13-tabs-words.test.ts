import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('T13 tabs, picks, wrap, account and clash words', () => {
  it('tab layout no longer uses the star for Picks', () => {
    expect(read('app/(tabs)/_layout.tsx')).not.toContain("'star'");
  });
  it('PhaseHomeActions uses no star, sparkles or "Find each other"', () => {
    const src = read('components/PhaseHomeActions.tsx');
    expect(src).not.toContain("'star'");
    expect(src).not.toContain("'sparkles'");
    expect(src).not.toContain('Find each other');
  });
  it('account says "Sign out", never "Sign Out"', () => {
    expect(read('app/(tabs)/account.tsx')).not.toContain('Sign Out');
  });
  it('ClashPrompt uses the shared clash copy', () => {
    const src = read('components/ClashPrompt.tsx');
    expect(src).toContain('clashPromptCopy');
    expect(src).not.toContain('You have a conflict');
  });
});
