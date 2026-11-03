/**
 * validateFestivalIssues, validateFestival and publishChecklist (lib/helpers/validation.ts).
 * Pure functions: no database.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { validateFestival, validateFestivalIssues, publishChecklist } from '../lib/helpers/validation';

const config = { MAX_STAGES: 50, MAX_DAYS: 10, MAX_SETS_PER_DAY: 200 };

const issueOf = (body: any, code: string, cfg: any = config) => {
  const found = validateFestivalIssues(cfg, body).find((issue) => issue.code === code);
  assert.ok(found, `expected an issue with code ${code}`);
  return found;
};

const stage = (id: string, name = id, extra: any = {}) => ({ id, name, color: '#ffffff', ...extra });
const set = (id: string, artist: string, stageId: string, startTime?: string, endTime?: string) => ({
  id,
  artist,
  stageId,
  startTime,
  endTime,
});

describe('validateFestivalIssues targets', () => {
  test('festival-level codes', () => {
    assert.deepEqual(validateFestivalIssues(config, null), [
      { code: 'payload_required', message: 'Festival payload is required', target: { kind: 'festival' } },
    ]);
    assert.deepEqual(issueOf({}, 'name_required').target, { kind: 'festival', field: 'name' });
    assert.deepEqual(issueOf({ name: 'F', stages: 'x' }, 'stages_not_array').target, { kind: 'festival' });
    assert.deepEqual(issueOf({ name: 'F', days: 'x' }, 'days_not_array').target, { kind: 'festival' });
    const tight = { MAX_STAGES: 1, MAX_DAYS: 1, MAX_SETS_PER_DAY: 1 };
    assert.deepEqual(issueOf({ name: 'F', stages: [stage('a'), stage('b')] }, 'max_stages', tight).target, {
      kind: 'festival',
    });
    assert.deepEqual(issueOf({ name: 'F', days: [{}, {}] }, 'max_days', tight).target, { kind: 'festival' });
  });

  test('stage codes', () => {
    assert.deepEqual(issueOf({ name: 'F', stages: [stage('a', '')] }, 'stage_name_required').target, {
      kind: 'stage',
      field: 'name',
      stageIndex: 0,
      stageId: 'a',
    });
    assert.deepEqual(issueOf({ name: 'F', stages: [stage('', 'Main')] }, 'stage_id_invalid').target, {
      kind: 'stage',
      field: 'id',
      stageIndex: 0,
    });
    assert.deepEqual(issueOf({ name: 'F', stages: [stage('a', 'A'), stage('a', 'B')] }, 'stage_id_duplicate').target, {
      kind: 'stage',
      field: 'id',
      stageIndex: 1,
      stageId: 'a',
    });
    assert.deepEqual(
      issueOf({ name: 'F', stages: [stage('a', 'Main'), stage('b', 'main')] }, 'stage_name_duplicate').target,
      { kind: 'stage', field: 'name', stageIndex: 1, stageId: 'b' },
    );
  });

  test('day codes', () => {
    assert.deepEqual(issueOf({ name: 'F', days: [{}, { sets: 'x' }] }, 'day_sets_not_array').target, {
      kind: 'day',
      field: 'sets',
      dayIndex: 1,
    });
    const tight = { ...config, MAX_SETS_PER_DAY: 1 };
    const body = { name: 'F', stages: [stage('a')], days: [{ sets: [set('s1', 'X', 'a'), set('s2', 'Y', 'a')] }] };
    assert.deepEqual(issueOf(body, 'max_sets_per_day', tight).target, { kind: 'day', field: 'sets', dayIndex: 0 });
  });

  test('set codes', () => {
    const day = (sets: any[]) => ({ name: 'F', stages: [stage('a')], days: [{ sets: [] }, { sets }] });
    assert.deepEqual(issueOf(day([set('', 'X', 'a')]), 'set_id_invalid').target, {
      kind: 'set',
      dayIndex: 1,
      setIndex: 0,
    });
    assert.deepEqual(issueOf(day([set('s1', 'X', 'a'), set('s1', 'Y', 'a')]), 'set_id_duplicate').target, {
      kind: 'set',
      dayIndex: 1,
      setIndex: 1,
      setId: 's1',
    });
    assert.deepEqual(issueOf(day([set('s1', '', 'a')]), 'set_artist_required').target, {
      kind: 'set',
      field: 'artist',
      dayIndex: 1,
      setIndex: 0,
      setId: 's1',
    });
    assert.deepEqual(issueOf(day([set('s1', 'X', 'nope')]), 'set_stage_invalid').target, {
      kind: 'set',
      field: 'stageId',
      dayIndex: 1,
      setIndex: 0,
      setId: 's1',
    });
    assert.equal(issueOf(day([set('s1', 'X', 'a', '25:00', '23:00')]), 'set_time_invalid').target.field, 'startTime');
    assert.equal(issueOf(day([set('s1', 'X', 'a', '22:00', 'late')]), 'set_time_invalid').target.field, 'endTime');
  });

  test('stage_overlap names the later set and the earlier one', () => {
    const body = {
      name: 'F',
      stages: [stage('a')],
      days: [{ sets: [set('late', 'Later', 'a', '21:30', '23:00'), set('early', 'Earlier', 'a', '21:00', '22:00')] }],
    };
    const issue = issueOf(body, 'stage_overlap');
    assert.equal(issue.message, 'Stage overlap on "Later" and "Earlier"');
    assert.deepEqual(issue.target, {
      kind: 'set',
      field: 'startTime',
      dayIndex: 0,
      setIndex: 0,
      setId: 'late',
      relatedSetId: 'early',
    });
  });

  test('validateFestival returns the same strings as before', () => {
    const body = {
      name: '',
      stages: [stage('a', 'Main'), stage('a', 'main')],
      days: [
        {
          sets: [
            set('s1', 'One', 'a', '20:00', '22:00'),
            set('s1', 'Two', 'a', '21:00', '23:00'),
            set('s3', '', 'zz'),
            set('s4', 'Bad', 'a', '9pm', ''),
          ],
        },
      ],
    };
    assert.deepEqual(validateFestival(config, body), [
      'Festival name is required',
      'Duplicate stage id: a',
      'Duplicate stage name: main',
      'Duplicate set id: s1',
      'Every set requires an artist name',
      'Set "Unnamed" must reference a valid stage',
      'Set "Bad" has invalid time format',
      'Stage overlap on "Two" and "One"',
    ]);
  });
});

describe('publishChecklist', () => {
  const keys = ['timeZone', 'stages', 'days', 'sets', 'errors', 'pins', 'times', 'overlaps'];
  const byKey = (items: any[]) => Object.fromEntries(items.map((item) => [item.key, item]));

  test('an empty festival is todo for time zone, stages, days and sets', () => {
    const items = publishChecklist(config, { name: 'Empty', stages: [], days: [] });
    assert.deepEqual(items.map((item) => item.key), keys);
    const map = byKey(items);
    assert.deepEqual(map.timeZone, { key: 'timeZone', status: 'todo', label: "Choose the festival's time zone." });
    assert.deepEqual(map.stages, { key: 'stages', status: 'todo', label: 'Add at least one stage.' });
    assert.deepEqual(map.days, { key: 'days', status: 'todo', label: 'Add the festival days.' });
    assert.equal(map.sets.status, 'todo');
    assert.equal(map.errors.status, 'done');
  });

  test('a complete festival with one unpinned stage is done except pins', () => {
    const festival = {
      name: 'Full',
      timeZone: 'America/New_York',
      stages: [stage('a', 'Main', { latitude: 28.1, longitude: -81.2 }), stage('b', 'Tent')],
      days: [
        { label: 'Friday', date: '2026-06-05', sets: [set('s1', 'X', 'a', '20:00', '21:00')] },
        { label: 'Saturday', date: '2026-06-06', sets: [set('s2', 'Y', 'b', '20:00', '21:00')] },
      ],
    };
    const map = byKey(publishChecklist(config, festival));
    for (const key of keys.filter((k) => k !== 'pins')) assert.equal(map[key].status, 'done', key);
    assert.equal(map.timeZone.label, 'Time zone: America/New_York');
    assert.equal(map.stages.label, '2 stage(s)');
    assert.equal(map.days.label, '2 day(s), each with a date');
    assert.equal(map.sets.label, '2 set(s)');
    assert.deepEqual(map.pins, {
      key: 'pins',
      status: 'warn',
      label: "1 stage(s) have no map pin: Tent. Attendees won't see them on the map.",
    });
  });

  test('names the days without sets or dates, and counts TBA sets and problems', () => {
    const festival = {
      name: 'Partial',
      timeZone: 'UTC',
      stages: [stage('a', 'Main', { latitude: 1, longitude: 2 })],
      days: [
        { label: 'Friday', date: '2026-06-05', sets: [set('s1', 'X', 'a'), set('s2', 'Y', 'nope', '20:00', '21:00')] },
        { label: '', date: '', sets: [] },
      ],
    };
    const map = byKey(publishChecklist(config, festival));
    assert.equal(map.days.label, 'Give every day a date. Missing: Day 2.');
    assert.equal(map.sets.label, 'Add sets to Day 2. Import the lineup or add them by hand.');
    assert.deepEqual(map.errors, {
      key: 'errors',
      status: 'todo',
      label: 'Fix 1 lineup problem(s). First: Set "Y" must reference a valid stage',
    });
    assert.deepEqual(map.times, { key: 'times', status: 'warn', label: '1 set(s) have no start time yet. They show as TBA.' });
  });

  test('warns, without blocking, about a same-stage overlap past midnight', () => {
    const festival = {
      name: 'Late',
      timeZone: 'UTC',
      stages: [stage('a', 'Main', { latitude: 1, longitude: 2 })],
      days: [{
        label: 'Saturday',
        date: '2026-06-06',
        sets: [set('s1', 'Early', 'a', '22:00', '23:00'), set('s2', 'Late', 'a', '23:00', '01:00'), set('s3', 'Later', 'a', '00:30', '02:00')],
      }],
    };
    const map = byKey(publishChecklist(config, festival));
    assert.equal(map.errors.status, 'done');
    assert.deepEqual(map.overlaps, { key: 'overlaps', status: 'warn', label: 'Late and Later overlap on Main, Sun 12:30 AM.' });
  });

  test('names the first overlap and counts the rest, using the day label without a date', () => {
    const festival = {
      name: 'Busy',
      stages: [stage('a', 'Main'), stage('b', 'Tent')],
      days: [{
        label: 'Friday',
        sets: [
          set('s1', 'One', 'a', '22:00', '23:30'), set('s2', 'Two', 'a', '23:00', '00:30'),
          set('s3', 'Three', 'b', '22:00', '23:00'), set('s4', 'Four', 'b', '22:30', '23:30'),
        ],
      }],
    };
    assert.deepEqual(byKey(publishChecklist(config, festival)).overlaps, {
      key: 'overlaps',
      status: 'warn',
      label: 'One and Two overlap on Main, Friday 11:00 PM (and 1 more).',
    });
  });
});
