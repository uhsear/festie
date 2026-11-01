import { describe, it, expect } from 'vitest';
import {
  APP_SECTIONS,
  CREW_TABS,
  PHASE_ACTION_ORDER,
  parseCrewTab,
} from './navigation';

describe('navigation constants', () => {
  it('lists the five sections in order', () => {
    expect(APP_SECTIONS.map((s) => s.label)).toEqual(['Lineup', 'My Plan', 'Crew', 'Map', 'More']);
  });

  it('lists the four crew tabs in order', () => {
    expect(CREW_TABS.map((t) => t.key)).toEqual(['find', 'members', 'plan', 'money']);
  });

  it('parseCrewTab returns canonical keys', () => {
    for (const t of CREW_TABS) expect(parseCrewTab(t.key)).toBe(t.key);
  });

  it('parseCrewTab maps old keys', () => {
    const aliases = {
      logistics: 'find', meeting: 'find', meet: 'find', activity: 'find',
      polls: 'plan', packing: 'plan', rides: 'plan', expenses: 'money',
    };
    for (const [old, next] of Object.entries(aliases)) expect(parseCrewTab(old)).toBe(next);
  });

  it('parseCrewTab rejects non-matching input', () => {
    for (const v of [undefined, '', 'nope', ['find'], 3, 'constructor']) {
      expect(parseCrewTab(v)).toBeNull();
    }
  });

  it('phase order has each action once and leads with wrap after the festival', () => {
    for (const order of Object.values(PHASE_ACTION_ORDER)) {
      expect([...order].sort()).toEqual(['crew', 'map', 'myPlan', 'nownext', 'wrap']);
    }
    expect(PHASE_ACTION_ORDER.post[0]).toBe('wrap');
  });
});
