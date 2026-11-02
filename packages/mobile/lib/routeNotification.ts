import type { useRouter } from 'expo-router';
import { useCrewStore, useFestivalStore, useLiveLocationStore } from '@festie/shared/stores';
import { resolvePushTarget } from '@festie/shared/utils';
import { CREW_MEET_HREF, sosPushCrewId } from './dayOfRoutes';
import { pushTargetHref } from './pushRoutes';

// Route a tapped notification's data payload to its deep-link target. Shared by
// the warm-tap listener and the cold-start useLastNotificationResponse handler
// so both paths route identically.
export function routeNotification(
  r: Pick<ReturnType<typeof useRouter>, 'push'>,
  data: Record<string, unknown> | undefined,
) {
  const sosCrewId = sosPushCrewId(data);
  if (sosCrewId) {
    // Open that crew's Find tab, where CrewSos shows the banner with "Get directions".
    if (sosCrewId !== useCrewStore.getState().activeCrew?.id) {
      useCrewStore.getState().selectCrew(sosCrewId).catch(() => {});
    } else {
      void useLiveLocationStore.getState().loadActiveSos(sosCrewId);
    }
    r.push(CREW_MEET_HREF);
    return;
  }
  const target = resolvePushTarget(data);
  if (!target) return;
  if (target.kind === 'festival') useFestivalStore.getState().selectFestival(target.festivalId).catch(() => {});
  r.push(pushTargetHref(target));
}
