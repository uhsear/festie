import { describe, it, expect } from 'vitest';
import { INBOX_COPY, inboxBadgeLabel } from './inboxCopy';

describe('inboxCopy', () => {
  it('inboxBadgeLabel caps at 9+', () => {
    expect(inboxBadgeLabel(0)).toBeNull();
    expect(inboxBadgeLabel(3)).toBe('3');
    expect(inboxBadgeLabel(10)).toBe('9+');
  });

  it('footnote names the push budget', () => {
    expect(INBOX_COPY.footnote).toContain('6 alerts');
  });

  it('bell label uses the real count', () => {
    expect(INBOX_COPY.bellLabelUnread(12)).toBe('Notifications, 12 unread');
  });

  it('never says "Log in"', () => {
    const all = [INBOX_COPY.title, INBOX_COPY.empty, INBOX_COPY.error, INBOX_COPY.retry, INBOX_COPY.footnote, INBOX_COPY.bellLabel, INBOX_COPY.unreadA11y];
    for (const s of all) expect(s).not.toMatch(/log in/i);
  });
});
