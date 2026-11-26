import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(resolve(process.cwd(), 'src/styles', name), 'utf8');
const theme = read('theme.css');
const animations = read('animations.css');

/** Body of `@keyframes <name>`, or '' when it does not exist. */
function keyframes(css: string, name: string): string {
  const start = css.indexOf(`@keyframes ${name}`);
  if (start < 0) return '';
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(open, i + 1);
  }
  return '';
}

describe('ambient loops stay on the compositor', () => {
  it.each(['skeleton-sweep', 'live-glow', 'timeline-now-pulse', 'crew-bar-fill'])(
    '%s animates only transform and opacity',
    (name) => {
      const body = keyframes(animations, name);
      expect(body).not.toBe('');
      const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      expect(props.filter((p) => p !== 'transform' && p !== 'opacity')).toEqual([]);
    },
  );

  it('deletes the repainting loops', () => {
    expect(animations).not.toContain('pulseGlow');
    expect(animations).not.toContain('skeleton-loading');
    expect(theme).not.toContain('rotateBorder');
    expect(theme).not.toContain('background-position');
  });

  it('names the live card border in the live token group, never aqua', () => {
    expect(theme).toMatch(/\.set-card\.live\s*\{[^}]*--color-live-fill/);
  });

  it('stops every ambient loop in low-power mode and pauses it in a hidden tab', () => {
    for (const attr of ['data-low-power', 'data-tab-hidden']) {
      // Pseudo-elements are dropped inside :is(), so each selector is written out.
      expect(theme).not.toContain(`:root[${attr}] :is(`);
      const rule = theme.slice(theme.indexOf(`:root[${attr}] .ambient-loop`));
      for (const sel of ['.ambient-loop', '.skeleton-shimmer::after', '.set-card.live::before', '.fm-live-dot::after']) {
        expect(rule).toContain(`:root[${attr}] ${sel}`);
      }
      expect(rule).not.toContain('sos');
    }
  });
});
