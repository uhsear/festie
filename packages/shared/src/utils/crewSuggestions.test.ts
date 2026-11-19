import { describe, it, expect } from 'vitest';
import { goingLabel, addLabel, clusterLabel, crewGoingLabel } from './crewSuggestions';

describe('crew suggestion copy', () => {
  it('phrases the count caption', () => {
    expect(goingLabel(3, '2 must, 1 want')).toBe('3 going — 2 must, 1 want');
    expect(goingLabel(2, '')).toBe('2 going');
  });

  it('phrases the Add accessibility label', () => {
    expect(addLabel('Aphex Twin', 3, '2 must, 1 want')).toBe(
      'Add Aphex Twin to my picks — 3 crew going: 2 must, 1 want',
    );
    expect(addLabel('Aphex Twin', 1, '')).toBe('Add Aphex Twin to my picks');
  });

  it('phrases the avatar cluster accessibility label', () => {
    expect(clusterLabel('Aphex Twin', 3, '2 must, 1 want')).toBe(
      '3 crew members going to Aphex Twin — 2 must, 1 want',
    );
    // Singular, and no breakdown when the shared builder produced none.
    expect(clusterLabel('Aphex Twin', 1, '')).toBe('1 crew member going to Aphex Twin');
  });

  it('phrases the conflict-card crew line', () => {
    expect(crewGoingLabel(3, '2 must, 1 want')).toBe('3 crew going — 2 must, 1 want');
    expect(crewGoingLabel(2, '')).toBe('2 crew going');
  });
});
