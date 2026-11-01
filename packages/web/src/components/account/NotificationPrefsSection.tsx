import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
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
import { useToast } from '../../lib/toastContext';
import { cn } from '../../lib/utils';
import Skeleton from '../ui/Skeleton';

function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="min-w-0">
        <div className="text-sm text-text-primary">{label}</div>
        {hint ? <div className="text-xs text-text-muted">{hint}</div> : null}
      </div>
      <span className="inline-flex items-center justify-center min-h-11 min-w-11 shrink-0">
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={label}
          disabled={disabled}
          aria-disabled={disabled || undefined}
          onClick={() => onChange(!checked)}
          className={cn(
            'relative w-11 h-6 shrink-0 rounded-full transition-colors duration-200',
            checked ? 'bg-accent-aqua' : 'bg-border',
            disabled && 'opacity-50',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform duration-200',
              checked && 'translate-x-5',
            )}
          />
        </button>
      </span>
    </div>
  );
}

const windowLabel = (start: string, end: string) => `${formatTime(start)}–${formatTime(end)}`;

function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="space-y-3 py-2">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} />
      ))}
    </div>
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
    { topic: 'crew', label: 'Crew picks' },
    { topic: 'schedule', label: 'Schedule changes' },
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
  const updatePrefs = useNotificationPrefsStore((s) => s.updatePrefs);
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(end);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setFrom(start);
    setTo(end);
    setInvalid(false);
  }, [start, end]);

  const save = (nextFrom: string, nextTo: string) => {
    if (!isValidQuietWindow(nextFrom, nextTo)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (nextFrom !== start || nextTo !== end) updatePrefs({ dndStart: nextFrom, dndEnd: nextTo }).catch(() => {});
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
              onClick={() => updatePrefs({ dndStart: p.start, dndEnd: p.end }).catch(() => {})}
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
      {invalid ? <p className="text-xs text-danger mt-1">Start and end can't be the same.</p> : null}
    </div>
  );
}

type MustSeeMinutes = 5 | 10 | 15 | 30 | 60;

/**
 * Per-category notification preferences plus quiet hours, backed by the shared
 * notificationPrefs store (GET/PUT /notifications/prefs). Web parity with the mobile
 * AccountNotificationPrefsSection. Followed by a per-festival topic opt-out.
 */
export default function NotificationPrefsSection() {
  const prefs = useNotificationPrefsStore((s) => s.prefs);
  const loaded = useNotificationPrefsStore((s) => s.loaded);
  const isLoading = useNotificationPrefsStore((s) => s.isLoading);
  const error = useNotificationPrefsStore((s) => s.error);
  const loadPrefs = useNotificationPrefsStore((s) => s.loadPrefs);
  const updatePrefs = useNotificationPrefsStore((s) => s.updatePrefs);

  useEffect(() => {
    loadPrefs().catch(() => {});
  }, [loadPrefs]);

  const quietOn = !!prefs.dndStart && !!prefs.dndEnd;
  // Turning quiet hours back on restores the last stored window, else Nights.
  const lastWindow = useRef({ start: '23:00', end: '08:00' });
  if (prefs.dndStart && prefs.dndEnd) lastWindow.current = { start: prefs.dndStart, end: prefs.dndEnd };
  const win = lastWindow.current;

  const zone = quietOn && prefs.dndTimeZone ? ` (${timeZoneCity(prefs.dndTimeZone)} time)` : '';
  const quietHint = `Mute ${windowLabel(win.start, win.end)}${zone}`;

  return (
    <section className="p-4 rounded-lg bg-bg-card border border-border">
      <h3 className="text-sm font-semibold text-text-secondary flex items-center gap-2 mb-1">
        <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
        Notification types
      </h3>
      {!loaded && isLoading ? (
        <SkeletonRows count={4} />
      ) : (
        <>
          {visibleNotificationRows().map((row) => (
            <div key={row.key}>
              <Toggle
                label={row.label}
                hint={row.hint}
                checked={prefs[row.key]}
                onChange={(v) => updatePrefs({ [row.key]: v }).catch(() => {})}
              />
              {row.key === 'setReminders' ? (
                <div className="flex items-center justify-between py-2">
                  <label htmlFor="must-see-reminder" className="min-w-0">
                    <div className="text-sm text-text-primary">Must-see reminders</div>
                    <div className="text-xs text-text-muted">Remind me before every set I mark Must see.</div>
                  </label>
                  <select
                    id="must-see-reminder"
                    value={prefs.mustSeeReminderMinutes ?? ''}
                    onChange={(e) =>
                      updatePrefs({
                        mustSeeReminderMinutes: e.target.value === '' ? null : (Number(e.target.value) as MustSeeMinutes),
                      }).catch(() => {})
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
              updatePrefs(v ? { dndStart: win.start, dndEnd: win.end } : { dndStart: null, dndEnd: null }).catch(() => {})
            }
          />
          {quietOn ? <QuietHoursEditor start={win.start} end={win.end} /> : null}
        </>
      )}
      {error ? (
        <p role="alert" className="text-xs text-danger mt-2">
          {error}
        </p>
      ) : null}
      <FestivalTopicsSubsection />
    </section>
  );
}
