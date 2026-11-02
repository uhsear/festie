import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('T17 mobile Schedule tab', () => {
  const index = read('app/(tabs)/index.tsx');

  it('reads My picks from the shared store, not local state', () => {
    expect(index).not.toMatch(/\[onlyMine, setOnlyMine\] = useState/);
  });

  it('uses the shared filter, view and empty-state logic', () => {
    for (const needle of [
      'toggleStageFilter',
      'All stages',
      'scheduleEmptyReason',
      'defaultScheduleView',
      '<ScheduleDayChips',
      '<ScheduleResultsRow',
    ]) {
      expect(index).toContain(needle);
    }
  });

  it('drops the old hide-model stage toggle and per-load default ref', () => {
    expect(index).not.toContain('effectiveStages');
    expect(index).not.toContain('defaultedFestivalRef');
  });

  it('no longer hides the phase band inside the Filters panel', () => {
    expect(index).not.toContain('phase && filtersOpen');
    expect(index).not.toContain('filtersOpen || phase');
  });

  it('applies a deep-link view only after this festival restored its prefs', () => {
    expect(index).toContain('prefsFestivalId !== currentFestival.id');
  });

  it('keeps the view out of UIContext', () => {
    expect(read('contexts/UIContext.tsx')).not.toContain('viewMode');
  });

  it('lets the phase band be dismissed', () => {
    expect(read('components/PhaseHomeActions.tsx')).toContain('Hide these shortcuts');
  });
});
