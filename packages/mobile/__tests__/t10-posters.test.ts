import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (f: string) => readFileSync(join(__dirname, '..', 'components', f), 'utf8');

describe('T10 share posters ignore OS font size', () => {
  for (const file of ['WrapPoster.tsx', 'CrewWrapPoster.tsx']) {
    it(`${file}: every <Text has allowFontScaling={false}`, () => {
      const src = read(file);
      const texts = (src.match(/<Text\b/g) ?? []).length;
      const fixed = (src.match(/allowFontScaling=\{false\}/g) ?? []).length;
      expect(texts).toBeGreaterThan(0);
      expect(fixed).toBe(texts);
    });
  }
});
