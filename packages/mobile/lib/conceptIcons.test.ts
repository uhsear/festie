import { describe, it, expect } from 'vitest';
import { CONCEPT_IONICON } from './conceptIcons';

describe('CONCEPT_IONICON', () => {
  const names = Object.values(CONCEPT_IONICON);
  it('maps all eight concepts', () => {
    expect(names).toHaveLength(8);
    for (const n of names) expect(n).toBeTruthy();
  });
  it('keeps star and sparkles out', () => {
    expect(names).not.toContain('star');
    expect(names).not.toContain('sparkles');
  });
  it('gives every concept its own icon', () => {
    expect(new Set(names).size).toBe(names.length);
  });
});
