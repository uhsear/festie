import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  humanizeAmenityType,
  SITEPLAN_CORNER_LABELS,
  SITEPLAN_CORNER_COUNT,
  type MapZone,
} from '@festie/shared/utils';
import type { AmenityType, Festival, Stage } from '@festie/shared/types';
import OfflineMap from '../../OfflineMap';
import type { AuthoringMode } from '../../../lib/webviewBridge';
import { useTokens } from '../../../hooks/useTokens';
import { useStyles } from './styles';
import type { ArmedTarget, StageEdit, Vertex } from './types';

interface MapAuthoringPaneProps {
  amenityFeatures: { type: "Feature"; geometry: { type: "Point"; coordinates: [number, number]; }; properties: { id: string; amenityType: AmenityType; label: string; }; }[];
  armed: ArmedTarget;
  authoringMode: AuthoringMode;
  draftCorners: Vertex[];
  draftPoints: Vertex[];
  draftVertices: Vertex[];
  handleMapPress: (coord: { latitude: number; longitude: number; }) => void;
  mapFestival: Festival & { stages?: Stage[]; };
  placedZones: MapZone[];
  stages: StageEdit[];
}

export default function MapAuthoringPane({
  amenityFeatures,
  armed,
  authoringMode,
  draftCorners,
  draftPoints,
  draftVertices,
  handleMapPress,
  mapFestival,
  placedZones,
  stages,
}: MapAuthoringPaneProps) {
  const styles = useStyles();
  const t = useTokens();
  return (
    <View style={styles.mapWrap}>
      <OfflineMap
        meetingPoints={[]}
        festival={mapFestival}
        authoringMode={authoringMode}
        draftPoints={draftPoints}
        onMapPress={handleMapPress}
      />
      {armed ? (
        <View style={styles.armedBanner} pointerEvents="none">
          <Ionicons name="locate-outline" size={14} color={t.colors.text.onLightAccent} />
          <Text style={styles.armedBannerText} numberOfLines={1}>
            {armed.kind === 'venue'
              ? 'Tap the map at the venue'
              : armed.kind === 'move-amenity'
                ? `Tap the map where ${amenityFeatures.find((f) => f.properties.id === armed.id)?.properties.label ?? 'it'} should go`
                : armed.kind === 'move-zone'
                  ? `Tap the map where the centre of ${placedZones.find((z) => z.id === armed.id)?.label || 'the zone'} should go`
                  : armed.kind === 'stage'
                    ? `Tap the map to set ${stages.find((s) => s.id === armed.stageId)?.name || 'this stage'}’s location`
                    : armed.kind === 'amenity'
                      ? `Tap the map to drop a ${humanizeAmenityType(armed.amenityType)} marker`
                      : armed.kind === 'siteplan'
                        ? draftCorners.length >= SITEPLAN_CORNER_COUNT
                          ? 'All 4 corners set — apply them below'
                          : `Tap the ${SITEPLAN_CORNER_LABELS[draftCorners.length]} corner (${draftCorners.length}/${SITEPLAN_CORNER_COUNT})`
                        : `Tap the map to add zone points (${draftVertices.length} added — need 3+)`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
