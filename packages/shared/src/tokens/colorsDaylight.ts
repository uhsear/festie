/**
 * Daylight palette — the high-contrast theme for direct sun (DESIGN.md, "The
 * Daylight Rule"). Same shape and roles as `colors`: every token keeps its job,
 * only the value changes. House lights up: light surfaces, near-black text, and
 * darkened signal colours so each still reads as itself.
 *
 * Text and signal colours reach at least 7:1 on `bg.primary` and `bg.card`
 * (contrast.test.ts asserts this), because glare washes out anything less.
 * The Wrap poster keeps its own dark artwork in both themes.
 */
import type { Colors } from './colors';

const AQUA = '0, 89, 79';
const CORAL = '168, 0, 42';
const AMBER = '107, 65, 0';

export const colorsDaylight = {
  bg: {
    primary: '#f4f4f7',
    secondary: '#e8e8ee',
    card: '#ffffff',
    cardHover: '#f0f0f5',
    input: '#ffffff',
    hover: '#ececf2',
    elevated: '#ffffff',
    sticky: '#ececf1',
  },
  text: {
    primary: '#0b0b12',
    secondary: '#2e2e44',
    muted: '#45455c',
    onAccent: '#ffffff',
    // Every Daylight accent fill is dark, so ink on a fill is white (web: --text-on-light-accent).
    onLightAccent: '#ffffff',
    onDark: '#000000',
    onPoster: '#ffffff',
    danger: '#a3001f',
    disabled: '#5f5f74',
    placeholder: '#5a5a70',
  },
  accent: {
    coral: '#a8002a',
    coralStrong: '#a3001f',
    aqua: '#00594f',
    amber: '#6b4100',
    green: '#175800',
  },
  border: {
    default: 'rgba(0, 0, 0, 0.12)',
    light: 'rgba(0, 0, 0, 0.3)',
  },
  priority: {
    must: '#a8002a',
    want: '#00594f',
    maybe: '#6b4100',
  },
  glass: {
    bg: 'rgba(255, 255, 255, 0.92)',
    border: 'rgba(0, 0, 0, 0.12)',
  },
  stage: {
    purpleAccessible: '#6a2c99',
    fallback: '#45455c',
  },
  ring: {
    coral: `rgba(${CORAL}, 0.2)`,
    aqua: `rgba(${AQUA}, 0.2)`,
  },
  dayTab: {
    active: '#00594f',
  },
  status: {
    verified: '#0e5c25',
    unverified: '#6b4100',
    verifiedBg: 'rgba(14, 92, 37, 0.12)',
    unverifiedBg: `rgba(${AMBER}, 0.12)`,
    warning: '#6b4100',
    error: '#a3001f',
  },
  /**
   * Clash = two of the user's picks overlap. Alias of status.warning (amber means warning; coral is danger only).
   * Never colour alone: pair with the warning icon, the hatching or the word Clash.
   */
  clash: {
    mark: '#6b4100',
    tint: 'rgba(107, 65, 0, 0.12)',
  },
  confidence: {
    live: '#175800',
    aging: '#6b4100',
    stale: '#45455c',
    dark: '#2e2e44',
  },
  delivery: {
    local: '#45455c',
    sent: '#0e5c25',
    failed: '#6b4100',
  },
  spotify: {
    brand: '#1DB954',
  },
  cookieBanner: {
    textLight: '#1f2937',
  },
  wrapPoster: {
    bg1: '#0a0a1a',
    bg2: '#1a0a2e',
    bg3: '#0a1a2e',
  },
  // On a light ground a coloured glow vanishes; state is a crisp 2px ring.
  glow: {
    coral: `0 0 0 2px rgba(${CORAL}, 0.45)`,
    aqua: `0 0 0 2px rgba(${AQUA}, 0.45)`,
    amber: `0 0 0 2px rgba(${AMBER}, 0.45)`,
    green: '0 0 0 2px rgba(23, 88, 0, 0.45)',
  },
  // Dark-theme overlays lighten with white; daylight overlays darken with black.
  overlay: {
    1: 'rgba(0, 0, 0, 0.03)',
    2: 'rgba(0, 0, 0, 0.04)',
    3: 'rgba(0, 0, 0, 0.06)',
    4: 'rgba(0, 0, 0, 0.08)',
    5: 'rgba(0, 0, 0, 0.1)',
    hi: 'rgba(255, 255, 255, 0.95)',
  },
  shade: {
    1: 'rgba(0, 0, 0, 0.04)',
    2: 'rgba(0, 0, 0, 0.06)',
    3: 'rgba(0, 0, 0, 0.08)',
    4: 'rgba(0, 0, 0, 0.1)',
    5: 'rgba(0, 0, 0, 0.12)',
    6: 'rgba(0, 0, 0, 0.15)',
    7: 'rgba(0, 0, 0, 0.2)',
    8: 'rgba(0, 0, 0, 0.4)',
    9: 'rgba(0, 0, 0, 0.45)',
    10: 'rgba(0, 0, 0, 0.75)',
  },
  aquaAlpha: {
    6: `rgba(${AQUA}, 0.06)`,
    8: `rgba(${AQUA}, 0.08)`,
    10: `rgba(${AQUA}, 0.1)`,
    12: `rgba(${AQUA}, 0.12)`,
    15: `rgba(${AQUA}, 0.15)`,
    20: `rgba(${AQUA}, 0.2)`,
    30: `rgba(${AQUA}, 0.3)`,
    40: `rgba(${AQUA}, 0.4)`,
    70: `rgba(${AQUA}, 0.7)`,
  },
  amberAlpha: {
    8: `rgba(${AMBER}, 0.08)`,
    12: `rgba(${AMBER}, 0.12)`,
    20: `rgba(${AMBER}, 0.2)`,
    30: `rgba(${AMBER}, 0.3)`,
  },
  rgb: {
    coral: CORAL,
    spotify: '29, 185, 84',
  },
} as const satisfies { [K in keyof Colors]: { [P in keyof Colors[K]]: string } };
