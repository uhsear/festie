import { PRIORITY_SYMBOLS } from '@festie/shared/constants';
import { QUICK_PICK_ACTIONS, priorityForAction } from './quickPick';

describe('quickPick', () => {
  it('maps each action to its priority', () => {
    expect(priorityForAction('must')).toBe('must');
    expect(priorityForAction('want-to-see')).toBe('want-to-see');
    expect(priorityForAction('maybe')).toBe('maybe');
  });
  it('maps clear to null and unknown to undefined', () => {
    expect(priorityForAction('clear')).toBeNull();
    expect(priorityForAction('nope')).toBeUndefined();
  });
  it('labels equal PRIORITY_SYMBOLS', () => {
    for (const a of QUICK_PICK_ACTIONS) {
      const p = priorityForAction(a.name);
      if (p) expect(a.label).toBe(PRIORITY_SYMBOLS[p].label);
    }
  });
});
