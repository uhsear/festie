import { describe, it, expect } from 'vitest';
import { describeCrewActivity } from './crewActivity';

const at = '2026-06-06T23:40:00.000Z';

describe('describeCrewActivity', () => {
  it('drops coordinates from a raised SOS', () => {
    expect(describeCrewActivity({ type: 'sos_raised', detail: 'Need help @28.5,-81.4', created_at: at })).toEqual({
      verb: 'raised an SOS',
      detail: 'Need help',
    });
  });

  it('gives null detail when only coordinates are left', () => {
    expect(describeCrewActivity({ type: 'sos_raised', detail: '@28.5,-81.4', created_at: at }).detail).toBeNull();
  });

  it('describes a self-clear and an other-clear with the clock', () => {
    expect(describeCrewActivity({ type: 'sos_cleared', detail: null, created_at: at }, 'UTC')).toEqual({
      verb: 'is safe — cleared their SOS at 11:40 PM',
      detail: null,
    });
    expect(describeCrewActivity({ type: 'sos_cleared', detail: 'Maya', created_at: at }, 'UTC')).toEqual({
      verb: "marked Maya's SOS resolved at 11:40 PM",
      detail: null,
    });
  });

  it('falls back to a readable type', () => {
    expect(describeCrewActivity({ type: 'foo_bar', detail: 'x', created_at: at })).toEqual({ verb: 'foo bar', detail: 'x' });
    expect(describeCrewActivity({ type: 'member-joined', detail: null, created_at: at }).verb).toBe('joined the crew');
  });
});
