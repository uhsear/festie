import { describe, it, expect, vi } from 'vitest';
import { noticeSignedOut, onSignedOutNotice } from './sessionLost';
import { COPY } from '../constants/copy';

describe('noticeSignedOut', () => {
  it('stays silent for a guest', () => {
    const listener = vi.fn();
    const off = onSignedOutNotice(listener);
    expect(noticeSignedOut(false)).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    off();
  });

  it('notifies once for a signed-in user, then stays silent once signed out', () => {
    const listener = vi.fn();
    const off = onSignedOutNotice(listener);
    let signedIn = true;
    for (let i = 0; i < 3; i++) {
      noticeSignedOut(signedIn);
      signedIn = false;
    }
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(COPY.session.signedOut);
    off();
  });

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn();
    onSignedOutNotice(listener)();
    noticeSignedOut(true);
    expect(listener).not.toHaveBeenCalled();
  });
});
