import { read } from './read-source';


describe('mobile misc sweep', () => {
  it('search-hidden Clear filters also clears genres', () => {
    expect(read('app/(tabs)/index.tsx')).toMatch(
      /setActiveStages\(\[\]\);\s*setActiveGenres\(\[\]\);\s*viewAs\.clear\(\)/,
    );
  });
  it('festival phase recomputes with the clock', () => {
    expect(read('app/(tabs)/index.tsx')).toMatch(
      /festivalPhase\(currentFestival, days, new Date\(nowMs\)\),\s*\[currentFestival, days, nowMs\]/,
    );
  });
  it('crew plan uses shared meeting time and HH:MM formatting', () => {
    const src = read('app/crew-plan.tsx');
    expect(src).toContain('meetingTimeDisplay(');
    expect(src).toContain('resolveFestivalTimeZone(currentFestival)');
    expect(src).not.toContain('toLocaleString');
    expect(src).toContain('formatTimeOrRaw(crew.homeBaseTime)');
  });
  it('timeline auto-scroll respects user scroll and NOW visibility', () => {
    const src = read('components/TimelineView.tsx');
    expect(src).not.toContain('USER_SCROLL_HOLD_MS');
    expect(src).not.toContain('setTimeout');
    expect(src).toContain('userScrolledRef.current');
    expect(src).toMatch(/nowY >= y && nowY <= y \+ h/);
  });
});
