import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Share, useWindowDimensions, type HostInstance } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@festie/shared/services';
import { useFestivalDataStore, useCrewStore } from '@festie/shared/stores';
import { useFestival } from '@festie/shared/hooks';
import { isFestivalOver } from '@festie/shared/utils';
import { RATING_LABEL } from '@festie/shared/constants';
import { makeStyles, typeStyle, useTokens, iconSize, MAX_FONT_SCALE } from '../hooks/useTokens';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { RATING_IONICON } from '../lib/ratingIcon';
import { useSharedValue, withTiming, Easing, useDerivedValue, runOnJS } from 'react-native-reanimated';
import EmptyState from '../components/EmptyState';
import SectionLabel from '../components/SectionLabel';
import { Skeleton } from '../components/Skeleton';
import WrapPoster from '../components/WrapPoster';
import CrewWrapPoster, { type CrewWrapData } from '../components/CrewWrapPoster';

interface WrapStats {
  totalRated: number;
  stagesVisited: number;
  daysAttended: number;
  totalHours: number | null;
}
interface WrapSet {
  setId: string;
  rating: number;
  artist?: string;
  note?: string | null;
  stageId?: string | null;
  stageName?: string | null;
}
interface WrapResponse {
  stats: WrapStats;
  topSets: WrapSet[];
  allRatings: WrapSet[];
}

/**
 * Festival Wrap — post-festival year-in-review stats + top-rated sets, a mobile
 * mirror of the web /wrap route. Gated on isFestivalOver. The web "share as
 * 1080×1920 PNG poster" is replaced here by a plain text share (RN Share), as
 * native image capture would need an extra dependency.
 */
export default function WrapScreen() {
  const t = useTokens();
  const styles = useStyles();
  const insets = useSafeAreaInsets();

  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
  const days = useFestivalDataStore((s) => s.days);
  const activeCrew = useCrewStore((s) => s.activeCrew);
  const { getStageName } = useFestival();

  const over = isFestivalOver(currentFestival, days);

  const [tab, setTab] = useState<'me' | 'crew'>('me');
  const [data, setData] = useState<WrapResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [sharing, setSharing] = useState(false);
  // Bumped by the error-state "Try again" action to re-run the fetch (F40).
  const [reloadKey, setReloadKey] = useState(0);
  const posterRef = useRef<HostInstance>(null);

  useEffect(() => {
    if (!currentFestival?.id || !over) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- genuine data-fetch side effect: flip loading on before the async GET. Not derivable — loading tracks the in-flight request, not render inputs.
    setLoading(true);
    setError(false);
    api
      .get<WrapResponse>(`/ratings/wrap/${currentFestival.id}`)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentFestival?.id, over, reloadKey]);

  // Crew overlap moment: the set most of the crew loved, from the crew-wrap endpoint.
  const crewId = activeCrew?.id ?? null;
  const [crewWrap, setCrewWrap] = useState<CrewWrapData | null>(null);
  useEffect(() => {
    if (!crewId || !currentFestival?.id || !over) return;
    let cancelled = false;
    api
      .get<CrewWrapResponse>(`/ratings/crew-wrap/${crewId}/${currentFestival.id}`)
      .then((res) => {
        if (!cancelled) setCrewWrap(res.wrap);
      })
      .catch(() => {
        // The moment is optional; the Crew tab shows its own error state.
      });
    return () => {
      cancelled = true;
    };
  }, [crewId, currentFestival?.id, over]);
  const crewMoment = crewId ? crewWrap?.setsSeenTogether[0] : undefined;

  const allSorted = useMemo(
    () => (data?.allRatings || []).slice().sort((a, b) => b.rating - a.rating),
    [data?.allRatings],
  );

  const stageLabel = (s: WrapSet): string => s.stageName || (s.stageId ? getStageName(s.stageId) || 'Stage' : 'Stage');

  // Poster-shaped top sets (resolve stage names) — mirrors web's posterTopSets.
  const posterTopSets = useMemo(
    () =>
      (data?.topSets || []).slice(0, 5).map((s) => ({
        rating: s.rating,
        artist: s.artist || s.setId,
        stageName: s.stageName || (s.stageId ? getStageName(s.stageId) : null),
      })),
    [data?.topSets, getStageName],
  );

  const shareText = async () => {
    if (!data || !currentFestival) return;
    const { stats, topSets } = data;
    const lines = [
      `My ${currentFestival.name} wrap`,
      `${stats.totalRated} sets rated · ${stats.stagesVisited} stages · ${(stats.totalHours ?? 0).toFixed(1)}h of music`,
      ...topSets.slice(0, 5).map((s, i) => `${i + 1}. ${s.artist || s.setId} (${RATING_LABEL[s.rating] ?? s.rating})`),
      'festie.us',
    ];
    try {
      await Share.share({ message: lines.join('\n') });
    } catch {
      // User dismissed the share sheet.
    }
  };

  // Capture the off-screen 1080×1920 poster to a PNG and share it; fall back to
  // the plain-text share if capture or the share sheet is unavailable.
  const handleShare = async () => {
    if (!data || !currentFestival || sharing) return;
    setSharing(true);
    try {
      const uri = await captureRef(posterRef, {
        format: 'png',
        quality: 1,
        width: 1080,
        height: 1920,
        result: 'tmpfile',
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          UTI: 'public.png',
          dialogTitle: 'Share your Festie wrap',
        });
      } else {
        await shareText();
      }
    } catch {
      // Capture failed (or sheet dismissed) — degrade to a text share.
      await shareText();
    } finally {
      setSharing(false);
    }
  };

  const body = () => {
    if (!currentFestival) {
      return (
        <EmptyState
          icon="sparkles-outline"
          title="Select a festival first"
          message="Your wrap appears here once a festival ends."
        />
      );
    }
    if (!over) {
      return (
        <EmptyState
          icon="sparkles-outline"
          title="Festival wrap coming soon"
          message="We'll put together your highlights the day after the festival ends."
        />
      );
    }
    if (loading) {
      return <WrapSkeleton />;
    }
    if (error) {
      return (
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn't load your wrap"
          message="Something went wrong loading your festival wrap."
          action={{ label: 'Try again', onPress: () => setReloadKey((k) => k + 1) }}
        />
      );
    }

    const stats = data?.stats || {
      totalRated: 0,
      stagesVisited: 0,
      daysAttended: 0,
      totalHours: 0,
    };
    const topSets = data?.topSets || [];
    const totalHours = stats.totalHours ?? 0;

    return (
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(t.spacing[4], insets.bottom + t.spacing[2]) },
        ]}
      >
        <View style={styles.headerBlock}>
          <View style={styles.kicker}>
            <Ionicons name="sparkles" size={iconSize.compact} color={t.colors.accent.aqua} />
            <Text style={styles.kickerText}>Your Festival Wrap</Text>
          </View>
          <Text style={styles.festivalName}>{currentFestival.name}</Text>
        </View>

        {stats.totalRated > 0 ? (
          <Hero
            value={stats.totalRated}
            label="sets rated"
            detail={`${stats.stagesVisited} ${stats.stagesVisited === 1 ? 'stage' : 'stages'} · ${stats.daysAttended} ${stats.daysAttended === 1 ? 'day' : 'days'} · ${totalHours.toFixed(1)} hours of music`}
          />
        ) : null}

        {topSets.length > 0 ? (
          <View>
            <SectionLabel>Your top sets</SectionLabel>
            <View style={styles.leadCard}>
              <Text style={styles.topMeta}>#1 · {stageLabel(topSets[0]!)}</Text>
              <Text style={styles.leadArtist} numberOfLines={2}>
                {topSets[0]!.artist || topSets[0]!.setId}
              </Text>
              <RatingTag rating={topSets[0]!.rating} />
              {topSets[0]!.note ? (
                <Text style={styles.topNote} numberOfLines={2}>
                  "{topSets[0]!.note}"
                </Text>
              ) : null}
            </View>
            {topSets.slice(1).map((s, i) => (
              <View key={s.setId} style={styles.allRow}>
                <Text style={styles.rank} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  {i + 2}
                </Text>
                <View style={styles.topInfo}>
                  <Text style={styles.topArtist} numberOfLines={1}>
                    {s.artist || s.setId}
                  </Text>
                  <Text style={styles.topMeta} numberOfLines={1}>
                    {stageLabel(s)}
                  </Text>
                </View>
                <RatingTag rating={s.rating} compact />
              </View>
            ))}
          </View>
        ) : (
          <EmptyState
            icon="trophy-outline"
            title="No 4 or 5-star ratings yet"
            message="Rate sets from the set detail screen to build your wrap."
            action={{ label: 'Rate your picks', onPress: () => router.push('/(tabs)/picks') }}
          />
        )}

        {crewMoment && crewWrap ? (
          <View style={styles.momentCard} accessible accessibilityLabel={`Your crew moment: ${crewMoment.artist || crewMoment.setId}, ${crewMoment.count} of ${crewWrap.memberCount} loved it`}>
            <View style={styles.kicker}>
              <Ionicons name="people" size={iconSize.compact} color={t.colors.accent.aqua} />
              <Text style={styles.kickerText}>Your crew moment</Text>
            </View>
            <Text style={styles.leadArtist} numberOfLines={2}>
              {crewMoment.artist || crewMoment.setId}
            </Text>
            <Text style={styles.superSub}>
              {crewMoment.count} of {crewWrap.memberCount} in {activeCrew?.name ?? 'your crew'} loved it
            </Text>
            <TouchableOpacity
              onPress={() => setTab('crew')}
              style={styles.momentLink}
              accessibilityRole="button"
              accessibilityLabel="Open the crew wrap"
            >
              <Text style={styles.momentLinkText}>Open the crew wrap</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {stats.totalRated > 0 ? (
          <View style={styles.shareBlock}>
            <PosterPreview>
              <WrapPoster
                festivalName={currentFestival.name}
                topSets={posterTopSets}
                stats={{
                  totalRated: stats.totalRated,
                  stagesVisited: stats.stagesVisited,
                  daysAttended: stats.daysAttended,
                  totalHours,
                }}
              />
            </PosterPreview>
            <TouchableOpacity
              style={[styles.shareButton, sharing && styles.shareButtonBusy]}
              onPress={() => void handleShare()}
              disabled={sharing}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Share your wrap"
            >
              {sharing ? (
                <ActivityIndicator size="small" color={t.colors.text.onLightAccent} />
              ) : (
                <Ionicons name="share-social-outline" size={16} color={t.colors.text.onLightAccent} />
              )}
              <Text style={styles.shareButtonText}>{sharing ? 'Preparing…' : 'Share your wrap'}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {allSorted.length > 0 ? (
          <View>
            <SectionLabel>Everything you rated</SectionLabel>
            {allSorted.map((s) => (
              <View key={s.setId} style={styles.allRow}>
                <RatingTag rating={s.rating} compact />
                <Text style={styles.allArtist} numberOfLines={1}>
                  {s.artist || s.setId}
                </Text>
                <Text style={styles.allStage} numberOfLines={1}>
                  {stageLabel(s)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <Text style={styles.footer}>festie.us</Text>
      </ScrollView>
    );
  };

  // Tab bar — Personal vs Crew wrap. Only shown once the festival is over (the
  // not-over / no-festival empty states render the same regardless of tab).
  const showTabs = !!currentFestival && over;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Festival Wrap', headerShown: true }} />
      {showTabs ? (
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tab, tab === 'me' && styles.tabActive]}
            onPress={() => setTab('me')}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === 'me' }}
          >
            <Text style={[styles.tabText, tab === 'me' && styles.tabTextActive]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              You
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, tab === 'crew' && styles.tabActive]}
            onPress={() => setTab('crew')}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === 'crew' }}
          >
            <Text
              style={[styles.tabText, tab === 'crew' && styles.tabTextActive]}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
            >
              Crew wrap
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {showTabs && tab === 'crew' ? (
        <CrewWrapTab
          crewId={activeCrew?.id ?? null}
          crewName={activeCrew?.name ?? 'Your crew'}
          festivalId={currentFestival!.id}
          festivalName={currentFestival!.name}
        />
      ) : (
        body()
      )}
      {/* Off-screen 1080×1920 poster, captured to PNG on share. collapsable=false
          keeps the View in the native tree so react-native-view-shot can grab it
          on Android. */}
      {tab === 'me' && data && data.stats.totalRated > 0 ? (
        <View
          ref={posterRef}
          collapsable={false}
          style={{ position: 'absolute', left: -99999, top: 0, width: 1080, height: 1920 }}
          pointerEvents="none"
        >
          <WrapPoster
            festivalName={currentFestival?.name ?? 'Festival'}
            topSets={posterTopSets}
            stats={{
              totalRated: data.stats.totalRated,
              stagesVisited: data.stats.stagesVisited,
              daysAttended: data.stats.daysAttended,
              totalHours: data.stats.totalHours ?? 0,
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Cold-load placeholder for the wrap — a header line, the hero number, and a
 * couple of list rows, matching the real layout so it doesn't jump on arrival.
 */
function WrapSkeleton() {
  const t = useTokens();
  const styles = useStyles();
  return (
    <View style={styles.skeletonWrap} accessibilityRole="progressbar" accessibilityLabel="Loading your wrap">
      <View style={styles.skeletonHeader}>
        <Skeleton width={140} height={12} radius={t.radii.xs} />
        <Skeleton width={200} height={24} radius={t.radii.xs} />
      </View>
      <View style={styles.skeletonHeader}>
        <Skeleton width={120} height={64} radius={t.radii.xs} />
        <Skeleton width={160} height={16} radius={t.radii.xs} />
      </View>
      <Skeleton width="45%" height={12} radius={t.radii.xs} />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} height={64} radius={t.radii.default} />
      ))}
    </View>
  );
}

// R10: count-up hook for mobile using Reanimated withTiming.
// Drives a SharedValue from 0 → numericTarget over `duration` ms with an
// ease-out cubic. A setState callback (runOnJS) on each frame keeps a
// React state string in sync so a plain <Text> can render it — avoiding
// AnimatedText dependency issues and keeping the pattern setState-throttled
// as the spec permits.
// Respects OS reduce-motion: when true, jumps straight to the final value.
function useCountUpMobile(target: string, duration = 800): string {
  const numericTarget = parseFloat(target);
  const hasDecimal = target.includes('.');
  const reduceMotion = useReduceMotion();
  const sv = useSharedValue(0);
  const [displayed, setDisplayed] = useState(() =>
    reduceMotion || isNaN(numericTarget) ? target : hasDecimal ? '0.0' : '0',
  );

  const fmt = useCallback(
    (v: number) => {
      setDisplayed(hasDecimal ? v.toFixed(1) : String(Math.round(v)));
    },
    [hasDecimal],
  );

  useDerivedValue(() => {
    runOnJS(fmt)(sv.value);
  });

  useEffect(() => {
    if (isNaN(numericTarget)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- non-numeric target shows verbatim once; not derivable as render state because the animated frames also drive `displayed` via runOnJS
      setDisplayed(target);
      return;
    }
    if (reduceMotion) {
      // eslint-disable-next-line react-hooks/immutability -- imperative Reanimated shared-value write; the count-up animation has no declarative/derived equivalent
      sv.value = numericTarget;
      setDisplayed(target);
      return;
    }
    sv.value = 0;
    sv.value = withTiming(numericTarget, {
      duration,
      easing: Easing.out(Easing.cubic),
    });
    // sv is a useSharedValue (stable ref); numericTarget is derived from target.
  }, [target, numericTarget, reduceMotion, duration, sv]);

  return displayed;
}

// Hero stat: one big count-up number, a label and one supporting line.
function Hero({ value, label, detail }: { value: number; label: string; detail?: string }) {
  const styles = useStyles();
  const animated = useCountUpMobile(String(value), 800);
  return (
    <View style={styles.hero} accessible accessibilityLabel={`${value} ${label}${detail ? `, ${detail}` : ''}`}>
      <Text style={styles.heroValue} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {animated}
      </Text>
      <Text style={styles.heroLabel}>{label}</Text>
      {detail ? <Text style={styles.superSub}>{detail}</Text> : null}
    </View>
  );
}

/** Rating as icon + word, so a rating is never glyph or colour alone. */
function RatingTag({ rating, compact = false }: { rating: number; compact?: boolean }) {
  const t = useTokens();
  const styles = useStyles();
  return (
    <View style={styles.ratingTag}>
      <Ionicons name={RATING_IONICON[rating] ?? 'trophy'} size={compact ? iconSize.xs : iconSize.compact} color={t.colors.text.secondary} />
      <Text style={compact ? styles.ratingTagCompact : styles.ratingTagText}>{RATING_LABEL[rating] ?? `${rating}/5`}</Text>
    </View>
  );
}

const POSTER_W = 1080;
const POSTER_H = 1920;

/**
 * On-screen preview of the share poster, scaled down. A second copy of the poster:
 * the capture source stays the off-screen full-size view. Keeps its dark artwork in both themes.
 */
function PosterPreview({ children }: { children: React.ReactNode }) {
  const t = useTokens();
  const styles = useStyles();
  const { width } = useWindowDimensions();
  const previewW = Math.min(260, width - t.spacing[4] * 2);
  const scale = previewW / POSTER_W;
  const previewH = POSTER_H * scale;
  return (
    <View style={styles.previewWrap}>
      <View
        style={[styles.preview, { width: previewW, height: previewH }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
      >
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: POSTER_W,
            height: POSTER_H,
            transform: [{ translateX: previewW / 2 - POSTER_W / 2 }, { translateY: previewH / 2 - POSTER_H / 2 }, { scale }],
          }}
        >
          {children}
        </View>
      </View>
      <Text style={styles.previewCaption}>This is the image you will share</Text>
    </View>
  );
}

const money = (n: number) =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });

interface CrewWrapResponse {
  wrap: CrewWrapData;
}

/**
 * Crew wrap tab — fetches GET /ratings/crew-wrap/:crewId/:festivalId and renders
 * the shared recap, mirroring the web crew tab. Shares the off-screen poster +
 * react-native-view-shot capture pipeline used by the personal wrap.
 */
function CrewWrapTab({
  crewId,
  crewName,
  festivalId,
  festivalName,
}: {
  crewId: string | null;
  crewName: string;
  festivalId: string;
  festivalName: string;
}) {
  const t = useTokens();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [wrap, setWrap] = useState<CrewWrapData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [sharing, setSharing] = useState(false);
  // Bumped by the error-state "Try again" action to re-run the fetch (F40).
  const [reloadKey, setReloadKey] = useState(0);
  const posterRef = useRef<HostInstance>(null);

  useEffect(() => {
    if (!crewId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- genuine data-fetch side effect: flip loading on before the async GET. Not derivable — loading tracks the in-flight request, not render inputs.
    setLoading(true);
    setError(false);
    api
      .get<CrewWrapResponse>(`/ratings/crew-wrap/${crewId}/${festivalId}`)
      .then((res) => {
        if (!cancelled) setWrap(res.wrap);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [crewId, festivalId, reloadKey]);

  const hasData =
    !!wrap &&
    wrap.memberCount > 0 &&
    (wrap.topOverlap !== null || wrap.setsSeenTogether.length > 0 || wrap.totalSplit > 0);

  const handleShare = async () => {
    if (!wrap || sharing) return;
    setSharing(true);
    try {
      const uri = await captureRef(posterRef, {
        format: 'png',
        quality: 1,
        width: 1080,
        height: 1920,
        result: 'tmpfile',
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          UTI: 'public.png',
          dialogTitle: 'Share your crew wrap',
        });
      } else {
        await Share.share({
          message: `Our ${festivalName} crew wrap\n${crewName} · ${wrap.memberCount} in the crew\nfestie.us`,
        });
      }
    } catch {
      // Capture failed or sheet dismissed.
    } finally {
      setSharing(false);
    }
  };

  if (!crewId) {
    return (
      <EmptyState
        icon="people-outline"
        title="No active crew"
        message="Join or select a crew to see your shared festival recap."
      />
    );
  }
  if (loading) {
    return <WrapSkeleton />;
  }
  if (error || !wrap) {
    return (
      <EmptyState
        icon="cloud-offline-outline"
        title="Couldn't load your crew wrap"
        message="Something went wrong loading the shared recap."
        action={{ label: 'Try again', onPress: () => setReloadKey((k) => k + 1) }}
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(t.spacing[4], insets.bottom + t.spacing[2]) },
        ]}
      >
        <View style={styles.headerBlock}>
          <View style={styles.kicker}>
            <Ionicons name="people" size={iconSize.compact} color={t.colors.accent.aqua} />
            <Text style={styles.kickerText}>Crew Wrap</Text>
          </View>
          <Text style={styles.festivalName}>{crewName}</Text>
          <Text style={styles.crewFestival}>{festivalName}</Text>
        </View>

        <Hero
          value={wrap.setsSeenTogether.length}
          label="sets seen together"
          detail={[`${wrap.memberCount} in the crew`, wrap.totalSplit > 0 ? `${money(wrap.totalSplit)} split` : null]
            .filter(Boolean)
            .join(' · ')}
        />

        <View style={styles.superlative}>
          <Text style={styles.superLabel}>Most-overlapping taste</Text>
          <Text style={styles.superValue} numberOfLines={1}>
            {wrap.topOverlap ? `${wrap.topOverlap.aName} + ${wrap.topOverlap.bName}` : 'Rate more sets together'}
          </Text>
          {wrap.topOverlap ? (
            <Text style={styles.superSub}>
              {wrap.topOverlap.shared} shared favourite{wrap.topOverlap.shared === 1 ? '' : 's'}
            </Text>
          ) : null}
        </View>

        <View style={styles.superlative}>
          <Text style={styles.superLabel}>Biggest spender</Text>
          <Text style={styles.superValue} numberOfLines={1}>
            {wrap.biggestSpender ? wrap.biggestSpender.name : 'No expenses yet'}
          </Text>
          {wrap.biggestSpender ? (
            <Text style={styles.superSub}>fronted {money(wrap.biggestSpender.amount)}</Text>
          ) : null}
        </View>

        {wrap.setsSeenTogether.length > 0 ? (
          <View>
            <SectionLabel>Sets you saw together</SectionLabel>
            {wrap.setsSeenTogether.slice(0, 10).map((set) => (
              <View key={set.setId} style={styles.allRow}>
                <Text style={styles.allArtist} numberOfLines={1}>
                  {set.artist || set.setId}
                </Text>
                <Text style={styles.seenCount}>{set.count} loved it</Text>
              </View>
            ))}
          </View>
        ) : null}

        {wrap.perMember.some((m) => m.topSets.length > 0) ? (
          <View>
            <SectionLabel>Everyone&apos;s top picks</SectionLabel>
            {wrap.perMember.map((m) => (
              <View key={m.userId} style={styles.memberCard}>
                <Text style={styles.memberName}>{m.name}</Text>
                {m.topSets.length > 0 ? (
                  <Text style={styles.memberPicks} numberOfLines={2}>
                    {m.topSets.map((set) => set.artist || set.setId).join(' · ')}
                  </Text>
                ) : (
                  <Text style={styles.memberEmpty}>No sets rated 4 or higher yet</Text>
                )}
              </View>
            ))}
          </View>
        ) : null}

        {hasData ? (
          <View style={styles.shareBlock}>
            <PosterPreview>
              <CrewWrapPoster crewName={crewName} festivalName={festivalName} wrap={wrap} />
            </PosterPreview>
            <TouchableOpacity
              style={[styles.shareButton, sharing && styles.shareButtonBusy]}
              onPress={() => void handleShare()}
              disabled={sharing}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Share crew wrap"
            >
              {sharing ? (
                <ActivityIndicator size="small" color={t.colors.text.onLightAccent} />
              ) : (
                <Ionicons name="share-social-outline" size={16} color={t.colors.text.onLightAccent} />
              )}
              <Text style={styles.shareButtonText}>{sharing ? 'Preparing…' : 'Share crew wrap'}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <Text style={styles.footer}>festie.us</Text>
      </ScrollView>

      {/* Off-screen poster for capture. */}
      {hasData ? (
        <View
          ref={posterRef}
          collapsable={false}
          style={{ position: 'absolute', left: -99999, top: 0, width: 1080, height: 1920 }}
          pointerEvents="none"
        >
          <CrewWrapPoster crewName={crewName} festivalName={festivalName} wrap={wrap} />
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  skeletonWrap: {
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[4],
    gap: t.spacing[4],
  },
  skeletonHeader: {
    alignItems: 'center',
    gap: t.spacing[2],
  },
  content: {
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[4],
    gap: t.spacing[4],
  },
  headerBlock: {
    alignItems: 'center',
    gap: t.spacing[1],
  },
  kicker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
  },
  kickerText: {
    ...typeStyle('micro'),
    textTransform: 'uppercase',
    color: t.colors.accent.aqua,
  },
  festivalName: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
    textAlign: 'center',
  },
  hero: {
    alignItems: 'center',
    gap: t.spacing[1],
    paddingVertical: t.spacing[2],
  },
  heroValue: {
    fontFamily: 'ClashDisplay-Bold',
    fontSize: 48,
    lineHeight: 56,
    color: t.colors.accent.aqua,
    // No negative tracking on iOS: UIKit clips the trailing glyph.
    letterSpacing: 0,
  },
  heroLabel: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
  },
  leadCard: {
    padding: t.spacing[4],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
    gap: t.spacing[1],
    marginBottom: t.spacing[2],
  },
  leadArtist: {
    ...typeStyle('heading'),
    color: t.colors.text.primary,
  },
  rank: {
    ...typeStyle('label'),
    width: 20,
    textAlign: 'right',
    color: t.colors.text.muted,
  },
  ratingTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
  },
  ratingTagText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  ratingTagCompact: {
    ...typeStyle('micro'),
    color: t.colors.text.secondary,
  },
  momentCard: {
    padding: t.spacing[4],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.ring.aqua,
    gap: t.spacing[1],
  },
  momentLink: {
    minHeight: 44,
    justifyContent: 'center',
  },
  momentLinkText: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
    textDecorationLine: 'underline',
  },
  shareBlock: {
    gap: t.spacing[3],
  },
  previewWrap: {
    alignItems: 'center',
    gap: t.spacing[2],
  },
  preview: {
    overflow: 'hidden',
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
  },
  previewCaption: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
    marginBottom: t.spacing[2],
  },
  topInfo: {
    flex: 1,
    gap: t.spacing[1],
  },
  topMeta: {
    ...typeStyle('micro'),
    // Load-bearing (rank + stage name), not decorative — bumped from muted for contrast.
    color: t.colors.text.secondary,
  },
  topArtist: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  topNote: {
    ...typeStyle('caption'),
    fontStyle: 'italic',
    color: t.colors.text.secondary,
  },
  allRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border.default,
  },
  allArtist: {
    ...typeStyle('caption'),
    color: t.colors.text.primary,
    flex: 1,
  },
  allStage: {
    ...typeStyle('micro'),
    // Load-bearing (stage name), not decorative — bumped from muted for contrast.
    color: t.colors.text.secondary,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[2],
    // Accent rule (F13): aqua = primary action with dark ink; coral is danger-only.
    backgroundColor: t.colors.accent.aqua,
    borderRadius: t.radii.default,
    paddingVertical: t.spacing[3],
  },
  shareButtonBusy: {
    opacity: 0.7,
  },
  shareButtonText: {
    ...typeStyle('label'),
    color: t.colors.text.onLightAccent,
  },
  footer: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
    textAlign: 'center',
    paddingTop: t.spacing[2],
  },
  tabBar: {
    flexDirection: 'row',
    gap: t.spacing[1],
    margin: t.spacing[4],
    marginBottom: 0,
    padding: t.spacing[1],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.sm,
  },
  tabActive: {
    // Aqua selection (F13) to match the SegmentedControl/plan-share active tab.
    backgroundColor: t.colors.accent.aqua,
  },
  tabText: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  tabTextActive: {
    color: t.colors.text.onLightAccent,
  },
  crewFestival: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    textAlign: 'center',
  },
  superlative: {
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
    gap: t.spacing[1],
  },
  superLabel: {
    ...typeStyle('micro'),
    textTransform: 'uppercase',
    color: t.colors.text.muted,
  },
  superValue: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  superSub: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  seenCount: {
    ...typeStyle('micro'),
    color: t.colors.accent.aqua,
  },
  memberCard: {
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
    marginBottom: t.spacing[2],
    gap: t.spacing[1],
  },
  memberName: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  memberPicks: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  memberEmpty: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
  },
}));
