import { describe, it, expect } from 'vitest';
import { PRIORITY_SYMBOLS } from '@festie/shared/constants';
import { PRIORITY_BUTTONS, priorityIconName } from './prioritySymbol';

describe('prioritySymbol', () => {
  it('lists must, want-to-see, maybe in order with distinct icons', () => {
    expect(PRIORITY_BUTTONS.map((b) => b.value)).toEqual(['must', 'want-to-see', 'maybe']);
    expect(new Set(PRIORITY_BUTTONS.map((b) => b.icon)).size).toBe(3);
  });

  it('takes labels from the shared symbol set', () => {
    for (const b of PRIORITY_BUTTONS) {
      expect(b.label).toBe(PRIORITY_SYMBOLS[b.value].label);
      expect(b.short).toBe(PRIORITY_SYMBOLS[b.value].short);
    }
  });

  it('maps the shared icon keys to Ionicons names', () => {
    expect(priorityIconName('must')).toBe('star');
    expect(priorityIconName('want-to-see')).toBe('heart');
    expect(priorityIconName('maybe')).toBe('ellipse');
  });
});
