import { describe, it, expect } from 'vitest';
import { describeSetMove, SET_MOVE_WINDOW_MS } from './setMoves';

const NOW = Date.parse('2026-09-05T20:00:00Z');
const movedAt = new Date(NOW - 60_000).toISOString();
const days = [{ date: '2026-09-04', label: 'Fri' }, { date: '2026-09-05', label: 'Sat' }];
const ctx = { days, stageName: (id: string) => (id === 'sahara' ? 'Sahara' : undefined), nowMs: NOW };
const from = { dayIndex: 1, stageId: 'sahara', start: '22:00', end: '23:00' };

describe('describeSetMove', () => {
  it('returns null without a mark, with a bad date, and at 48 h', () => {
    expect(describeSetMove({ startTime: '22:30' }, ctx)).toBeNull();
    expect(describeSetMove({ movedAt: 'nope', movedFrom: from, startTime: '22:30' }, ctx)).toBeNull();
    const old = new Date(NOW - SET_MOVE_WINDOW_MS).toISOString();
    expect(describeSetMove({ movedAt: old, movedFrom: from, startTime: '22:30' }, ctx)).toBeNull();
  });

  it('builds the line, with the long weekday in a11y', () => {
    const n = describeSetMove({ movedAt, movedFrom: from, startTime: '22:30' }, ctx)!;
    expect(n.chip).toBe('Moved');
    expect(n.line).toBe('Moved from Sat 10:00 PM, Sahara');
    expect(n.a11y).toBe('Moved from Saturday 10:00 PM, Sahara');
  });

  it('shows the range when only the end moved', () => {
    const n = describeSetMove({ movedAt, movedFrom: from, startTime: '22:00' }, ctx)!;
    expect(n.line).toBe('Moved from Sat 10:00 PM - 11:00 PM, Sahara');
  });

  it('leaves out a missing stage, day or time', () => {
    const l = (f: object, c = ctx) => describeSetMove({ movedAt, movedFrom: { ...from, ...f }, startTime: '22:30' }, c)!.line;
    expect(l({ stageId: 'gone' })).toBe('Moved from Sat 10:00 PM');
    expect(l({ stageId: null })).toBe('Moved from Sat 10:00 PM');
    expect(l({ start: null, dayIndex: 0 })).toBe('Moved from Fri, Sahara');
    expect(l({ dayIndex: -1 })).toBe('Moved from 10:00 PM, Sahara');
    expect(l({ dayIndex: -1, start: null, stageId: null })).toBe('Moved');
  });

  it('falls back to the label when the day has no date', () => {
    const c = { ...ctx, days: [{ date: '', label: 'Opening' }] };
    const n = describeSetMove({ movedAt, movedFrom: { ...from, dayIndex: 0 }, startTime: '22:30' }, c)!;
    expect(n.a11y).toBe('Moved from Opening 10:00 PM, Sahara');
  });
});
