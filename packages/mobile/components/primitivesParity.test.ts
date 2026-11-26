import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pressScale } from '@festie/shared/tokens';

const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

describe('mobile primitives parity with web (source guards)', () => {
  it('Button takes its variant type from shared tokens', () => {
    expect(read('Button.tsx')).toMatch(/ButtonVariant[^;]*from '@festie\/shared\/tokens'/);
  });

  it('EmptyState uses the secondary text colour and a second action', () => {
    const src = read('EmptyState.tsx');
    expect(src).toContain('text.secondary');
    expect(src).not.toContain('accent.aqua');
    expect(src).toContain('secondaryAction');
  });

  it('DisplayWords swaps spaces for U+2005 on Android', () => {
    expect(read('DisplayWords.tsx')).toMatch(/\u2005|\u2005/);
  });

  it('notification prefs titles use SectionLabel', () => {
    expect(read('AccountNotificationPrefsSection.tsx')).toContain('<SectionLabel>Notification types</SectionLabel>');
  });

  it('PressableScale reads the shared press scale and springs to it', () => {
    const src = read('PressableScale.tsx');
    expect(src).toMatch(/pressScale[^;]*from '@festie\/shared\/tokens'/);
    expect(src).toContain('spring.touch');
    expect(src).not.toMatch(/0\.0?6|0\.94/);
    expect(pressScale).toBe(0.96);
  });

  it('the pick pop springs instead of timing', () => {
    expect(read('SetCardMobile.tsx')).toContain('withSequence(withSpring(1.12, spring.touch), withSpring(1, spring.touch))');
  });

  it('Button disabled is a token pair, never an opacity', () => {
    const src = read('Button.tsx');
    expect(src).toContain('t.colors.bg.disabled');
    expect(src).toContain('t.colors.text.disabled');
    expect(src).not.toMatch(/opacity:\s*0\.6/);
  });

  it('the no-crew view uses Button, not a hand-rolled outline button', () => {
    const src = read('crew/CrewNoCrewView.tsx');
    expect(src).toContain('<Button');
    expect(src).not.toContain('TouchableOpacity');
  });

  it('SheetShell animates itself on token durations and keeps a tap-to-close grabber', () => {
    const src = read('SheetShell.tsx');
    expect(src).toContain('animationType="none"');
    expect(src).toContain('durationEffects.med');
    expect(src).toContain('durationSpatial.med');
    expect(src).toContain('styles.grabberHit');
  });
});
