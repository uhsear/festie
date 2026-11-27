// After a failed sign-in the keyboard closes and the form kept the offset the keyboard scrolled it to,
// leaving the logo half under the status bar. The screen must scroll back to the top when the keyboard hides.
import { describe, it, expect } from 'vitest';
import { read } from './read-source';

const src = read('app/(auth)/login.tsx').replace(/\r\n/g, '\n');

describe('Sign-in keyboard scroll reset', () => {
  it('scrolls the form to the top on keyboardDidHide and removes the listener on unmount', () => {
    expect(src).toMatch(/Keyboard\.addListener\('keyboardDidHide',[\s\S]*?scrollTo\(\{ y: 0, animated: !reduceMotion \}\)/);
    expect(src).toContain('return () => sub.remove();');
  });

  it('attaches the ref to the form ScrollView', () => {
    expect(src).toMatch(/<ScrollView\s+ref=\{scrollRef\}/);
  });
});
