import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('picks and sharing UX source guards', () => {
  it('rate: advance clears the pending auto-advance and a failed save warns and toasts', () => {
    const src = read('app/rate.tsx');
    expect(src).toMatch(/const advance = useCallback\(\(\) => \{\s*if \(timer\.current\) clearTimeout\(timer\.current\);/);
    expect(src).toContain("showToast(\"Couldn't save that. Try again.\", { kind: 'error' })");
    expect(src).toContain('haptics.warning()');
    expect(src).not.toContain('console.warn');
  });

  it('wrap: refetches on focus, gates guests, shares crew wrap as text on failure, uses shared copy', () => {
    const src = read('app/wrap.tsx');
    expect(src).toContain('useFocusEffect(');
    expect(src).toContain("if (!festivalId || !user) return;");
    expect(src).toContain("signInTo('see your wrap')");
    expect(src).toContain('Couldn\'t load your ${COPY.wrap.name}');
    expect(src).toContain('{COPY.wrap.crewName}');
    expect(src).toContain('sortRatingsForWrap(');
    expect(src).not.toContain('s.artist || s.setId');
    expect(src).not.toContain('set.artist || set.setId');
    expect(src.match(/const shareText = async/g)).toHaveLength(2);
  });

  it('caught: save errors toast, the search is lifted above the keyboard', () => {
    const src = read('app/caught.tsx');
    expect(src).toContain("showToast(mapErrorToUserMessage(e, SAVE_ERROR), { kind: 'error' })");
    expect(src).toContain('automaticallyAdjustKeyboardInsets');
    expect(src).not.toContain('saveError');
    expect(src).not.toContain('errorTimer');
  });

  it('friend-picks: ticks are user state with a derived default, and load errors can retry', () => {
    const src = read('app/friend-picks.tsx');
    expect(src).toContain('useState<Set<string> | null>(null)');
    expect(src).not.toContain('setTicked');
    expect(src).toContain('setUserTicks(new Set())');
    expect(src).toContain("label: 'Try again'");
    expect(src).toContain('isRetryable(err)');
  });

  it('crew-compare: a failed refresh keeps the grid, guests get Sign in, names take two lines', () => {
    const src = read('app/crew-compare.tsx');
    expect(src).toContain('if (error && rows.length === 0)');
    expect(src).toContain("setError(mapErrorToUserMessage(err, \"Couldn't load crew picks.\"))");
    expect(src).toContain("label: COPY.auth.signIn, onPress: () => router.push('/(auth)/login')");
    expect(src).toMatch(/styles\.setArtist\} numberOfLines=\{2\}/);
  });

  it('clash surfaces: mapped errors and two-line Keep buttons', () => {
    expect(read('components/ClashCards.tsx')).toContain('mapErrorToUserMessage(err, COPY.clash.failed)');
    const prompt = read('components/ClashPrompt.tsx');
    expect(prompt).not.toMatch(/keepText\} numberOfLines=\{1\}/);
    expect(prompt.match(/keepText\} numberOfLines=\{2\}/g)).toHaveLength(2);
  });

  it('picks tab: a failed calendar subscribe toasts', () => {
    expect(read('app/(tabs)/picks.tsx')).toContain("Couldn't open your calendar. Try Download once.");
  });
});
