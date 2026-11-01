import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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
});
