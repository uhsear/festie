import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('t21 mobile clash badge source guards', () => {
  it('SetCardMobile shows clashLabel on one truncating line in the conflict badge', () => {
    const src = read('components/SetCardMobile.tsx');
    expect(src).toContain('clashLabel');
    expect(src).toMatch(/styles\.conflictText\}\s+numberOfLines=\{1\}/);
    expect(src).toContain('prev.clashLabel !== next.clashLabel');
  });

  it('schedule index builds the badge map and passes the label', () => {
    const src = read('app/(tabs)/index.tsx');
    expect(src).toContain('clashBadgeBySetId');
    expect(src).toContain('clashLabel={clashBadges.get(set.id)?.label}');
  });
});
