import {
  addStage,
  removeStage,
  setStageField,
  setStageLocation,
  setMapConfig,
  addDay,
  removeDay,
  setDayField,
  toggleDay,
  addSet,
  prependSet,
  sortFormSets,
  shiftDaySets,
  removeSet,
  setSetField,
  setSetArtistNames,
  withoutIndex,
  type FormState,
  type SetRow,
  type DayRow,
  type StageRow,
} from './festivalEditState';

function stage(over: Partial<StageRow>): StageRow {
  return { id: 'st1', name: '', color: '#fff', latitude: null, longitude: null, ...over };
}

function set(over: Partial<SetRow>): SetRow {
  return { id: 's1', artist: '', stageId: '', startTime: '', endTime: '', linkUrl: '', artists: [], ...over };
}

function day(over: Partial<DayRow>): DayRow {
  return { id: 'd1', label: '', date: '', sets: [], ...over };
}

function form(over: Partial<FormState>): FormState {
  return { name: '', location: '', timeZone: '', b2bSeparator: 'b2b', stages: [], days: [], mapConfig: null, ...over };
}

describe('stage reducers', () => {
  it('addStage appends', () => {
    const f = addStage(form({}), stage({ id: 'st1', name: 'Main', color: '#fff' }));
    expect(f.stages.map((s) => s.id)).toEqual(['st1']);
  });
  it('removeStage drops only the matching id', () => {
    const f = form({ stages: [stage({ id: 'a' }), stage({ id: 'b' })] });
    expect(removeStage(f, 'a').stages.map((s) => s.id)).toEqual(['b']);
  });
  it('setStageField edits the right field on the right stage', () => {
    const f = form({ stages: [stage({ id: 'a', name: 'x', color: '#000' })] });
    const next = setStageField(f, 'a', 'name', 'Renamed');
    expect(next.stages[0]).toEqual({ id: 'a', name: 'Renamed', color: '#000', latitude: null, longitude: null });
  });
});

describe('setStageLocation', () => {
  it('sets the pin on the matching stage only', () => {
    const f = form({ stages: [stage({ id: 'a' }), stage({ id: 'b' })] });
    const next = setStageLocation(f, 'b', 12.5, -3.25);
    expect(next.stages.find((s) => s.id === 'a')).toMatchObject({ latitude: null, longitude: null });
    expect(next.stages.find((s) => s.id === 'b')).toMatchObject({ latitude: 12.5, longitude: -3.25 });
  });
  it('clears the pin when both are null', () => {
    const f = form({ stages: [stage({ id: 'a', latitude: 1, longitude: 2 })] });
    expect(setStageLocation(f, 'a', null, null).stages[0]).toMatchObject({ latitude: null, longitude: null });
  });
});

describe('setMapConfig', () => {
  it('replaces the whole config', () => {
    const f = form({});
    const cfg = { version: 1 as const, center: [1, 2] as [number, number] };
    expect(setMapConfig(f, cfg).mapConfig).toEqual(cfg);
    expect(setMapConfig(f, null).mapConfig).toBeNull();
  });
});

describe('day reducers', () => {
  it('addDay appends', () => {
    const f = addDay(form({}), day({ id: 'd9' }));
    expect(f.days.map((d) => d.id)).toEqual(['d9']);
  });
  it('removeDay drops only the matching day', () => {
    const f = form({ days: [day({ id: 'A' }), day({ id: 'B' })] });
    expect(removeDay(f, 'A').days.map((d) => d.id)).toEqual(['B']);
  });
  it('setDayField edits the right day', () => {
    const f = form({ days: [day({ id: 'A', label: 'old' }), day({ id: 'B', label: 'keep' })] });
    const next = setDayField(f, 'A', 'label', 'new');
    expect(next.days.map((d) => d.label)).toEqual(['new', 'keep']);
  });
});

describe('toggleDay', () => {
  it('adds a dayId not yet expanded', () => {
    expect(toggleDay(new Set<string>(), 'd1').has('d1')).toBe(true);
  });
  it('removes a dayId already expanded', () => {
    expect(toggleDay(new Set(['d1']), 'd1').has('d1')).toBe(false);
  });
  it('returns a new Set (does not mutate the input)', () => {
    const prev = new Set(['d1']);
    const next = toggleDay(prev, 'd2');
    expect(next).not.toBe(prev);
    expect([...prev]).toEqual(['d1']); // untouched
    expect([...next].sort()).toEqual(['d1', 'd2']);
  });
});

describe('addSet — add to day A does not touch day B', () => {
  it('appends to the targeted day only', () => {
    const f = form({ days: [day({ id: 'A', sets: [] }), day({ id: 'B', sets: [set({ id: 'b1' })] })] });
    const next = addSet(f, 'A', set({ id: 'a1' }));
    expect(next.days.find((d) => d.id === 'A')!.sets.map((s) => s.id)).toEqual(['a1']);
    expect(next.days.find((d) => d.id === 'B')!.sets.map((s) => s.id)).toEqual(['b1']);
  });
  it('leaves the untouched day referentially equal (structural sharing)', () => {
    const dayB = day({ id: 'B', sets: [set({ id: 'b1' })] });
    const f = form({ days: [day({ id: 'A' }), dayB] });
    const next = addSet(f, 'A', set({ id: 'a1' }));
    expect(next.days.find((d) => d.id === 'B')).toBe(dayB);
  });
});

describe('removeSet — removes only (dayId,setId)', () => {
  it('removes the matching set under the matching day', () => {
    const f = form({ days: [day({ id: 'A', sets: [set({ id: 's1' }), set({ id: 's2' })] })] });
    expect(removeSet(f, 'A', 's1').days[0].sets.map((s) => s.id)).toEqual(['s2']);
  });
  it('does NOT remove a set with the same id under a different day', () => {
    const f = form({
      days: [day({ id: 'A', sets: [set({ id: 'dup' })] }), day({ id: 'B', sets: [set({ id: 'dup' })] })],
    });
    const next = removeSet(f, 'A', 'dup');
    expect(next.days.find((d) => d.id === 'A')!.sets).toEqual([]);
    expect(next.days.find((d) => d.id === 'B')!.sets.map((s) => s.id)).toEqual(['dup']);
  });
});

describe('setSetField — edits the right one across duplicated setIds', () => {
  it('edits only the set under the targeted day, even when setIds collide', () => {
    const f = form({
      days: [
        day({ id: 'A', sets: [set({ id: 'dup', artist: 'A-orig' })] }),
        day({ id: 'B', sets: [set({ id: 'dup', artist: 'B-orig' })] }),
      ],
    });
    const next = setSetField(f, 'B', 'dup', 'artist', 'B-edited');
    expect(next.days.find((d) => d.id === 'A')!.sets[0].artist).toBe('A-orig');
    expect(next.days.find((d) => d.id === 'B')!.sets[0].artist).toBe('B-edited');
  });
  it('updates an arbitrary SetRow field', () => {
    const f = form({ days: [day({ id: 'A', sets: [set({ id: 's1', stageId: '' })] })] });
    expect(setSetField(f, 'A', 's1', 'stageId', 'stage-7').days[0].sets[0].stageId).toBe('stage-7');
  });
});

describe('setSetArtistNames', () => {
  const origin = [
    { name: 'A', links: { spotify: 'https://a' } },
    { name: 'B', links: { spotify: 'https://b' } },
    { name: 'C', links: { spotify: 'https://c' } },
  ];
  const base = () =>
    form({
      b2bSeparator: 'vs',
      days: [
        day({ id: 'd1', sets: [set({ id: 's1', artists: origin }), set({ id: 's2', artist: 'Z' })] }),
        day({ id: 'd2', sets: [set({ id: 's1', artist: 'Other' })] }),
      ],
    });

  it('changes only the target set and joins with the festival separator', () => {
    const f = base();
    const next = setSetArtistNames(f, 'd1', 's1', origin, ['A', 'B2', 'C']);
    expect(next.days[0].sets[0].artist).toBe('A vs B2 vs C');
    expect(next.days[0].sets[1]).toBe(f.days[0].sets[1]);
    expect(next.days[1]).toBe(f.days[1]);
  });

  it('keeps the third artist links when the middle name is blank', () => {
    const next = setSetArtistNames(base(), 'd1', 's1', origin, ['A', '', 'C']);
    expect(next.days[0].sets[0].artists).toEqual([origin[0], origin[2]]);
  });

  it('keeps the third artist links when the middle artist is removed, and gives a new artist none', () => {
    const spliced = withoutIndex(origin, 1);
    let next = setSetArtistNames(base(), 'd1', 's1', spliced, ['A', 'C']);
    expect(next.days[0].sets[0].artists).toEqual([origin[0], origin[2]]);
    expect(next.days[0].sets[0].artist).toBe('A vs C');
    next = setSetArtistNames(next, 'd1', 's1', spliced, ['A', 'C', 'D']);
    expect(next.days[0].sets[0].artists[2]).toEqual({ name: 'D', links: {} });
  });
});

describe('prependSet', () => {
  it('puts the set first in that day only', () => {
    const f = form({
      days: [day({ id: 'd1', sets: [set({ id: 'a' })] }), day({ id: 'd2', sets: [set({ id: 'b' })] })],
    });
    const next = prependSet(f, 'd1', set({ id: 'new' }));
    expect(next.days[0].sets.map((s) => s.id)).toEqual(['new', 'a']);
    expect(next.days[1]).toBe(f.days[1]);
  });
});

describe('sortFormSets', () => {
  it('sorts by stage order, then start, with 01:00 after 23:00', () => {
    const f = form({
      stages: [stage({ id: 'main' }), stage({ id: 'tent' })],
      days: [
        day({
          id: 'd1',
          sets: [
            set({ id: 't1', stageId: 'tent', startTime: '20:00' }),
            set({ id: 'm3', stageId: 'main', startTime: '01:00' }),
            set({ id: 'm2', stageId: 'main', startTime: '23:00' }),
            set({ id: 'm1', stageId: 'main', startTime: '18:00' }),
          ],
        }),
      ],
    });
    expect(sortFormSets(f).days[0].sets.map((s) => s.id)).toEqual(['m1', 'm2', 'm3', 't1']);
  });
});

describe('shiftDaySets', () => {
  it('shifts the listed sets, returns the counts and leaves other days alone', () => {
    const f = form({
      days: [
        day({ id: 'd1', sets: [set({ id: 'a', startTime: '22:00', endTime: '23:00' }), set({ id: 'b', startTime: '' })] }),
        day({ id: 'd2', sets: [set({ id: 'a', startTime: '22:00' })] }),
      ],
    });
    const { form: next, result } = shiftDaySets(f, 'd1', ['a', 'b'], 30);
    expect(next.days[0].sets[0]).toMatchObject({ startTime: '22:30', endTime: '23:30' });
    expect(result).toEqual({ shifted: 1, skipped: 1, crossedDayStart: 0 });
    expect(next.days[1]).toBe(f.days[1]);
  });
});
