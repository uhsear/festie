import { colors, colorsDaylight } from '@festie/shared/tokens';
import { contrastRatio } from './inkOnFill';
import { ensureStageTextContrast } from './stageTextContrast';

// Live stage colors from the three prod festivals, plus black and white extremes.
const STAGE_COLORS = [
  '#ff3366',
  '#00e8d0',
  '#7c5cff',
  '#ffb020',
  '#ff6b35',
  '#4ade80',
  '#6D28D9',
  '#c8102e',
  '#1e7e5c',
  '#6a1b9a',
  '#00acc1',
  '#000000',
  '#ffffff',
];

describe('ensureStageTextContrast', () => {
  it.each([
    // The call site passes bg.primary (Stage's bg.elevated is rgba, which
    // parseHex rejects). The Daylight sheet itself is bg.elevated (#ffffff).
    ['stage', colors.bg.primary, colors.bg.primary],
    ['daylight', colorsDaylight.bg.primary, colorsDaylight.bg.elevated],
  ])('every stage color reaches 4.5:1 on the %s sheet', (_name, ground, sheet) => {
    for (const stage of STAGE_COLORS) {
      const text = ensureStageTextContrast(stage, ground);
      expect(contrastRatio(text, ground)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(text, sheet)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('leaves an already-readable color unchanged', () => {
    expect(ensureStageTextContrast('#00e8d0', colors.bg.primary)).toBe('#00e8d0');
  });

  it('returns unparseable input as-is', () => {
    expect(ensureStageTextContrast('not-a-color', colors.bg.primary)).toBe('not-a-color');
  });
});
