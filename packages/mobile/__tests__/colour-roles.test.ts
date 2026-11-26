import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(join(__dirname, '..', file), 'utf8');

describe('colour roles (DP-29)', () => {
  it('clash surfaces read the clash tokens, never coral', () => {
    for (const file of ['components/ClashCards.tsx', 'components/ClashPrompt.tsx']) {
      const src = read(file);
      expect(src, file).toContain('colors.clash.mark');
      expect(src, file).not.toContain('accent.coral');
      expect(src, file).not.toContain('ring.coral');
    }
  });

  it('the failed-sync banner is amber delivery.failed and its error text is text.danger', () => {
    const src = read('components/OfflineBanner.tsx');
    expect(src).toContain('backgroundColor: t.colors.delivery.failed');
    expect(src).not.toContain('accent.coral');
  });

  it('the set sheet shows a neighbour pick with the shared priority colour, glyph and short label', () => {
    const src = read('components/SetContextSection.tsx');
    expect(src).toContain('priorityColor(t, pick)');
    expect(src).toContain('priorityIconName(pick)');
    expect(src).toContain('PRIORITY_SYMBOLS[pick].short');
    expect(src).not.toContain('accent.aqua');
  });

  it('live sites read the live group, not coral', () => {
    for (const file of ['components/LiveBadge.tsx', 'components/LiveDot.tsx', 'components/NowNextStrip.tsx']) {
      expect(read(file), file).not.toContain('accent.coral');
    }
    expect(read('components/LiveBadge.tsx')).toContain('colors.live.fill');
  });

  it('the posters read the shared priority map', () => {
    const src = read('components/ScheduleImagePoster.tsx');
    expect(src).toContain('POSTER_TOKENS');
    expect(src).not.toMatch(/ffaa00|9999bb/i);
  });

  it('floating controls spread the elevation tokens instead of copying shadow props', () => {
    for (const file of [
      'components/SosControl.tsx',
      'components/MapPlaceCard.tsx',
      'components/OfflineMap.tsx',
      'components/picks/styles.ts',
      'components/schedule/styles.ts',
    ]) {
      const src = read(file);
      expect(src, file).toMatch(/\.\.\.elevation\.(low|high)/);
      expect(src, file).not.toContain("shadowColor: '#000'");
    }
  });
});
