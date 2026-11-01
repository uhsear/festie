// Source-level guards for the T19 mobile set sheet (no RN renderer in mobile vitest).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(join(__dirname, '..', 'app/set/[setId].tsx'), 'utf8');

describe('T19 mobile set sheet', () => {
  it('uses the shared preview hook, when line and reminder summary', () => {
    expect(src).toContain('useSpotifyPreview(');
    expect(src).toContain('formatSetWhen(');
    expect(src).toContain('reminderNoteSummary(');
  });
  it('explains offline and opens the player from a card Listen', () => {
    expect(src).toContain('Listening needs signal.');
    expect(src).toContain("listen === '1'");
  });
  it('drops the hero photo and the local preview fetch', () => {
    expect(src).not.toContain('artistPhotoContainer');
    expect(src).not.toContain('/spotify/preview/');
  });
});
