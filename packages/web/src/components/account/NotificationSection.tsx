import { useEffect, useRef, useState } from 'react';
import { Bell, BellOff, SlidersHorizontal } from 'lucide-react';
import { useNotificationPrefsStore } from '@festie/shared/stores';
import {
  formatTime,
  isValidQuietWindow,
  MUST_SEE_REMINDER_OPTIONS,
  mustSeeOptionLabel,
  QUIET_HOURS_PRESETS,
  timeZoneCity,
  TOPIC_GLOBAL_KEY,
  visibleNotificationRows,
} from '@festie/shared/utils';
import { useNotificationTopics } from '@festie/shared/hooks';
import { NOTIFICATION_TOPIC_COPY } from '@festie/shared/constants';
import { isApiClientError } from '@festie/shared/services/api';
import { useToast } from '../../lib/toastContext';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import { cn } from '../../lib/utils';
import Button from '../ui/Button';
import Skeleton, { SkeletonGroup } from '../ui/Skeleton';
import Switch from '../ui/Switch';
import { Card } from '../ui/Card';

function Toggle({
  label,
  ariaLabel,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  /** The accessible name, when the visible label alone does not tell this switch apart from another. */
  ariaLabel?: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="text-sm text-text-primary">{label}</div>
        {hint ? <div className="text-xs text-text-muted">{hint}</div> : null}
      </div>
      <Switch checked={checked} onChange={onChange} label={ariaLabel ?? label} disabled={disabled} />
    </div>
  );
}

// A failed save snaps the switch back; the message in the card footer can be off screen, so toast it too.
function usePrefsUpdater() {
  const { toast } = useToast();
  const updatePrefs = useNotificationPrefsStore((s) => s.updatePrefs);
  return (patch: Parameters<typeof updatePrefs>[0]) =>
    updatePrefs(patch).catch((err) => {
      console.warn('Notification prefs update failed', err);
      toast("Couldn't update notification setting. Try again.", 'error');
    });
}

const windowLabel = (start: string, end: string) => `${formatTime(start)}–${formatTime(end)}`;

function SkeletonRows({ count }: { count: number }) {
  return (
    <SkeletonGroup className="space-y-3 py-2">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} />
      ))}
    </SkeletonGroup>
  );
}

/**
 * Per-festival notification opt-out, shown only for a festival the user joined.
 * Toggling a topic OFF mutes that topic's push for this festival only. The global
 * switch wins: when it is off, the festival switch is disabled and shows off.
 */
function FestivalTopicsSubsection() {
  const { toast } = useToast();
  const prefs = useNotificationPrefsStore((s) => s.prefs);
  const { festival, subs, error, setTopic } = useNotificationTopics();
  if (!festival) return null;

  const rows = [
    { topic: 'crew', label: NOTIFICATION_TOPIC_COPY.topicLabels.crew },
    { topic: 'schedule', label: NOTIFICATION_TOPIC_COPY.topicLabels.schedule },
  ] as const;

  return (
    <div className="mt-3 pt-3 border-t border-border">
      <h3 className="text-xs font-medium text-text-muted mb-1">Only for {festival.name}</h3>
      <p className="text-xs text-text-muted mb-1">
        Turn one off to mute it for this festival only. The switches above apply to every festival.
      </p>
      {error ? (
        <p className="text-xs text-text-muted">Couldn't load settings for {festival.name}.</p>
      ) : !subs ? (
        <SkeletonRows count={2} />
      ) : (
        rows.map(({ topic, label }) => {
          const globalOff = !prefs[TOPIC_GLOBAL_KEY[topic]];
          return (
            <Toggle
              key={topic}
              label={label}
              ariaLabel={`${label} for ${festival.name}`}
              hint={globalOff ? 'Off for every festival' : undefined}
              checked={!globalOff && subs[topic]}
              disabled={globalOff}
              onChange={(v) =>
                setTopic(topic, v).catch(() => toast("Couldn't update notification setting. Try again.", 'error'))
              }
            />
          );
        })
      )}
    </div>
  );
}

function QuietHoursEditor({ start, end }: { start: string; end: string }) {
  const updatePrefs = usePrefsUpdater();
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(end);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    setFrom(start);
    setTo(end);
    setProblem(null);
  }, [start, end]);

  const save = (nextFrom: string, nextTo: string) => {
    if (!isValidQuietWindow(nextFrom, nextTo)) {
      setProblem(nextFrom && nextTo ? "Start and end can't be the same." : 'Enter a start and end time.');
      return;
    }
    setProblem(null);
    if (nextFrom !== start || nextTo !== end) void updatePrefs({ dndStart: nextFrom, dndEnd: nextTo });
  };

  return (
    <div className="pb-2">
      <div className="flex flex-wrap gap-2 mb-2">
        {QUIET_HOURS_PRESETS.map((p) => {
          const active = p.start === start && p.end === end;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={active}
              onClick={() => void updatePrefs({ dndStart: p.start, dndEnd: p.end })}
              className={cn(
                'min-h-11 px-3 rounded-full border text-xs',
                active ? 'border-accent-aqua text-text-primary' : 'border-border text-text-muted',
              )}
            >
              {p.id === 'festival' ? `${p.label} (4 AM to 11 AM)` : p.label}
            </button>
          );
        })}
      </div>
      <div className="flex gap-3 text-xs text-text-muted">
        <label className="flex items-center gap-2">
          From
          <input
            type="time"
            step="900"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            onBlur={() => save(from, to)}
            className="min-h-11 px-2 rounded border border-border bg-bg-card text-text-primary"
          />
        </label>
        <label className="flex items-center gap-2">
          To
          <input
            type="time"
            step="900"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            onBlur={() => save(from, to)}
            className="min-h-11 px-2 rounded border border-border bg-bg-card text-text-primary"
          />
        </label>
      </div>
      {problem ? <p className="text-xs text-[var(--color-text-danger)] mt-1">{problem}</p> : null}
    </div>
  );
}

function PushSubsection() {
  const { toast, toastError } = useToast();
  const push = usePushNotifications();
  const [pushBusy, setPushBusy] = useState(false);
  // A browser or push-service failure carries a raw string ("Subscription failed - no active Service Worker"), so only a server error keeps its own message.
  const toastPushError = (e: unknown, fallback: string) => toastError(isApiClientError(e) ? e : null, fallback);
  // Render nothing while the key request is in flight, so a supported browser never flashes "Not supported".
  if (push.unsupportedReason === 'not-configured' || push.checking) return null;

  const handleEnablePush = async () => {
    if (!push.isSupported) {
      if (push.unsupportedReason === 'ios-needs-install') {
        toast('Add Festie to your Home Screen first. iOS needs the installed PWA to allow notifications.', 'info');
      } else {
        toast('Push notifications not supported on this browser', 'error');
      }
      return;
    }
    setPushBusy(true);
    try {
      const res = await push.requestPermission();
      if (res === 'granted') {
        await push.registerToken();
        toast('Push notifications enabled', 'success');
      } else if (res === 'denied') {
        toast('Permission denied. Enable in browser settings to turn on.', 'error');
      } else {
        toast('Permission prompt dismissed.', 'info');
      }
    } catch (e) {
      toastPushError(e, "Couldn't turn on notifications. Try again.");
    } finally {
      setPushBusy(false);
    }
  };

  // Permission already granted but no subscription (after Disable): subscribe without a prompt.
  const handleResubscribe = async () => {
    setPushBusy(true);
    try {
      await push.registerToken();
      toast('Push notifications enabled', 'success');
    } catch (e) {
      toastPushError(e, "Couldn't turn on notifications. Try again.");
    } finally {
      setPushBusy(false);
    }
  };

  const handleDisablePush = async () => {
    setPushBusy(true);
    try {
      await push.unregisterToken();
      toast('Push notifications disabled', 'success');
    } catch (e) {
      toastPushError(e, "Couldn't turn off notifications. Try again.");
    } finally {
      setPushBusy(false);
    }
  };

  return (
    <div className="space-y-3 pb-3 mb-3 border-b border-border">
      <h3 className="text-sm font-semibold text-text-secondary flex items-center gap-2">
        {push.permission === 'granted' ? (
          <Bell className="w-4 h-4" aria-hidden="true" />
        ) : (
          <BellOff className="w-4 h-4" aria-hidden="true" />
        )}
        Push Notifications
      </h3>
      {push.keyError ? (
        <>
          <p className="text-sm text-text-muted" role="alert">
            Couldn't check push notifications. Check your connection, then try again.
          </p>
          <Button variant="secondary" fullWidth onClick={push.retry} className="min-h-[44px]">
            Try again
          </Button>
        </>
      ) : !push.isSupported ? (
        push.unsupportedReason === 'ios-needs-install' ? (
          <p className="text-sm text-text-muted">
            On iOS, notifications work only when Festie is installed to your Home Screen. Tap the{' '}
            <span aria-hidden="true">Share</span> button in Safari and choose <strong>Add to Home Screen</strong>, then
            open Festie from the new icon to enable notifications.
          </p>
        ) : (
          <p className="text-sm text-text-muted">
            Not supported on this browser. Try Chrome, Edge, or Safari 16+ (iOS requires Add-to-Home-Screen install).
          </p>
        )
      ) : push.permission === 'granted' ? (
        <>
          <p className="text-sm text-text-muted">
            You'll get notified when your crew picks sets, sends polls, or updates the meeting point.
          </p>
          <p className="text-sm text-text-muted">
            SOS alerts from your crew always come through, even when other alerts are muted.
          </p>
          {push.subscribed ? (
            <Button variant="secondary" fullWidth isLoading={pushBusy} onClick={handleDisablePush} className="min-h-[44px]">
              Disable Notifications
            </Button>
          ) : (
            <Button variant="primary" fullWidth isLoading={pushBusy} onClick={handleResubscribe} className="min-h-[44px]">
              Enable Notifications
            </Button>
          )}
        </>
      ) : push.permission === 'denied' ? (
        <p className="text-sm text-text-muted">
          Permission blocked. Re-enable in your browser's site settings (lock icon in the address bar) and reload.
        </p>
      ) : (
        <>
          <p className="text-sm text-text-muted">
            Get notified when your crew picks sets, sends polls, or updates the meeting point.
          </p>
          <Button variant="primary" fullWidth isLoading={pushBusy} onClick={handleEnablePush} className="min-h-[44px]">
            Enable Notifications
          </Button>
        </>
      )}
    </div>
  );
}

type MustSeeMinutes = 5 | 10 | 15 | 30 | 60;

/**
 * Per-category notification preferences plus quiet hours, backed by the shared
 * notificationPrefs store (GET/PUT /notifications/prefs). Web parity with the mobile
 * AccountNotificationPrefsSection. Followed by a per-festival topic opt-out.
 */
function PrefsSubsection() {
  const prefs = useNotificationPrefsStore((s) => s.prefs);
  const loaded = useNotificationPrefsStore((s) => s.loaded);
  const isLoading = useNotificationPrefsStore((s) => s.isLoading);
  const error = useNotificationPrefsStore((s) => s.error);
  const loadPrefs = useNotificationPrefsStore((s) => s.loadPrefs);
  const updatePrefs = usePrefsUpdater();

  useEffect(() => {
    loadPrefs().catch((err) => console.warn('Notification prefs load failed', err));
  }, [loadPrefs]);

  const quietOn = !!prefs.dndStart && !!prefs.dndEnd;
  // Turning quiet hours back on restores the last stored window, else Nights.
  const lastWindow = useRef({ start: '23:00', end: '08:00' });
  if (prefs.dndStart && prefs.dndEnd) lastWindow.current = { start: prefs.dndStart, end: prefs.dndEnd };
  const win = lastWindow.current;

  const zone = quietOn && prefs.dndTimeZone ? ` (${timeZoneCity(prefs.dndTimeZone)} time)` : '';
  const quietHint = `Mute ${windowLabel(win.start, win.end)}${zone}`;

  return (
    <div>
      <h3 className="text-sm font-semibold text-text-secondary flex items-center gap-2 mb-1">
        <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
        Notification types
      </h3>
      {!loaded && isLoading ? (
        <SkeletonRows count={4} />
      ) : !loaded && error ? (
        // The server's real values never arrived; default switches would show settings the user never chose.
        <Button variant="secondary" size="sm" onClick={() => loadPrefs().catch((err) => console.warn('Notification prefs load failed', err))}>
          Try again
        </Button>
      ) : (
        <>
          {visibleNotificationRows().map((row) => (
            <div key={row.key}>
              <Toggle
                label={row.label}
                hint={row.hint}
                checked={prefs[row.key]}
                onChange={(v) => void updatePrefs({ [row.key]: v })}
              />
              {row.key === 'setReminders' ? (
                <div className="flex items-center justify-between gap-3 py-2">
                  <label htmlFor="must-see-reminder" className="min-w-0">
                    <div className="text-sm text-text-primary">{NOTIFICATION_TOPIC_COPY.mustSeeTitle}</div>
                    <div className="text-xs text-text-muted">{NOTIFICATION_TOPIC_COPY.mustSeeHint}</div>
                  </label>
                  <select
                    id="must-see-reminder"
                    value={prefs.mustSeeReminderMinutes ?? ''}
                    onChange={(e) =>
                      void updatePrefs({
                        mustSeeReminderMinutes: e.target.value === '' ? null : (Number(e.target.value) as MustSeeMinutes),
                      })
                    }
                    className="min-h-11 px-2 rounded border border-border bg-bg-card text-sm text-text-primary"
                  >
                    {MUST_SEE_REMINDER_OPTIONS.map((v) => (
                      <option key={v ?? 'off'} value={v ?? ''}>
                        {mustSeeOptionLabel(v)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>
          ))}
          <Toggle
            label="Quiet hours"
            hint={quietHint}
            checked={quietOn}
            onChange={(v) =>
              void updatePrefs(v ? { dndStart: win.start, dndEnd: win.end } : { dndStart: null, dndEnd: null })
            }
          />
          {quietOn ? <QuietHoursEditor start={win.start} end={win.end} /> : null}
        </>
      )}
      {error ? (
        <p role="alert" className="text-xs text-[var(--color-text-danger)] mt-2">
          {error}
        </p>
      ) : null}
      {loaded ? <FestivalTopicsSubsection /> : null}
    </div>
  );
}

/** Push opt-in, per-category preferences, quiet hours and per-festival topics in one account card. */
export default function NotificationSection() {
  return (
    <Card variant="section">
      <PushSubsection />
      <PrefsSubsection />
    </Card>
  );
}
