import { useState } from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCrewStore, useUIStore } from '@festie/shared/stores';
import { mapErrorToUserMessage } from '@festie/shared/services';
import { COPY } from '@festie/shared/constants';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE } from '../hooks/useTokens';
import AppSwitch from './AppSwitch';

interface CrewLockRowProps {
  crewId: string;
  isOwner: boolean;
}

/**
 * Owner "Lock crew" switch beside the invite code; members see a one-line
 * "Locked" note. The server enforces the lock, this is only the control.
 */
export default function CrewLockRow({ crewId, isOwner }: CrewLockRowProps) {
  const t = useTokens();
  const styles = useStyles();
  const locked = useCrewStore((s) => (s.activeCrew?.id === crewId ? !!s.activeCrew.inviteLocked : false));
  const setCrewLocked = useCrewStore((s) => s.setCrewLocked);
  const [busy, setBusy] = useState(false);

  if (!isOwner) {
    if (!locked) return null;
    return (
      <View style={styles.row} accessible accessibilityRole="text" accessibilityLabel={COPY.crewLock.lockedLine}>
        <Ionicons name="lock-closed-outline" size={16} color={t.colors.text.secondary} />
        <Text style={styles.hint} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {COPY.crewLock.lockedLine}
        </Text>
      </View>
    );
  }

  const onChange = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await setCrewLocked(crewId, next);
      useUIStore.getState().showToast(next ? COPY.crewLock.locked : COPY.crewLock.unlocked);
    } catch (err) {
      useUIStore.getState().showToast(mapErrorToUserMessage(err, COPY.crewLock.failed), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text style={styles.label} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {COPY.crewLock.label}
        </Text>
        <Text style={styles.hint} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {COPY.crewLock.hint}
        </Text>
      </View>
      <AppSwitch
        value={locked}
        onValueChange={onChange}
        disabled={busy}
        accessibilityLabel={COPY.crewLock.label}
        accessibilityHint={COPY.crewLock.hint}
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: t.spacing[2],
    // Full width inside the wrapping invite bar.
    flexBasis: '100%',
    minHeight: 44,
    paddingVertical: t.spacing[2],
  },
  text: {
    flex: 1,
    minWidth: 160,
    gap: t.spacing[1],
  },
  label: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  hint: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    flexShrink: 1,
  },
}));
