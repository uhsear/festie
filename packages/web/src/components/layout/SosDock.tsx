import { useAuthStore, useCrewStore } from '@festie/shared/stores';
import { useActiveSos } from '@festie/shared/hooks';
import SosRaiseButton from '../crew/SosRaiseButton';

/**
 * The one persistent SOS control, mounted once in the app shell so it sits in the same
 * corner on every screen. It hides while your own SOS is live (the banner carries the
 * way out) and for guests or users with no open crew.
 */
export default function SosDock() {
  const userId = useAuthStore((s) => s.user?.id);
  const crewId = useCrewStore((s) => s.activeCrew?.id);
  const entries = useActiveSos();
  if (!userId || !crewId || entries.some((e) => e.userId === userId)) return null;

  return (
    <div className="fixed right-4 z-[var(--z-sticky)] bottom-[calc(var(--bottom-nav-h,0px)+var(--sticky-bar-h,0px)+16px+env(safe-area-inset-bottom,0px))]">
      <SosRaiseButton crewId={crewId} alerting={entries.length > 0} />
    </div>
  );
}
