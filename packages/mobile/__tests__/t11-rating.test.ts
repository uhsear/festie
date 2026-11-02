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
