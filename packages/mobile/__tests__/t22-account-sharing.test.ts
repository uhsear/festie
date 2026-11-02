import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('t22 account sharing source guards', () => {
  const src = read('components/AccountPublicScheduleSection.tsx');

  it('offers Share, Open, status and reset', () => {
    expect(src).toContain('Share.share(');
    expect(src).toContain('Linking.openURL(');
    expect(src).toContain('fetchSharingStatus(');
    expect(src).toContain('resetShareLinks(');
    expect(src).toContain("'Reset my share links'");
  });

  it('keeps the URL selectable and confirms the reset as destructive', () => {
    expect(src).toContain('selectable');
    expect(src).toContain("style: 'destructive'");
  });

  it('drops the old hint', () => {
    expect(src).not.toContain('picks links you already shared keep working');
  });
});
