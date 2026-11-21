import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { zoneCount, ZONE_PALETTE, type MapZone } from '@festie/shared/utils';
import type { FestivalMapConfig } from '@festie/shared/types';
import SectionLabel from '../../SectionLabel';
import { LabeledTextInput } from '..';
import { useTokens } from '../../../hooks/useTokens';
import type { Dispatch, SetStateAction } from 'react';
import NameInput from './NameInput';
import { useStyles } from './styles';
import type { ArmedTarget, Vertex } from './types';

interface ZonesSectionProps {
  armMoveZone: (zoneId: string) => void;
  armed: ArmedTarget;
  cancelZone: () => void;
  draftVertices: Vertex[];
  finishZone: () => void;
  isDrawingZone: boolean;
  mapConfig: FestivalMapConfig | null;
  placedZones: MapZone[];
  removeZoneById: (zoneId: string) => void;
  renameZoneById: (zoneId: string, label: string) => void;
  setZoneColor: Dispatch<SetStateAction<string>>;
  setZoneLabel: Dispatch<SetStateAction<string>>;
  startZone: () => void;
  undoVertex: () => void;
  zoneColor: string;
  zoneLabel: string;
}

export default function ZonesSection({
  armMoveZone,
  armed,
  cancelZone,
  draftVertices,
  finishZone,
  isDrawingZone,
  mapConfig,
  placedZones,
  removeZoneById,
  renameZoneById,
  setZoneColor,
  setZoneLabel,
  startZone,
  undoVertex,
  zoneColor,
  zoneLabel,
}: ZonesSectionProps) {
  const styles = useStyles();
  const t = useTokens();
  return (
    <>
      <SectionLabel>Zones</SectionLabel>
      <View style={styles.card}>
        <Text style={styles.emptyHint}>
          Pick a color, name the area, then tap the map to drop points. Finish with 3 or more.{' '}
          {zoneCount(mapConfig)} drawn.
        </Text>
        <LabeledTextInput
          label="Zone name"
          value={zoneLabel}
          onChangeText={setZoneLabel}
          placeholder="e.g. Camping, VIP, No-go"
          autoCapitalize="sentences"
          hint="Shown as the zone's label tag."
        />
        <View style={styles.palette}>
          {ZONE_PALETTE.map((preset) => {
            const selected = zoneColor === preset.color;
            return (
              <TouchableOpacity
                key={preset.color}
                onPress={() => {
                  setZoneColor(preset.color);
                  if (!zoneLabel.trim()) setZoneLabel(preset.label);
                }}
                style={[styles.paletteItem, selected ? { borderColor: preset.color, borderWidth: 2 } : null]}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`Use ${preset.label} color`}
              >
                <View style={[styles.zoneSwatch, { backgroundColor: preset.color }]} />
                <Text style={styles.paletteLabel} numberOfLines={1}>
                  {preset.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {isDrawingZone ? (
          <View style={styles.zoneControls}>
            <Text style={styles.zonePointCount}>
              {draftVertices.length} {draftVertices.length === 1 ? 'point' : 'points'}
            </Text>
            <TouchableOpacity
              onPress={undoVertex}
              disabled={draftVertices.length === 0}
              style={[styles.zoneBtn, draftVertices.length === 0 ? styles.btnDisabled : null]}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Undo last zone point"
            >
              <Text style={styles.zoneBtnText}>Undo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={finishZone}
              disabled={draftVertices.length < 3}
              style={[styles.zoneBtnPrimary, draftVertices.length < 3 ? styles.btnDisabled : null]}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Finish zone"
            >
              <Text style={styles.zoneBtnPrimaryText}>Finish</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={cancelZone}
              style={styles.zoneBtnDanger}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Cancel drawing this zone"
            >
              <Text style={styles.zoneBtnDangerText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            onPress={startZone}
            style={[styles.armBtn, styles.zoneStartBtn]}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Draw a zone"
          >
            <Text style={styles.armBtnText}>Draw a zone</Text>
          </TouchableOpacity>
        )}

        {placedZones.length > 0 ? (
          <View style={styles.placedList}>
            {placedZones.map((z) => (
              <View key={z.id} style={styles.placedRow}>
                <View style={[styles.zoneSwatch, { backgroundColor: z.color }]} />
                <NameInput label={z.label || 'zone'} value={z.label} onCommit={(v) => renameZoneById(z.id, v)} />
                <TouchableOpacity
                  onPress={() => armMoveZone(z.id)}
                  style={styles.moveBtn}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityState={{ selected: armed?.kind === 'move-zone' && armed.id === z.id }}
                  accessibilityLabel={`Move ${z.label || 'zone'}`}
                >
                  <Text style={styles.armBtnText}>
                    {armed?.kind === 'move-zone' && armed.id === z.id ? 'Cancel' : 'Move'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => removeZoneById(z.id)}
                  style={styles.miniBtn}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${z.label || 'zone'}`}
                >
                  <Ionicons name="close" size={t.iconSize.sm} color={t.colors.accent.coral} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </>
  );
}
