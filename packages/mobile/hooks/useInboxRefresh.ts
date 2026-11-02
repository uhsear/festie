import { useEffect } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useAuthStore, useInboxStore, useUIStore } from '@festie/shared/stores';

/** Keep the inbox count fresh: on mount, on app resume, and when a push arrives while the app is open. */
export function useInboxRefresh() {
  const userId = useAuthStore((s) => s.user?.id);
  const offlineMode = useUIStore((s) => s.offlineMode);

  useEffect(() => {
    if (!userId || offlineMode) return;
    const load = () => {
      useInboxStore.getState().load().catch((e) => console.warn('inbox: refresh failed', e));
    };
    load();
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') load();
    });
    const received = Notifications.addNotificationReceivedListener(load);
    return () => {
      appState.remove();
      received.remove();
    };
  }, [userId, offlineMode]);
}
