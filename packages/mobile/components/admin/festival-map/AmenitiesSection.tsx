import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  amenityGlyph,
  amenityCount,
  AMENITY_PALETTE,
  humanizeAmenityType,
} from '@festie/shared/utils';
import type { AmenityType, FestivalMapConfig } from '@festie/shared/types';
import SectionLabel from '../../SectionLabel';
import { LabeledTextInput } from '..';
import { useTokens } from '../../../hooks/useTokens';
import type { Dispatch, SetStateAction } from 'react';
import NameInput from './NameInput';
import { useStyles } from './styles';
import type { ArmedTarget } from './types';

interface AmenitiesSectionProps {
  amenityFeatures: { type: "Feature"; geometry: { type: "Point"; coordinates: [number, number]; }; properties: { id: string; amenityType: AmenityType; label: string; }; }[];
  amenityLabel: string;
  armAmenity: (amenityType: AmenityType) => void;
  armMoveAmenity: (amenityId: string) => void;
  armed: ArmedTarget;
  mapConfig: FestivalMapConfig | null;
  removeAmenityById: (amenityId: string) => void;
  renameAmenityById: (amenityId: string, label: string) => void;
  setAmenityLabel: Dispatch<SetStateAction<string>>;
}

export default function AmenitiesSection({
  amenityFeatures,
  amenityLabel,
  armAmenity,
  armMoveAmenity,
  armed,
  mapConfig,
  removeAmenityById,
  renameAmenityById,
  setAmenityLabel,
}: AmenitiesSectionProps) {
  const styles = useStyles();
  const t = useTokens();
  return (
    <>
      <SectionLabel>Amenities</SectionLabel>
      <View style={styles.card}>
        <Text style={styles.emptyHint}>
          Pick a type, optionally name it, then tap the map to drop it. {amenityCount(mapConfig)} placed.
        </Text>
        <LabeledTextInput
          label="Label (optional)"
          value={amenityLabel}
          onChangeText={setAmenityLabel}
          placeholder="e.g. North water station"
          autoCapitalize="sentences"
          hint="Used for the marker's popup. Blank uses the type name."
        />
        <View style={styles.palette}>
          {AMENITY_PALETTE.map((type) => {
            const { glyph, color } = amenityGlyph(type);
            const isArmed = armed?.kind === 'amenity' && armed.amenityType === type;
            return (
              <TouchableOpacity
                key={type}
                onPress={() => armAmenity(type)}
                style={[styles.paletteItem, isArmed ? { borderColor: color, borderWidth: 2 } : null]}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityState={{ selected: isArmed }}
                accessibilityLabel={`${isArmed ? 'Cancel placing' : 'Place'} ${humanizeAmenityType(type)}`}
              >
                <View style={[styles.paletteGlyph, { backgroundColor: color }]}>
                  <Text style={styles.paletteGlyphText}>{glyph}</Text>
                </View>
                <Text style={styles.paletteLabel} numberOfLines={1}>
                  {humanizeAmenityType(type)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Placed amenities list (remove individual markers). */}
        {amenityFeatures.length > 0 ? (
          <View style={styles.placedList}>
            {amenityFeatures.map((f) => {
              const { glyph, color } = amenityGlyph(f.properties.amenityType);
              return (
                <View key={f.properties.id} style={styles.placedRow}>
                  <View style={[styles.placedGlyph, { backgroundColor: color }]}>
                    <Text style={styles.paletteGlyphText}>{glyph}</Text>
                  </View>
                  <NameInput
                    label={f.properties.label}
                    value={f.properties.label}
                    onCommit={(v) => renameAmenityById(f.properties.id, v)}
                  />
                  <TouchableOpacity
                    onPress={() => armMoveAmenity(f.properties.id)}
                    style={styles.moveBtn}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityState={{
                      selected: armed?.kind === 'move-amenity' && armed.id === f.properties.id,
                    }}
                    accessibilityLabel={`Move ${f.properties.label}`}
                  >
                    <Text style={styles.armBtnText}>
                      {armed?.kind === 'move-amenity' && armed.id === f.properties.id ? 'Cancel' : 'Move'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => removeAmenityById(f.properties.id)}
                    style={styles.miniBtn}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${f.properties.label}`}
                  >
                    <Ionicons name="close" size={t.iconSize.sm} color={t.colors.accent.coral} />
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        ) : null}
      </View>
    </>
  );
}
