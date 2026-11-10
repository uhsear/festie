import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) =>
  readFileSync(resolve(process.cwd(), 'src/styles', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const DAYLIGHT = ":root[data-theme='daylight']";

/** Declarations of every innermost rule whose selector satisfies `match`, merged. */
function declarations(css: string, match: (selector: string) => boolean): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!match(selector.trim())) continue;
    for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(name, value.trim());
  }
  return out;
}

const themeCss = read('theme.css');
const night = declarations(themeCss, (s) => s === '@theme' || s === ':root');
const daylight = declarations(themeCss, (s) => s === DAYLIGHT);
const generatedDaylight = declarations(read('theme.generated.css'), (s) => s === DAYLIGHT);

const COLOUR_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(|var\(--color-/i;
// An rgb channel triplet ("29, 185, 84") has no colour literal but still paints.
const isColour = (name: string, value: string) => COLOUR_LITERAL.test(value) || name.endsWith('-rgb');

// A pure alias, var(--x), follows daylight for free once --x itself has a daylight value.
function followsDaylight(value: string): boolean {
  const target = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
  return !!target && (daylight.has(target) || generatedDaylight.has(target));
}

// Theme-invariant colours. Each needs a reason.
const EXEMPT: Record<string, string> = {
  '--spotify-brand-rgb': 'Spotify brand green is fixed by the brand guidelines on both themes',
};

describe('daylight overrides for hand-authored colour tokens', () => {
  const colours = [...night].filter(([name, value]) => isColour(name, value));

  it('finds the colour tokens it is meant to guard', () => {
    expect(colours.length).toBeGreaterThan(10);
    expect(daylight.size).toBeGreaterThan(10);
  });

  it('overrides every colour token in the daylight block, or exempts it with a reason', () => {
    const gaps = colours
      .filter(([name, value]) => !daylight.has(name) && !followsDaylight(value) && !(name in EXEMPT))
      .map(([name]) => name);
    expect(gaps).toEqual([]);
  });

  it('keeps the exemption list honest', () => {
    for (const name of Object.keys(EXEMPT)) {
      expect(night.has(name), `${name} is exempt but no longer defined`).toBe(true);
      expect(daylight.has(name), `${name} is exempt but now overridden`).toBe(false);
    }
  });

  it('does not override a token the night theme never defines', () => {
    const orphans = [...daylight.keys()].filter((name) => !night.has(name));
    expect(orphans).toEqual([]);
  });
});
