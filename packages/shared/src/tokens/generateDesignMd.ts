/**
 * generateDesignMd — rebuilds the token sections of a DESIGN.md frontmatter.
 *
 * The TS tokens are the source of truth. `colors`, `typography`, `rounded` and
 * `spacing` in packages/{web,mobile}/DESIGN.md are generated from them; the
 * other keys (`name`, `description`, `components`) stay hand-authored and pass
 * through untouched. DESIGN.md is gitignored, so generateDesignMd.test.ts only
 * checks the on-disk files when they exist.
 *
 * Run: pnpm --filter @festie/shared gen:design
 *
 * Pure: no Node dependencies.
 */

import { colors } from './colors.js';
import { radii } from './radii.js';
import { spacing } from './spacing.js';
import { fontFamily, typeRoles } from './typography.js';

export type DesignPlatform = 'web' | 'mobile';

/** DESIGN.md colour name -> token. The names are referenced from the prose and from `components`. */
const colorNames = {
  'stage-black': colors.bg.primary,
  'booth-grey': colors.bg.secondary,
  'sticky-band': colors.bg.sticky,
  'card-smoke': colors.bg.card,
  'card-smoke-hover': colors.bg.cardHover,
  'elevated-smoke': colors.bg.elevated,
  hairline: colors.border.default,
  'hairline-strong': colors.border.light,
  'house-light': colors.text.primary,
  'dusk-lavender': colors.text.secondary,
  'fog-lavender': colors.text.muted,
  'spotlight-aqua': colors.accent.aqua,
  'flare-coral': colors.accent.coral,
  'flare-coral-strong': colors.accent.coralStrong,
  'marquee-amber': colors.accent.amber,
  'live-green': colors.live.fill,
  'alert-red': colors.text.danger,
  'disabled-lavender': colors.text.disabled,
  'placeholder-lavender': colors.text.placeholder,
  'field-outline': colors.border.input,
  'switch-track-off': colors.control.trackOff,
  'verified-green': colors.status.verified,
  'unverified-yellow': colors.status.unverified,
  'warning-orange': colors.status.warning,
  'clash-mark': colors.clash.mark,
  'clash-tint': colors.clash.tint,
  'stage-purple': colors.stage.purpleAccessible,
} as const;

/** Web uses the CSS stacks. React Native registers each family under one bundled name. */
function familyFor(platform: DesignPlatform, family: string): string {
  if (platform === 'web') return family === fontFamily.display ? fontFamily.displayWeb : family;
  return family === fontFamily.display ? 'ClashDisplay' : 'SpaceGrotesk';
}

function typographySection(platform: DesignPlatform): string[] {
  const lines = ['typography:'];
  for (const [name, role] of Object.entries(typeRoles)) {
    lines.push(
      `  ${name}:`,
      `    fontFamily: ${JSON.stringify(familyFor(platform, role.family))}`,
      `    fontSize: "${role.size}px"`,
      `    fontWeight: ${role.weight}`,
      `    lineHeight: ${role.lineHeight}`,
    );
    if (role.letterSpacing !== 0) lines.push(`    letterSpacing: "${role.letterSpacing}em"`);
    if ('numeric' in role) lines.push(`    fontFeature: "\\"tnum\\""`);
  }
  return lines;
}

function section(key: string, entries: ReadonlyArray<readonly [string, string | number]>): string[] {
  return [`${key}:`, ...entries.map(([k, v]) => `  ${/^\d/.test(k) ? `"${k}"` : k}: "${v}"`)];
}

/** The four generated frontmatter sections, keyed by top-level YAML key. */
export function designSections(platform: DesignPlatform): { colors: string[]; typography: string[]; rounded: string[]; spacing: string[] } {
  return {
    colors: section('colors', Object.entries(colorNames)),
    typography: typographySection(platform),
    rounded: section('rounded', Object.entries(radii).map(([k, v]) => [k, `${v}px`] as const)),
    spacing: section('spacing', Object.entries(spacing).map(([k, v]) => [k, `${v}px`] as const)),
  };
}

/**
 * Replace the generated sections inside a DESIGN.md frontmatter. Throws when the
 * file has no frontmatter or lacks one of the four sections, so a rename cannot
 * silently skip the guard.
 */
export function applyDesignFrontmatter(doc: string, platform: DesignPlatform): string {
  const eol = doc.includes('\r\n') ? '\r\n' : '\n';
  const lines = doc.split(/\r?\n/);
  if (lines[0] !== '---') throw new Error('DESIGN.md has no frontmatter: it must start with a "---" line.');
  const end = lines.indexOf('---', 1);
  if (end < 0) throw new Error('DESIGN.md frontmatter has no closing "---" line.');

  const sections = designSections(platform);
  const seen = new Set<string>();
  const out: string[] = ['---'];
  let skipping = false;
  for (const line of lines.slice(1, end)) {
    const key = /^([A-Za-z][\w-]*):/.exec(line)?.[1];
    if (key) {
      const generated = (sections as Record<string, string[] | undefined>)[key];
      skipping = generated !== undefined;
      if (generated) {
        seen.add(key);
        out.push(...generated);
      }
    }
    if (!skipping) out.push(line);
  }
  const missing = Object.keys(sections).filter((k) => !seen.has(k));
  if (missing.length > 0) throw new Error(`DESIGN.md frontmatter lacks the section(s): ${missing.join(', ')}.`);
  return [...out, ...lines.slice(end)].join(eol);
}
