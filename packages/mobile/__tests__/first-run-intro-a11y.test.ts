// Source-level guards: the intro must stay readable with VoiceOver and TalkBack.
// iOS treats an element with role "adjustable" as one accessibility element, so
// the role must not sit on the ScrollView that holds the slide copy.
import { read } from './read-source';

// The working copy may carry CRLF endings.
const src = read('components/FirstRunIntro.tsx').replace(/\r\n/g, '\n');

/** The opening JSX tag that starts at the first match of `open`, up to its closing `>` at a line end. */
function openingTag(open: RegExp): string {
  const start = src.search(open);
  if (start === -1) return '';
  const end = src.indexOf('>\n', start);
  return src.slice(start, end);
}

const pagerTag = openingTag(/<ScrollView\s+ref=\{scrollRef\}/);
const pageTag = openingTag(/\{steps\.map\(\(step, i\) => \(\s*<ScrollView/);
const dotsTag = openingTag(/<View\s+style=\{styles\.dots\}/);

describe('FirstRunIntro screen-reader semantics', () => {
  it('locates the pager, page and step-indicator tags', () => {
    expect(pagerTag).not.toBe('');
    expect(pageTag).not.toBe('');
    expect(dotsTag).not.toBe('');
  });

  it('the paging ScrollView is not adjustable or an action target', () => {
    expect(pagerTag).not.toContain('accessibilityRole');
    expect(pagerTag).not.toContain('accessibilityValue');
    expect(pagerTag).not.toContain('accessibilityActions');
    expect(pagerTag).not.toContain('onAccessibilityAction');
  });

  it('the step indicator carries the adjustable role and actions', () => {
    expect(dotsTag).toMatch(/\n\s+accessible\n/);
    expect(dotsTag).toContain('accessibilityRole="adjustable"');
    expect(dotsTag).toContain('accessibilityValue');
    expect(dotsTag).toContain('accessibilityActions');
    expect(dotsTag).toContain('onAccessibilityAction');
  });

  it('the step indicator is at least 44 px tall so explore-by-touch can hit it', () => {
    const dotsStyle = src.slice(src.indexOf('  dots: {'), src.indexOf('  dot: {'));
    expect(dotsStyle).toContain('minHeight: 44');
  });

  it('hides every page except the current one from screen readers', () => {
    expect(pageTag).toContain('accessibilityElementsHidden={i !== index}');
    expect(pageTag).toContain("importantForAccessibility={i === index ? 'auto' : 'no-hide-descendants'}");
  });

  it('moves screen-reader focus to the new heading after a step change', () => {
    expect(src).toContain('focusTitleOnStepChange.current = true');
    expect(src).toContain('AccessibilityInfo.setAccessibilityFocus(node)');
    // Every page type registers its heading.
    expect(src).toMatch(/ref=\{titleRef\(slideKey\)\}/);
    expect(src).toMatch(/ref=\{titleRef\('festival'\)\}/);
    expect(src).toMatch(/ref=\{titleRef\('going'\)\}/);
  });

  it('turns off the programmatic scroll animation under Reduce Motion', () => {
    expect(src).toContain('animated: !reduceMotion');
  });

  it('keeps the slide title as a header and the existing testIDs and radiogroup', () => {
    expect(src).toContain('accessibilityRole="header"');
    expect(src).toContain('testID="intro-skip"');
    expect(src).toContain('accessibilityRole="radiogroup"');
    expect(src).toContain('accessibilityRole="radio"');
  });
});
