/**
 * validateFestivalIssues, validateFestival and publishChecklist (lib/helpers/validation.ts).
 * Pure functions: no database.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { schemas } from '../lib/schemas';
import { validateFestival, validateFestivalIssues, publishChecklist, submitBlockers } from '../lib/helpers/validation';

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

  test('an empty colour or a set with no artist passes the schema and is named as an issue', () => {
    const body = {
      name: 'F',
      stages: [stage('st1', 'Main', { color: '' })],
      days: [{ label: 'Fri', sets: [{ id: 's1', artists: [], stageId: 'st1' }] }],
    };
    assert.equal(schemas.festivalCreate.safeParse(body).success, true);
    assert.deepEqual(issueOf(body, 'stage_color_invalid').target, {
      kind: 'stage',
      field: 'color',
      stageIndex: 0,
      stageId: 'st1',
    });
    assert.equal(issueOf(body, 'set_artist_required').message, 'Every set requires an artist name');
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
  const keys = [
    'timeZone', 'stages', 'days', 'sets', 'errors', 'pins', 'times', 'overlaps',
    'duration_odd', 'start_unusual_hour', 'artist_double_booked',
  ];
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
    assert.equal(map.stages.label, '2 stages');
    assert.equal(map.days.label, '2 days, each with a date');
    assert.equal(map.sets.label, '2 sets');
    assert.deepEqual(map.pins, {
      key: 'pins',
      status: 'warn',
      label: "1 stage has no map pin: Tent. Attendees won't see them on the map.",
    });
  });

  test('uses the singular for one stage, day or set', () => {
    const festival = {
      name: 'Tiny',
      timeZone: 'UTC',
      stages: [stage('a', 'Main', { latitude: 1, longitude: 2 })],
      days: [{ label: 'Friday', date: '2026-06-05', sets: [set('s1', 'X', 'a', '20:00', '21:00')] }],
    };
    const map = byKey(publishChecklist(config, festival));
    assert.equal(map.stages.label, '1 stage');
    assert.equal(map.days.label, '1 day, each with a date');
    assert.equal(map.sets.label, '1 set');
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
      label: 'Fix 1 lineup problem. First: Set "Y" must reference a valid stage',
    });
    assert.deepEqual(map.times, { key: 'times', status: 'warn', label: '1 set has no start time yet. It shows as TBA.' });
  });

  describe('a festival with announced names', () => {
    const entry = (id: string, name: string, extra: any = {}) => ({
      id,
      artists: [{ name, links: {} }],
      displayName: null,
      tier: null,
      dayDate: null,
      status: 'announced',
      announcedAt: '2026-11-20',
      linkedSetIds: [],
      ...extra,
    });
    const namesOnly = (extra: any = {}) => ({
      name: 'Names',
      timeZone: 'UTC',
      stages: [],
      days: [
        { label: 'Fri', date: '2026-06-05', sets: [] },
        { label: 'Sat', date: '2026-06-06', sets: [] },
      ],
      lineup: [entry('lu-1', 'INFEKT')],
      ...extra,
    });

    test('can publish with dated days, no stages and no sets: sets and stages only warn', () => {
      const items = publishChecklist(config, namesOnly());
      const map = byKey(items);
      assert.deepEqual(map.stages, { key: 'stages', status: 'warn', label: 'No stages yet. Add them before you add sets.' });
      assert.deepEqual(map.sets, {
        key: 'sets',
        status: 'warn',
        label: 'No sets yet on Fri, Sat. Attendees see the announced acts until you add sets.',
      });
      assert.deepEqual(items.filter((item) => item.status === 'todo'), []);
    });

    test('still blocks without dated days', () => {
      assert.equal(byKey(publishChecklist(config, namesOnly({ days: [] }))).days.status, 'todo');
      const undated = namesOnly({ days: [{ label: 'Fri', date: '', sets: [] }] });
      assert.equal(byKey(publishChecklist(config, undated)).days.status, 'todo');
      assert.equal(byKey(publishChecklist(config, namesOnly({ days: [] }))).sets.status, 'todo');
    });

    test('keeps today\'s todo rules with no entries, with only cancelled entries, or when every entry has a set', () => {
      const none = byKey(publishChecklist(config, namesOnly({ lineup: [] })));
      assert.equal(none.stages.status, 'todo');
      assert.equal(none.sets.status, 'todo');
      const cancelledOnly = [entry('lu-1', 'INFEKT', { status: 'cancelled' })];
      assert.equal(byKey(publishChecklist(config, namesOnly({ lineup: cancelledOnly }))).sets.status, 'todo');
      const covered = namesOnly({
        stages: [stage('a', 'Main')],
        days: [
          { label: 'Fri', date: '2026-06-05', sets: [set('s1', 'INFEKT', 'a', '20:00', '21:00')] },
          { label: 'Sat', date: '2026-06-06', sets: [] },
        ],
      });
      assert.equal(byKey(publishChecklist(config, covered)).sets.status, 'todo');
    });

    test('warns about an empty day while an act is still unscheduled, even when other days have sets', () => {
      const partial = namesOnly({
        stages: [stage('a', 'Main')],
        lineup: [entry('lu-1', 'INFEKT'), entry('lu-2', 'Other')],
        days: [
          { label: 'Fri', date: '2026-06-05', sets: [set('s1', 'INFEKT', 'a', '20:00', '21:00')] },
          { label: 'Sat', date: '2026-06-06', sets: [] },
        ],
      });
      const map = byKey(publishChecklist(config, partial));
      assert.equal(map.sets.status, 'warn');
      assert.equal(map.sets.label, 'No sets yet on Sat. Attendees see the announced acts until you add sets.');
      assert.equal(map.stages.status, 'done');
    });
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

describe('publishChecklist data-quality warnings', () => {
  const byKey = (items: any[]) => Object.fromEntries(items.map((item) => [item.key, item]));
  const festivalOf = (days: any[]) => ({
    name: 'Q',
    timeZone: 'UTC',
    stages: [stage('a', 'Main', { latitude: 1, longitude: 2 }), stage('b', 'Tent', { latitude: 1, longitude: 2 })],
    days: days.map((sets, i) => ({ label: `Day ${i + 1}`, date: `2026-06-0${5 + i}`, sets })),
  });
  const checklistOf = (days: any[]) => byKey(publishChecklist(config, festivalOf(days)));
  const quality = ['duration_odd', 'start_unusual_hour', 'artist_double_booked'];

  test('a clean festival is done on all three and none of them can block publish', () => {
    const map = checklistOf([[set('s1', 'X', 'a', '20:00', '21:00'), set('s2', 'Y', 'b', '22:00', '23:30')]]);
    for (const key of quality) assert.equal(map[key].status, 'done', key);
    const dirty = checklistOf([[
      set('s1', 'X', 'a', '20:00', '20:05'), set('s2', 'X', 'b', '20:00', '21:00'), set('s3', 'Y', 'b', '09:00', '10:00'),
    ]]);
    for (const key of quality) assert.equal(dirty[key].status, 'warn', key);
    assert.ok(!Object.values(dirty).some((item: any) => item.status === 'todo'));
  });

  describe('duration_odd', () => {
    test('flags under 15 minutes, over 4 hours and a 22:00 to 21:00 wrap', () => {
      const map = checklistOf([[
        set('s1', 'Short', 'a', '20:00', '20:10'),
        set('s2', 'Long', 'b', '14:00', '18:30'),
        set('s3', 'Wrap', 'a', '22:00', '21:00'),
      ]]);
      assert.equal(map.duration_odd.status, 'warn');
      assert.equal(map.duration_odd.label, 'Short is 10 min long on Day 1 (and 2 more).');
    });

    test('names a single set and uses h and min', () => {
      assert.equal(checklistOf([[set('s1', 'Long', 'a', '14:00', '18:30')]]).duration_odd.label, 'Long is 4 h 30 min long on Day 1.');
      assert.equal(checklistOf([[set('s1', 'Wrap', 'a', '22:00', '21:00')]]).duration_odd.label, 'Wrap is 23 h long on Day 1.');
    });

    test('accepts 15 minutes, 4 hours, a past-midnight set and untimed sets', () => {
      const map = checklistOf([[
        set('s1', 'Min', 'a', '20:00', '20:15'),
        set('s2', 'Max', 'b', '14:00', '18:00'),
        set('s3', 'Night', 'a', '23:00', '02:00'),
        set('s4', 'Tba', 'b'),
      ]]);
      assert.equal(map.duration_odd.status, 'done');
    });
  });

  describe('start_unusual_hour', () => {
    const evening = [set('s1', 'A', 'a', '20:00', '21:00'), set('s2', 'B', 'b', '22:00', '23:00'), set('s3', 'C', 'a', '00:30', '01:30')];

    test('flags a 06:00 to 10:59 start on a day of evening sets', () => {
      for (const start of ['06:00', '09:00', '10:59']) {
        const map = checklistOf([[...evening, set('s9', 'Nine', 'b', start, '12:00')]]);
        assert.equal(map.start_unusual_hour.status, 'warn', start);
      }
      assert.match(
        checklistOf([[...evening, set('s9', 'Nine', 'b', '09:00', '10:00')]]).start_unusual_hour.label,
        /^Nine starts at 9:00 AM on Day 1, but most sets that day start at 2:00 PM or later\.$/,
      );
    });

    test('leaves 11:00, 14:00 and after-midnight starts alone', () => {
      for (const start of ['11:00', '13:00', '05:59', '00:30']) {
        const map = checklistOf([[...evening, set('s9', 'Nine', 'b', start, '12:00')]]);
        assert.equal(map.start_unusual_hour.status, 'done', start);
      }
    });

    test('is quiet when every set on the day starts before 14:00', () => {
      const map = checklistOf([[set('s1', 'A', 'a', '09:00', '10:00'), set('s2', 'B', 'b', '10:00', '11:00'), set('s3', 'C', 'a', '12:00', '13:00')]]);
      assert.equal(map.start_unusual_hour.status, 'done');
    });

    test('judges each day on its own sets', () => {
      const map = checklistOf([evening, [set('s4', 'D', 'a', '09:00', '10:00'), set('s5', 'E', 'b', '10:00', '11:00')]]);
      assert.equal(map.start_unusual_hour.status, 'done');
    });
  });

  describe('artist_double_booked', () => {
    const tail = ' Name match. Two different artists with one name show here too.';

    test('flags one name on two stages at overlapping times, ignoring case', () => {
      const map = checklistOf([[set('s1', 'Kai', 'a', '20:00', '21:00'), set('s2', 'kai', 'b', '20:30', '21:30')]]);
      assert.deepEqual(map.artist_double_booked, {
        key: 'artist_double_booked',
        status: 'warn',
        label: `kai is on Main and Tent at the same time on Day 1.${tail}`,
      });
    });

    test('does not flag back-to-back sets or the same stage', () => {
      const map = checklistOf([[
        set('s1', 'Kai', 'a', '20:00', '21:00'), set('s2', 'Kai', 'b', '21:00', '22:00'),
        set('s3', 'Mira', 'a', '20:00', '22:00'), set('s4', 'Mira', 'a', '21:00', '23:00'),
      ]]);
      assert.equal(map.artist_double_booked.status, 'done');
    });

    test('checks each B2B member alone', () => {
      const b2b = { id: 's1', artists: [{ name: 'Ana' }, { name: 'Bo' }], stageId: 'a', startTime: '20:00', endTime: '21:00' };
      const apart = checklistOf([[b2b, set('s2', 'Bo', 'b', '23:00', '23:30')]]);
      assert.equal(apart.artist_double_booked.status, 'done');
      const clash = checklistOf([[b2b, set('s2', 'Bo', 'b', '20:30', '21:30')]]);
      assert.equal(clash.artist_double_booked.status, 'warn');
      assert.match(clash.artist_double_booked.label, /^Bo is on Main and Tent/);
    });

    test('compares across midnight: 23:00-02:00 against 01:00-02:00', () => {
      const map = checklistOf([[set('s1', 'Kai', 'a', '23:00', '02:00'), set('s2', 'Kai', 'b', '01:00', '02:00')]]);
      assert.equal(map.artist_double_booked.status, 'warn');
    });

    test('does not compare a late tail with the next night', () => {
      const map = checklistOf([
        [set('s1', 'Kai', 'a', '23:00', '02:00')],
        [set('s2', 'Kai', 'b', '01:00', '02:00')],
      ]);
      assert.equal(map.artist_double_booked.status, 'done');
    });

    test('compares consecutive dated days across the 06:00 boundary', () => {
      const clash = checklistOf([
        [set('s1', 'Kai', 'a', '05:00', '07:00')],
        [set('s2', 'Kai', 'b', '06:30', '07:30')],
      ]);
      assert.equal(clash.artist_double_booked.status, 'warn');
      const festival = festivalOf([[set('s1', 'Kai', 'a', '05:00', '07:00')], [], [set('s2', 'Kai', 'b', '06:30', '07:30')]]);
      assert.equal(byKey(publishChecklist(config, festival)).artist_double_booked.status, 'done');
    });

    test('falls back to day order when a day has no date', () => {
      const festival = festivalOf([[set('s1', 'Kai', 'a', '05:00', '07:00')], [set('s2', 'Kai', 'b', '06:30', '07:30')]]);
      festival.days.forEach((d: any) => delete d.date);
      assert.equal(byKey(publishChecklist(config, festival)).artist_double_booked.status, 'warn');
    });
  });
});

describe('submitBlockers: what stops a submit for review (master plan C10)', () => {
  const base = { name: 'Fest', location: 'Field', timeZone: 'America/New_York', stages: [], days: [], lineup: [{ id: 'e1', artists: [{ name: 'Alpha', links: {} }], status: 'announced' }] };
  const blockers = (festival: any) => submitBlockers(festival, publishChecklist(config, festival)).map((item) => item.key);

  test('a festival with names only and no days can be submitted, though publish still needs the days', () => {
    assert.deepEqual(blockers(base), []);
    assert.equal(publishChecklist(config, base).find((item) => item.key === 'days')!.status, 'todo');
  });

  test('a festival with no time zone, or nothing at all, is still blocked', () => {
    assert.deepEqual(blockers({ ...base, timeZone: null }), ['timeZone']);
    assert.deepEqual(blockers({ ...base, lineup: [] }), ['stages', 'sets'], 'no names and no days: the days item is ignored, the rest is not');
  });

  test('once there are days, the sets item counts again', () => {
    assert.deepEqual(blockers({ ...base, days: [{ label: 'Fri', date: '2027-06-04', sets: [] }] }), []);
    assert.deepEqual(blockers({ ...base, lineup: [], days: [{ label: 'Fri', date: '2027-06-04', sets: [] }] }), ['stages', 'sets']);
  });
});
