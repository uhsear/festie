import { View, Text, ScrollView } from 'react-native';
import { useFestivalWeather } from '@festie/shared/hooks';
import { timeAgo } from '@festie/shared/utils';
import { makeStyles, typeScaleCap, typeStyle } from '../hooks/useTokens';

interface WeatherStripProps {
  festivalId: string;
  nowMs: number;
}

/** Now, the next 6 hours and a rain warning, from the persisted forecast so it works offline. */
export default function WeatherStrip({ festivalId, nowMs }: WeatherStripProps) {
  const styles = useStyles();
  const { weather, fetchedAt, stale } = useFestivalWeather(festivalId, nowMs);
  if (!weather) return null;

  const cap = typeScaleCap('body');
  const nowLine =
    `Now ${weather.temp}` +
    (weather.condition ? ` · ${weather.condition}` : '') +
    (weather.todayHigh && weather.todayLow ? ` · High ${weather.todayHigh} · Low ${weather.todayLow}` : '');

  return (
    <View style={styles.card} accessibilityRole="summary" accessibilityLabel="Weather">
      <Text style={styles.nowLine} maxFontSizeMultiplier={cap}>
        {nowLine}
      </Text>
      {weather.hours.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hours}>
          {weather.hours.map((hour) => (
            <View key={hour.label + hour.temp} style={styles.hour} accessible accessibilityLabel={hour.a11y}>
              <Text style={styles.hourLabel} maxFontSizeMultiplier={cap}>
                {hour.label}
              </Text>
              <Text style={styles.hourTemp} maxFontSizeMultiplier={cap}>
                {hour.temp}
              </Text>
              <Text style={styles.hourRain} maxFontSizeMultiplier={cap}>
                {hour.precipChance}% rain
              </Text>
            </View>
          ))}
        </ScrollView>
      ) : null}
      {weather.rainLikely ? (
        <Text style={styles.rain} maxFontSizeMultiplier={cap}>
          Rain likely in the next 6 hours. Bring a poncho.
        </Text>
      ) : null}
      {stale && fetchedAt != null ? (
        <Text style={styles.muted} maxFontSizeMultiplier={cap}>
          Forecast updated {timeAgo(fetchedAt)}
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.lg,
    padding: t.spacing[3],
    gap: t.spacing[2],
  },
  nowLine: { ...typeStyle('label'), color: t.colors.text.primary },
  hours: { gap: t.spacing[2] },
  hour: {
    alignItems: 'center',
    minWidth: 64,
    paddingVertical: t.spacing[1],
    paddingHorizontal: t.spacing[2],
  },
  hourLabel: { ...typeStyle('caption'), color: t.colors.text.muted },
  hourTemp: { ...typeStyle('label'), color: t.colors.text.primary },
  hourRain: { ...typeStyle('caption'), color: t.colors.text.secondary },
  rain: { ...typeStyle('caption'), color: t.colors.accent.amber },
  muted: { ...typeStyle('caption'), color: t.colors.text.muted },
}));
