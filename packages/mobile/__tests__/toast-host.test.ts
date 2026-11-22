import { describe, it, expect } from 'vitest';
import { read } from './read-source';


// The toast host is components/Toaster.tsx. A second host would render every toast twice.
describe('t3 toast host source guards', () => {
  it('root layout mounts the Toaster once, after loading', () => {
    const src = read('app/_layout.tsx');
    expect(src.match(/<Toaster\s*\/>/g)).toHaveLength(1);
    expect(src).toContain('{!loading && <Toaster />}');
  });

  it('Toaster reads the shared toasts and dismisses them', () => {
    const src = read('components/Toaster.tsx');
    expect(src).toContain('s.toasts');
    expect(src).toContain('dismissToast');
  });

  it('Toaster uses amber for errors, dismisses on tap and offsets with useListBottomInset', () => {
    const src = read('components/Toaster.tsx');
    expect(src).toContain('error: t.colors.accent.amber');
    expect(src).not.toContain('coralStrong');
    expect(src).toContain('onPress={() => dismissToast(toast.id)}');
    expect(src).toContain('useListBottomInset(');
  });

  // An empty FullWindowOverlay is a full-screen native window that iOS 18 accessibility (VoiceOver, XCUITest/Maestro) treats as the whole screen, so the app tree below it goes empty.
  it('Toaster mounts the iOS overlay only while a toast is visible', () => {
    const src = read('components/Toaster.tsx');
    expect(src).toMatch(/Platform\.OS === 'ios' && visible\.length > 0 \? <FullWindowOverlay>/);
  });
});
