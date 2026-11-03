import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('T13 live words and colour', () => {
  it('LiveDot uses coral, not aqua, for the dot', () => {
    const src = read('components/LiveDot.tsx');
    expect(src).toContain('accent.coral');
    expect(src).not.toContain('backgroundColor: t.colors.accent.aqua');
  });
  it('SetCardMobile says Clash, not Conflict', () => {
    expect(read('components/SetCardMobile.tsx')).not.toContain('>Conflict<');
  });
  it('TimelineView jump-to-now button uses the concept icon, not a music icon', () => {
    const src = read('components/TimelineView.tsx');
    expect(src).toContain('CONCEPT_IONICON.jumpToNow');
    expect(src).not.toContain('name="musical-notes" size={16}');
  });
});
