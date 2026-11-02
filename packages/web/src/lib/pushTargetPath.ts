import { useCrewStore, useFestivalStore } from '@festie/shared/stores';
import type { InboxItem } from '@festie/shared/stores/inboxStore';
import { resolvePushTarget, type PushTarget } from '@festie/shared/utils/pushTarget';

export interface PushTargetPath {
  to: string;
  search?: Record<string, string>;
  external?: boolean;
}

const SCREEN_PATHS: Record<string, string> = {
  picks: '/picks',
  compare: '/compare',
  wrap: '/wrap',
  rate: '/rate',
  'crew-plan': '/crew-plan',
  'festival-mode': '/festival-mode',
  grid: '/grid',
  timeline: '/timeline',
  map: '/map',
  find: '/crew',
  'plan-share': '/crew',
};

export function pushTargetPath(target: PushTarget): PushTargetPath {
  switch (target.kind) {
    case 'set':
      return { to: `/set/${target.setId}` };
    case 'festival':
      return { to: '/' };
    case 'crew':
      return target.sosUserId ? { to: '/crew', search: { sos: target.sosUserId } } : { to: '/crew' };
    case 'join':
      return { to: `/join/${target.code}`, external: true };
    case 'screen': {
      if (target.screen === 'privacy') return { to: '/privacy.html', external: true };
      const to = SCREEN_PATHS[target.screen] ?? '/';
      const withFestival = (target.screen === 'wrap' || target.screen === 'rate') && target.festivalId;
      return withFestival ? { to, search: { festival: target.festivalId as string } } : { to };
    }
  }
}

type Navigate = (opts: { to: string; search?: Record<string, string> }) => unknown;

/** Opens the place the push for this inbox row would open. */
export function openInboxItem(item: InboxItem, navigate: Navigate): void {
  const { crewId } = item.data;
  if (item.type === 'crew_sos' && crewId && useCrewStore.getState().activeCrew?.id !== crewId) {
    useCrewStore
      .getState()
      .selectCrew(crewId)
      .catch((e: unknown) => console.warn('inbox: crew switch failed', e));
  }

  const target = resolvePushTarget(item.data);
  if (!target) return;

  if (target.kind === 'festival') {
    (async () => {
      const store = useFestivalStore.getState();
      if (!store.festivals?.length) await store.loadFestivals();
      await useFestivalStore.getState().selectFestival(target.festivalId);
    })().catch((e: unknown) => console.warn('Could not open the festival from the inbox', e));
  }

  const { to, search, external } = pushTargetPath(target);
  if (external) {
    window.location.assign(to);
    return;
  }
  navigate(search ? { to, search } : { to });
}
