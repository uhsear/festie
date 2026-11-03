// Source-level guards for T50 packet t50-mobile-share-festival.
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

describe('T50 mobile festival share', () => {
  const src = read('components/FestivalList.tsx');

  it('builds the festival page link with the shared copy and guards on the slug', () => {
    expect(src).toContain('buildFestivalPageUrl(');
    expect(src).toContain('FESTIVAL_SHARE_COPY.a11y(');
    expect(src).toContain('FESTIVAL_SHARE_COPY.text(');
    expect(src).toContain('festival.slug');
  });

  it('uses the system share sheet and a wrapping action row', () => {
    expect(src).toMatch(/import \{[^}]*\bShare\b[^}]*\} from 'react-native'/);
    expect(src).toContain('icon="share-outline"');
    expect(src).toContain('flexWrap');
  });
});
