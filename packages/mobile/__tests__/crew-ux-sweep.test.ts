import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('crew UX sweep guards', () => {
  it('meeting-point form blocks a picked day with no time and toasts save failures in formOnly mode', () => {
    const src = read('components/CrewMeetingPoints.tsx');
    expect(src).toContain('(dayIndex === null || !!time)');
    expect(src).toContain('Pick a time (or choose No time)');
    expect(src).toMatch(/if \(formOnly\) \{\s*useUIStore\s*\.getState\(\)\s*\.showToast\(useCrewStore\.getState\(\)\.error/);
  });
  it('invite screen toasts the already-joined outcome and clears stale errors', () => {
    const src = read('app/join/[code].tsx');
    expect(src).toContain("showToast(`You're already in ${outcome.crew.name}`");
    expect(src).not.toContain('AccessibilityInfo');
    expect(src).toMatch(/useEffect\(\(\) => \{\s*setError\(null\);/);
  });
  it('crew tab clears a stale store error on focus', () => {
    const src = read('app/(tabs)/crew.tsx');
    expect(src).toMatch(/useCallback\(\(\) => \{[^}]*?setError\(null\);\s*if \(sectionsFailed\)/s);
  });
  it('settle-up shows toasts for payment and reminder, not an Alert', () => {
    const src = read('components/CrewExpenses.tsx');
    expect(src).toContain("writeOutcomeMessage(outcome, 'Payment recorded')");
    expect(src).not.toContain("Alert.alert('Not sent yet'");
    expect(src).toContain('`Reminder sent to ${s.fromName}.`');
    expect(src).not.toContain('announceForAccessibility(`Reminder sent');
  });
  it('guest crew plan offers sign in and create account', () => {
    const src = read('app/crew-plan.tsx');
    expect(src).toContain("setReturnTo('/crew-plan')");
    expect(src).toContain("'/(auth)/login'");
    expect(src).toContain("'/(auth)/register'");
  });
  it('crew plan pluralises members and falls back for whereabouts with no status', () => {
    const src = read('app/crew-plan.tsx');
    expect(src).toContain('memberCountLabel(hub.memberCount)');
    expect(src).not.toContain('hub.memberCount} members');
    expect(src).toContain("w.statusLabel ?? 'Location shared'");
  });
  it('suggestion strip and Home Base card wrap long text', () => {
    expect(read('components/CrewSuggestionStrip.tsx')).toMatch(/styles\.artist\} numberOfLines=\{2\}/);
    expect(read('components/CrewSuggestionStrip.tsx')).toMatch(/titleRow: \{\s*flexDirection: 'row',\s*flexWrap: 'wrap'/);
    expect(read('components/CrewHomeBase.tsx')).toContain('styles.cardLocation} numberOfLines={3}');
  });
  it('confirm and alert copy: Make owner, mapped nudge error, shared end-poll copy, reform without a zero', () => {
    const crew = read('app/(tabs)/crew.tsx');
    expect(crew).toContain("text: 'Make owner'");
    expect(crew).not.toContain("text: 'Transfer'");
    expect(crew).toContain('invited > 0');
    expect(crew).toContain('Share the invite link with the other ${invited} to bring them across.');
    const polls = read('components/CrewPolls.tsx');
    expect(polls).toContain("mapErrorToUserMessage(err, 'Try again in a moment.')");
    expect(polls).toContain('crewCopy.endPoll(isSchedule)');
  });
});
