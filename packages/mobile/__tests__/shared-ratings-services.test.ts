import { describe, it, expect } from 'vitest';
import { read } from './read-source';

describe('rating and wrap calls go through the shared services', () => {
  const buttons = read('components/RatingButtons.tsx');

  it('RatingButtons rates, clears and loads through rateSet, clearSetRating and fetchFestivalRatings', () => {
    expect(buttons).toMatch(/import \{[^}]*\brateSet\b[^}]*\} from '@festie\/shared\/services'/);
    expect(buttons).toMatch(/import \{[^}]*\bclearSetRating\b[^}]*\} from '@festie\/shared\/services'/);
    expect(buttons).toMatch(/import \{[^}]*\bfetchFestivalRatings\b[^}]*\} from '@festie\/shared\/services'/);
    expect(buttons).toContain('await rateSet(setId, n)');
    expect(buttons).toContain('await clearSetRating(setId)');
    expect(buttons).toContain('await rateSet(setId, current, text)');
    expect(buttons).not.toMatch(/api\.(get|post|delete)\(/);
  });

  it.each([
    'app/wrap.tsx',
    'app/rate.tsx',
    'app/caught.tsx',
    'app/set/[setId].tsx',
    'components/RatingButtons.tsx',
    'components/RateNightBanner.tsx',
    'components/CaughtNowCard.tsx',
    'components/AccountHistorySection.tsx',
  ])('%s has no inline ratings, crew-wrap or locate-set request', (file) => {
    expect(read(file)).not.toMatch(/api\s*\.\s*(get|post|put|delete)(<[^>]*>)?\(\s*[`'"]\/(ratings|festivals\/locate-set)/);
  });
});
