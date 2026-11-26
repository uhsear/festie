import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { applyDesignFrontmatter, designSections, type DesignPlatform } from './generateDesignMd';
import { colors } from './colors';
import { radii } from './radii';

const sample = ['---', 'name: Festie', 'colors:', '  old: "#000000"', 'typography:', '  old:', '    fontSize: "1px"',
  'rounded:', '  old: "1px"', 'spacing:', '  "1": "1px"', 'components:', '  card:', '    rounded: "{rounded.default}"', '---', '', '# Body'].join('\n');

describe('applyDesignFrontmatter', () => {
  it('rewrites the four token sections from the tokens and keeps the rest', () => {
    const out = applyDesignFrontmatter(sample, 'web');
    expect(out).toContain(`  stage-black: "${colors.bg.primary}"`);
    expect(out).toContain(`  pill: "${radii.pill}px"`);
    expect(out).toContain('name: Festie');
    expect(out).toContain('components:\n  card:\n    rounded: "{rounded.default}"');
    expect(out.endsWith('---\n\n# Body')).toBe(true);
    expect(out).not.toContain('  old:');
  });

  it('is idempotent', () => {
    const once = applyDesignFrontmatter(sample, 'mobile');
    expect(applyDesignFrontmatter(once, 'mobile')).toBe(once);
  });

  it('detects a hand-edited token value', () => {
    const generated = applyDesignFrontmatter(sample, 'web');
    const edited = generated.replace(`"${colors.accent.aqua}"`, '"#00e8d1"');
    expect(edited).not.toBe(generated);
    expect(applyDesignFrontmatter(edited, 'web')).toBe(generated);
  });

  it('throws when a generated section is missing', () => {
    expect(() => applyDesignFrontmatter(sample.replace('spacing:', 'gap:'), 'web')).toThrow(/spacing/);
    expect(() => applyDesignFrontmatter('# no frontmatter', 'web')).toThrow(/frontmatter/);
  });

  it('uses CSS font stacks on web and bundled names on mobile', () => {
    expect(designSections('web').typography.join('\n')).toContain("'Clash Display', 'Clash Display Fallback'");
    expect(designSections('mobile').typography.join('\n')).toContain('"ClashDisplay"');
  });
});

// DESIGN.md is gitignored (internal design doc), so the on-disk check runs only where the file exists.
describe.each(['web', 'mobile'] as DesignPlatform[])('committed %s DESIGN.md frontmatter matches the tokens', (platform) => {
  const path = resolve(__dirname, `../../../${platform}/DESIGN.md`);
  it.skipIf(!existsSync(path))('is in sync (run `pnpm --filter @festie/shared gen:design` to fix)', () => {
    const onDisk = readFileSync(path, 'utf8');
    expect(onDisk).toBe(applyDesignFrontmatter(onDisk, platform));
  });
});
