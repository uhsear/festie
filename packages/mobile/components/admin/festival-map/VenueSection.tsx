import { View, Text, TouchableOpacity } from 'react-native';
import SectionLabel from '../../SectionLabel';
import { LabeledTextInput } from '..';
import type { Dispatch, SetStateAction } from 'react';
import { useStyles } from './styles';
import type { ArmedTarget } from './types';

interface VenueSectionProps {
  applyVenueText: () => void;
  armVenue: () => void;
  armed: ArmedTarget;
  setVenueError: Dispatch<SetStateAction<string | null>>;
  setVenueText: Dispatch<SetStateAction<string>>;
  venue: { latitude: number; longitude: number; } | null;
  venueError: string | null;
  venueText: string;
}

export default function VenueSection({
  applyVenueText,
  armVenue,
  armed,
  setVenueError,
  setVenueText,
  venue,
  venueError,
  venueText,
}: VenueSectionProps) {
  const styles = useStyles();
  return (
    <>
      <SectionLabel>Venue</SectionLabel>
      <View style={styles.card}>
        <Text style={styles.emptyHint}>
          {venue
            ? `The map and weather use ${venue.latitude.toFixed(5)}, ${venue.longitude.toFixed(5)}.`
            : "No venue point yet. Festie looks up the location when you save the festival. If it can't find it, set the venue here."}
        </Text>
        <TouchableOpacity
          onPress={armVenue}
          style={[styles.armBtn, styles.zoneStartBtn, armed?.kind === 'venue' ? styles.armBtnActive : null]}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityState={{ selected: armed?.kind === 'venue' }}
          accessibilityLabel={armed?.kind === 'venue' ? 'Cancel setting the venue' : 'Set the venue on the map'}
        >
          <Text style={[styles.armBtnText, armed?.kind === 'venue' ? styles.armBtnTextActive : null]}>
            {armed?.kind === 'venue' ? 'Cancel' : 'Set on map'}
          </Text>
        </TouchableOpacity>
        <LabeledTextInput
          label="Venue coordinates"
          value={venueText}
          onChangeText={(v) => {
            setVenueText(v);
            setVenueError(null);
          }}
          placeholder="Paste coordinates, e.g. 28.53834, -81.37923"
          autoCapitalize="none"
          error={venueError}
        />
        <TouchableOpacity
          onPress={applyVenueText}
          disabled={venueText.trim() === ''}
          style={[styles.armBtn, styles.zoneStartBtn, venueText.trim() === '' ? styles.btnDisabled : null]}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Use these coordinates as the venue"
        >
          <Text style={styles.armBtnText}>Use</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}
