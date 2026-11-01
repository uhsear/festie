import { describe, it, expect } from 'vitest';
import { buildPicksIcsExport, buildPicksIcs, describeIcsExport } from './ics';
import type { FestivalSet, Stage } from '../types';

const stages = [{ id: 'st1', name: 'Main' }] as unknown as Stage[];
const mk = (over: Record<string, unknown>) => ({ stageId: 'st1', artist: 'Artist', ...over }) as unknown as FestivalSet;
const run = (sets: FestivalSet[], extra: Record<string, unknown> = {}) =>
  buildPicksIcsExport({
    festival: { id: 'f1', name: 'Fest' },
    sets,
    stages,
    picks: Object.fromEntries(sets.map((s) => [s.id, 'must' as const])),
    ...extra,
  });

describe('buildPicksIcsExport', () => {
  it('writes a timed event', () => {
    const r = run([mk({ id: 'a', date: '2026-06-01', startTime: '20:00', endTime: '21:30' })]);
    expect(r).toMatchObject({ timed: 1, timeTba: 0, skipped: 0 });
    expect(r.ics).toContain('DTSTART:20260601T200000');
    expect(r.ics).toContain('DTEND:20260601T213000');
    expect(r.ics).toContain('DESCRIPTION:Priority: Must See');
    expect(r.ics).not.toContain('VALARM');
  });

  it('writes a TBA pick as an all-day event', () => {
    const r = run([mk({ id: 'a', date: '2026-06-30' })]);
    expect(r).toMatchObject({ timed: 0, timeTba: 1 });
    expect(r.ics).toContain('DTSTART;VALUE=DATE:20260630');
    expect(r.ics).toContain('DTEND;VALUE=DATE:20260701');
    expect(r.ics).toContain('SUMMARY:Artist (time TBA)');
  });

  it('skips a set with no valid date', () => {
    const r = run([mk({ id: 'a', startTime: '20:00', endTime: '21:00' })]);
    expect(r).toMatchObject({ timed: 0, timeTba: 0, skipped: 1 });
    expect(r.ics).not.toContain('BEGIN:VEVENT');
  });

  it('defaults a missing end to 60 minutes, across midnight too', () => {
    expect(run([mk({ id: 'a', date: '2026-06-01', startTime: '20:00' })]).ics).toContain('DTEND:20260601T210000');
    expect(run([mk({ id: 'a', date: '2026-06-01', startTime: '23:30' })]).ics).toContain('DTEND:20260602T003000');
  });

  it('rolls a past-midnight end to the next day', () => {
    const r = run([mk({ id: 'a', date: '2026-06-01', startTime: '23:30', endTime: '01:00' })]);
    expect(r.ics).toContain('DTEND:20260602T010000');
  });

  it('puts a set that starts before 06:00 on the next calendar date', () => {
    const r = run([mk({ id: 'a', date: '2026-07-10', startTime: '00:30', endTime: '02:00' })]);
    expect(r.ics).toContain('DTSTART:20260711T003000');
    expect(r.ics).toContain('DTEND:20260711T020000');
    expect(run([mk({ id: 'a', date: '2026-07-10', startTime: '05:30' })]).ics).toContain('DTEND:20260711T063000');
  });

  it('adds an alarm for a positive reminder only', () => {
    const sets = [
      mk({ id: 'a', date: '2026-06-01', startTime: '20:00', endTime: '21:00' }),
      mk({ id: 'b', date: '2026-06-01', startTime: '22:00', endTime: '23:00' }),
    ];
    const r = run(sets, { reminders: { a: 15, b: 0 } });
    expect(r.ics.match(/BEGIN:VALARM/g)).toHaveLength(1);
    expect(r.ics).toContain('TRIGGER:-PT15M');
    expect(r.ics).toContain('DESCRIPTION:Artist starts in 15 minutes');
    expect(r.ics.indexOf('STATUS:CONFIRMED')).toBeLessThan(r.ics.indexOf('BEGIN:VALARM'));
  });

  it('puts the note on line two and keeps the UID', () => {
    const r = run([mk({ id: 'a', date: '2026-06-01', startTime: '20:00', endTime: '21:00' })], {
      notes: { a: 'meet at bar' },
      origin: 'x.test',
    });
    expect(r.ics).toContain('DESCRIPTION:Priority: Must See\\nmeet at bar');
    expect(r.ics).toContain('UID:a-f1@x.test');
  });

  it('buildPicksIcs returns the same text', () => {
    const sets = [mk({ id: 'a', date: '2026-06-01', startTime: '20:00', endTime: '21:00' })];
    const opts = { festival: { id: 'f1' }, sets, stages, picks: { a: 'maybe' as const } };
    expect(buildPicksIcs(opts)).toContain('Priority: Maybe');
  });
});

describe('describeIcsExport', () => {
  const r = (timed: number, timeTba: number, skipped: number) => ({ ics: '', timed, timeTba, skipped });
  it('handles zero', () => {
    expect(describeIcsExport(r(0, 0, 2))).toBe('None of your picks have a date yet, so there was nothing to add.');
  });
  it('handles singular and plural', () => {
    expect(describeIcsExport(r(1, 0, 0))).toBe('Added 1 set to your calendar file.');
    expect(describeIcsExport(r(18, 3, 0))).toBe(
      'Added 21 sets to your calendar file. 3 have no set time yet, so they are all-day events.',
    );
    expect(describeIcsExport(r(0, 1, 1))).toBe(
      'Added 1 set to your calendar file. 1 has no set time yet, so it is an all-day event. 1 set was left out because its day has no date.',
    );
    expect(describeIcsExport(r(2, 0, 3))).toContain('3 sets were left out because their days have no date.');
  });
});
