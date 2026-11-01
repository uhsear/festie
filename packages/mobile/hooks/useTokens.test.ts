import { beforeEach, describe, expect, it, vi } from 'vitest';
import { colors, colorsDaylight } from '@festie/shared/tokens';

// The mobile harness is node-only (no RN transform), so stub the three
// framework seams useTokens touches: the theme store, react's useMemo (called
// outside a render here) and StyleSheet.create (identity, so sheets compare by
// the object makeStyles caches).
const storeState = { theme: 'stage' as 'stage' | 'daylight' };
vi.mock('@festie/shared/stores', () => ({
  useUIStore: (select: (s: typeof storeState) => unknown) => select(storeState),
}));
vi.mock('react', () => ({ useMemo: (fn: () => unknown) => fn() }));
vi.mock('react-native', () => ({ StyleSheet: { create: <T>(s: T) => s } }));

const { makeStyles, tokensForTheme, typeStyle, useTokens } = await import('./useTokens');

beforeEach(() => {
  storeState.theme = 'stage';
});

describe('useTokens — theme-aware tokens', () => {
  it('returns the stage palette by default and the daylight palette when toggled', () => {
    expect(useTokens().colors).toBe(colors);
    storeState.theme = 'daylight';
    expect(useTokens().colors).toBe(colorsDaylight);
    expect(useTokens().colors.bg.primary).not.toBe(colors.bg.primary);
  });

  it('hands out the same object on every call for a given theme', () => {
    expect(useTokens()).toBe(useTokens());
    storeState.theme = 'daylight';
    expect(useTokens()).toBe(tokensForTheme('daylight'));
    expect(useTokens()).toBe(useTokens());
  });

  it('keeps every non-colour token identical across themes', () => {
    const { colors: _s, ...stage } = tokensForTheme('stage');
    const { colors: _d, ...daylight } = tokensForTheme('daylight');
    expect(daylight).toEqual(stage);
  });
});

describe('makeStyles — one cached sheet per theme', () => {
  const useStyles = makeStyles((t) => ({ box: { backgroundColor: t.colors.bg.primary } }));

  it('flips colours with the theme and reuses each theme’s sheet', () => {
    const stage = useStyles();
    expect(stage.box.backgroundColor).toBe(colors.bg.primary);
    expect(useStyles()).toBe(stage);

    storeState.theme = 'daylight';
    const daylight = useStyles();
    expect(daylight).not.toBe(stage);
    expect(daylight.box.backgroundColor).toBe(colorsDaylight.bg.primary);
    expect(useStyles()).toBe(daylight);

    storeState.theme = 'stage';
    expect(useStyles()).toBe(stage);
  });
});

describe('typeStyle — Clash Display on native', () => {
  it('maps display roles to the registered ClashDisplay family and never applies negative tracking', () => {
    for (const role of ['display-xl', 'display-lg', 'heading'] as const) {
      const style = typeStyle(role);
      expect(style.fontFamily).toBe('ClashDisplay-Bold');
      expect(style.letterSpacing).toBeGreaterThanOrEqual(0);
    }
    expect(typeStyle('heading', 500).fontFamily).toBe('ClashDisplay-Medium');
  });
});

describe('typeStyle — label face', () => {
  it('keeps the system face for labels by default', () => {
    expect(typeStyle('label').fontFamily).toBeUndefined();
  });

  it('uses Space Grotesk for labels when brandFace is set', () => {
    const style = typeStyle('label', 600, { brandFace: true });
    expect(style.fontFamily).toBe('SpaceGrotesk_600SemiBold');
    expect(style.fontWeight).toBeUndefined();
  });
});
