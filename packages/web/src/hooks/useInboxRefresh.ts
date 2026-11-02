import { useEffect } from 'react';
import { useAuthStore } from '@festie/shared/stores/authStore';
import { useInboxStore } from '@festie/shared/stores/inboxStore';
import { useUIStore } from '@festie/shared/stores/uiStore';

/** Loads the inbox on mount and whenever the tab becomes visible again. */
export function useInboxRefresh(): void {
  const signedIn = useAuthStore((s) => !!s.user);

  useEffect(() => {
    if (!signedIn) return;
    const refresh = () => {
      if (useUIStore.getState().offlineMode) return;
      void useInboxStore.getState().load();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [signedIn]);
}
