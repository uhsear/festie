import { describe, expect, it } from 'vitest';
import { read } from './read-source';


describe('T6 mobile notification settings', () => {
  const prefs = read('components/AccountNotificationPrefsSection.tsx');
  it('uses the shared rows and topics hook, and never dims rows', () => {
    expect(prefs).toContain('visibleNotificationRows');
    expect(prefs).toContain('useNotificationTopics');
    expect(prefs).not.toContain('opacity: 0.5');
  });
  it('toasts a failed save, keeps quiet-hour chips at 44pt and words time errors for quiet hours', () => {
    expect(prefs).toContain("Couldn't update notification setting. Try again.");
    expect(prefs).toContain('minHeight: 44');
    expect(prefs).toContain('errorText={QUIET_TIME_ERROR}');
    expect(read('components/admin/AdminFields.tsx')).toContain('required = false');
  });
  it('warns that the calendar link is a bearer link and offers sharing it', () => {
    const calendar = read('hooks/usePicksCalendar.ts');
    expect(calendar).toContain('CALENDAR_LINK_COPY.privacy');
    expect(calendar).toContain('Share.share');
  });
  it('maps raw push-registration failures to plain copy', () => {
    expect(read('hooks/useMobilePush.ts')).toContain('mapErrorToUserMessage(err,');
  });
  it('opens system settings when permission is denied', () => {
    expect(read('components/AccountNotificationsSection.tsx')).toContain('Linking.openSettings');
  });
});
