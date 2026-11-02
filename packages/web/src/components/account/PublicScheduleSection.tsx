import { useState } from 'react';
import { useAuthStore } from '@festie/shared/stores/authStore';
import { buildPublicScheduleUrl } from '@festie/shared/utils';
import { Globe } from 'lucide-react';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';
import Switch from '../ui/Switch';

/** Opt-in switch for the public schedule page. Off by default. */
export default function PublicScheduleSection() {
  const { toast } = useToast();
  const user = useAuthStore((s) => s.user);
  const setPublicSchedule = useAuthStore((s) => s.setPublicSchedule);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!user) return null;
  const on = user.publicSchedule === true;
  const url = buildPublicScheduleUrl(user.username, window.location.origin);

  const toggle = async (next: boolean) => {
    setSaving(true);
    try {
      await setPublicSchedule(next);
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

  return (
    <section className="p-4 rounded-lg bg-bg-card border border-border space-y-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-text-secondary flex items-center gap-2">
            <Globe className="w-4 h-4" aria-hidden="true" />
            Public schedule page
          </h3>
          <p className="text-xs text-text-muted">Anyone with the link can see your picks. Turning it off hides this link; picks links you already shared keep working.</p>
        </div>
        <Switch checked={on} onChange={toggle} label="Public schedule page" disabled={saving} />
      </div>
      {on && (
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate text-xs text-accent-aqua" data-testid="public-schedule-url">
            {url}
          </code>
          <Button variant="outline" size="sm" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      )}
    </section>
  );
}
