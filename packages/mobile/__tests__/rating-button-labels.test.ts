import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

describe('t11 rating buttons source guard', () => {
  const src = readFileSync(join(__dirname, '..', 'components/RatingButtons.tsx'), 'utf8');
  it('uses the shared caption and shows a label under each icon', () => {
    expect(src).toContain('ratingCaption(');
    expect(src).toContain('styles.optionLabel');
  });
});

describe('dp-40 rating meter source guard', () => {
  const src = readFileSync(join(__dirname, '..', 'components/RatingButtons.tsx'), 'utf8');
  it('selects with the aqua token, never amber or hex concatenation', () => {
    expect(src).not.toContain('accent.amber');
    expect(src).not.toContain("+ '40'");
    expect(src).toContain('aquaAlpha[20]');
  });
  it('prints a label only on the active step and lets a list hide the caption', () => {
    expect(src).toContain("{active ? r.label : ''}");
    expect(src).toContain('showCaption');
  });
});
