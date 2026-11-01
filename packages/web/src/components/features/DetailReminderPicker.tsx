import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useNotificationPrefsStore } from '@festie/shared/stores';
import { reminderDeliveryProblem, type ReminderPermission } from '@festie/shared/utils';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import { cn } from '../../lib/utils';

interface Props {
  myReminder: number | undefined;
  reminderBusy: number | null | 'clear';
  onReminderClick: (minutes: number | null) => Promise<void>;
}

// Must match the server's allowed lead times (ALLOWED_REMINDER_MINUTES).
const options: Array<[number, string]> = [
  [5, '5m'],
  [10, '10m'],
  [15, '15m'],
  [30, '30m'],
  [60, '1h'],
];

const baseButtonClass =
  'flex-1 py-2.5 min-h-[44px] rounded-full text-center bg-bg-card border-2 border-border cursor-pointer transition-[background-color,border-color,transform] duration-200 ease-[var(--ease-standard)] text-text-primary touch-manipulation appearance-none hover:border-text-muted hover:bg-bg-card-hover active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2';

const problemLinkClass =
  'min-h-[44px] px-2 underline cursor-pointer focus-visible:outline-2 focus-visible:outline-accent-aqua';

export default function DetailReminderPicker({ myReminder, reminderBusy, onReminderClick }: Props) {
  const navigate = useNavigate();
  const { permissionState, unsupportedReason, requestPermission, registerToken } = usePushNotifications();
  const setRemindersPref = useNotificationPrefsStore((s) => s.prefs.setReminders);
  const loadPrefs = useNotificationPrefsStore((s) => s.loadPrefs);

  useEffect(() => {
    loadPrefs().catch((err) => console.warn('Could not load notification preferences', err));
  }, [loadPrefs]);

  const permission: ReminderPermission =
    permissionState === 'unsupported'
      ? unsupportedReason === 'ios-needs-install'
        ? 'ios-needs-install'
        : 'unsupported'
      : permissionState;
  const problem = reminderDeliveryProblem({ hasReminder: myReminder != null, permission, setRemindersPref });

  // Ask only from this button, after the user set a reminder; never on mount.
  const turnOn = async () => {
    const result = await requestPermission();
    if (result === 'granted') await registerToken();
  };

  return (
    <div>
      <div className="text-[length:var(--font-size-12)] font-bold uppercase tracking-[0.5px] text-text-secondary mb-2">
        Remind me before it starts
      </div>
      <div className={cn('flex gap-2', problem ? 'mb-2' : 'mb-6')}>
        {options.map(([m, label]) => {
          const active = myReminder === m;
          const isThisBusy = reminderBusy === m;
          const anyBusy = reminderBusy !== null;
          return (
            <button
              key={m}
              className={cn(baseButtonClass, active && 'border-accent-aqua bg-[var(--color-aqua-a08)]')}
              type="button"
              aria-pressed={active ? 'true' : 'false'}
              aria-label={active ? `Reminder ${label} before, click to clear` : `Remind me ${label} before`}
              aria-busy={isThisBusy ? 'true' : 'false'}
              disabled={anyBusy}
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (reminderBusy !== null) return;
                await onReminderClick(active ? null : m);
              }}
            >
              <div className="text-[length:var(--font-size-12)] font-bold uppercase tracking-[0.5px]">{label}</div>
            </button>
          );
        })}
      </div>
      {problem && (
        <div role="status" className="mb-6 text-xs text-accent-amber">
          {problem === 'not-enabled' && (
            <>
              Notifications are off, so this reminder can&apos;t reach you.{' '}
              <button type="button" className={problemLinkClass} onClick={() => void turnOn()}>
                Turn on
              </button>
            </>
          )}
          {problem === 'denied' &&
            'Notifications are blocked for festie.us. Allow them in your browser settings to get this reminder.'}
          {problem === 'ios-needs-install' && 'To get reminders on iPhone, add Festie to your Home Screen first.'}
          {problem === 'unsupported' && "This browser can't show reminders. Use the Festie app or another browser."}
          {problem === 'pref-off' && (
            <>
              Set reminders are turned off in Account.{' '}
              <button type="button" className={problemLinkClass} onClick={() => void navigate({ to: '/account' })}>
                Turn on in Account
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
