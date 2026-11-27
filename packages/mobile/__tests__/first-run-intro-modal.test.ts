// The intro used to be an absolute View over the app. The overlay was missing from the Android
// accessibility tree, so it must be its own window (a Modal) and modal for VoiceOver too.
import { describe, it, expect } from 'vitest';
import { read } from './read-source';

const src = read('components/FirstRunIntro.tsx').replace(/\r\n/g, '\n');

describe('FirstRunIntro is modal for screen readers', () => {
  it('renders inside a Modal that Android back dismisses like Skip', () => {
    expect(src).toMatch(/<Modal\s+visible\s+animationType="none"\s+statusBarTranslucent\s+navigationBarTranslucent\s+onRequestClose=\{handleSkip\}/);
    expect(src).toContain('</Modal>');
  });

  it('marks its root as a modal view for VoiceOver', () => {
    expect(src).toMatch(/styles\.overlay[^>]*\n\s+accessibilityViewIsModal/);
  });

  it('no longer floats as an absolute overlay', () => {
    const overlay = src.slice(src.indexOf('  overlay: {'), src.indexOf('  skipRow: {'));
    expect(overlay).not.toContain('absolute');
    expect(overlay).not.toContain('zIndex');
  });
});
