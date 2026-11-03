export const INBOX_COPY = {
  title: 'Notifications',
  empty: 'No notifications yet. Set reminders, crew news, schedule changes and festival announcements show up here.',
  error: "Couldn't load your notifications.",
  retry: 'Try again',
  // The "6" matches PUSH_BUDGET_PER_HOUR in lib/notifications/send.ts; change both together.
  footnote:
    'Shows the last 50 notifications we sent you. Some arrive here without a push: during quiet hours, or after 6 alerts in an hour.',
  bellLabel: 'Notifications',
  bellLabelUnread: (n: number) => `Notifications, ${n} unread`,
  unreadA11y: 'Unread',
} as const;

/** Bell count text: null for 0, '9+' over 9. */
export function inboxBadgeLabel(n: number): string | null {
  if (n <= 0) return null;
  return n > 9 ? '9+' : String(n);
}
