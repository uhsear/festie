// Source-level guards: the intro must stay readable with VoiceOver and TalkBack.
// iOS treats an element with role "adjustable" as one accessibility element, so
// the role must not sit on the ScrollView that holds the slide copy.
import { read } from './read-source';

// The working copy may carry CRLF endings; the markers below use LF.
const src = read('components/FirstRunIntro.tsx').replace(/\r\n/g, '\n');
const pagerStart = src.indexOf('<ScrollView\n        ref={scrollRef}');
const pagerTag = src.slice(pagerStart, src.indexOf('>\n', pagerStart));
const stepsStart = src.indexOf('{steps.map((step, i) => (\n          <ScrollView');
const pageTag = src.slice(stepsStart, src.indexOf('>\n', stepsStart + 40));
const dotsStart = src.indexOf('<View\n          style={styles.dots}');
const dotsTag = src.slice(dotsStart, src.indexOf('>\n', dotsStart));

describe('FirstRunIntro screen-reader semantics', () => {
  it('locates the pager, page and step-indicator tags', () => {
    expect(pagerStart).toBeGreaterThan(-1);
    expect(stepsStart).toBeGreaterThan(-1);
    expect(dotsStart).toBeGreaterThan(-1);
  });

  it('the paging ScrollView is not adjustable or an action target', () => {
    expect(pagerTag).not.toContain('accessibilityRole');
    expect(pagerTag).not.toContain('accessibilityValue');
    expect(pagerTag).not.toContain('accessibilityActions');
    expect(pagerTag).not.toContain('onAccessibilityAction');
  });

  it('the step indicator carries the adjustable role and actions', () => {
    expect(dotsTag).toContain('accessible');
    expect(dotsTag).toContain('accessibilityRole="adjustable"');
    expect(dotsTag).toContain('accessibilityValue');
    expect(dotsTag).toContain('accessibilityActions');
    expect(dotsTag).toContain('onAccessibilityAction');
  });

  it('hides every page except the current one from screen readers', () => {
    expect(pageTag).toContain('accessibilityElementsHidden={i !== index}');
    expect(pageTag).toContain("importantForAccessibility={i === index ? 'auto' : 'no-hide-descendants'}");
  });

  it('keeps the slide title as a header and the existing testIDs and radiogroup', () => {
    expect(src).toContain('accessibilityRole="header"');
    expect(src).toContain('testID="intro-skip"');
    expect(src).toContain('accessibilityRole="radiogroup"');
    expect(src).toContain('accessibilityRole="radio"');
  });
});
