import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('DP-57 polish', () => {
  it('crew switcher shows initials, not the tent emoji, when totem_emoji is null', () => {
    const src = read('components/CrewSwitcherSheet.tsx');
    expect(src).not.toContain('🎪');
    expect(src).toMatch(/c\.totem_emoji \? <Text[^>]*>\{c\.totem_emoji\}<\/Text> : <Avatar name=\{c\.name\}/);
  });

  it('the no-crew join button reads "Join with code"', () => {
    expect(read('components/crew/CrewNoCrewView.tsx')).toContain('label="Join with code"');
  });

  it('a leading icon takes 2px less padding on the icon side than the text side', () => {
    const src = read('components/Button.tsx');
    expect(src).toContain('paddingLeft: t.spacing[4] - 2');
    expect(src).toContain('paddingLeft: t.spacing[3] - 2');
    expect(src).toMatch(/icon && !loading && \(size === 'sm' \? styles\.iconPadSm : styles\.iconPad\)/);
  });

  it('no mobile admin control is under 44 px unless it has hitSlop', () => {
    const files: string[] = [];
    const walk = (rel: string) => {
      for (const e of readdirSync(join(__dirname, '..', rel), { withFileTypes: true })) {
        const next = `${rel}/${e.name}`;
        if (e.isDirectory()) walk(next);
        else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) files.push(next);
      }
    };
    walk('app/admin');
    walk('components/admin');
    // Touch-target floors and button boxes of 36 to 43 px. swatchPreview is a static chip, not a control.
    const small = /(?:minHeight|minWidth|width|height): (?:3[6-9]|4[0-3]),/;
    const offenders = files.flatMap((f) =>
      read(f)
        .split(/\r?\n/)
        .map((line, i, lines) => ({ f, line, ctx: lines.slice(Math.max(0, i - 2), i + 1).join(' '), n: i + 1 }))
        .filter(({ line, ctx }) => small.test(line) && !/swatchPreview/.test(ctx))
        .map(({ f: file, n }) => `${file}:${n}`),
    );
    expect(offenders).toEqual([]);
  });
});
