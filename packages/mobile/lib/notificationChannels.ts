import type { NotificationBoolKey } from '@festie/shared/utils';

// keep in sync with TYPE_CHANNEL_MAP in lib/notifications/send.ts
export const CHANNEL_PREF_KEYS: Record<string, NotificationBoolKey[]> = {
  'set-reminders': ['setReminders'],
  crew: ['crewUpdates', 'crewReformed', 'crewMeetingPoints', 'crewPolls', 'crewMoney', 'crewRides'],
  updates: ['scheduleChanges', 'lineupDrops', 'wrapReady'],
};

/** Preference keys whose Android channel the user muted (importance equals `noneImportance`). */
export function mutedPrefKeys(
  channels: { id: string; importance: number }[],
  noneImportance: number,
): Set<NotificationBoolKey> {
  const muted = new Set<NotificationBoolKey>();
  for (const ch of channels) {
    if (ch.importance !== noneImportance) continue;
    for (const key of CHANNEL_PREF_KEYS[ch.id] ?? []) muted.add(key);
  }
  return muted;
}
