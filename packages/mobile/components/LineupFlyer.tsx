import { Text, View } from 'react-native';
import { useAuthStore, useFestivalDataStore, useFollowStore } from '@festie/shared/stores';
import { DISCOVER_COPY } from '@festie/shared/constants';
import type { FlyerSize, LineupFlyerModel } from '@festie/shared/utils';
import { makeStyles, typeStyle, MAX_FONT_SCALE, typeScaleCap } from '../hooks/useTokens';
import BrandMark from './BrandMark';
import BrandWordmark from './BrandWordmark';
import FollowButton from './FollowButton';

/**
 * The lineup as a flyer, shown while no set has a start time. Mirrors the web component of the same
 * name. It has no pick controls: they return with the cards once times publish. A signed-out visitor
 * also gets the lockup and one sentence on what Festie does.
 */
export default function LineupFlyer({ model, hPad }: { model: LineupFlyerModel; hPad: number }) {
  const styles = useStyles();
  const festival = useFestivalDataStore((s) => s.currentFestival);
  const hasProfile = useFestivalDataStore((s) => !!s.currentProfile);
  const user = useAuthStore((s) => s.user);
  const following = useFollowStore((s) => (festival ? s.festivalIds.includes(festival.id) : false));
  if (!festival) return null;

  const covered = following || (!!user && hasProfile);
  const rowStyle: Record<FlyerSize, object> = {
    headliner: styles.headliner,
    support: styles.support,
    rest: styles.rest,
  };
  return (
    <View style={[styles.wrap, { marginHorizontal: hPad }]}>
      {user ? null : (
        <View style={styles.lockup}>
          <BrandMark />
          <BrandWordmark />
          <Text style={styles.guestLine} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {DISCOVER_COPY.flyer.guestLine}
          </Text>
        </View>
      )}
      <View style={styles.head}>
        <View style={styles.headText}>
          <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {DISCOVER_COPY.banner.title}
          </Text>
          <Text style={styles.body} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {covered ? DISCOVER_COPY.banner.joined : DISCOVER_COPY.banner.guest}
          </Text>
        </View>
        <FollowButton festivalId={festival.id} festivalName={festival.name} />
      </View>
      <View style={styles.list} accessibilityLabel="Lineup">
        {model.rows.map((row) => (
          <Text
            key={row.key}
            style={rowStyle[row.size]}
            maxFontSizeMultiplier={typeScaleCap(row.size === 'headliner' ? 'display-lg' : 'heading')}
          >
            {row.name}
          </Text>
        ))}
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: {
    marginTop: t.spacing[3],
    padding: t.spacing[4],
    gap: t.spacing[5],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.card,
  },
  lockup: { alignItems: 'center', gap: t.spacing[1] },
  guestLine: { ...typeStyle('label'), color: t.colors.text.secondary, textAlign: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: t.spacing[3] },
  headText: { flex: 1, gap: t.spacing[1] },
  title: { ...typeStyle('title'), color: t.colors.text.primary },
  body: { ...typeStyle('label'), color: t.colors.text.secondary },
  list: { gap: t.spacing[3] },
  headliner: { ...typeStyle('display-lg'), color: t.colors.text.primary },
  support: { ...typeStyle('heading'), color: t.colors.text.primary },
  rest: { ...typeStyle('heading', 500), color: t.colors.text.primary },
}));
