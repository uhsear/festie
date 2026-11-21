import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import SectionLabel from '../../SectionLabel';
import { useTokens } from '../../../hooks/useTokens';
import type { Dispatch, SetStateAction } from 'react';
import { useStyles } from './styles';
import type { ArmedTarget, StageEdit } from './types';

interface StageLocationsSectionProps {
  armStage: (stageId: string) => void;
  armed: ArmedTarget;
  clearStagePin: (stageId: string) => void;
  goToFestivalEditor: () => void;
  setShowLeaveConfirm: Dispatch<SetStateAction<boolean>>;
  stages: StageEdit[];
  touched: boolean;
}

export default function StageLocationsSection({
  armStage,
  armed,
  clearStagePin,
  goToFestivalEditor,
  setShowLeaveConfirm,
  stages,
  touched,
}: StageLocationsSectionProps) {
  const styles = useStyles();
  const t = useTokens();
  return (
    <>
      <SectionLabel>Stage locations</SectionLabel>
      <View style={styles.card}>
        {stages.length === 0 ? (
          <>
            <Text style={styles.emptyHint}>This festival has no stages yet.</Text>
            <TouchableOpacity
              onPress={() => (touched ? setShowLeaveConfirm(true) : goToFestivalEditor())}
              style={[styles.armBtn, styles.zoneStartBtn]}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Add stages in the festival editor"
            >
              <Text style={styles.armBtnText}>Add stages</Text>
            </TouchableOpacity>
          </>
        ) : (
          stages.map((stage) => {
            const pinned = typeof stage.latitude === 'number' && typeof stage.longitude === 'number';
            const isArmed = armed?.kind === 'stage' && armed.stageId === stage.id;
            return (
              <View key={stage.id} style={styles.stageRow}>
                <View style={[styles.swatch, { backgroundColor: stage.color }]} />
                <View style={styles.stageBody}>
                  <Text style={styles.stageName} numberOfLines={1}>
                    {stage.name || 'Untitled stage'}
                  </Text>
                  <Text style={styles.stageCoord} numberOfLines={1}>
                    {pinned ? `${stage.latitude!.toFixed(5)}, ${stage.longitude!.toFixed(5)}` : 'No location'}
                  </Text>
                </View>
                {pinned ? (
                  <TouchableOpacity
                    onPress={() => clearStagePin(stage.id)}
                    style={styles.miniBtn}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Clear ${stage.name || 'stage'} location`}
                  >
                    <Ionicons name="trash-outline" size={t.iconSize.sm} color={t.colors.accent.coral} />
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  onPress={() => armStage(stage.id)}
                  style={[styles.armBtn, isArmed ? styles.armBtnActive : null]}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isArmed }}
                  accessibilityLabel={
                    isArmed
                      ? 'Cancel placing this stage'
                      : `${pinned ? 'Move' : 'Set'} ${stage.name || 'stage'} location`
                  }
                >
                  <Text style={[styles.armBtnText, isArmed ? styles.armBtnTextActive : null]}>
                    {isArmed ? 'Cancel' : pinned ? 'Move' : 'Set'}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })
        )}
      </View>
    </>
  );
}
