// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// The shared package is not "type": "module", so Node loads its .ts files as
// CommonJS. tsx/esm alone cannot resolve their extensionless imports; register
// the CommonJS hook too. This import must stay above the shared import.
import 'tsx/cjs';

import { buildIcsEventsFromPicks, buildVCalendar } from '../lib/helpers/ics-builder.js';
// The backend does not depend on @festie/shared, so the calendar rules are
// mirrored in both builders. This test is the drift guard, imported by relative path.
import { buildPicksIcsExport } from '../packages/shared/src/utils/ics.js';

const stages = [{ id: 'main', name: 'Main Stage' }];
const daySets = [
  { id: 'timed', artist: 'Timed', stageId: 'main', startTime: '10:00', endTime: '11:00' },
  { id: 'tba', artist: 'Tba', stageId: 'main' },
  { id: 'late', artist: 'Late', stageId: 'main', startTime: '23:30', endTime: '01:00' },
  { id: 'noend', artist: 'NoEnd', stageId: 'main', startTime: '23:30' },
  { id: 'night', artist: 'Night', stageId: 'main', startTime: '00:30', endTime: '02:00' },
  { id: 'rem', artist: 'Rem', stageId: 'main', startTime: '12:00', endTime: '13:00' },
  { id: 'dated, odd; name', artist: 'Odd, Name; Here', stageId: 'main', startTime: '14:00', endTime: '15:00' },
];
const picks: Record<string, string> = {
  timed: 'must',
  tba: 'maybe',
  late: 'want-to-see',
  noend: 'must',
  night: 'must',
  rem: 'must',
  'dated, odd; name': 'maybe',
  nodate: 'must',
};
const notes = { timed: 'Front row, bring earplugs', rem: 'Meet at the gate' };
const reminders = { rem: 15, timed: 30 };

function vevents(ics: string): string[] {
  return ics
    .split('\r\n')
    .filter((l) => !l.startsWith('DTSTAMP:'))
    .join('\r\n')
    .split('BEGIN:VEVENT')
    .slice(1)
    .map((b) => b.split('END:VEVENT')[0]!.replace(/SEQUENCE:\d+\r\n/, ''));
}

describe('backend ↔ shared ICS builder parity', () => {
  it('VEVENT lines match for timed, TBA, past-midnight, early-morning, no-end, reminder and no-date picks', () => {
    const festival = {
      id: 'fest-1',
      name: 'Fest',
      location: 'Testville',
      stages,
      days: [
        { date: '2026-06-05', label: 'Friday', sets: daySets },
        { date: '', label: 'Undated', sets: [{ id: 'nodate', artist: 'Nodate', stageId: 'main', startTime: '10:00', endTime: '11:00' }] },
      ],
    };
    const backend = buildVCalendar(
      buildIcsEventsFromPicks(festival, { picks, notes, reminders }, 'festie.us'),
      { calendarName: 'x' },
    );

    const sets = festival.days.flatMap((d) => d.sets.map((s) => ({ ...s, date: d.date })));
    const shared = buildPicksIcsExport({
      festival,
      sets: sets as any,
      stages: stages as any,
      picks: picks as any,
      notes,
      reminders,
      origin: 'festie.us',
    }).ics;

    const a = vevents(backend);
    assert.equal(a.length, 7);
    assert.deepStrictEqual(a, vevents(shared));
  });
});
