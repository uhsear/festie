import { describe, it, expect } from 'vitest';
import { reminderDeliveryProblem, type ReminderPermission } from './reminderDelivery';

const ok = { hasReminder: true, permission: 'granted' as ReminderPermission, setRemindersPref: true };

describe('reminderDeliveryProblem', () => {
  it('returns null when no reminder is set, whatever the state', () => {
    expect(reminderDeliveryProblem({ hasReminder: false, permission: 'denied', setRemindersPref: false })).toBeNull();
  });

  it('returns null when granted and the preference is on', () => {
    expect(reminderDeliveryProblem(ok)).toBeNull();
  });

  it('checks the preference before the permission', () => {
    expect(reminderDeliveryProblem({ ...ok, setRemindersPref: false })).toBe('pref-off');
    expect(reminderDeliveryProblem({ ...ok, setRemindersPref: false, permission: 'denied' })).toBe('pref-off');
  });

  it('maps each non-granted permission to its problem', () => {
    expect(reminderDeliveryProblem({ ...ok, permission: 'default' })).toBe('not-enabled');
    expect(reminderDeliveryProblem({ ...ok, permission: 'denied' })).toBe('denied');
    expect(reminderDeliveryProblem({ ...ok, permission: 'unsupported' })).toBe('unsupported');
    expect(reminderDeliveryProblem({ ...ok, permission: 'ios-needs-install' })).toBe('ios-needs-install');
  });
});
