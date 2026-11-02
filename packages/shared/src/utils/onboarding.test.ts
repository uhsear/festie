import { describe, it, expect } from 'vitest';
import { ONBOARDING_SLIDES_SHARED, PRIORITY_LABELS } from '../constants/config';
import type { Festival } from '../types';
import { getIntroSteps, introCrewAction, introFestivalChoices, nextIntroStep } from './onboarding';

const NOW = new Date('2026-06-15T12:00:00Z');
const fest = (id: string, startDate: string, endDate: string): Festival => ({ id, name: id, startDate, endDate });

// live, two upcoming, four past (most recent first after sorting)
const festivals = [
  fest('past1', '2025-01-10', '2025-01-12'),
  fest('past2', '2025-03-10', '2025-03-12'),
  fest('up2', '2026-09-10', '2026-09-12'),
  fest('live', '2026-06-14', '2026-06-16'),
  fest('past3', '2025-05-10', '2025-05-12'),
  fest('up1', '2026-07-10', '2026-07-12'),
  fest('past4', '2025-08-10', '2025-08-12'),
];

describe('getIntroSteps / nextIntroStep', () => {
  it('drops the festival step when there are no festivals', () => {
    expect(getIntroSteps(0)).not.toContain('festival');
    expect(getIntroSteps(3)).toEqual(['plan', 'crew', 'reminders', 'festival', 'going']);
  });

  it('returns the next key and null after the last or for an unknown key', () => {
    const steps = getIntroSteps(3);
    expect(nextIntroStep(steps, 'plan')).toBe('crew');
    expect(nextIntroStep(steps, 'festival')).toBe('going');
    expect(nextIntroStep(steps, 'going')).toBeNull();
    expect(nextIntroStep(getIntroSteps(0), 'festival')).toBeNull();
  });
});

describe('introFestivalChoices', () => {
  it('returns five choices, live first, and defaults to the live one', () => {
    const { choices, defaultId } = introFestivalChoices(festivals, null, NOW);
    expect(choices).toHaveLength(5);
    expect(choices[0].id).toBe('live');
    expect(defaultId).toBe('live');
  });

  it('defaults to the current festival when it is in the list', () => {
    expect(introFestivalChoices(festivals, 'up1', NOW).defaultId).toBe('up1');
  });

  it('puts a current festival that sorts sixth in place of the fifth', () => {
    const sorted = introFestivalChoices(festivals, null, NOW).choices;
    const { choices, defaultId } = introFestivalChoices(festivals, 'past1', NOW);
    expect(sorted.some((f) => f.id === 'past1')).toBe(false);
    expect(choices).toHaveLength(5);
    expect(choices[4].id).toBe('past1');
    expect(choices.slice(0, 4)).toEqual(sorted.slice(0, 4));
    expect(defaultId).toBe('past1');
  });

  it('ignores an unknown current id and handles an empty list', () => {
    expect(introFestivalChoices(festivals, 'nope', NOW).defaultId).toBe('live');
    expect(introFestivalChoices([], null, NOW)).toEqual({ choices: [], defaultId: null });
  });
});

describe('introCrewAction', () => {
  it.each([
    ['solo', true, { start: null, needsAccount: false }],
    ['solo', false, { start: null, needsAccount: false }],
    ['start', true, { start: 'create', needsAccount: false }],
    ['start', false, { start: 'create', needsAccount: true }],
    ['join', true, { start: 'join', needsAccount: false }],
    ['join', false, { start: 'join', needsAccount: true }],
  ] as const)('%s signedIn=%s', (choice, signedIn, expected) => {
    expect(introCrewAction(choice, signedIn)).toEqual(expected);
  });
});

describe('onboarding copy', () => {
  it('has three slides and slide 1 names every priority label', () => {
    expect(ONBOARDING_SLIDES_SHARED).toHaveLength(3);
    for (const label of Object.values(PRIORITY_LABELS)) {
      expect(ONBOARDING_SLIDES_SHARED[0].description).toContain(label);
    }
  });
});
