import { Text, View } from 'react-native';
import { useAuthStore, useFestivalDataStore, useFollowStore } from '@festie/shared/stores';
import { DISCOVER_COPY } from '@festie/shared/constants';
import { makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';
import FollowButton from './FollowButton';

/** Shown on a lineup that has sets but no set times yet. */
export default function SetTimesBanner({ hPad }: { hPad: number }) {
  const styles = useStyles();
  const festival = useFestivalDataStore((s) => s.currentFestival);
  const sets = useFestivalDataStore((s) => s.sets);
  const hasProfile = useFestivalDataStore((s) => !!s.currentProfile);
  const user = useAuthStore((s) => s.user);
  const following = useFollowStore((s) => (festival ? s.festivalIds.includes(festival.id) : false));

  if (!festival || sets.length === 0 || sets.some((s) => s.startTime)) return null;
  const covered = following || (!!user && hasProfile);
  return (
    <View style={[styles.wrap, { marginHorizontal: hPad }]}>
      <View style={styles.text}>
        <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {DISCOVER_COPY.banner.title}
        </Text>
        <Text style={styles.body} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {covered ? DISCOVER_COPY.banner.joined : DISCOVER_COPY.banner.guest}
        </Text>
      </View>
      {covered ? null : <FollowButton festivalId={festival.id} festivalName={festival.name} />}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    marginTop: t.spacing[3],
    padding: t.spacing[4],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.card,
  },
  text: { flex: 1, gap: t.spacing[1] },
  title: { ...typeStyle('title'), color: t.colors.text.primary },
  body: { ...typeStyle('label'), color: t.colors.text.secondary },
}));
