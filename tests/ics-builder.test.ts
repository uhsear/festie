/**
 * Unit tests for lib/helpers/ics-builder.ts
 *
 * Covers the ICS (RFC 5545) generation helpers shared by the one-off /export
 * route (routes/export.ts) and the subscribable /cal calendar-sync feed
 * (routes/calendar-sync.ts). No DB required — all functions under test are
 * pure string builders.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildIcsEventsFromPicks, buildVCalendar } from '../lib/helpers/ics-builder';

function makeFestival(overrides: any = {}) {
  return {
    id: 'fest-1',
    location: 'Testville',
    stages: [{ id: 'main', name: 'Main Stage' }],
    days: [
      {
        date: '2026-06-05',
        label: 'Friday',
        sets: [{ id: 'set-a', artist: 'Alpha', stageId: 'main', startTime: '10:00', endTime: '11:00' }],
      },
    ],
    ...overrides,
  };
}

describe('buildIcsEventsFromPicks description separator', () => {
  test('joins priority and note with a real newline, not a pre-escaped literal backslash-n', () => {
    const festival = makeFestival();
    const profile = {
      picks: { 'set-a': 'must' },
      notes: { 'set-a': 'Front row, bring earplugs' },
    };
    const events = buildIcsEventsFromPicks(festival, profile, 'festie.us');
    assert.equal(events.length, 1);
    const event = events[0]!;
    assert.equal(
      event.description,
      'Priority: Must See\nFront row, bring earplugs',
      'separator must be a real newline character so escIcs escapes it exactly once',
    );
  });

  test('final DESCRIPTION line carries a single RFC5545 newline escape, not a doubled backslash', () => {
    const festival = makeFestival();
    const profile = {
      picks: { 'set-a': 'must' },
      notes: { 'set-a': 'Front row, bring earplugs' },
    };
    const events = buildIcsEventsFromPicks(festival, profile, 'festie.us');
    const ics = buildVCalendar(events, { calendarName: 'Test Cal' });
    const descLine = ics.split('\r\n').find((l: string) => l.startsWith('DESCRIPTION:'));
    assert.equal(
      descLine,
      'DESCRIPTION:Priority: Must See\\nFront row\\, bring earplugs',
      'a calendar client must see one \\n line-break escape, not a literal \\\\n backslash-n',
    );
  });
});

describe('buildIcsEventsFromPicks event rules', () => {
  const build = (sets: any[], profile: any) =>
    buildIcsEventsFromPicks(
      makeFestival({ days: [{ date: '2026-06-05', label: 'Friday', sets }] }),
      profile,
      'festie.us',
    );
  const set = (over: any) => ({ id: 'set-a', artist: 'Alpha', stageId: 'main', startTime: '10:00', endTime: '11:00', ...over });

  test('TBA pick is an all-day event with (time TBA) in the summary', () => {
    const [ev] = build([set({ startTime: undefined, endTime: undefined })], { picks: { 'set-a': 'maybe' } });
    assert.equal(ev.summary, 'Alpha (time TBA)');
    assert.equal(ev.allDay, true);
    assert.equal(ev.dtstart, '20260605');
    assert.equal(ev.dtend, '20260606');
    const ics = buildVCalendar([ev]);
    assert.ok(ics.includes('DTSTART;VALUE=DATE:20260605'));
    assert.ok(ics.includes('DTEND;VALUE=DATE:20260606'));
  });

  test('a day with no valid date is skipped', () => {
    const festival = makeFestival({ days: [{ date: '', label: 'x', sets: [set({})] }] });
    assert.equal(buildIcsEventsFromPicks(festival, { picks: { 'set-a': 'must' } }, 'festie.us').length, 0);
  });

  test('start with no end ends 60 minutes later', () => {
    const [ev] = build([set({ endTime: undefined })], { picks: { 'set-a': 'must' } });
    assert.equal(ev.dtend, '20260605T110000');
  });

  test('a set past midnight ends on the next date', () => {
    const [ev] = build([set({ startTime: '23:30', endTime: '01:00' })], { picks: { 'set-a': 'must' } });
    assert.equal(ev.dtstart, '20260605T233000');
    assert.equal(ev.dtend, '20260606T010000');
  });

  test('a set that starts before 06:00 is on the next calendar date', () => {
    const [ev] = build([set({ startTime: '00:30', endTime: '02:00' })], { picks: { 'set-a': 'must' } });
    assert.equal(ev.dtstart, '20260606T003000');
    assert.equal(ev.dtend, '20260606T020000');
  });

  test('a 15-minute reminder writes a VALARM after STATUS', () => {
    const events = build([set({})], { picks: { 'set-a': 'must' }, reminders: { 'set-a': 15 } });
    const lines = buildVCalendar(events).split('\r\n');
    assert.ok(lines.includes('TRIGGER:-PT15M'));
    assert.ok(lines.indexOf('BEGIN:VALARM') > lines.indexOf('STATUS:CONFIRMED'));
    assert.ok(lines.includes('DESCRIPTION:Alpha starts in 15 minutes'));
  });

  test('no reminder means no VALARM', () => {
    const events = build([set({})], { picks: { 'set-a': 'must' } });
    assert.ok(!buildVCalendar(events).includes('VALARM'));
  });

  test('priority labels read Want to See and Maybe', () => {
    const events = build(
      [set({}), set({ id: 'set-b', artist: 'Beta' })],
      { picks: { 'set-a': 'want-to-see', 'set-b': 'maybe' } },
    );
    assert.equal(events[0].description, 'Priority: Want to See');
    assert.equal(events[1].description, 'Priority: Maybe');
  });
});
