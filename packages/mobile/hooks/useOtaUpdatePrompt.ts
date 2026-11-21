import { useEffect, useRef } from 'react';
import { Alert, AppState } from 'react-native';
import * as Updates from 'expo-updates';

/** A foreground that follows the last check by less than this does not check again. */
const CHECK_INTERVAL_MS = 10 * 60_000;

/**
 * Tells the user when an OTA update has downloaded and offers to restart into it. expo-updates fetches
 * on launch, so without this a hotfix only applies on the second cold start. Coming back to the
 * foreground also checks, so a long-lived session picks up a hotfix too. Does nothing where updates
 * are off (dev client, Expo Go).
 */
export function useOtaUpdatePrompt(): { updateReady: boolean } {
  const { isUpdatePending } = Updates.useUpdates();
  const prompted = useRef(false);
  const lastCheckAt = useRef(0);

  useEffect(() => {
    if (!isUpdatePending || prompted.current) return;
    prompted.current = true;
    Alert.alert('Update ready', 'Restart Festie to get the latest fixes.', [
      { text: 'Later', style: 'cancel' },
      {
        text: 'Restart now',
        onPress: () => {
          Updates.reloadAsync().catch((err: unknown) => console.warn('ota: restart failed', err));
        },
      },
    ]);
  }, [isUpdatePending]);

  useEffect(() => {
    if (!Updates.isEnabled) return;
    const check = async () => {
      const now = Date.now();
      if (now - lastCheckAt.current < CHECK_INTERVAL_MS) return;
      lastCheckAt.current = now;
      try {
        const result = await Updates.checkForUpdateAsync();
        if (result.isAvailable) await Updates.fetchUpdateAsync();
      } catch (err) {
        console.warn('ota: update check failed', err);
      }
    };
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    return () => sub.remove();
  }, []);

  return { updateReady: isUpdatePending };
}
