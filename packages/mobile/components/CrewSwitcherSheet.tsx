import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCrewStore, useFestivalStore } from '@festie/shared/stores';
import {
  groupCrewsByFestival,
  memberCountLabel,
  parseInviteCode,
} from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';
import Button from './Button';
import CreateCrewForm from './CreateCrewForm';

type Mode = 'list' | 'create' | 'join';

interface CrewSwitcherSheetProps {
  visible: boolean;
  onClose: () => void;
  initialMode?: Mode;
}

const BAD_CODE = "That code doesn't look right. Codes have 6 letters and numbers.";

/** Switch, create or join crews. Crews are grouped by festival; past festivals are dimmed. */
export default function CrewSwitcherSheet({ visible, onClose, initialMode = 'list' }: CrewSwitcherSheetProps) {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();

  const crews = useCrewStore((s) => s.crews);
  const activeCrew = useCrewStore((s) => s.activeCrew);
  const selectCrew = useCrewStore((s) => s.selectCrew);
  const festivals = useFestivalStore((s) => s.festivals);
  const currentFestival = useFestivalStore((s) => s.currentFestival);

  const [mode, setMode] = useState<Mode>(initialMode);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);

  // Every open starts fresh in the requested mode.
  useEffect(() => {
    if (!visible) return;
    setMode(initialMode);
    setCode('');
    setCodeError(null);
  }, [visible, initialMode]);

  const groups = useMemo(
    () => groupCrewsByFestival(crews, festivals, currentFestival?.id),
    [crews, festivals, currentFestival?.id],
  );

  const join = () => {
    const parsed = parseInviteCode(code);
    if (!parsed) {
      setCodeError(BAD_CODE);
      return;
    }
    onClose();
    router.push(`/join/${parsed}`);
  };

  const pick = (id: string) => {
    haptics.select();
    selectCrew(id).catch(() => {});
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close your crews"
        />
        <View style={styles.sheet} accessibilityViewIsModal>
          <Text style={styles.title} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            Your crews
          </Text>
          {mode === 'list' ? (
            <>
              <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
                {groups.map((g) => (
                  <View key={g.festivalId ?? 'unknown'} style={[styles.group, g.status === 'past' && styles.past]}>
                    {g.label ? (
                      <Text style={styles.sectionLabel} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                        {g.label}
                      </Text>
                    ) : null}
                    {g.crews.map((c) => {
                      const selected = c.id === activeCrew?.id;
                      return (
                        <Pressable
                          key={c.id}
                          style={[styles.row, selected && styles.rowSelected]}
                          onPress={() => pick(c.id)}
                          accessibilityRole="button"
                          accessibilityLabel={`Switch to crew ${c.name}${g.label ? `, ${g.label}` : ''}`}
                          accessibilityState={{ selected }}
                        >
                          <Text style={styles.emoji}>{c.totem_emoji || '🎪'}</Text>
                          <View style={styles.rowBody}>
                            <Text style={styles.rowName} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                              {c.name}
                            </Text>
                            <Text style={styles.rowMeta} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                              {memberCountLabel(c.memberCount ?? c.members?.length ?? 0, c.maxMembers)}
                            </Text>
                          </View>
                          {selected ? (
                            <Ionicons name="checkmark" size={t.iconSize.action} color={t.colors.accent.aqua} />
                          ) : null}
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
              </ScrollView>
              <View style={styles.footer}>
                <Button label="Create crew" variant="secondary" onPress={() => setMode('create')} style={styles.footerButton} />
                <Button label="Join with code" variant="secondary" onPress={() => setMode('join')} style={styles.footerButton} />
              </View>
            </>
          ) : mode === 'create' ? (
            <>
              <CreateCrewForm onCreated={onClose} />
              <Button label="Back" variant="ghost" onPress={() => setMode('list')} />
            </>
          ) : (
            <>
              <TextInput
                style={styles.input}
                value={code}
                onChangeText={(v) => {
                  setCode(v);
                  setCodeError(null);
                }}
                placeholder="K7XQ2M"
                placeholderTextColor={t.colors.text.placeholder}
                maxLength={64}
                autoCapitalize="characters"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={join}
                accessibilityLabel="Invite code or link"
              />
              <Text style={styles.helper} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                6-character code, or paste the invite link
              </Text>
              {codeError ? (
                <Text style={styles.error} accessibilityLiveRegion="polite" maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {codeError}
                </Text>
              ) : null}
              <Button label="Join" onPress={join} disabled={!code.trim()} />
              <Button label="Back" variant="ghost" onPress={() => setMode('list')} />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: t.colors.shade[9],
  },
  sheet: {
    gap: t.spacing[3],
    padding: t.spacing[5],
    maxHeight: '85%',
    borderTopLeftRadius: t.radii.default,
    borderTopRightRadius: t.radii.default,
    backgroundColor: t.colors.bg.secondary,
  },
  title: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    gap: t.spacing[4],
  },
  group: {
    gap: t.spacing[2],
  },
  past: {
    opacity: 0.6,
  },
  sectionLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    textTransform: 'uppercase',
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
  rowSelected: {
    borderColor: t.colors.accent.aqua,
  },
  emoji: {
    fontSize: 22,
  },
  rowBody: {
    flex: 1,
  },
  rowName: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  rowMeta: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  footer: {
    flexDirection: 'row',
    gap: t.spacing[2],
  },
  footerButton: {
    flex: 1,
  },
  input: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    backgroundColor: t.colors.bg.input,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    borderRadius: t.radii.default,
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    minHeight: 48,
  },
  helper: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  error: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
  },
}));
