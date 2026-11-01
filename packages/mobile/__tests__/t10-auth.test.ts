// Source-level guards for T10 packet F (intro and auth screens at large text).
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

describe('T10 large text: intro and auth (source-level guards)', () => {
  it.each(['login', 'register', 'forgot-password'])('%s caps the wordmark and subtitle', (name) => {
    const src = read(`app/(auth)/${name}.tsx`);
    expect(src).toContain("typeScaleCap('display-lg')");
    expect(src).toContain('maxFontSizeMultiplier={MAX_FONT_SCALE}');
  });

  it('BrandMark hides at large text', () => {
    const src = read('components/BrandMark.tsx');
    expect(src).toContain('useLargeText()');
    expect(src).toContain('return null');
  });

  it('FirstRunIntro drops the hero at large text and caps Skip', () => {
    const src = read('components/FirstRunIntro.tsx');
    expect(src).toContain('useLargeText()');
    expect(src).toContain('{!largeText && (');
    expect(src).toContain('<Text style={styles.skip} maxFontSizeMultiplier={MAX_FONT_SCALE}>');
  });
});
