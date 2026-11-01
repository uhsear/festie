import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import * as Location from 'expo-location';
import { raiseSos, sosErrorMessage, type SosPosition } from '@festie/shared/services';
import { useHaptics } from './useHaptics';

/**
 * Confirm-gated SOS raise, shared by the Crew tab, the map and Find. The
 * location fix is bounded: seed from the cached last-known position (instant)
 * and race a fresh reading against a 4s timeout, so a slow or denied GPS never
 * delays the alert. SOS is online-only; a failed send is surfaced, never queued.
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
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.granted) {
        const seed = await Location.getLastKnownPositionAsync();
        const fresh = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
        ]);
        const pos = fresh ?? seed;
        if (pos) {
          position = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? undefined,
            capturedAt: new Date(pos.timestamp).toISOString(),
          };
        }
      }
    } catch {
      // No location — still raise the SOS (the alert + push are the priority).
    }
    try {
      await raiseSos(crewId, position ? { position } : {});
      // The sos:raised broadcast populates the banner for the whole crew (incl. us).
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
