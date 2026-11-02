// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { FESTIVAL_DAY_START_HOUR } from '../time-zone.js';

/**
 * Shared ICS (RFC 5545) calendar generation utilities.
 * Used by both the one-off export route and the subscribable calendar feed.
 */

/**
 * Escape a value for use in an ICS property (RFC 5545 TEXT escaping).
 */
export function escIcs(v: any) {
  return String(v || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

/**
 * Validate a time string in HH:MM format. Returns the string if valid, null otherwise.
 */
export function validateIcsTime(t: any) {
  if (!/^\d{2}:\d{2}$/.test(t)) return null;
  const [hh, mm] = t.split(':').map(Number);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return t;
}

/**
 * Fold a content line per RFC 5545 (max 75 octets per line).
 */
export function foldIcsLine(line: any) {
  if (line.length <= 75) return line;
  let folded = line.substring(0, 75);
  let rest = line.substring(75);
  while (rest.length > 0) {
    folded += '\r\n ' + rest.substring(0, 74);
    rest = rest.substring(74);
  }
  return folded;
}

/**
 * Build a single VEVENT block from an event descriptor.
 */
export function buildVEvent({ uid, summary, dtstart, dtend, location, description, dtstamp, sequence, allDay, alarmMinutes }: any) {
  const stamp = dtstamp || new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VEVENT',
    `DTSTAMP:${stamp}`,
    allDay ? `DTSTART;VALUE=DATE:${dtstart}` : `DTSTART:${dtstart}`,
    allDay ? `DTEND;VALUE=DATE:${dtend}` : `DTEND:${dtend}`,
    foldIcsLine(`SUMMARY:${escIcs(summary)}`),
  ];
  if (location) lines.push(foldIcsLine(`LOCATION:${escIcs(location)}`));
  if (description) lines.push(foldIcsLine(`DESCRIPTION:${escIcs(description)}`));
  lines.push(`UID:${uid}`);
  lines.push('STATUS:CONFIRMED');
  if (alarmMinutes && alarmMinutes > 0) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      foldIcsLine(`DESCRIPTION:${escIcs(`${summary} starts in ${alarmMinutes} minutes`)}`),
      `TRIGGER:-PT${alarmMinutes}M`,
      'END:VALARM',
    );
  }
  if (sequence !== undefined) lines.push(`SEQUENCE:${sequence}`);
  lines.push('END:VEVENT');
  return lines;
}

/**
 * Build a complete VCALENDAR string from an array of event descriptors.
 */
export function buildVCalendar(events: any, { calendarName, prodId, extraHeaders }: any = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${prodId || '-//FestivalPlanner//EN'}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    foldIcsLine(`X-WR-CALNAME:${escIcs(calendarName)}`),
  ];

  if (extraHeaders) {
    for (const header of extraHeaders) lines.push(header);
  }

  for (const event of events) {
    const veventLines = buildVEvent(event);
    for (const line of veventLines) lines.push(line);
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

// The backend cannot import @festie/shared; tests/ics-parity.test.ts guards drift.
const PRIORITY_LABELS: Record<string, string> = { must: 'Must See', 'want-to-see': 'Want to See', maybe: 'Maybe' };
const DEFAULT_SET_MINUTES = 60;

/** `YYYY-MM-DD` plus `days`, as `YYYYMMDD` (UTC math, so no DST drift). */
function addDaysCompact(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Transform a festival + profile into an array of ICS event descriptors
 * suitable for `buildVCalendar`. Shared by the one-off export route and the
 * subscribable calendar-sync feed.
 */
export function buildIcsEventsFromPicks(festival: any, profile: any, origin: string) {
  const picks = profile.picks || {};
  const notes = profile.notes || {};
  const sets = (festival.days || []).flatMap((day: any) =>
    (day.sets || []).filter((s: any) => picks[s.id]).map((s: any) => ({ ...s, date: day.date, dayLabel: day.label }))
  );
  const stageMap = new Map<string, any>((festival.stages || []).map((s: any) => [s.id, s]));

  const reminders = profile.reminders || {};

  const events: any[] = [];
  for (const set of sets) {
    if (!set.date || !/^\d{4}-\d{2}-\d{2}$/.test(set.date)) continue;

    const stage = stageMap.get(set.stageId);
    const dateStr = set.date.replace(/-/g, '');
    const priority = picks[set.id] || '';
    const note = notes[set.id] || '';
    const description = [priority && `Priority: ${PRIORITY_LABELS[priority] ?? priority}`, note]
      .filter(Boolean)
      .join('\n');
    const base = {
      uid: `${set.id}-${festival.id}@${origin}`,
      location: stage ? stage.name + (festival.location ? ' - ' + festival.location : '') : undefined,
      description: description || undefined,
    };

    const startTime = validateIcsTime(set.startTime);
    if (!startTime) {
      events.push({
        ...base,
        summary: `${set.artist} (time TBA)`,
        dtstart: dateStr,
        dtend: addDaysCompact(set.date, 1),
        allDay: true,
      });
      continue;
    }

    const [sh, sm] = startTime.split(':').map(Number) as [number, number];
    // A start before 06:00 is the night of the festival day: the next calendar date (as getSetTimeBounds).
    const startOffset = sh < FESTIVAL_DAY_START_HOUR ? 1 : 0;
    const startDateStr = addDaysCompact(set.date, startOffset);
    const endTime = validateIcsTime(set.endTime);
    let endDateStr = startDateStr;
    let endHhmm: string;
    if (endTime) {
      if (endTime < startTime) endDateStr = addDaysCompact(set.date, startOffset + 1);
      endHhmm = endTime.replace(':', '');
    } else {
      const total = sh * 60 + sm + DEFAULT_SET_MINUTES;
      if (total >= 1440) endDateStr = addDaysCompact(set.date, startOffset + 1);
      const m = total % 1440;
      endHhmm = String(Math.floor(m / 60)).padStart(2, '0') + String(m % 60).padStart(2, '0');
    }
    const reminder = reminders[set.id];

    events.push({
      ...base,
      summary: set.artist,
      dtstart: startDateStr + 'T' + startTime.replace(':', '') + '00',
      dtend: endDateStr + 'T' + endHhmm + '00',
      ...(Number.isInteger(reminder) && reminder > 0 ? { alarmMinutes: reminder } : {}),
    });
  }
  return events;
}
