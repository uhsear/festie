import { describe, it, expect } from 'vitest';
import type { CrewMeetingPoint, CrewMemberStatus } from '../types/domain';
import type { NowNextSelection } from './dayOf';
import {
  arrivalTarget,
  crewStatusLabel,
  isStatusFresh,
  noStatusLine,
  presetStageName,
  statusNoteLine,
} from './crewStatus';

const NOW = Date.parse('2026-09-04T21:00:00Z');
const MIN = 60_000;

describe('crewStatusLabel', () => {
  it('labels each key', () => {
    const l = (status: string) => crewStatusLabel({ status });
    expect(l('on-my-way')).toBe('On my way');
    expect(l('here')).toBe("I'm here");
    expect(l('delayed')).toBe('Running late');
    expect(l('at-camp')).toBe('At camp');
    expect(l('break')).toBe('Taking a break');
    expect(l('lost')).toBe('Lost — come find me');
  });

  it('puts the stage in the at-stage label', () => {
    expect(crewStatusLabel({ status: 'at-stage', note: 'Main Stage' })).toBe('At Main Stage');
    expect(crewStatusLabel({ status: 'at-stage' })).toBe('At a stage');
  });

  it('gives null for null and unknown values', () => {
    expect(crewStatusLabel({ status: 'asleep' })).toBeNull();
    expect(crewStatusLabel({ status: null })).toBeNull();
  });
});

describe('statusNoteLine', () => {
  it('is null for at-stage and the note otherwise', () => {
    expect(statusNoteLine({ status: 'at-stage', note: 'Main Stage' })).toBeNull();
    expect(statusNoteLine({ status: 'lost', note: 'by the bar' })).toBe('by the bar');
    expect(statusNoteLine({ status: 'lost', note: '' })).toBeNull();
  });
});

describe('isStatusFresh', () => {
  const at = (ms: number) => ({ status: 'here', updated_at: new Date(NOW - ms).toISOString() });
  it('is true under 4 hours and false at 4 hours', () => {
    expect(isStatusFresh(at(239 * MIN), NOW)).toBe(true);
    expect(isStatusFresh(at(240 * MIN), NOW)).toBe(false);
  });
  it('is false for a missing status or a bad date', () => {
    expect(isStatusFresh({ status: null, updated_at: new Date(NOW).toISOString() }, NOW)).toBe(false);
    expect(isStatusFresh({ status: 'here', updated_at: 'nope' }, NOW)).toBe(false);
    expect(isStatusFresh(null, NOW)).toBe(false);
  });
});

describe('presetStageName', () => {
  const set = (stageId: string, start: number) => ({ set: { stageId }, start, end: start + 30 * MIN, priority: null });
  const sel = (current: unknown[], upcoming: unknown[]) => ({ current, upcoming }) as unknown as NowNextSelection;
  const names = (id: string) => ({ s1: 'Main Stage', s2: 'Tent' })[id];

  it('prefers a set playing now', () => {
    expect(presetStageName(sel([set('s1', NOW - MIN)], [set('s2', NOW + 10 * MIN)]), NOW, names)).toBe('Main Stage');
  });
  it('uses an upcoming set within the hour only', () => {
    expect(presetStageName(sel([], [set('s2', NOW + 30 * MIN)]), NOW, names)).toBe('Tent');
    expect(presetStageName(sel([], [set('s2', NOW + 90 * MIN)]), NOW, names)).toBeNull();
  });
});

describe('arrivalTarget', () => {
  const point = (over: Partial<CrewMeetingPoint> = {}) =>
    ({ id: 'p1', label: 'Big tree', latitude: 28.1, longitude: -81.2, ...over }) as CrewMeetingPoint;
  const mine = (over: Partial<CrewMemberStatus> = {}) =>
    ({
      status: 'on-my-way',
      target_meeting_point_id: 'p1',
      updated_at: new Date(NOW - 10 * MIN).toISOString(),
      ...over,
    }) as CrewMemberStatus;
  // 0.0001 degrees of latitude is about 11 m.
  const near = (m: number) => ({ lat: 28.1 + (m / 11.1) * 0.0001, lng: -81.2 });

  it('returns the point within 50 m only', () => {
    expect(arrivalTarget(mine(), [point()], near(20), NOW)?.id).toBe('p1');
    expect(arrivalTarget(mine(), [point()], near(80), NOW)).toBeNull();
  });
  it('needs a fresh on-my-way status', () => {
    expect(arrivalTarget(mine({ status: 'here' }), [point()], near(20), NOW)).toBeNull();
    const old = new Date(NOW - 5 * 60 * MIN).toISOString();
    expect(arrivalTarget(mine({ updated_at: old }), [point()], near(20), NOW)).toBeNull();
  });
  it('needs a target with coordinates', () => {
    expect(arrivalTarget(mine(), [point({ latitude: null, longitude: null })], near(20), NOW)).toBeNull();
  });
});

describe('noStatusLine', () => {
  it('pluralizes members', () => {
    expect(noStatusLine(1)).toBe('No one has shared a status yet · 1 member');
    expect(noStatusLine(9)).toBe('No one has shared a status yet · 9 members');
  });
});
