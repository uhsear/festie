// Source-level guards (mobile vitest runs in plain node, no RN renderer).
import { read } from './read-source';

describe('AnnouncementBanner body clamp', () => {
  const src = read('components/AnnouncementBanner.tsx');

  it('clamps the body to two lines until expanded', () => {
    expect(src).toContain('const BODY_LINES = 2;');
    expect(src).toContain('numberOfLines={expanded ? undefined : BODY_LINES}');
  });

  it('measures the line count on a hidden unclamped copy, with no character guess', () => {
    expect(src).not.toContain('LONG_BODY_CHARS');
    const measure = src.slice(src.indexOf('style={[s.text, s.measure]}'), src.indexOf('{canExpand ? ('));
    expect(measure).toContain('onTextLayout');
    expect(measure).not.toContain('numberOfLines');
    expect(measure).toContain('accessibilityElementsHidden');
    expect(src).toContain('canExpand = measuredLines > BODY_LINES;');
  });

  it('Read more is a labelled button with expanded state, outside the grouped text so it stays focusable', () => {
    const grouped = src.slice(src.indexOf('accessibilityRole="summary"'), src.indexOf('{canExpand ? ('));
    expect(grouped).not.toContain('readMore');
    expect(src).toContain('ANNOUNCEMENT_COPY.banner.readMore');
    expect(src).toContain('accessibilityState={{ expanded }}');
  });

  it('never clamps or hides the SOS banner', () => {
    expect(read('components/SosBanner.tsx')).not.toContain('numberOfLines');
  });
});
