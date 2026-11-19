import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { CrewMember } from '@festie/shared/types';
import { crewCopy, FESTIE_ORIGIN, memberAvatarUrl } from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE } from '../hooks/useTokens';
import Avatar from './Avatar';
import Button from './Button';
import SheetShell from './SheetShell';

interface HandOverSheetProps {
  visible: boolean;
  crewName: string;
  candidates: CrewMember[];
  busy: boolean;
  onConfirm: (newOwnerId: string) => void;
  onClose: () => void;
}

/** Owner picks who takes over the crew before leaving it. The first candidate is preselected. */
export default function HandOverSheet({ visible, crewName, candidates, busy, onConfirm, onClose }: HandOverSheetProps) {
  const t = useTokens();
  const styles = useStyles();
  const firstId = candidates[0]?.userId ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(firstId);

  // A stale pick (member left, or a different crew) falls back to the first candidate.
  const picked = candidates.some((m) => m.userId === selectedId) ? selectedId : firstId;
  const close = () => {
    setSelectedId(firstId);
    onClose();
  };

  return (
    <SheetShell visible={visible} onClose={close} backdropLabel="Close hand over" maxHeight="80%">
      <Text style={styles.title} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {crewCopy.handOverTitle(crewName)}
      </Text>
      <Text style={styles.body} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {crewCopy.handOverBody}
      </Text>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {candidates.map((m) => {
          const checked = m.userId === picked;
          const label = m.name || m.username || 'Member';
          return (
            <Pressable
              key={m.userId}
              style={[styles.row, checked && styles.rowChecked]}
              onPress={() => setSelectedId(m.userId)}
              disabled={busy}
              accessibilityRole="radio"
              accessibilityState={{ checked, disabled: busy }}
              accessibilityLabel={label}
            >
              <Avatar name={label} image={memberAvatarUrl(m, FESTIE_ORIGIN)} size="md" />
              <Text style={styles.rowName} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {label}
              </Text>
              <Ionicons
                name={checked ? 'radio-button-on' : 'radio-button-off'}
                size={t.iconSize.action}
                color={checked ? t.colors.accent.aqua : t.colors.text.secondary}
              />
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={styles.buttons}>
        <Button label="Cancel" variant="secondary" onPress={close} disabled={busy} style={styles.button} />
        <Button
          label={crewCopy.handOverConfirm}
          variant="danger"
          loading={busy}
          disabled={!picked}
          onPress={() => picked && onConfirm(picked)}
          style={styles.button}
        />
      </View>
    </SheetShell>
  );
}

const useStyles = makeStyles((t) => ({
  title: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
  },
  body: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    gap: t.spacing[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    minHeight: 56,
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.input,
  },
  rowChecked: {
    borderColor: t.colors.accent.aqua,
  },
  rowName: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    flex: 1,
  },
  buttons: {
    flexDirection: 'row',
    gap: t.spacing[2],
  },
  button: {
    flex: 1,
  },
}));
