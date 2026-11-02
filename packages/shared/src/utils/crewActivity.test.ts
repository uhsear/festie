import { describe, it, expect } from 'vitest';
import { describeCrewActivity, visibleCrewActivity, crewNoticeText } from './crewActivity';

const at = '2026-06-06T23:40:00.000Z';

describe('describeCrewActivity', () => {
  it('drops coordinates from a raised SOS', () => {
    expect(describeCrewActivity({ type: 'sos_raised', detail: 'Need help @28.5,-81.4', created_at: at })).toEqual({
      verb: 'raised an SOS',
      detail: 'Need help',
      action: null,
    });
  });

  it('gives null detail when only coordinates are left', () => {
    expect(describeCrewActivity({ type: 'sos_raised', detail: '@28.5,-81.4', created_at: at }).detail).toBeNull();
  });

  it('describes a self-clear and an other-clear with the clock', () => {
    expect(describeCrewActivity({ type: 'sos_cleared', detail: null, created_at: at }, 'UTC')).toEqual({
      verb: 'is safe — cleared their SOS at 11:40 PM',
      detail: null,
      action: null,
    });
    expect(describeCrewActivity({ type: 'sos_cleared', detail: 'Maya', created_at: at }, 'UTC')).toEqual({
      verb: "marked Maya's SOS resolved at 11:40 PM",
      detail: null,
      action: null,
    });
  });

  it('falls back to a readable type', () => {
    expect(describeCrewActivity({ type: 'foo_bar', detail: 'x', created_at: at })).toEqual({
      verb: 'foo bar',
      detail: 'x',
      action: null,
    });
    expect(describeCrewActivity({ type: 'member-joined', detail: null, created_at: at }).verb).toBe('joined the crew');
  });
});

describe('crew feed additions', () => {
  it('writes the owner-change line', () => {
    expect(describeCrewActivity({ type: 'owner-changed', detail: 'Sam', created_at: at })).toEqual({
      verb: 'made Sam the crew owner',
      detail: null,
      action: null,
    });
  });

  it('turns a raw user id in an old settle row into a name', () => {
    const members = [{ userId: 'u-9', username: 'sam', name: 'Sam' }];
    const row = { type: 'expense_settled', detail: '$12.00 to u-9', created_at: at };
    expect(describeCrewActivity(row, undefined, { members })).toEqual({
      verb: 'settled up',
      detail: '$12.00 to Sam',
      action: null,
    });
    const named = { ...row, type: 'expense-settled', detail: '$12.00 to Sam' };
    expect(describeCrewActivity(named, undefined, { members }).detail).toBe('$12.00 to Sam');
  });

  it('hides the album URL', () => {
    expect(describeCrewActivity({ type: 'photo-album-updated', detail: 'https://x.test/a', created_at: at }).detail).toBeNull();
  });

  it('offers show-sos only for a user with an active SOS', () => {
    const row = { type: 'sos_raised', detail: 'help', created_at: at, user_id: 'u1' };
    expect(describeCrewActivity(row, undefined, { activeSosUserIds: new Set(['u1']) }).action).toBe('show-sos');
    expect(describeCrewActivity(row, undefined, { activeSosUserIds: new Set(['u2']) }).action).toBeNull();
    expect(describeCrewActivity(row).action).toBeNull();
  });

  it('drops poll-voted rows', () => {
    expect(visibleCrewActivity([{ type: 'poll-voted' }, { type: 'poll-closed' }])).toEqual([{ type: 'poll-closed' }]);
  });

  it('words the crew notices', () => {
    expect(crewNoticeText('removed', 'Desert Rats')).toEqual({
      title: 'Removed from crew',
      message: 'You were removed from Desert Rats.',
    });
    expect(crewNoticeText('removed', null).message).toBe('You were removed from a crew.');
    expect(crewNoticeText('deleted', 'Desert Rats')).toEqual({
      title: 'Crew deleted',
      message: 'Desert Rats was deleted by its owner.',
    });
    expect(crewNoticeText('deleted', null).message).toBe('Your crew was deleted by its owner.');
  });
});
