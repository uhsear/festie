import { View, Text, TouchableOpacity, Share, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  MAP_COPY,
  locationPromptCopy,
  placeShareText,
  placeWalkLine,
  type Coord,
  type GeoState,
  type MapPlace,
} from '@festie/shared/utils';
import { useTokens, makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';
import Button from './Button';

interface MapPlaceCardProps {
  place: MapPlace;
  selfCoord: Coord | null;
  geoState: GeoState;
  onShowWay: () => void;
  /** Omitted when the map has no meeting-point flow (guests, admin editor). */
  onSetMeetingPoint?: (place: MapPlace) => void;
  /** The no-fix line's tap: the map starts or retries location. */
  onLocate: () => void;
  onClose: () => void;
}

/** The card a stage, amenity or meeting-point tap opens on the mobile map. */
export default function MapPlaceCard({
  place,
  selfCoord,
  geoState,
  onShowWay,
  onSetMeetingPoint,
  onLocate,
  onClose,
}: MapPlaceCardProps) {
  const t = useTokens();
  const styles = useStyles();
  const walkLine = placeWalkLine(selfCoord, place);

  const share = () => {
    Share.share({ message: placeShareText(place) }).catch((err: unknown) => console.warn('MapPlaceCard share', err));
  };

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        {/* Plain sibling lines in one column, so a later line can slot in between. */}
        <View style={styles.lines}>
          <Text style={styles.title} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header">
            {place.name}
          </Text>
          <Text style={styles.kind} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {place.kindLabel}
          </Text>
          {walkLine ? (
            <Text style={styles.walk} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {walkLine}
            </Text>
          ) : (
            <TouchableOpacity
              // A blocked permission cannot be re-prompted from here: Settings is the only way.
              onPress={geoState === 'denied' ? () => void Linking.openSettings() : onLocate}
              accessibilityRole="button" style={styles.locate}>
              <Text style={styles.locateText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {locationPromptCopy(geoState)}
              </Text>
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          onPress={onClose}
          style={styles.close}
          accessibilityRole="button"
          accessibilityLabel={MAP_COPY.close}
        >
          <Ionicons name="close" size={20} color={t.colors.text.muted} />
        </TouchableOpacity>
      </View>
      <View style={styles.actions}>
        <Button
          label={MAP_COPY.showWay}
          size="sm"
          icon="navigate"
          onPress={onShowWay}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
        />
        {onSetMeetingPoint && place.kind !== 'meeting-point' ? (
          <Button
            label={MAP_COPY.setMeetingPoint}
            size="sm"
            variant="secondary"
            onPress={() => onSetMeetingPoint(place)}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          />
        ) : null}
        <Button
          label={MAP_COPY.share}
          size="sm"
          variant="secondary"
          onPress={share}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
        />
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.bg.elevated,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 8,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.spacing[2],
  },
  lines: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    ...typeStyle('body', 700),
    color: t.colors.text.primary,
  },
  kind: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  walk: {
    ...typeStyle('caption', 600),
    color: t.colors.text.primary,
  },
  locate: {
    minHeight: 44,
    justifyContent: 'center',
  },
  locateText: {
    ...typeStyle('caption', 600),
    color: t.colors.accent.aqua,
  },
  close: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
}));
