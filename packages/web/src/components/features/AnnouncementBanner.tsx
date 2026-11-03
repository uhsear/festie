import { useEffect } from 'react';
import { Link } from '@tanstack/react-router';
import { AlertTriangle } from 'lucide-react';
import { ANNOUNCEMENT_COPY as COPY } from '@festie/shared/constants';
import { useAnnouncementStore } from '@festie/shared/stores/announcementStore';
import { useFestivalDataStore } from '@festie/shared/stores/festivalDataStore';
import { announcementWebPath, pickBannerAnnouncement } from '@festie/shared/utils';

/**
 * Admin announcement banner ("From Festie") under the SOS banner. Loads when the
 * festival changes and when the tab becomes visible. Dismissal persists per device.
 */
export default function AnnouncementBanner() {
  const festivalId = useFestivalDataStore((s) => s.currentFestivalId);
  const items = useAnnouncementStore((s) => s.items);
  const dismissed = useAnnouncementStore((s) => s.dismissed);
  const load = useAnnouncementStore((s) => s.load);
  const dismiss = useAnnouncementStore((s) => s.dismiss);

  useEffect(() => {
    void load(festivalId);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load(festivalId);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [festivalId, load]);

  const a = pickBannerAnnouncement(items, dismissed);
  if (!a) return null;
  const urgent = a.severity === 'urgent';
  const kicker = COPY.banner.kicker(a.severity);

  return (
    <div
      role="status"
      aria-label={COPY.banner.label(kicker, a.title, a.body)}
      data-testid="announcement-banner"
      className={`flex items-center gap-2.5 bg-bg-card border rounded-xl py-2.5 px-4 mx-3 my-2 text-sm text-text-primary ${urgent ? 'border-text-danger' : 'border-accent-aqua'}`}
    >
      {urgent && <AlertTriangle className="w-5 h-5 shrink-0 text-text-danger" aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        <p className="type-caption text-text-secondary">{kicker}</p>
        <p className="font-semibold">{a.title}</p>
        <p className="text-text-secondary">{a.body}</p>
      </div>
      {a.screen !== 'home' && (
        <Link
          to={announcementWebPath(a.screen)}
          onClick={() => dismiss(a.id)}
          data-testid="announcement-banner-open"
          className="shrink-0 flex items-center bg-accent-aqua text-bg-primary rounded-lg py-2 px-3.5 font-semibold min-h-11 hover:bg-[var(--color-accent-aqua-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua"
        >
          {COPY.banner.open}
        </Link>
      )}
      <button
        type="button"
        onClick={() => dismiss(a.id)}
        aria-label={COPY.banner.dismiss}
        data-testid="announcement-banner-close"
        className="shrink-0 bg-transparent border-none text-text-secondary cursor-pointer text-xl leading-none min-h-11 min-w-11 hover:text-text-primary"
      >
        ×
      </button>
    </div>
  );
}
