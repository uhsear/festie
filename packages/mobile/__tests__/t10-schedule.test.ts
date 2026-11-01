// Source-level guards for T10 packet B (large text on the schedule screens).
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

describe('T10 schedule large-text guards', () => {
  it('TimelineView caps the hint and widens the gutter at large text', () => {
    const src = read('components/TimelineView.tsx');
    expect(src).toMatch(/<Text style=\{styles\.hintText\} maxFontSizeMultiplier=/);
    expect(src).toContain('GUTTER_W_LARGE');
    expect(src).toContain('useLargeText()');
  });

  it('SegmentedControl caps the label scale instead of shrinking it', () => {
    const src = read('components/SegmentedControl.tsx');
    expect(src).toContain('SEGMENT_FONT_SCALE = 1.2');
    expect(src).not.toContain('adjustsFontSizeToFit');
  });

  it('FestivalList caps the name and allows two location lines', () => {
    const src = read('components/FestivalList.tsx');
    expect(src).toContain("typeScaleCap('title')");
    expect(src).toMatch(/styles\.metaText\} numberOfLines=\{2\}/);
  });

  it('set sheet shrinks the photo, hides it at large text, and caps the name', () => {
    const src = read('app/set/[setId].tsx');
    expect(src).toContain('height: 120');
    expect(src).toContain("typeScaleCap('display-lg')");
    expect(src).toMatch(/artistPhoto && !largeText/);
  });

  it('SetCardMobile caps the artist title', () => {
    expect(read('components/SetCardMobile.tsx')).toContain("typeScaleCap('title')");
  });
});
