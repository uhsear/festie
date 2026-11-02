import { useEffect, useState } from 'react';
import { View, Text, Modal, Platform, StatusBar, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { requireOptionalNativeModule } from 'expo';
import type * as KeepAwakeModule from 'expo-keep-awake';
import type * as BrightnessModule from 'expo-brightness';
import { useAuthStore } from '@festie/shared/stores';
import { BEACON_COPY } from '@festie/shared/constants';
import { BEACON_FLASH_MS, beaconColors, displayInitials, identityLabel } from '@festie/shared/utils';
import { useTokens, makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';
import { useReduceMotion } from '../hooks/useReduceMotion';

const INITIALS_SCALE = 2.5;

// Binaries before 1.5.0 lack both native modules, and a static import throws at launch there.
// Without them Beacon keeps T28's behavior: the footer asks the user to raise brightness.
/* eslint-disable @typescript-eslint/no-require-imports */
const screenControl =
  requireOptionalNativeModule('ExpoKeepAwake') != null && requireOptionalNativeModule('ExpoBrightness') != null
    ? {
        useKeepAwake: (require('expo-keep-awake') as typeof KeepAwakeModule).useKeepAwake,
        Brightness: require('expo-brightness') as typeof BrightnessModule,
      }
    : null;
/* eslint-enable @typescript-eslint/no-require-imports */

function warn(what: string, e: unknown) {
  console.warn(`Beacon: ${what} failed`, e);
}

// Max app brightness while mounted. iOS keeps the level after the app leaves, so it needs the explicit restore.
function ScreenAwakeAndBright({ useKeepAwake, Brightness }: NonNullable<typeof screenControl>) {
  useKeepAwake('beacon');
  useEffect(() => {
    let cancelled = false;
    let prev: number | null = null;
    (async () => {
      try {
        prev = await Brightness.getBrightnessAsync();
        if (cancelled) return;
        await Brightness.setBrightnessAsync(1);
      } catch (e) {
        warn('raise brightness', e);
      }
    })();
    return () => {
      cancelled = true;
      const restore =
        Platform.OS === 'android'
          ? Brightness.restoreSystemBrightnessAsync()
          : prev === null
            ? Promise.resolve()
            : Brightness.setBrightnessAsync(prev);
      restore.catch((e) => warn('restore brightness', e));
    };
  }, [Brightness]);
  return null;
}

function BeaconScreen({ onClose }: { onClose: () => void }) {
  const styles = useStyles();
  const user = useAuthStore((s) => s.user);
  const reduceMotion = useReduceMotion();
  const [phase, setPhase] = useState(false);
  const { primary, alternate } = beaconColors(identityLabel(user));

  useEffect(() => {
    if (reduceMotion) return;
    const id = setInterval(() => setPhase((p) => !p), BEACON_FLASH_MS);
    return () => clearInterval(id);
  }, [reduceMotion]);

  const bg = phase ? alternate : primary;
  const fg = phase ? primary : alternate;

  return (
    <View style={[styles.root, { backgroundColor: bg }]} accessibilityViewIsModal accessibilityLabel={BEACON_COPY.a11y}>
      <StatusBar hidden />
      {screenControl && <ScreenAwakeAndBright {...screenControl} />}
      <Text
        style={[styles.initials, { color: fg, transform: [{ scale: INITIALS_SCALE }] }]}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
      >
        {displayInitials(user)}
      </Text>
      <Text style={[styles.name, { color: fg }]}>{identityLabel(user)}</Text>
      <Text style={[styles.prompt, { color: fg }]}>{BEACON_COPY.prompt}</Text>
      {!screenControl && <Text style={[styles.footer, { color: fg }]}>{BEACON_COPY.footer}</Text>}
      <TouchableOpacity
        style={[styles.done, { borderColor: fg }]}
        onPress={onClose}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Turn off Beacon"
      >
        <Text style={[styles.doneText, { color: fg }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {BEACON_COPY.done}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export function BeaconRow() {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();
  const [open, setOpen] = useState(false);

  return (
    <>
      <TouchableOpacity
        style={styles.row}
        onPress={() => {
          haptics.tap();
          setOpen(true);
        }}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={BEACON_COPY.button}
        accessibilityHint={BEACON_COPY.buttonHint}
      >
        <View style={styles.rowIcon}>
          <Ionicons name="flashlight-outline" size={t.iconSize.md} color={t.colors.text.secondary} />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>{BEACON_COPY.button}</Text>
          <Text style={styles.rowSub}>{BEACON_COPY.buttonHint}</Text>
        </View>
      </TouchableOpacity>
      <Modal
        visible={open}
        presentationStyle="fullScreen"
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setOpen(false)}
      >
        <BeaconScreen onClose={() => setOpen(false)} />
      </Modal>
    </>
  );
}

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    minHeight: 56,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  rowIcon: { width: 28, alignItems: 'center' },
  rowBody: { flex: 1, gap: t.spacing[1] },
  rowTitle: { ...typeStyle('label'), color: t.colors.text.primary },
  rowSub: { ...typeStyle('caption'), color: t.colors.text.secondary },
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[4],
    padding: t.spacing[6],
  },
  initials: { ...typeStyle('display-lg', 700), marginBottom: t.spacing[6] },
  name: { ...typeStyle('title'), textAlign: 'center' },
  prompt: { ...typeStyle('label', 700), textAlign: 'center' },
  footer: { ...typeStyle('caption'), textAlign: 'center' },
  done: {
    minHeight: 56,
    minWidth: 160,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: t.radii.default,
    borderWidth: 2,
    marginTop: t.spacing[4],
  },
  doneText: { ...typeStyle('label', 700) },
}));
