import { useCallback, useState } from 'react';
import { Alert, Linking, Share } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useFestivalDataStore, useUIStore } from '@festie/shared/stores';
import { buildPicksIcsExport, describeIcsExport } from '@festie/shared/utils';
import { CALENDAR_LINK_COPY } from '@festie/shared/constants';
import { mapErrorToUserMessage, fetchCalendarLinks } from '@festie/shared/services';
import { useHaptics } from './useHaptics';

/** Calendar export for the Picks tab: a one-off .ics file or the live subscription feed. */
export function usePicksCalendar() {
  const haptics = useHaptics();
  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
  const currentProfile = useFestivalDataStore((s) => s.currentProfile);
  const sets = useFestivalDataStore((s) => s.sets);
  const stages = useFestivalDataStore((s) => s.stages);
  const [exportBusy, setExportBusy] = useState(false);

  // Export the user's picks to a .ics the OS can import into any calendar app.
  // Built fully client-side from the already-loaded store data (no server call,
  // works offline) and shared via the OS sheet — same write/share flow as the
  // account data export.
  const handleDownloadCalendar = useCallback(async () => {
    if (!currentFestival || !currentProfile || exportBusy) return;
    setExportBusy(true);
    try {
      const result = buildPicksIcsExport({
        festival: {
          id: currentFestival.id,
          name: currentFestival.name,
          location: currentFestival.location,
          timeZone: currentFestival.timeZone,
        },
        sets,
        stages,
        picks: currentProfile.picks,
        notes: currentProfile.notes,
        reminders: currentProfile.reminders,
      });
      const ics = result.ics;
      const safeName = (currentFestival.name || 'festival').replace(/[^a-z0-9_-]/gi, '_').slice(0, 60);
      const file = new File(Paths.cache, `${safeName}_picks.ics`);
      file.create({ overwrite: true });
      file.write(ics);
      if (await Sharing.isAvailableAsync()) {
        haptics.success();
        await Sharing.shareAsync(file.uri, {
          mimeType: 'text/calendar',
          UTI: 'com.apple.ical.ics',
          dialogTitle: 'Add picks to calendar',
        });
        useUIStore.getState().showToast(describeIcsExport(result), { kind: 'success' });
      } else {
        Alert.alert('Sharing unavailable', 'Calendar sharing is not available on this device.');
      }
    } catch (e) {
      haptics.warning();
      Alert.alert("Couldn't export picks", mapErrorToUserMessage(e, 'Try again.'));
    } finally {
      setExportBusy(false);
    }
  }, [currentFestival, currentProfile, sets, stages, exportBusy, haptics]);

  // Subscribe to the live feed: webcal:// opens the iOS Calendar subscribe prompt.
  // Android has no webcal handler, so the open rejects and Google Calendar's
  // add-by-URL page takes over. No scheme probe: on iOS that needs a native plist entry.
  const handleSubscribeCalendar = useCallback(async () => {
    if (!currentFestival) return;
    let links: Awaited<ReturnType<typeof fetchCalendarLinks>>;
    try {
      links = await fetchCalendarLinks(currentFestival.id);
    } catch {
      haptics.warning();
      useUIStore
        .getState()
        .showToast("Couldn't get your calendar link. Check your connection and try again.", { kind: 'error' });
      return;
    }
    const openInCalendar = async () => {
      try {
        await Linking.openURL(links.webcalUrl);
      } catch {
        Linking.openURL(links.googleUrl).catch(() => {
          haptics.warning();
          useUIStore.getState().showToast("Couldn't open your calendar. Try Download once.", { kind: 'error' });
        });
      }
    };
    // The link is a bearer link, so say so before it leaves the app. An Android alert shows three buttons at most.
    Alert.alert(
      'Your calendar link',
      CALENDAR_LINK_COPY.privacy,
      [
        { text: 'Open in calendar', onPress: () => void openInCalendar() },
        {
          text: 'Share or copy link',
          onPress: () => void Share.share({ message: links.httpsUrl, url: links.httpsUrl }).catch(() => undefined),
        },
        { text: 'Cancel', style: 'cancel' },
      ],
      { cancelable: true },
    );
  }, [currentFestival, haptics]);

  const handleAddToCalendar = useCallback(() => {
    haptics.tap();
    Alert.alert(
      'Add to calendar',
      'Subscribe keeps your calendar up to date when set times change. Download once saves a file that does not update.',
      [
        { text: 'Subscribe (stays up to date)', onPress: () => void handleSubscribeCalendar() },
        { text: 'Download once', onPress: () => void handleDownloadCalendar() },
        { text: 'Cancel', style: 'cancel' },
      ],
      { cancelable: true },
    );
  }, [haptics, handleSubscribeCalendar, handleDownloadCalendar]);

  return { exportBusy, handleAddToCalendar };
}
