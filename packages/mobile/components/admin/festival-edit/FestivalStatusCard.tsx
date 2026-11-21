import { View, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTokens } from '../../../hooks/useTokens';
import { type ChecklistItem } from '@festie/shared/utils';
import type { Dispatch, SetStateAction } from 'react';
import { useStyles } from './styles';

const CHECK_PREFIX = { done: 'Done', todo: 'To do', warn: 'Warning' } as const;

interface FestivalStatusCardProps {
  canPublish: boolean;
  checklist: ChecklistItem[];
  editingId: string | null;
  goToMapEditor: (stageId?: string) => void;
  publishHint: "Save your changes first." | "Finish the open items first." | null;
  setConfirmPublish: Dispatch<SetStateAction<boolean>>;
  status: { state: "draft" | "published"; chip: "Draft" | "Published"; edited: string; };
}

export default function FestivalStatusCard({
  canPublish,
  checklist,
  editingId,
  goToMapEditor,
  publishHint,
  setConfirmPublish,
  status,
}: FestivalStatusCardProps) {
  const styles = useStyles();
  const t = useTokens();
  const router = useRouter();
  return (
    <View style={styles.card}>
      <View style={styles.statusRow}>
        <View style={[styles.chip, status.state === 'draft' ? styles.chipDraft : styles.chipLive]}>
          <Text style={[styles.chipText, status.state === 'draft' ? styles.chipTextDraft : styles.chipTextLive]}>
            {status.chip}
          </Text>
        </View>
        {status.edited ? <Text style={styles.statusEdited}>{status.edited}</Text> : null}
      </View>
      {status.state === 'draft' ? (
        <>
          <Text style={styles.emptyHint}>This festival is a draft. Only admins can see it.</Text>
          <View>
            <Text style={styles.checklistTitle} accessibilityRole="header">
              Before you publish
            </Text>
            <Text style={styles.emptyHint}>Based on the last save.</Text>
          </View>
          {checklist.map((item) => (
            <View key={item.key} style={styles.checkRow}>
              <Ionicons
                name={item.status === 'done' ? 'checkmark-circle' : item.status === 'todo' ? 'close-circle' : 'warning'}
                size={t.iconSize.md}
                color={
                  item.status === 'done'
                    ? t.colors.accent.aqua
                    : item.status === 'todo'
                      ? t.colors.accent.coral
                      : t.colors.accent.amber
                }
              />
              <Text style={styles.checkText} accessibilityLabel={`${CHECK_PREFIX[item.status]}: ${item.label}`}>
                {item.label}
              </Text>
              {item.key === 'sets' && item.status !== 'done' ? (
                <TouchableOpacity
                  onPress={() => router.push({ pathname: '/admin/lineup-import', params: { id: editingId } })}
                  style={styles.locationBtn}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Import lineup"
                >
                  <Text style={styles.locationBtnText}>Import lineup</Text>
                </TouchableOpacity>
              ) : null}
              {item.key === 'pins' && item.status === 'warn' ? (
                <TouchableOpacity
                  onPress={() => goToMapEditor()}
                  style={styles.locationBtn}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Edit map"
                >
                  <Text style={styles.locationBtnText}>Edit map</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ))}
          <TouchableOpacity
            onPress={() => setConfirmPublish(true)}
            style={[styles.actionBtn, styles.saveBtn, !canPublish && styles.btnDisabled]}
            activeOpacity={0.7}
            disabled={!canPublish}
            accessibilityRole="button"
            accessibilityLabel="Publish festival"
            accessibilityState={{ disabled: !canPublish }}
          >
            <Text style={styles.saveBtnText} maxFontSizeMultiplier={1.4}>
              Publish festival
            </Text>
          </TouchableOpacity>
          {publishHint ? <Text style={styles.emptyHint}>{publishHint}</Text> : null}
        </>
      ) : null}
    </View>
  );
}
