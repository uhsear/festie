import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Priority } from '@festie/shared/types';
import { BULK_SCOPE_LABEL, type BulkPickGroup } from '@festie/shared/utils';
import { PRIORITY_SYMBOLS } from '@festie/shared/constants';
import { useTokens, MAX_FONT_SCALE } from '../../hooks/useTokens';
import { useHaptics } from '../../hooks/useHaptics';
import { priorityColor } from '../../lib/priorityColor';
import { priorityIconName } from '../../lib/prioritySymbol';
import type { Dispatch, SetStateAction } from 'react';
import SpotifyAttribution from '../SpotifyAttribution';
import BulkPill from './BulkPill';
import { useStyles } from './styles';

const PRIORITY_CHOICES: readonly { value: Priority; label: string }[] = [
  { value: 'must', label: PRIORITY_SYMBOLS.must.short },
  { value: 'want-to-see', label: PRIORITY_SYMBOLS['want-to-see'].short },
  { value: 'maybe', label: PRIORITY_SYMBOLS.maybe.short },
];

interface PicksBulkPanelProps {
  bulkBusyKey: string | null;
  bulkOpen: boolean;
  bulkPriority: Priority;
  genreAttribution: { href: string } | null;
  genreGroups: BulkPickGroup[];
  handleBulkApply: (group: BulkPickGroup) => void;
  setBulkOpen: Dispatch<SetStateAction<boolean>>;
  setBulkPriority: Dispatch<SetStateAction<Priority>>;
  stageGroups: BulkPickGroup[];
}

export default function PicksBulkPanel({
  bulkBusyKey,
  bulkOpen,
  bulkPriority,
  genreAttribution,
  genreGroups,
  handleBulkApply,
  setBulkOpen,
  setBulkPriority,
  stageGroups,
}: PicksBulkPanelProps) {
  const styles = useStyles();
  const t = useTokens();
  const haptics = useHaptics();
  return (
<View style={styles.bulkPanel}>
  <TouchableOpacity
    style={styles.bulkHeader}
    onPress={() => {
      haptics.tap();
      setBulkOpen((v) => !v);
    }}
    activeOpacity={0.8}
    accessibilityRole="button"
    accessibilityState={{ expanded: bulkOpen }}
    accessibilityLabel="Bulk add picks for all days"
  >
    <Ionicons name="add-circle-outline" size={16} color={t.colors.accent.aqua} />
    <Text style={styles.bulkHeaderText} maxFontSizeMultiplier={MAX_FONT_SCALE}>{`Bulk add picks · ${BULK_SCOPE_LABEL}`}</Text>
    <Ionicons
      name={bulkOpen ? 'chevron-up' : 'chevron-down'}
      size={16}
      color={t.colors.text.muted}
      style={styles.bulkChevron}
    />
  </TouchableOpacity>

  {bulkOpen && (
    <View style={styles.bulkBody}>
      <View
        style={styles.bulkPriorityRow}
        accessibilityRole="radiogroup"
        accessibilityLabel="Priority for bulk add"
      >
        <Text style={styles.bulkSubLabel} maxFontSizeMultiplier={MAX_FONT_SCALE}>Add as</Text>
        {PRIORITY_CHOICES.map((p) => {
          const active = bulkPriority === p.value;
          return (
            <TouchableOpacity
              key={p.value}
              onPress={() => {
                haptics.select();
                setBulkPriority(p.value);
              }}
              activeOpacity={0.8}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${p.label} priority${active ? ', selected' : ''}`}
              style={[styles.bulkChip, active && styles.bulkChipActive]}
            >
              <Ionicons name={priorityIconName(p.value)} size={t.iconSize.xs} color={priorityColor(t, p.value)} />
              <Text style={[styles.bulkChipText, active && styles.bulkChipTextActive]} maxFontSizeMultiplier={MAX_FONT_SCALE}>{p.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {stageGroups.length > 0 && (
        <View style={styles.bulkGroup}>
          <Text style={styles.bulkSubLabel} maxFontSizeMultiplier={MAX_FONT_SCALE}>By stage</Text>
          <View style={styles.bulkPillRow}>
            {stageGroups.map((g) => (
              <BulkPill
                key={g.key}
                label={g.label}
                count={g.setIds.length}
                busy={bulkBusyKey === g.key}
                disabled={!!bulkBusyKey}
                onPress={() => handleBulkApply(g)}
              />
            ))}
          </View>
        </View>
      )}

      {genreGroups.length > 0 && (
        <View style={styles.bulkGroup}>
          <Text style={styles.bulkSubLabel} maxFontSizeMultiplier={MAX_FONT_SCALE}>By genre</Text>
          <View style={styles.bulkPillRow}>
            {genreGroups.map((g) => (
              <BulkPill
                key={g.key}
                label={g.label}
                count={g.setIds.length}
                busy={bulkBusyKey === g.key}
                disabled={!!bulkBusyKey}
                onPress={() => handleBulkApply(g)}
              />
            ))}
          </View>
          {genreAttribution ? <SpotifyAttribution href={genreAttribution.href} /> : null}
        </View>
      )}
    </View>
  )}
</View>
  );
}
