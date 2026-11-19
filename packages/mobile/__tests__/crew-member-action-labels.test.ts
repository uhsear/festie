import { describe, it, expect } from 'vitest';
import { read } from './read-source';


describe('t11 crew member actions are labelled', () => {
  it('crew.tsx uses a Manage disclosure with text buttons', () => {
    const src = read('app/(tabs)/crew.tsx');
    expect(src).toContain('extraData={managingMemberId}');
    expect(src).toContain('label="Remove from crew"');
    expect(src).not.toContain('name="swap-horizontal"');
    expect(src).not.toContain('name="person-remove-outline"');
  });
});
