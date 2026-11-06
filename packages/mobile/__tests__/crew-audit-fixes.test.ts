import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { crewCopy } from '@festie/shared/utils';

const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const crew = read('app', '(tabs)', 'crew.tsx');

describe('crew switcher sheet keyboard', () => {
  it('lifts the sheet above the keyboard', () => {
    const src = read('components', 'CrewSwitcherSheet.tsx');
    expect(src).toContain('KeyboardAvoidingView');
    expect(src).toContain("Platform.OS === 'ios' ? 'padding' : 'height'");
  });
});

describe('crew bottom sheets clear the home indicator', () => {
  it.each(['CrewSwitcherSheet', 'HandOverSheet', 'FestivalChoiceSheet', 'InviteQRSheet'])('%s adds insets.bottom', (name) => {
    const src = read('components', `${name}.tsx`);
    expect(src).toContain('useSafeAreaInsets');
    expect(src).toContain('paddingBottom: t.spacing[5] + insets.bottom');
  });
});

describe('user-typed crew text wraps instead of clipping', () => {
  const lines = (file: string, style: string) =>
    [...read('components', file).matchAll(new RegExp(`styles[.]${style}[}][^>]*numberOfLines=[{]([0-9])[}]`, 'g'))].map((m) => Number(m[1]));
  it.each([
    ['CrewPollCard.tsx', 'optionText', 2],
    ['CrewPollCard.tsx', 'voterLine', 2],
    ['CrewPolls.tsx', 'optionPickText', 2],
    ['CrewMeetingPoints.tsx', 'pointLabel', 2],
    ['CrewMeetingPoints.tsx', 'pointLocation', 3],
    ['CrewMeetingPoints.tsx', 'pointStage', 2],
    ['CrewStatus.tsx', 'statusRowTarget', 2],
    ['CrewPacking.tsx', 'itemLabel', 2],
    ['CrewRides.tsx', 'itemLabel', 2],
    ['CrewExpenses.tsx', 'expenseDesc', 2],
  ] as const)('%s %s allows %i lines', (file, style, n) => {
    expect(lines(file, style)).toContain(n);
  });
});

describe('crew tab behaviour fixes', () => {
  it('sends a festival mismatch to the compare grid', () => {
    expect(crew).toContain("router.push('/crew-compare')");
    expect(crew).toContain('numberOfLines={2}>');
  });
  it('scrolls the Money tab to the expense form', () => {
    expect(crew).toContain('ref={moneyScrollRef}');
    expect(crew).toContain('onFormShown=');
    expect(read('components', 'CrewExpenses.tsx')).toContain('onFormShown?.(e.nativeEvent.layout.y)');
  });
  it('clears the store error on tab change and on overlap failure', () => {
    expect(crew).toMatch(/onTabChange=\{\(tab\) => \{\s*setError\(null\);/);
    expect(crew).toMatch(/setError\(null\);\s*setOverlapError\(/);
  });
  it('confirms leave and delete', () => {
    expect(crewCopy.left('Squad')).toBe('You left Squad');
    expect(crewCopy.deleted('Squad')).toBe('Deleted Squad');
    expect(crew).toContain('crewCopy.left(crewName)');
    expect(crew).toContain('crewCopy.deleted(crewName)');
  });
  it('bounds the check-in cached fix age', () => {
    expect(read('components', 'CrewCheckIn.tsx')).toContain('getLastKnownPositionAsync({ maxAge: 5 * 60_000 })');
  });
});

describe('expense edit while the form is open', () => {
  it('scrolls to the open form instead of arming a stale layout flag', () => {
    const src = readFileSync(join(__dirname, '../components/CrewExpenses.tsx'), 'utf8');
    expect(src).toMatch(/if \(showForm\) onFormShown\?\.\(formY\.current\);\s*else scrollOnLayout\.current = true;/);
  });
});
