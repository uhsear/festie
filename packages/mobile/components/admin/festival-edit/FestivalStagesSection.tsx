import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import SectionLabel from '../../SectionLabel';
import { LabeledTextInput, HexColorField } from '..';
import { useTokens } from '../../../hooks/useTokens';
import { type StageRow, type FormState } from '../../../app/admin/festivalEditState';
import { amenityCount } from '@festie/shared/utils';
import { useStyles } from './styles';

/** True when a stage row carries a finite lat/lng pin. */
function stageIsPinned(s: StageRow): boolean {
  return typeof s.latitude === 'number' && typeof s.longitude === 'number';
}

interface FestivalStagesSectionProps {
  addStage: () => void;
  editingId: string | null;
  fieldIssuesOf: (keys: string[], fields: string[]) => string | null;
  form: FormState;
  goToMapEditor: (stageId?: string) => void;
  issuesByKey: Map<string, string[]>;
  removeStage: (stageId: string) => void;
  setStageField: (stageId: string, field: "name" | "color", value: string) => void;
  stageKeys: (stage: StageRow, index: number) => string[];
}

export default function FestivalStagesSection({
  addStage,
  editingId,
  fieldIssuesOf,
  form,
  goToMapEditor,
  issuesByKey,
  removeStage,
  setStageField,
  stageKeys,
}: FestivalStagesSectionProps) {
  const styles = useStyles();
  const t = useTokens();
  return (
    <>
      <SectionLabel>Stages</SectionLabel>
      <View style={styles.card}>
        {form.stages.length === 0 ? (
          <Text style={styles.emptyHint}>No stages yet. Add one below.</Text>
        ) : (
          form.stages.map((stage, stageIndex) => (
            <View
              key={stage.id}
              style={[styles.stageBlock, stageKeys(stage, stageIndex).some((k) => issuesByKey.has(k)) && styles.blockError]}
            >
              <View style={styles.stageHeader}>
                <Text style={styles.stageHeaderText}>Stage</Text>
                <TouchableOpacity
                  onPress={() => removeStage(stage.id)}
                  style={styles.removeBtn}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${stage.name || 'stage'}`}
                >
                  <Ionicons name="trash-outline" size={t.iconSize.sm} color={t.colors.accent.coral} />
                  <Text style={styles.removeBtnText}>Remove</Text>
                </TouchableOpacity>
              </View>
              <LabeledTextInput
                label="Name"
                value={stage.name}
                onChangeText={(v) => setStageField(stage.id, 'name', v)}
                placeholder="Main Stage"
                autoCapitalize="words"
                error={fieldIssuesOf(stageKeys(stage, stageIndex), ['name'])}
              />
              <HexColorField
                label="Color"
                value={stage.color}
                onChangeText={(v) => setStageField(stage.id, 'color', v)}
              />
              {/* Pin status. Locations are AUTHORED on the map editor (it has
                  the actual map); here we only surface whether this stage is
                  pinned and link across to set/move it. */}
              <View style={styles.locationRow}>
                <Ionicons
                  name={stageIsPinned(stage) ? 'location' : 'location-outline'}
                  size={t.iconSize.sm}
                  color={stageIsPinned(stage) ? t.colors.accent.aqua : t.colors.text.muted}
                />
                <Text style={styles.locationText} numberOfLines={1}>
                  {stageIsPinned(stage)
                    ? `Pinned · ${stage.latitude!.toFixed(5)}, ${stage.longitude!.toFixed(5)}`
                    : 'No location pinned'}
                </Text>
                {editingId ? (
                  <TouchableOpacity
                    onPress={() => goToMapEditor(stage.id)}
                    style={styles.locationBtn}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Set location for ${stage.name || 'stage'} on the map`}
                  >
                    <Text style={styles.locationBtnText}>{stageIsPinned(stage) ? 'Move' : 'Set location'}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          ))
        )}
        <TouchableOpacity
          onPress={addStage}
          style={styles.addBtn}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Add stage"
        >
          <Ionicons name="add" size={t.iconSize.md} color={t.colors.accent.aqua} />
          <Text style={styles.addBtnText}>Add stage</Text>
        </TouchableOpacity>
        {/* Map editor link (edit only — the map screen loads the festival by
            id and persists stage pins + amenities itself). */}
        {editingId ? (
          <TouchableOpacity
            onPress={() => goToMapEditor()}
            style={styles.toolBtn}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Edit festival map"
          >
            <Ionicons name="map-outline" size={t.iconSize.md} color={t.colors.accent.aqua} />
            <Text style={styles.toolBtnText}>
              Edit map{amenityCount(form.mapConfig) > 0 ? ` · ${amenityCount(form.mapConfig)} amenities` : ''}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </>
  );
}
