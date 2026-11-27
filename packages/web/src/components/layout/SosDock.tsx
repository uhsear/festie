import { useEffect } from 'react';
import { useAuthStore, useCrewStore } from '@festie/shared/stores';
import { useActiveSos } from '@festie/shared/hooks';
import SosRaiseButton from '../crew/SosRaiseButton';

/**
 * The one persistent SOS control, mounted once in the app shell so it sits in the same
 * corner on every screen. It hides while your own SOS is live (the banner carries the
 * way out) and for guests or users with no open crew. While shown it publishes the corner
 * it occupies as --sos-dock-h (height to clear) and --sos-dock-w (width to clear) on :root,
 * so toasts, floating buttons and map overlays keep out from under it. It also publishes
 * --sos-band-h: the page area (.main-content in pages.css) ends that far above the nav, so no row ever
 * scrolls under the dock. The band is the 64px button plus DOCK_GAP above and below it, and
 * it follows the dock's own offsets (sticky bar, safe-area inset).
 */
const DOCK_GAP = 4;
const DOCK_H = `${64 + 2 * DOCK_GAP}px`;
const DOCK_W = '88px';
const BAND_H = `calc(${DOCK_H} + var(--sticky-bar-h, 0px) + env(safe-area-inset-bottom, 0px))`;

export default function SosDock() {
  const userId = useAuthStore((s) => s.user?.id);
  const crewId = useCrewStore((s) => s.activeCrew?.id);
  const entries = useActiveSos();
  const visible = !!userId && !!crewId && !entries.some((e) => e.userId === userId);
  useEffect(() => {
    if (!visible) return;
    const root = document.documentElement.style;
    root.setProperty('--sos-dock-h', DOCK_H);
    root.setProperty('--sos-dock-w', DOCK_W);
    root.setProperty('--sos-band-h', BAND_H);
    return () => {
      root.removeProperty('--sos-dock-h');
      root.removeProperty('--sos-dock-w');
      root.removeProperty('--sos-band-h');
    };
  }, [visible]);
  if (!visible || !crewId) return null;

  return (
    <div className="fixed right-4 z-[var(--z-sticky)] bottom-[calc(var(--bottom-nav-h,0px)+var(--sticky-bar-h,0px)+4px+env(safe-area-inset-bottom,0px))]">
      <SosRaiseButton crewId={crewId} alerting={entries.length > 0} />
    </div>
  );
}
