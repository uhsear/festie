import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('t11 crew member actions are labelled', () => {
  it('crew.tsx uses a Manage disclosure with text buttons', () => {
    const src = read('app/(tabs)/crew.tsx');
    expect(src).toContain('extraData={managingMemberId}');
    expect(src).toContain('label="Remove from crew"');
    expect(src).not.toContain('name="swap-horizontal"');
    expect(src).not.toContain('name="person-remove-outline"');
  });
});
