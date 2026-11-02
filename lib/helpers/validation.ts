// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Input validation for festivals, users, and form data.
 */

import { sanitizeString, sanitizeIdentifier } from './sanitize';
import { festivalStartMinutes, formatClock12 } from '../time-zone';

export function validateTime(value: any) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [hh, mm] = value.split(':').map(Number) as [number, number];
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

/**
 * Validate hex color format (#RGB, #RRGGBB, #RRGGBBAA)
 */
export function validateColor(value: any) {
  return typeof value === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value);
}

/**
 * Validate username: 2-30 chars, alphanumeric/dash/underscore, spaces allowed between words
 */
export function validateUsername(value: any) {
  if (typeof value !== 'string') return false;
  const clean = value.trim();
  if (clean.length < 2 || clean.length > 30) return false;
  return /^[a-zA-Z0-9_-]+( [a-zA-Z0-9_-]+)*$/.test(clean);
}

/**
 * Validate password strength: 8-100 chars (length-only; kept for callers that
 * just need the boolean. New code should prefer checkPasswordPolicy, which also
 * screens common/breached passwords and identity reuse).
 */
export function validatePasswordStrength(value: any) {
  if (typeof value !== 'string') return false;
  return value.length >= 8 && value.length <= 100;
}

/**
 * The most common / breached passwords (lowercased). NIST 800-63B recommends
 * screening against a known-bad list instead of composition rules. This is a
 * focused, bundled top-list (no network dependency); a HIBP k-anonymity check
 * could be layered behind a flag later. Keep entries lowercase + trimmed.
 */
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword',
  '12345678', '123456789', '1234567890', '123123123', '111111111', '000000000',
  'qwerty123', 'qwertyuiop', 'qwerty12345', '1q2w3e4r', '1qaz2wsx', 'zaq12wsx',
  'iloveyou', 'iloveyou1', 'admin123', 'administrator', 'welcome1', 'welcome123',
  'letmein1', 'letmein123', 'abc12345', 'abcd1234', 'baseball', 'football',
  'football1', 'sunshine', 'princess', 'princess1', 'dragon123', 'monkey123',
  'master123', 'superman1', 'trustno1', 'whatever1', 'starwars1', 'computer1',
  'michael1', 'jennifer', 'jordan23', 'hunter22', 'shadow123', 'ashley123',
  'login123', 'changeme', 'changeme1', 'secret123', 'samsung123', 'google123',
  'qazwsxedc', 'asdfghjkl', 'zxcvbnm1', 'q1w2e3r4', 'q1w2e3r4t5', 'passpass',
  'test1234', 'test12345', 'temp1234', 'demo1234', 'guest123', 'user1234',
  'festival', 'festival1', 'festie123', 'festival123',
]);

export interface PasswordPolicyContext {
  username?: string | null;
  email?: string | null;
}

/**
 * Server-authoritative password policy. Returns an error message string, or
 * null if the password is acceptable. Rejects: out-of-range length, common /
 * breached passwords, and passwords that contain the username or email
 * local-part (case-insensitive). No composition rules (per NIST 800-63B).
 */
export function checkPasswordPolicy(
  value: any,
  ctx: PasswordPolicyContext = {},
): string | null {
  if (typeof value !== 'string' || value.length === 0) return 'Password is required';
  if (value.length < 8) return 'Password must be at least 8 characters';
  if (value.length > 100) return 'Password must be at most 100 characters';

  const lower = value.trim().toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) {
    return 'That password is too common — please choose something harder to guess';
  }

  const username = ctx.username?.trim().toLowerCase();
  if (username && username.length >= 3 && lower.includes(username)) {
    return 'Password must not contain your username';
  }

  const emailLocal = ctx.email?.split('@')[0]?.trim().toLowerCase();
  if (emailLocal && emailLocal.length >= 3 && lower.includes(emailLocal)) {
    return 'Password must not contain your email address';
  }

  return null;
}

export interface FestivalIssueTarget {
  kind: 'festival' | 'stage' | 'day' | 'set';
  field?: 'name' | 'color' | 'id' | 'label' | 'date' | 'artist' | 'stageId' | 'startTime' | 'endTime' | 'sets';
  stageId?: string;
  stageIndex?: number;
  dayIndex?: number;
  setId?: string;
  setIndex?: number;
  relatedSetId?: string;
}

export interface FestivalIssue {
  code: string;
  message: string;
  target: FestivalIssueTarget;
}

/**
 * Comprehensive festival data validation
 * Checks stages, days, sets, timing, and prevents duplicate names/IDs.
 * Each issue names the stage, day or set at fault so the editors can mark the field.
 */
export function validateFestivalIssues(config: any, body: any): FestivalIssue[] {
  const issues: FestivalIssue[] = [];
  const add = (code: string, message: string, target: FestivalIssueTarget) => issues.push({ code, message, target });
  if (!body || typeof body !== 'object') {
    return [{ code: 'payload_required', message: 'Festival payload is required', target: { kind: 'festival' } }];
  }
  if (!body.name || !sanitizeString(body.name)) {
    add('name_required', 'Festival name is required', { kind: 'festival', field: 'name' });
  }
  if (body.stages && !Array.isArray(body.stages)) add('stages_not_array', 'Stages must be an array', { kind: 'festival' });
  if (body.days && !Array.isArray(body.days)) add('days_not_array', 'Days must be an array', { kind: 'festival' });
  if (body.stages?.length > config.MAX_STAGES) {
    add('max_stages', `Maximum ${config.MAX_STAGES} stages`, { kind: 'festival' });
  }
  if (body.days?.length > config.MAX_DAYS) add('max_days', `Maximum ${config.MAX_DAYS} days`, { kind: 'festival' });
  const stageIds = new Set();
  const stageNames = new Set();
  let stageIndex = 0;
  for (const stage of body.stages || []) {
    const cleanName = sanitizeString(stage?.name || '', 100);
    const cleanId = sanitizeIdentifier(stage?.id, 100);
    const target = (field: FestivalIssueTarget['field']): FestivalIssueTarget => ({
      kind: 'stage',
      field,
      stageIndex,
      ...(cleanId ? { stageId: cleanId } : {}),
    });
    if (!cleanName) add('stage_name_required', 'Every stage requires a name', target('name'));
    if (!cleanId) add('stage_id_invalid', `Stage "${cleanName || 'Unnamed'}" requires a valid id`, target('id'));
    if (cleanId && stageIds.has(cleanId)) add('stage_id_duplicate', `Duplicate stage id: ${cleanId}`, target('id'));
    if (cleanId) stageIds.add(cleanId);
    const normalizedName = cleanName.toLowerCase();
    if (normalizedName && stageNames.has(normalizedName)) {
      add('stage_name_duplicate', `Duplicate stage name: ${cleanName}`, target('name'));
    }
    if (normalizedName) stageNames.add(normalizedName);
    stageIndex += 1;
  }
  const setIds = new Set();
  let dayIndex = 0;
  for (const day of body.days || []) {
    if (day.sets && !Array.isArray(day.sets)) {
      add('day_sets_not_array', 'Day sets must be an array', { kind: 'day', field: 'sets', dayIndex });
    }
    if ((day.sets || []).length > config.MAX_SETS_PER_DAY) {
      add('max_sets_per_day', `Maximum ${config.MAX_SETS_PER_DAY} sets per day`, { kind: 'day', field: 'sets', dayIndex });
    }
    const stageSchedules = new Map();
    let setIndex = 0;
    for (const set of day.sets || []) {
      const setId = sanitizeIdentifier(set?.id, 100);
      // Support both old (artist string) and new (artists array) format
      const artist = set?.artists?.length > 0
        ? set.artists.map((a: any) => sanitizeString(a.name || '', 300)).filter(Boolean).join(' b2b ')
        : sanitizeString(set?.artist || '', 300);
      const stageId = sanitizeIdentifier(set?.stageId, 100);
      const target = (field?: FestivalIssueTarget['field']): FestivalIssueTarget => ({
        kind: 'set',
        ...(field ? { field } : {}),
        dayIndex,
        setIndex,
        ...(setId ? { setId } : {}),
      });
      if (!setId) add('set_id_invalid', `Set "${artist || 'Unnamed'}" requires a valid id`, target());
      if (setId && setIds.has(setId)) add('set_id_duplicate', `Duplicate set id: ${setId}`, target());
      if (setId) setIds.add(setId);
      if (!artist && !(set?.artists?.length > 0)) {
        add('set_artist_required', 'Every set requires an artist name', target('artist'));
      }
      if (!stageId || !stageIds.has(stageId)) {
        add('set_stage_invalid', `Set "${artist || 'Unnamed'}" must reference a valid stage`, target('stageId'));
      }
      if (!validateTime(set?.startTime) || !validateTime(set?.endTime)) {
        // TBA sets without times are valid — only error if partial time given
        const badStart = set?.startTime && !validateTime(set?.startTime);
        if (badStart || (set?.endTime && !validateTime(set?.endTime))) {
          add(
            'set_time_invalid',
            `Set "${artist || 'Unnamed'}" has invalid time format`,
            target(badStart ? 'startTime' : 'endTime'),
          );
        }
      }
      const entryTarget = target('startTime');
      setIndex += 1;
      if (!stageId || !validateTime(set?.startTime) || !validateTime(set?.endTime)) continue;
      const stageEntries = stageSchedules.get(stageId) || [];
      stageEntries.push({
        artist: artist || 'Unnamed',
        start: set.startTime,
        end: set.endTime,
        target: entryTarget,
      });
      stageSchedules.set(stageId, stageEntries);
    }
    for (const stageEntries of stageSchedules.values()) {
      const sorted = stageEntries
        .map((entry: any) => {
          const start = entry.start.split(':').map((part: any) => Number.parseInt(part, 10));
          const end = entry.end.split(':').map((part: any) => Number.parseInt(part, 10));
          const startMinutes = (start[0] * 60) + start[1];
          let endMinutes = (end[0] * 60) + end[1];
          if (endMinutes <= startMinutes) endMinutes += 24 * 60;
          return { ...entry, startMinutes, endMinutes };
        })
        .sort((left: any, right: any) => left.startMinutes - right.startMinutes);
      for (let index = 1; index < sorted.length; index += 1) {
        const previous = sorted[index - 1];
        const current = sorted[index];
        if (current.startMinutes < previous.endMinutes) {
          add('stage_overlap', `Stage overlap on "${current.artist}" and "${previous.artist}"`, {
            ...current.target,
            ...(previous.target.setId ? { relatedSetId: previous.target.setId } : {}),
          });
        }
      }
    }
    dayIndex += 1;
  }
  return issues;
}

/** The issue messages only, one string per problem. */
export function validateFestival(config: any, body: any) {
  return validateFestivalIssues(config, body).map((issue) => issue.message);
}

export interface ChecklistItem {
  key: 'timeZone' | 'stages' | 'days' | 'sets' | 'errors' | 'pins' | 'times' | 'overlaps';
  /** 'todo' blocks publish; 'warn' does not. */
  status: 'done' | 'todo' | 'warn';
  label: string;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * "{a} and {b} overlap on {stage}, Sat 10:00 PM." for each same-stage overlap.
 * Orders sets by the 6 AM day rule, so a 00:30 set follows a 23:00 set on the same day.
 */
export function stageOverlapWarnings(festival: any): string[] {
  const stageNames = new Map<string, string>(
    (Array.isArray(festival?.stages) ? festival.stages : []).map((s: any) => [s?.id, s?.name || s?.id]),
  );
  const out: string[] = [];
  (Array.isArray(festival?.days) ? festival.days : []).forEach((day: any, dayIndex: number) => {
    const byStage = new Map<string, any[]>();
    for (const set of Array.isArray(day?.sets) ? day.sets : []) {
      if (!set?.stageId || !validateTime(set.startTime) || !validateTime(set.endTime)) continue;
      const start = festivalStartMinutes(set.startTime);
      let end = festivalStartMinutes(set.endTime);
      if (end <= start) end += 1440;
      const artist = set.artists?.length > 0
        ? set.artists.map((a: any) => a?.name).filter(Boolean).join(' b2b ')
        : set.artist;
      const list = byStage.get(set.stageId) ?? [];
      list.push({ artist: artist || 'Unnamed', startTime: set.startTime, start, end });
      byStage.set(set.stageId, list);
    }
    const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day?.date ?? ''));
    for (const [stageId, list] of byStage) {
      list.sort((a, b) => a.start - b.start);
      for (let i = 1; i < list.length; i += 1) {
        const [earlier, later] = [list[i - 1], list[i]];
        if (later.start >= earlier.end) continue;
        const weekday = date
          ? WEEKDAYS[new Date(Date.UTC(+date[1]!, +date[2]! - 1, +date[3]! + Math.floor(later.start / 1440))).getUTCDay()]
          : day?.label || `Day ${dayIndex + 1}`;
        out.push(`${earlier.artist} and ${later.artist} overlap on ${stageNames.get(stageId) ?? stageId}, ${weekday} ${formatClock12(later.startTime)}.`);
      }
    }
  });
  return out;
}

/**
 * The "Before you publish" checklist, computed from the saved festival.
 * POST /:id/publish refuses while any item is 'todo'.
 */
export function publishChecklist(config: any, festival: any): ChecklistItem[] {
  const stages: any[] = Array.isArray(festival?.stages) ? festival.stages : [];
  const days: any[] = Array.isArray(festival?.days) ? festival.days : [];
  const sets = days.flatMap((day: any) => (Array.isArray(day?.sets) ? day.sets : []));
  const dayLabels = (pick: (day: any) => boolean) =>
    days
      .map((day: any, i: number) => (pick(day) ? day?.label || `Day ${i + 1}` : null))
      .filter(Boolean)
      .join(', ');

  const timeZone: ChecklistItem = festival?.timeZone
    ? { key: 'timeZone', status: 'done', label: `Time zone: ${festival.timeZone}` }
    : { key: 'timeZone', status: 'todo', label: "Choose the festival's time zone." };

  const stagesItem: ChecklistItem = stages.length > 0
    ? { key: 'stages', status: 'done', label: `${stages.length} stage(s)` }
    : { key: 'stages', status: 'todo', label: 'Add at least one stage.' };

  const undated = dayLabels((day) => !/^\d{4}-\d{2}-\d{2}$/.test(String(day?.date ?? '')));
  let daysItem: ChecklistItem = { key: 'days', status: 'done', label: `${days.length} day(s), each with a date` };
  if (days.length === 0) daysItem = { key: 'days', status: 'todo', label: 'Add the festival days.' };
  else if (undated) daysItem = { key: 'days', status: 'todo', label: `Give every day a date. Missing: ${undated}.` };

  const emptyDays = dayLabels((day) => !(Array.isArray(day?.sets) && day.sets.length > 0));
  // With no days at all there is no label to name, so the copy says "each day".
  const setsItem: ChecklistItem = days.length > 0 && !emptyDays
    ? { key: 'sets', status: 'done', label: `${sets.length} set(s)` }
    : {
        key: 'sets',
        status: 'todo',
        label: `Add sets to ${emptyDays || 'each day'}. Import the lineup or add them by hand.`,
      };

  const issues = validateFestivalIssues(config, festival);
  const errors: ChecklistItem = issues.length === 0
    ? { key: 'errors', status: 'done', label: 'No lineup problems' }
    : { key: 'errors', status: 'todo', label: `Fix ${issues.length} lineup problem(s). First: ${issues[0]!.message}` };

  const unpinned = stages.filter((s: any) => typeof s?.latitude !== 'number' || typeof s?.longitude !== 'number');
  const pins: ChecklistItem = unpinned.length === 0
    ? { key: 'pins', status: 'done', label: 'Every stage is on the map' }
    : {
        key: 'pins',
        status: 'warn',
        label: `${unpinned.length} stage(s) have no map pin: ${unpinned.map((s: any) => s?.name || s?.id).join(', ')}. Attendees won't see them on the map.`,
      };

  const untimed = sets.filter((s: any) => !validateTime(s?.startTime)).length;
  const times: ChecklistItem = untimed === 0
    ? { key: 'times', status: 'done', label: 'Every set has a start time' }
    : { key: 'times', status: 'warn', label: `${untimed} set(s) have no start time yet. They show as TBA.` };

  const overlapList = stageOverlapWarnings(festival);
  const overlaps: ChecklistItem = overlapList.length === 0
    ? { key: 'overlaps', status: 'done', label: 'No sets overlap on a stage' }
    : {
        key: 'overlaps',
        status: 'warn',
        label: overlapList.length === 1
          ? overlapList[0]!
          : `${overlapList[0]!.slice(0, -1)} (and ${overlapList.length - 1} more).`,
      };

  return [timeZone, stagesItem, daysItem, setsItem, errors, pins, times, overlaps];
}
