/** Notification permission as each app reports it, normalised for the delivery check. */
export type ReminderPermission = 'granted' | 'denied' | 'default' | 'unsupported' | 'ios-needs-install';

/** Why a set reminder would not reach the user. Each app writes its own copy and fix. */
export type ReminderDeliveryProblem = 'pref-off' | 'denied' | 'not-enabled' | 'unsupported' | 'ios-needs-install';

/**
 * The reason a reminder the user set cannot be delivered, or null when it can
 * (or when no reminder is set). The account preference is checked before the
 * device permission.
 */
export function reminderDeliveryProblem(args: {
  hasReminder: boolean;
  permission: ReminderPermission;
  setRemindersPref: boolean;
}): ReminderDeliveryProblem | null {
  if (!args.hasReminder) return null;
  if (!args.setRemindersPref) return 'pref-off';
  if (args.permission === 'granted') return null;
  if (args.permission === 'default') return 'not-enabled';
  return args.permission;
}
