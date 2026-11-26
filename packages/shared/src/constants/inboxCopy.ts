export const INBOX_COPY = {
  title: 'Notifications',
  emptyTitle: 'No notifications yet',
  emptyBody: 'Set reminders, crew news, schedule changes and festival announcements show up here.',
  error: "Couldn't load your notifications.",
  retry: 'Try again',
  // The "6" matches PUSH_BUDGET_PER_HOUR in lib/notifications/send.ts; change both together.
  footnote:
    'Shows the last 50 notifications we sent you. Some arrive here without a push: during quiet hours, or after 6 alerts in an hour.',
  bellLabel: 'Notifications',
  bellLabelUnread: (n: number) => `Notifications, ${n} unread`,
  unreadA11y: 'Unread',
} as const;

/**
 * Screen-reader text for one inbox row. A title or body that already ends in a period would read as "..", so the
 * trailing periods go before the sentences are joined. A part that ends in "?" or "!" keeps it and gets no period.
 */
export function inboxRowLabel(
  item: { title: string; body: string; festivalName?: string | null },
  ago: string,
  unread: boolean,
): string {
  const bare = (s: string) => s.trim().replace(/\.+$/, '');
  // Same order as the row's visible text, so voice control can say what it sees (WCAG 2.5.3).
  const parts = [bare(item.title), bare(item.body), ago, ...(item.festivalName ? [bare(item.festivalName)] : [])];
  const sentence = (part: string) => (/[?!]$/.test(part) ? part : `${part}.`);
  return `${parts.map(sentence).join(' ')}${unread ? ` ${INBOX_COPY.unreadA11y}.` : ''}`;
}

/** Bell count text: null for 0, '9+' over 9. */
export function inboxBadgeLabel(n: number): string | null {
  if (n <= 0) return null;
  return n > 9 ? '9+' : String(n);
}
