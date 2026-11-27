import { describe, it, expect } from 'vitest';
import { sectionHeading } from './styles';

describe('sectionHeading', () => {
  it('starts at the card edge: no horizontal inset, so eyebrows and cards share one left edge', () => {
    expect(sectionHeading).not.toMatch(/\bpx-\d/);
    expect(sectionHeading).toContain('uppercase');
  });
});
