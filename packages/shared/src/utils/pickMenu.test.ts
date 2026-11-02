import { describe, expect, it } from 'vitest';
import { pickMenuItems, nextPickFromMenu } from './pickMenu';

describe('pickMenuItems', () => {
  it('lists three priorities with none selected and no remove when there is no pick', () => {
    const items = pickMenuItems(null);
    expect(items.map((i) => i.label)).toEqual(['Must See', 'Want to See', 'Maybe']);
    expect(items.some((i) => i.selected)).toBe(false);
  });

  it('marks the current priority and ends with remove', () => {
    const items = pickMenuItems('maybe');
    expect(items.filter((i) => i.selected).map((i) => i.key)).toEqual(['maybe']);
    expect(items.at(-1)).toEqual({ key: 'remove', label: 'Remove pick', selected: false });
  });
});

describe('nextPickFromMenu', () => {
  it('clears the pick for remove', () => expect(nextPickFromMenu('must', 'remove')).toBeNull());
  it('clears the pick when the current priority is chosen again', () =>
    expect(nextPickFromMenu('must', 'must')).toBeNull());
  it('returns a different priority', () => expect(nextPickFromMenu('must', 'maybe')).toBe('maybe'));
  it('sets a priority when there is no pick', () => expect(nextPickFromMenu(null, 'want-to-see')).toBe('want-to-see'));
});
