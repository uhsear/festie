/**
 * Client-side ICS (RFC 5545) calendar generation, ported from the backend
 * lib/helpers/ics-builder.ts so mobile (and later web) can export a user's
 * picks to a .ics file fully offline — no server round-trip, no native module.
 *
 * Times are emitted as floating local time (`YYYYMMDDTHHMMSS`, no Z / TZID),
 * matching the backend export: festival schedules are venue-local and must not
 * shift by the device's UTC offset.
 */
import type { FestivalSet, Stage, Priority } from '../types';
import { PRIORITY_LABELS } from '../constants';
import { FESTIVAL_DAY_START_HOUR } from './setStatus';

/** Escape a value for an ICS TEXT property (RFC 5545). */
export function escIcs(v: unknown): string {
  return String(v ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

/** Validate an HH:MM time; returns the string if valid, else null. */
export function validateIcsTime(t: unknown): string | null {
  if (typeof t !== 'string' || !/^\d{2}:\d{2}$/.test(t)) return null;
  const [hh, mm] = t.split(':').map(Number) as [number, number];
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return t;
}

/** Fold a content line per RFC 5545 (max 75 octets per line). */
export function foldIcsLine(line: string): string {
  if (line.length <= 75) return line;
  let folded = line.substring(0, 75);
  let rest = line.substring(75);
  while (rest.length > 0) {
    folded += '\r\n ' + rest.substring(0, 74);
    rest = rest.substring(74);
  }
  return folded;
}

export interface IcsEvent {
  uid: string;
  summary: string;
  dtstart: string;
  dtend: string;
  location?: string;
  description?: string;
  dtstamp?: string;
  sequence?: number;
  /** All-day event: dtstart/dtend are `YYYYMMDD` dates, written as VALUE=DATE. */
  allDay?: boolean;
  /** Positive minutes before start for a display alarm. */
  alarmMinutes?: number;
}

/** Build a single VEVENT block. */
export function buildVEvent(ev: IcsEvent): string[] {
  const stamp =
    ev.dtstamp ||
    new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VEVENT',
    `DTSTAMP:${stamp}`,
    ev.allDay ? `DTSTART;VALUE=DATE:${ev.dtstart}` : `DTSTART:${ev.dtstart}`,
    ev.allDay ? `DTEND;VALUE=DATE:${ev.dtend}` : `DTEND:${ev.dtend}`,
    foldIcsLine(`SUMMARY:${escIcs(ev.summary)}`),
  ];
  if (ev.location) lines.push(foldIcsLine(`LOCATION:${escIcs(ev.location)}`));
  if (ev.description) lines.push(foldIcsLine(`DESCRIPTION:${escIcs(ev.description)}`));
  lines.push(`UID:${ev.uid}`);
  lines.push('STATUS:CONFIRMED');
  if (ev.alarmMinutes && ev.alarmMinutes > 0) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      foldIcsLine(`DESCRIPTION:${escIcs(`${ev.summary} starts in ${ev.alarmMinutes} minutes`)}`),
      `TRIGGER:-PT${ev.alarmMinutes}M`,
      'END:VALARM',
    );
  }
  if (ev.sequence !== undefined) lines.push(`SEQUENCE:${ev.sequence}`);
  lines.push('END:VEVENT');
  return lines;
}

/** Build a complete VCALENDAR string from event descriptors. */
export function buildVCalendar(events: IcsEvent[], opts: { calendarName?: string; prodId?: string } = {}): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${opts.prodId || '-//Festie//EN'}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    foldIcsLine(`X-WR-CALNAME:${escIcs(opts.calendarName)}`),
  ];
  for (const event of events) {
    for (const line of buildVEvent(event)) lines.push(line);
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function setArtistLabel(set: FestivalSet): string {
  if (set.artist) return set.artist;
  if (set.artists && set.artists.length > 0) {
    return set.artists
      .map((a) => a.name)
      .filter(Boolean)
      .join(' b2b ');
  }
  return 'Set';
}


export interface PicksIcsResult {
  ics: string;
  timed: number;
  timeTba: number;
  skipped: number;
}

export interface BuildPicksIcsOpts {
  festival: { id: string; name?: string; location?: string };
  sets: FestivalSet[];
  stages: Stage[];
  picks: Record<string, Priority>;
  notes?: Record<string, string>;
  origin?: string;
}

/** `YYYY-MM-DD` plus `days`, as `YYYYMMDD` (UTC math, so no DST or zone drift). */
function addDaysCompact(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

const DEFAULT_SET_MINUTES = 60;

/**
 * Build a .ics for the picks in `picks`, using the already-loaded (flattened)
 * shared store data: `sets` carry `date` from their day, `stages` map ids to
 * names, `picks`/`notes`/`reminders` come from the current profile. Sets with
 * no valid date are skipped; sets with no valid start become all-day events.
 * Keep in step with `buildIcsEventsFromPicks` in lib/helpers/ics-builder.ts
 * (tests/ics-parity.test.ts guards drift).
 */
export function buildPicksIcsExport(opts: BuildPicksIcsOpts & { reminders?: Record<string, number> }): PicksIcsResult {
  const { festival, sets, stages, picks, notes = {}, reminders = {}, origin = 'festie.us' } = opts;
  const stageMap = new Map(stages.map((s) => [s.id, s]));
  const events: IcsEvent[] = [];
  let timed = 0;
  let timeTba = 0;
  let skipped = 0;

  for (const set of sets) {
    const priority = picks[set.id];
    if (!priority) continue;
    if (!set.date || !/^\d{4}-\d{2}-\d{2}$/.test(set.date)) {
      skipped++;
      continue;
    }

    const stage = stageMap.get(set.stageId);
    const dateStr = set.date.replace(/-/g, '');
    const description = [`Priority: ${PRIORITY_LABELS[priority] ?? priority}`, notes[set.id] || '']
      .filter(Boolean)
      .join('\n');
    const base = {
      uid: `${set.id}-${festival.id}@${origin}`,
      location: stage ? stage.name + (festival.location ? ' - ' + festival.location : '') : undefined,
      description,
    };
    const artist = setArtistLabel(set);

    const startTime = validateIcsTime(set.startTime);
    if (!startTime) {
      timeTba++;
      events.push({
        ...base,
        summary: `${artist} (time TBA)`,
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

    timed++;
    events.push({
      ...base,
      summary: artist,
      dtstart: startDateStr + 'T' + startTime.replace(':', '') + '00',
      dtend: endDateStr + 'T' + endHhmm + '00',
      ...(Number.isInteger(reminder) && reminder! > 0 ? { alarmMinutes: reminder } : {}),
    });
  }

  const ics = buildVCalendar(events, { calendarName: `${festival.name || 'Festival'} — My Picks` });
  return { ics, timed, timeTba, skipped };
}

/** Same as {@link buildPicksIcsExport}, returning only the .ics text. */
export function buildPicksIcs(opts: BuildPicksIcsOpts): string {
  return buildPicksIcsExport(opts).ics;
}

/** One-sentence summary of a download, for the post-export toast. */
export function describeIcsExport(r: PicksIcsResult): string {
  const n = r.timed + r.timeTba;
  if (n === 0) return 'None of your picks have a date yet, so there was nothing to add.';
  let text = `Added ${n} ${n === 1 ? 'set' : 'sets'} to your calendar file.`;
  if (r.timeTba > 0) {
    text +=
      r.timeTba === 1
        ? ' 1 has no set time yet, so it is an all-day event.'
        : ` ${r.timeTba} have no set time yet, so they are all-day events.`;
  }
  if (r.skipped > 0) {
    text +=
      r.skipped === 1
        ? ' 1 set was left out because its day has no date.'
        : ` ${r.skipped} sets were left out because their days have no date.`;
  }
  return text;
}
