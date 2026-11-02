import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const src = readFileSync(join(__dirname, '..', 'app/crew-plan.tsx'), 'utf8');

describe('crew-plan hub source guards', () => {
  it.each([
    'useCrewHub(',
    'useCrewFestival(',
    'useActiveCrew(',
    'How the crew did',
    'Crew mix',
    'Where everyone is',
    'Open polls',
    '/set/${',
    'Ask ',
  ])('contains %s', (needle) => {
    expect(src).toContain(needle);
  });
  it.each(['variant="ghost"', 'buildSlots('])('does not contain %s', (needle) => {
    expect(src).not.toContain(needle);
  });
});
