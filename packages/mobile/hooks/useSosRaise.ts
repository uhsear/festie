import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import * as Location from 'expo-location';
import { raiseSos, sosErrorMessage, type SosPosition } from '@festie/shared/services';
import { resolveSosPosition } from './sosPosition';
import { useHaptics } from './useHaptics';

/**
 * Confirm-gated SOS raise, shared by the Crew tab, the map and Find. The
 * location fix is bounded: each step (permission, cached last-known seed, fresh
 * reading) has its own timeout and the seed is the fallback, so a slow or denied
 * GPS never delays the alert. SOS is online-only; a failed send is surfaced, never queued.
 */
export function useSosRaise(crewId: string | null) {
  const haptics = useHaptics();
  const [raising, setRaising] = useState(false);

  const doRaise = useCallback(async () => {
    if (!crewId || raising) return;
    setRaising(true);
    haptics.heavy();
    let position: SosPosition | undefined;
    try {
      // The permission prompt gets a long budget (a first-time user may take a
      // while); the cached seed and the fresh read are short and independent,
      // so a hung fresh read still falls back to the seed.
      position = await resolveSosPosition(
        {
          requestPermission: async () => (await Location.requestForegroundPermissionsAsync()).granted,
          getLastKnown: () => Location.getLastKnownPositionAsync(),
          getCurrent: () => Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        },
        { permissionMs: 30000, seedMs: 1000, freshMs: 4000 },
      );
    } catch {
      // No location — still raise the SOS (the alert + push are the priority).
    }
    try {
      await raiseSos(crewId, position ? { position } : {});
      // The sos:raised broadcast populates the banner for the whole crew (incl. us).
      if (!position) {
        Alert.alert('SOS sent without your location', 'We could not get a location fix. Your crew was alerted; tell them where you are.');
      }
    } catch (err) {
      Alert.alert('SOS not sent', sosErrorMessage(err, 'send'));
    } finally {
      setRaising(false);
    }
  }, [crewId, raising, haptics]);

  const confirmRaise = useCallback(() => {
    if (!crewId) return;
    Alert.alert(
      'Send an SOS to your crew?',
      'Everyone in this crew gets an alert with your last location so they can find you. Use this for emergencies.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send SOS', style: 'destructive', onPress: () => void doRaise() },
      ],
    );
  }, [crewId, doRaise]);

  return { confirmRaise, raising };
}
