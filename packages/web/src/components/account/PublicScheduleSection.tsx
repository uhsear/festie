import { useEffect, useState } from 'react';
import { useAuthStore } from '@festie/shared/stores/authStore';
import { api } from '@festie/shared/services/api';
import { fetchSharingStatus, resetShareLinks, type SharingStatus } from '@festie/shared/services/sharing';
import { buildPublicScheduleUrl } from '@festie/shared/utils';
import { Globe } from 'lucide-react';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';

/** Opt-in switch for the public schedule page (off by default), plus the reset for every share link. */
export default function PublicScheduleSection() {
  const { toast } = useToast();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<SharingStatus | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const on = user?.publicSchedule === true;

  // Runs on mount and after each toggle (the toggle changes `on`).
  useEffect(() => {
    if (!on) {
      setStatus(null);
      return;
    }
    let cancelled = false;
    fetchSharingStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch((err) => {
        console.error('Could not load sharing status', err);
      });
    return () => {
      cancelled = true;
    };
  }, [on]);

  if (!user) return null;
  const url = buildPublicScheduleUrl(user.username, window.location.origin);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const toggle = async () => {
    setSaving(true);
    try {
      const res = await api.put<{ user: { publicSchedule?: boolean } }>('/account/public-schedule', {
        publicSchedule: !on,
      });
      setUser({ ...user, publicSchedule: res.user?.publicSchedule ?? !on });
    } catch {
      toast("Couldn't update your public schedule page. Try again.", 'error');
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("Couldn't copy the link. Select it and copy it yourself.", 'error');
    }
  };

  const share = async () => {
    try {
      await navigator.share({ title: 'My Festie picks', url });
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        toast("Couldn't open the share sheet. Copy the link instead.", 'error');
      }
    }
  };

  const reset = async () => {
    setResetting(true);
    try {
      await resetShareLinks();
      setConfirmOpen(false);
      toast('Done. Your old links no longer work. Share picks makes a new one.', 'success');
    } catch {
      toast("Couldn't reset your links. Check your connection and try again.", 'error');
    } finally {
      setResetting(false);
    }
  };

  const festivalName = status?.publicFestival?.name;

  return (
    <section className="p-4 rounded-lg bg-bg-card border border-border space-y-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-text-secondary flex items-center gap-2">
            <Globe className="w-4 h-4" aria-hidden="true" />
            Public schedule page
          </h3>
          <p className="text-xs text-text-muted">
            Anyone with the link can see your picks for your newest festival. Turning it off hides this page. Links you sent from Share picks keep working until you reset them below.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Public schedule page"
          disabled={saving}
          onClick={toggle}
          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? 'bg-accent-aqua' : 'bg-border'}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white transition-transform ${on ? 'translate-x-5' : ''}`}
          />
        </button>
      </div>
      {on && (
        <>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate text-xs text-accent-aqua" data-testid="public-schedule-url">
              {url}
            </code>
            <Button variant="outline" size="sm" onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-md border border-border px-3 min-h-8 text-sm text-text-primary"
            >
              Open
            </a>
            {canShare && (
              <Button variant="outline" size="sm" onClick={share}>
                Share
              </Button>
            )}
          </div>
          {status && (
            <p className="text-xs text-text-muted" data-testid="public-schedule-festival">
              {festivalName
                ? `Shows your picks for ${festivalName}. To share another festival, use Share picks on that festival's Picks.`
                : 'Join a festival and pick a set to fill this page.'}
            </p>
          )}
        </>
      )}
      <div className="space-y-1">
        <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
          Reset my share links
        </Button>
        <p className="text-xs text-text-muted">
          Stops every picks link and calendar subscription you've shared. Your public schedule page is not affected; turn it off above.
        </p>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Reset all your share links?"
        description="Every picks link and calendar subscription you've sent stops working right away. Anyone who has one will need a new link from you. Calendars you subscribed will stop updating; subscribe again from Picks › Add to calendar."
        confirmLabel="Reset links"
        destructive
        busy={resetting}
        onConfirm={reset}
      />
    </section>
  );
}
