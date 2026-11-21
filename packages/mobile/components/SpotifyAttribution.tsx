import { Image, Linking, Text, TouchableOpacity, View } from 'react-native';
import {
  SPOTIFY_HOME_URL,
  SPOTIFY_LISTEN_LABEL,
  SPOTIFY_MIN_LOGO_WIDTH_PX,
  isSafeExternalUrl,
} from '@festie/shared/utils';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';

// The official Spotify full logo (icon and wordmark), unmodified, from developer.spotify.com/documentation/design.
const LOGO_WHITE = require('../assets/spotify/Spotify_Full_Logo_RGB_White.png');
const LOGO_BLACK = require('../assets/spotify/Spotify_Full_Logo_RGB_Black.png');
const LOGO_WIDTH = Math.max(SPOTIFY_MIN_LOGO_WIDTH_PX, 80);
const LOGO_HEIGHT = Math.round((LOGO_WIDTH * 225.25) / 823.46);

/**
 * "Listen on Spotify" with the Spotify logo, linking to the artist's Spotify page. Shown wherever Spotify
 * photos or genres show (Spotify Developer Policy II.4; rules in @festie/shared spotifyAttribution). Never
 * sits on top of artwork. White logo on the stage theme, black on daylight.
 */
export default function SpotifyAttribution({ href }: { href: string }) {
  const styles = useStyles();
  const daylight = useUIStore((s) => s.theme) === 'daylight';
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => Linking.openURL(isSafeExternalUrl(href) ? href : SPOTIFY_HOME_URL).catch(() => {})}
      activeOpacity={0.7}
      accessibilityRole="link"
      accessibilityLabel={SPOTIFY_LISTEN_LABEL}
    >
      <Text style={styles.label} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {SPOTIFY_LISTEN_LABEL.replace(/ Spotify$/, '')}
      </Text>
      <View accessible={false}>
        <Image
          source={daylight ? LOGO_BLACK : LOGO_WHITE}
          style={{ width: LOGO_WIDTH, height: LOGO_HEIGHT }}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      </View>
    </TouchableOpacity>
  );
}

const _label = typeStyle('micro', 600);

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: t.spacing[2],
    minHeight: 44,
  },
  label: {
    ..._label,
    color: t.colors.text.secondary,
    textTransform: 'uppercase' as const,
    letterSpacing: (_label.fontSize ?? 10) * 0.04,
  },
}));
