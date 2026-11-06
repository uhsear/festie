// Source-level guards for the schedule/lineup consistency fixes. Mobile vitest
// runs in plain node with no RN renderer, so these read the files directly.
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

describe('Grid', () => {
  const src = read('app/grid.tsx');

  it('renders the TBA list under the grid on a day that also has timed sets', () => {
    expect(src.match(/<TBASection/g)).toHaveLength(2);
    expect(src).toMatch(/untimedSets\.length > 0 \? \(\s*<ScrollView style=\{styles\.tbaWrap\}>/);
  });

  it('lets guests pick: canPick comes from useCanPick, not the signed-in user', () => {
    expect(src).toContain('useCanPick()');
    expect(src).not.toContain('canPick={!!user}');
    expect(src).not.toContain('handleMenuPick');
  });

  it('clears the genre filter, and lists other-day matches, from the search empty state', () => {
    expect(src).toMatch(/setActiveStages\(\[\]\);\s*setActiveGenres\(\[\]\);\s*viewAs\.clear\(\);/);
    expect(src).toContain('searchOtherDays(allSets, searchQuery, selectedDay, stages)');
    expect(src).toContain('searchEmptyCopy(searchQuery, dayLabel, otherDayGroups.length > 0, hidden)');
    expect(src).toContain('{otherDayMatches}');
  });

  it('re-centres on now after a day switch and offers Jump to now', () => {
    expect(src).toMatch(/didAutoScroll\.current = false;\s*\}, \[selectedDay\]\)/);
    expect(src).toContain('COPY.jumpToNow.label');
    expect(src).toContain('CONCEPT_IONICON.jumpToNow');
  });
});

describe('useQuickPick', () => {
  const src = read('hooks/useQuickPick.ts');

  it('saves a guest or profile-less pick instead of redirecting', () => {
    expect(src).not.toContain('/(auth)/login');
    expect(src).not.toContain('currentProfile');
  });

  it('clears with Undo and toasts a failed save', () => {
    expect(src).toContain('usePickClear(undoNotifier)');
    expect(src).toContain('haptics.warning()');
    expect(src).toContain("Couldn't save your pick. Try again.");
  });
});

describe('Set deep link', () => {
  const src = read('app/set/[setId].tsx');

  it('tells a network error from a missing set and can retry', () => {
    expect(src).toContain('isNetworkError');
    expect(src).toContain("You're offline, so this set link can't open yet.");
    expect(src).toMatch(/resolveTried\.current = false;[\s\S]*setResolveAttempt\(\(n\) => n \+ 1\)/);
    expect(src).toContain('resolveAttempt]');
    expect(src).toContain('title="Set not found"');
  });
});

describe('Now & Next screen', () => {
  const src = read('app/festival-mode.tsx');

  it('shows loading and a retryable error before "No festival selected"', () => {
    expect(src).toContain('festivalLoadState(');
    expect(src).toContain('<LoadingState />');
    expect(src).toContain('COPY.festivalLoad.errorTitle');
    expect(src).toContain('COPY.festivalLoad.retry');
  });

  it('has a confirm-gated SOS button for a crew member before the festival ends', () => {
    expect(src).toContain('useSosRaise(');
    expect(src).toMatch(/user && crew && !after/);
    expect(src).toContain('onPress={confirmRaise}');
    expect(src).toContain('disabled={raising}');
  });

  it('uses the same wording as web for the lineup button', () => {
    expect(read('components/NowSurface.tsx')).toContain('label="Browse the lineup"');
  });
});

describe('Artist names on Now/Next surfaces', () => {
  it('wrap to two lines', () => {
    expect(read('components/NowNextStrip.tsx')).toMatch(/styles\.artist\} numberOfLines=\{2\}/);
    expect(read('components/CaughtNowCard.tsx')).toMatch(/styles\.artist\} numberOfLines=\{2\}/);
  });
});

describe('Festival picker', () => {
  it('uses the shared title and load-failure state', () => {
    expect(read('app/(tabs)/index.tsx')).toContain('title="Choose a festival"');
    const list = read('components/FestivalList.tsx');
    expect(list).toContain('COPY.festivalLoad.errorTitle');
    expect(list).toContain('cloud-offline-outline');
  });
});
