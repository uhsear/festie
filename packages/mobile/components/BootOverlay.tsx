import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';
import NetInfo from '@react-native-community/netinfo';
import { useUIStore } from '@festie/shared/stores';
import { duration as motionDuration } from '@festie/shared/tokens';
import { makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { BOOT_STATUS_DELAY_MS, bootStatusLine } from '../lib/bootStatus';

// Must match the expo-splash-screen plugin in app.json: the same art, centred, 200 wide, so the
// native splash hands off to this view without the mark moving.
const SPLASH_MARK_SIZE = 200;
const MARK_STAGE = require('../assets/splash-icon.png');
const MARK_DAYLIGHT = require('../assets/splash-icon-daylight.png');

const useStyles = makeStyles((t) => ({
  root: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: t.colors.bg.primary,
  },
  mark: { width: SPLASH_MARK_SIZE, height: SPLASH_MARK_SIZE },
  // Sits under the centred mark so the mark never moves when the line appears.
  status: {
    position: 'absolute',
    top: '50%',
    marginTop: SPLASH_MARK_SIZE / 2 + t.spacing[3],
    paddingHorizontal: t.spacing[4],
    textAlign: 'center',
    color: t.colors.text.secondary,
    ...typeStyle('caption'),
  },
}));

/** Covers the app while the root loads: the splash mark where the native splash drew it, then a status line after 1.5 s. */
export default function BootOverlay({ hydrated }: { hydrated: boolean }) {
  const styles = useStyles();
  const theme = useUIStore((s) => s.theme);
  const reduceMotion = useReduceMotion();
  const [offline, setOffline] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    const id = setTimeout(() => {
      NetInfo.fetch()
        .then((s) => live && setOffline(s.isConnected === false))
        .catch(() => live && setOffline(false));
    }, BOOT_STATUS_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, []);

  return (
    <Animated.View
      style={styles.root}
      pointerEvents="auto"
      exiting={reduceMotion ? undefined : FadeOut.duration(motionDuration.med)}
    >
      <Image
        source={theme === 'daylight' ? MARK_DAYLIGHT : MARK_STAGE}
        style={styles.mark}
        resizeMode="contain"
        accessible={false}
        importantForAccessibility="no"
        accessibilityIgnoresInvertColors
      />
      {offline !== null && (
        <Text style={styles.status} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityLiveRegion="polite">
          {bootStatusLine({ offline, hydrated })}
        </Text>
      )}
    </Animated.View>
  );
}
