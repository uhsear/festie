import { describe, it, expect } from 'vitest';
import {
  COPY, FESTIVAL_STATUS_LABEL, MEETING_POINT_KINDS, clashChip, clashChipA11y, clashCount, clashPromptCopy, genreChipLabel,
  meetingPointKind,
} from './copy';

// Mirrors MEETING_POINT_TYPES in lib/constants.ts:21; shared cannot import backend code.
const SERVER_TYPES = ['pre-show', 'during', 'post-show', 'post-event', 'emergency', 'general'];

describe('meetingPointKind', () => {
  it('labels emergency as Emergency spot', () => {
    expect(meetingPointKind('emergency').label).toBe('Emergency spot');
  });
  it.each(['pre-show', 'during', 'post-show', 'post-event', 'general', 'mystery'])('reads %s as Meet-up', (t) => {
    expect(meetingPointKind(t).label).toBe('Meet-up');
  });
  it('only offers types the server accepts', () => {
    for (const k of MEETING_POINT_KINDS) expect(SERVER_TYPES).toContain(k.type);
  });
});

describe('clashPromptCopy', () => {
  it.each([true, false])('never says conflict (hard=%s)', (hard) => {
    for (const at of ['9:00 PM', null]) {
      const c = clashPromptCopy({ hard, at, currentName: 'A', otherName: 'B' });
      expect(`${c.title} ${c.body}`.toLowerCase()).not.toContain('conflict');
    }
  });
  it('builds hard and soft titles', () => {
    expect(clashPromptCopy({ hard: true, at: '9:00 PM', currentName: 'A', otherName: 'B' }).title)
      .toBe('You have a clash at 9:00 PM: keep one');
    expect(clashPromptCopy({ hard: false, at: null, currentName: 'A', otherName: 'B' }).title)
      .toBe('2 sets: keep one');
  });
});

describe('clashCount', () => {
  it('pluralises', () => {
    expect(clashCount(1)).toBe('Schedule clash');
    expect(clashCount(3)).toBe('3 schedule clashes');
  });
});

describe('status words', () => {
  it('calls a running festival Happening now', () => {
    expect(FESTIVAL_STATUS_LABEL.ongoing).toBe('Happening now');
  });
  it('reserves Live for location sharing', () => {
    const { liveLocation, ...rest } = COPY.status;
    expect(liveLocation).toBe('Live');
    for (const v of Object.values(rest)) expect(v).not.toBe('Live');
  });
});

describe('grid clash copy', () => {
  it('formats the chip', () => {
    expect(clashChip(1)).toBe('1 clash');
    expect(clashChip(3)).toBe('3 clashes');
  });
  it('formats the chip a11y label', () => {
    expect(clashChipA11y(1)).toBe('1 clash. Open it in Picks.');
    expect(clashChipA11y(3)).toBe('3 clashes. Open them in Picks.');
    expect(clashChipA11y(3).startsWith(clashChip(3))).toBe(true);
  });
  it('never says conflict in grid copy', () => {
    for (const v of Object.values(COPY.grid)) expect(v.toLowerCase()).not.toContain('conflict');
  });
});

describe('clash fix and My day copy', () => {
  it('names the recommended pick Suggested, not Keep', () => {
    expect(COPY.clash.suggested).toBe('Suggested');
    expect(COPY.clash.failed).toBe("Couldn't update your picks. Try again.");
  });
  it('formats My day rows', () => {
    expect(COPY.myDay.free('45 min')).toBe('45 min free');
    expect(COPY.myDay.walk(6, 'Main Stage')).toBe('6 min walk from Main Stage');
    expect(COPY.myDay.meet('Ferris wheel')).toBe('Meet: Ferris wheel');
  });
  it('keeps every T13 clash key', () => {
    expect(COPY.clash).toMatchObject({ one: 'Schedule clash', badge: 'Clash', filter: 'Clashes', none: 'No clashes' });
  });
});

describe('also plays copy', () => {
  it('formats the strings', () => {
    expect(COPY.alsoPlays.heading).toBe('Also plays');
    expect(COPY.alsoPlays.row('Sat 9:00 PM')).toBe('Also plays Sat 9:00 PM');
    expect(COPY.alsoPlays.pickToo).toBe('Pick this one too');
    expect(COPY.alsoPlays.pickTooA11y('A', 'Sat 9:00 PM')).toBe('Pick A Sat 9:00 PM too');
    expect(COPY.alsoPlays.picked).toBe('In your picks');
    expect(COPY.alsoPlays.catchInstead('A', 'Sat')).toBe('Catch A on Sat instead');
    expect(COPY.alsoPlays.catchInsteadA11y('A', 'Sat 9:00 PM')).toBe(
      'Catch A Sat 9:00 PM instead, and remove this set from your picks',
    );
    expect(COPY.alsoPlays.caught('A', 'Sat 9:00 PM')).toBe('Catching A Sat 9:00 PM instead.');
    expect(COPY.alsoPlays.gone).toBe('That other set is no longer free. Pick another fix.');
  });
  it('never says "Log in"', () => {
    const strings = [
      ...Object.values(COPY.alsoPlays).map((v) => (typeof v === 'function' ? v('x', 'y') : v)),
      clashChipA11y(1),
      clashChipA11y(3),
    ];
    for (const v of strings) expect(v).not.toMatch(/log in/i);
  });
});

describe('genreChipLabel', () => {
  it('capitalises every word and keeps acronyms upper case', () => {
    expect(genreChipLabel('melodic dubstep')).toBe('Melodic Dubstep');
    expect(genreChipLabel('edm')).toBe('EDM');
    expect(genreChipLabel('uk garage')).toBe('UK Garage');
    expect(genreChipLabel('dnb')).toBe('DnB');
    expect(genreChipLabel('r&b')).toBe('R&B');
    expect(genreChipLabel('deep-house')).toBe('Deep-House');
  });
  it('is stable on a label that is already cased', () => {
    expect(genreChipLabel('Future Bass')).toBe('Future Bass');
  });
});

describe('a11y names start with the visible text (WCAG 2.5.3)', () => {
  it('names the jump-to-now control by its label first', () => {
    expect(COPY.jumpToNow.a11y.startsWith(COPY.jumpToNow.label)).toBe(true);
  });
});
