import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import DialogShell from '../DialogShell';
import { makeStyles, typeStyle } from '../../hooks/useTokens';
import { LabeledTextInput, ModalSelect, TimeField, isValidTime, type SelectOption } from './AdminFields';

/**
 * Bulk "shift set times" dialog for one day of the festival editor. Built on core
 * <Modal> (no native dep), styled like ConfirmDialog. The parent decides which
 * sets match; this only collects the stage, the start filter and the minutes.
 */
export interface ShiftTimesDialogProps {
  visible: boolean;
  stages: SelectOption[];
  onCancel: () => void;
  onConfirm: (opts: { stageId: string; fromTime: string; minutes: number }) => void;
}

const ALL_STAGES: SelectOption = { label: 'All stages', value: '' };
const MINUTES_ERROR = 'Enter whole minutes between -720 and 720.';

/** The shift in minutes, or null when the text is not a non-zero whole number from -720 to 720. */
function parseMinutes(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n === 0 || n < -720 || n > 720 ? null : n;
}

// Rendered only while the modal is visible, so every open starts from blank fields.
function ShiftTimesForm({ stages, onCancel, onConfirm }: Omit<ShiftTimesDialogProps, 'visible'>) {
  const styles = useStyles();
  const [stageId, setStageId] = useState('');
  const [fromTime, setFromTime] = useState('');
  const [minutesText, setMinutesText] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const minutes = parseMinutes(minutesText);
  const fromInvalid = fromTime.trim() !== '' && !isValidTime(fromTime);

  const submit = () => {
    setSubmitted(true);
    if (minutes === null || fromInvalid) return;
    onConfirm({ stageId, fromTime: fromTime.trim(), minutes });
  };

  return (
    <ScrollView
      contentContainerStyle={styles.cardContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      bounces={false}
    >
      <Text style={styles.title} accessibilityRole="header">
        Shift set times
      </Text>
      <ModalSelect
        label="Stage"
        value={stageId}
        options={[ALL_STAGES, ...stages]}
        onSelect={setStageId}
      />
      <TimeField
        label="Starting at or after"
        value={fromTime}
        onChangeText={setFromTime}
        hint="Leave blank to shift the whole day."
      />
      <LabeledTextInput
        label="Minutes"
        value={minutesText}
        onChangeText={setMinutesText}
        placeholder="30"
        autoCapitalize="none"
        maxLength={4}
        hint="Use a minus sign to move earlier."
        error={submitted && minutes === null ? MINUTES_ERROR : null}
      />
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.button, styles.cancelButton]}
          onPress={onCancel}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
        >
          <Text style={styles.cancelLabel}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, styles.confirmButton]}
          onPress={submit}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Shift"
        >
          <Text style={styles.confirmLabel}>Shift</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

export default function ShiftTimesDialog({ visible, ...rest }: ShiftTimesDialogProps) {
  const styles = useStyles();
  return (
    <DialogShell visible={visible} onClose={rest.onCancel} cardStyle={styles.card}>
      <ShiftTimesForm {...rest} />
    </DialogShell>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.lg,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    padding: t.spacing[5],
    maxHeight: '85%',
  },
  cardContent: {
    gap: t.spacing[3],
  },
  title: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
  },
  actions: {
    gap: t.spacing[3],
    marginTop: t.spacing[2],
  },
  button: {
    minHeight: 48,
    borderRadius: t.radii.default,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: t.spacing[3],
    paddingHorizontal: t.spacing[4],
  },
  cancelButton: {
    backgroundColor: t.colors.bg.primary,
    borderWidth: 1,
    borderColor: t.colors.border.light,
  },
  cancelLabel: {
    ...typeStyle('label', 600),
    color: t.colors.text.primary,
  },
  confirmButton: {
    backgroundColor: t.colors.accent.aqua,
  },
  confirmLabel: {
    ...typeStyle('label', 600),
    color: t.colors.text.onLightAccent,
  },
}));
