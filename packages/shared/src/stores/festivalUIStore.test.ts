import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useFestivalUIStore } from './festivalUIStore';
import { configureStorage, getStorage } from '../platform/storage';

describe('festivalUIStore', () => {
  beforeEach(() => {
    useFestivalUIStore.setState({
      selectedDay: 0,
      activeStages: [],
      searchQuery: '',
      onlyMine: false,
      scheduleView: null,
      hiddenDays: [],
      dismissedPhase: null,
      scheduleGroupBy: null,
      prefsFestivalId: null,
      prefsScope: { stageIds: [], dayCount: 0 },
      byFestival: {},
    });
  });

  describe('initial state', () => {
    it('starts with selectedDay 0', () => {
      expect(useFestivalUIStore.getState().selectedDay).toBe(0);
    });

    it('starts with empty activeStages', () => {
      expect(useFestivalUIStore.getState().activeStages).toEqual([]);
    });

    it('starts with empty searchQuery', () => {
      expect(useFestivalUIStore.getState().searchQuery).toBe('');
    });
  });

  describe('setSelectedDay', () => {
    it('sets the selected day index', () => {
      useFestivalUIStore.getState().setSelectedDay(2);
      expect(useFestivalUIStore.getState().selectedDay).toBe(2);
    });

    it('allows setting to 0', () => {
      useFestivalUIStore.getState().setSelectedDay(3);
      useFestivalUIStore.getState().setSelectedDay(0);
      expect(useFestivalUIStore.getState().selectedDay).toBe(0);
    });
  });

  describe('setActiveStages', () => {
    it('sets the active stage IDs', () => {
      useFestivalUIStore.getState().setActiveStages(['s1', 's2']);
      expect(useFestivalUIStore.getState().activeStages).toEqual(['s1', 's2']);
    });

    it('replaces previous stages', () => {
      useFestivalUIStore.getState().setActiveStages(['s1']);
      useFestivalUIStore.getState().setActiveStages(['s3', 's4']);
      expect(useFestivalUIStore.getState().activeStages).toEqual(['s3', 's4']);
    });

    it('clears with empty array', () => {
      useFestivalUIStore.getState().setActiveStages(['s1']);
      useFestivalUIStore.getState().setActiveStages([]);
      expect(useFestivalUIStore.getState().activeStages).toEqual([]);
    });
  });

  describe('setSearchQuery', () => {
    it('sets the search query', () => {
      useFestivalUIStore.getState().setSearchQuery('deadmau5');
      expect(useFestivalUIStore.getState().searchQuery).toBe('deadmau5');
    });

    it('clears with empty string', () => {
      useFestivalUIStore.getState().setSearchQuery('test');
      useFestivalUIStore.getState().setSearchQuery('');
      expect(useFestivalUIStore.getState().searchQuery).toBe('');
    });
  });

  describe('remembered prefs', () => {
    const scope = { stageIds: ['s1', 's2'], dayCount: 3, todayIdx: 1 };
    const ui = () => useFestivalUIStore.getState();

    it('writes every setter to byFestival[prefsFestivalId]', () => {
      ui().restoreForFestival('A', scope);
      ui().setActiveStages(['s1']);
      ui().setOnlyMine(true);
      ui().setSearchQuery('garden');
      ui().setScheduleView('grid');
      ui().dismissPhaseBand('post');
      ui().setHiddenDays([2]);
      ui().setScheduleGroupBy('az');
      expect(ui().byFestival.A).toEqual({
        view: 'grid',
        activeStages: ['s1'],
        onlyMine: true,
        searchQuery: 'garden',
        hiddenDays: [2],
        dismissedPhase: 'post',
        groupBy: 'az',
      });
    });

    it('does not write byFestival without a festival', () => {
      ui().setSearchQuery('x');
      expect(ui().byFestival).toEqual({});
    });

    it('loads each festival its own prefs', () => {
      ui().restoreForFestival('A', scope);
      ui().setActiveStages(['s1']);
      ui().restoreForFestival('B', scope);
      expect(ui().activeStages).toEqual([]);
      expect(ui().selectedDay).toBe(1);
      expect(ui().byFestival.B).toBeUndefined();
      ui().restoreForFestival('A', scope);
      expect(ui().activeStages).toEqual(['s1']);
    });

    it('keeps selectedDay on a refresh and drops vanished stages', () => {
      ui().restoreForFestival('A', scope);
      ui().setActiveStages(['s1', 's2']);
      ui().setSelectedDay(2);
      ui().restoreForFestival('A', { stageIds: ['s1', 's3'], dayCount: 3, todayIdx: 0 });
      expect(ui().selectedDay).toBe(2);
      expect(ui().activeStages).toEqual(['s1']);
    });

    it('moves selectedDay when hiding it', () => {
      ui().restoreForFestival('A', scope);
      ui().setSelectedDay(0);
      ui().setHiddenDays([0]);
      expect(ui().selectedDay).toBe(1);
    });

    it('still works when storage throws', () => {
      const original = getStorage();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const boom = () => {
        throw new Error('denied');
      };
      configureStorage({ getItem: boom, setItem: boom, removeItem: boom });
      try {
        ui().restoreForFestival('A', scope);
        expect(() => {
          ui().setActiveStages(['s2']);
          ui().setOnlyMine(true);
          ui().setSearchQuery('q');
          ui().setScheduleView('cards');
          ui().setHiddenDays([0]);
          ui().dismissPhaseBand('pre');
        }).not.toThrow();
        expect(ui().activeStages).toEqual(['s2']);
        expect(ui().hiddenDays).toEqual([0]);
      } finally {
        configureStorage(original);
        warn.mockRestore();
      }
    });

    it('writes through the storage adapter', () => {
      const writes: Record<string, string> = {};
      const original = getStorage();
      configureStorage({
        getItem: (k) => writes[k] ?? null,
        setItem: (k, v) => {
          writes[k] = v;
        },
        removeItem: () => {},
      });
      try {
        ui().restoreForFestival('A', scope);
        ui().setActiveStages(['s1']);
        expect(JSON.parse(writes['festie-schedule-prefs']!).state.byFestival.A.activeStages).toEqual(['s1']);
      } finally {
        configureStorage(original);
      }
    });

    describe('merge on late hydration', () => {
      const stored = JSON.stringify({
        state: {
          byFestival: {
            A: { view: 'grid', activeStages: ['s2'], onlyMine: false, searchQuery: '', hiddenDays: [], dismissedPhase: null, groupBy: null },
          },
        },
        version: 1,
      });
      const hydrate = async () => {
        const original = getStorage();
        configureStorage({ getItem: () => stored, setItem: () => {}, removeItem: () => {} });
        try {
          await useFestivalUIStore.persist.rehydrate();
        } finally {
          configureStorage(original);
        }
      };

      it('applies persisted prefs when the live store has no entry', async () => {
        ui().restoreForFestival('A', scope);
        await hydrate();
        expect(ui().activeStages).toEqual(['s2']);
        expect(ui().scheduleView).toBe('grid');
      });

      it('keeps live prefs when the live store already has an entry', async () => {
        ui().restoreForFestival('A', scope);
        ui().setActiveStages(['s1']);
        await hydrate();
        expect(ui().activeStages).toEqual(['s1']);
      });
    });
  });
});
