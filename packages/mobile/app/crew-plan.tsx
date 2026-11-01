import type { ReactNode } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore, useFestivalStore } from '@festie/shared/stores';
import { useActiveCrew, useCrewFestival, useCrewHub, useFestival, usePicks } from '@festie/shared/hooks';
import { artistDisplayName, formatTime, memberSummary, timeAgo } from '@festie/shared/utils';
import { PRIORITY_LABEL } from '@festie/shared/constants';
import type { FestivalSet, Priority } from '@festie/shared/types';
import { useTokens, makeStyles, typeStyle, iconSize, MAX_FONT_SCALE } from '../hooks/useTokens';
import { priorityIconName } from '../lib/prioritySymbol';
import { priorityColor } from '../lib/priorityColor';
import { useListBottomInset } from '../hooks/useListBottomInset';
import { useNow } from '../hooks/useNow';
import FreshnessChip from '../components/FreshnessChip';
import EmptyState from '../components/EmptyState';
import LoadingState from '../components/LoadingState';
import Button from '../components/Button';

// The plan renders from the persisted stores first (useCrewHub), then refreshes
// statuses, meeting points and polls. Pure assembly lives in @festie/shared.

const openCrewTab = (tab: 'find' | 'members' | 'plan') =>
  router.push({ pathname: '/(tabs)/crew', params: { tab } });

export default function CrewPlanScreen() {
  const t = useTokens();
  const styles = useStyles();
  const bottomPad = useListBottomInset({ base: t.spacing[4] });

  const user = useAuthStore((s) => s.user);
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const { getStageName } = useFestival();
  const { savePick } = usePicks();
  const nowMs = useNow();
  const { status, crew, retry: retryCrew } = useActiveCrew();
  const festival = useCrewFestival(crew);
  const hub = useCrewHub(nowMs);

  const gate = (children: ReactNode) => (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: crew ? `${crew.name}'s plan` : 'Crew plan', headerShown: true }} />
      {children}
    </View>
  );

  if (!user) {
    return gate(<EmptyState icon="lock-closed" title="Sign in required" message="Log in to see your crew's plan." />);
  }
  if (status === 'loading') return gate(<LoadingState label="Loading your crew…" />);
  if (status === 'error') {
    return gate(
      <EmptyState
        icon="cloud-offline-outline"
        title="Couldn't load your crew"
        message="Check your connection, then try again."
        action={{ label: 'Try again', onPress: retryCrew }}
      />,
    );
  }
  if (status === 'none') {
    return gate(
      <EmptyState
        icon="people-outline"
        title="No crew yet"
        message="Make a crew or join one with a code to plan together."
        action={{ label: 'Create or join a crew', onPress: () => router.navigate('/(tabs)/crew') }}
      />,
    );
  }
  if (festival.state === 'switching') return gate(<LoadingState label={`Opening ${festival.festivalName}…`} />);
  if (festival.state === 'failed') {
    return gate(
      <EmptyState
        icon="cloud-offline-outline"
        title={`Couldn't open ${festival.festivalName}`}
        message={`${crew?.name} is planning ${festival.festivalName}. Connect to the internet, then try again.`}
        action={{ label: 'Try again', onPress: festival.retry }}
      />,
    );
  }
  if (!crew) return gate(<LoadingState label="Loading your crew…" />);

  const openSet = (set: FestivalSet) => router.push(`/set/${set.id}`);
  const addPick = (set: FestivalSet, priority: Priority) => {
    if (!currentFestival) return;
    savePick(currentFestival.id, set.id, priority).catch((err) => console.warn('Add pick failed', err));
  };
  const mixRow = (set: FestivalSet, text: string) => (
    <TouchableOpacity
      key={set.id}
      style={styles.mixRow}
      onPress={() => openSet(set)}
      accessibilityRole="button"
      accessibilityLabel={`Open ${artistDisplayName(set)}. ${text}`}
    >
      <Text style={styles.pickMember}>{artistDisplayName(set)}</Text>
      <Text style={styles.secondaryLine}>{text}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: `${crew.name}'s plan`, headerShown: true }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}>
        <FreshnessChip surface="crew" />
        <Text style={styles.secondaryLine}>{`${hub.festivalName ?? festival.festivalName} · ${hub.memberCount} members`}</Text>

        {/* Active meeting point */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            {/* Aqua, not coral: "Meet up" is a neutral location/navigation
                feature. Coral is reserved for danger/SOS only (one-accent rule);
                the live map's equivalent meeting-point pin is neutral, so a coral
                icon here was an inconsistent accent misuse. */}
            <Ionicons name="location" size={iconSize.action} color={t.colors.accent.aqua} />
            <Text style={styles.cardTitle}>Meet up</Text>
          </View>
          {hub.meetingPoint ? (
            <View style={styles.cardBody}>
              <Text style={styles.primaryLine}>{hub.meetingPoint.label}</Text>
              <Text style={styles.secondaryLine}>{hub.meetingPoint.location}</Text>
              {hub.meetingPoint.meet_at ? (
                <Text style={styles.accentLine}>
                  {new Date(hub.meetingPoint.meet_at).toLocaleString([], {
                    weekday: 'short',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </Text>
              ) : null}
            </View>
          ) : (
            <>
              <Text style={styles.emptyLine}>No meeting point yet.</Text>
              <Button label="Add meeting point" variant="secondary" size="sm" onPress={() => openCrewTab('find')} />
            </>
          )}
        </View>

        {/* Crew home base */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="home" size={iconSize.action} color={t.colors.accent.aqua} />
            <Text style={styles.cardTitle}>Home base</Text>
          </View>
          {crew.homeBaseLocation || crew.homeBaseTime ? (
            <View style={styles.cardBody}>
              {crew.homeBaseLocation ? <Text style={styles.primaryLine}>{crew.homeBaseLocation}</Text> : null}
              {crew.homeBaseTime ? <Text style={styles.secondaryLine}>{crew.homeBaseTime}</Text> : null}
            </View>
          ) : hub.isOwner ? (
            <>
              <Text style={styles.emptyLine}>No home base yet.</Text>
              <Button label="Set home base" variant="secondary" size="sm" onPress={() => openCrewTab('find')} />
            </>
          ) : (
            <Text style={styles.emptyLine}>{`No home base yet. Ask ${hub.ownerName ?? 'the crew owner'} to set one.`}</Text>
          )}
        </View>

        {hub.isPast ? (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="trophy" size={iconSize.action} color={t.colors.accent.aqua} />
              <Text style={styles.cardTitle}>How the crew did</Text>
            </View>
            {hub.howWeDid.length === 0 ? (
              <Text style={styles.emptyLine}>Your crew had no picks in common at this festival.</Text>
            ) : (
              hub.howWeDid.map((e) => mixRow(e.set, `${e.count} of ${e.total} picked it`))
            )}
            <Button label="See your Wrap" variant="secondary" size="sm" onPress={() => router.push('/wrap')} />
          </View>
        ) : (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="time" size={iconSize.action} color={t.colors.accent.aqua} />
              <Text style={styles.cardTitle}>Up next</Text>
            </View>
            {hub.upNext.length === 0 ? (
              <>
                <Text style={styles.emptyLine}>No crew picks coming up.</Text>
                <Button label="Browse the lineup" variant="secondary" size="sm" onPress={() => router.navigate('/(tabs)')} />
                <Button label="Invite your crew" variant="secondary" size="sm" onPress={() => openCrewTab('members')} />
              </>
            ) : (
              <View style={styles.slotList}>
                {hub.upNext.map((slot) => (
                  <View key={slot.startMs} style={styles.slot}>
                    <Text style={styles.slotTime}>{slot.startTime ? formatTime(slot.startTime) : 'Soon'}</Text>
                    {slot.groups.map((g) => {
                      const artist = artistDisplayName(g.set);
                      const names = memberSummary(g.names);
                      const stage = getStageName(g.set.stageId);
                      return (
                        <View key={g.set.id} style={styles.pickRow}>
                          <TouchableOpacity
                            style={styles.pickLink}
                            onPress={() => openSet(g.set)}
                            accessibilityRole="button"
                            accessibilityLabel={`Open ${artist}. ${names}`}
                          >
                            <View style={styles.priorityBadge}>
                              <Ionicons name={priorityIconName(g.priority)} size={iconSize.xs} color={priorityColor(t, g.priority)} />
                              <Text style={styles.priorityText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                                {PRIORITY_LABEL[g.priority]}
                              </Text>
                            </View>
                            <Text style={styles.pickSet}>
                              <Text style={styles.pickMember}>{artist}</Text>
                              {stage ? ` · ${stage}` : ''}
                              {` · ${names}`}
                            </Text>
                          </TouchableOpacity>
                          {hub.myPicks[g.set.id] ? null : (
                            <Button
                              label="Add"
                              variant="utility"
                              size="sm"
                              accessibilityLabel={`Add ${artist} to my picks`}
                              onPress={() => addPick(g.set, g.priority)}
                            />
                          )}
                        </View>
                      );
                    })}
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {!hub.isPast && hub.mix.length > 0 ? (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="people" size={iconSize.action} color={t.colors.accent.aqua} />
              <Text style={styles.cardTitle}>Crew mix</Text>
            </View>
            {hub.mix.map((e) => mixRow(e.set, `${e.count} of ${e.total} want this`))}
          </View>
        ) : null}

        {hub.whereabouts.length > 0 ? (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="navigate" size={iconSize.action} color={t.colors.accent.aqua} />
              <Text style={styles.cardTitle}>Where everyone is</Text>
            </View>
            {hub.whereabouts.map((w) => {
              const detail = w.sos ? 'Sent an SOS' : w.live === 'live' ? 'Sharing live location' : w.statusLabel;
              const at = w.liveAt ?? w.statusAt;
              return (
                <Text key={w.userId} style={styles.secondaryLine}>
                  {[w.name, detail, at != null ? timeAgo(at) : null].filter(Boolean).join(' · ')}
                </Text>
              );
            })}
            <Button label="Open crew" variant="secondary" size="sm" onPress={() => openCrewTab('find')} />
          </View>
        ) : null}

        {hub.openPolls.length > 0 ? (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="bar-chart" size={iconSize.action} color={t.colors.accent.aqua} />
              <Text style={styles.cardTitle}>Open polls</Text>
            </View>
            {hub.openPolls.slice(0, 2).map((p) => (
              <Text key={p.id} style={styles.secondaryLine}>{p.question}</Text>
            ))}
            {hub.openPolls.length > 2 ? <Text style={styles.emptyLine}>{`+${hub.openPolls.length - 2} more`}</Text> : null}
            <Button label="Vote" variant="secondary" size="sm" onPress={() => openCrewTab('plan')} />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  content: {
    padding: t.spacing[4],
    gap: t.spacing[3],
  },
  card: {
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
    padding: t.spacing[4],
    gap: t.spacing[2],
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  cardTitle: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  cardBody: {
    gap: t.spacing[1],
  },
  primaryLine: {
    ...typeStyle('body', 600),
    color: t.colors.text.primary,
  },
  secondaryLine: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  accentLine: {
    ...typeStyle('caption', 600),
    color: t.colors.accent.aqua,
  },
  emptyLine: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  slotList: {
    gap: t.spacing[3],
  },
  slot: {
    gap: t.spacing[2],
  },
  slotTime: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    textTransform: 'uppercase',
  },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  pickLink: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  mixRow: {
    paddingVertical: t.spacing[1],
    gap: t.spacing[1],
  },
  priorityBadge: {
    paddingHorizontal: t.spacing[2],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.bg.elevated,
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
  },
  priorityText: {
    ...typeStyle('caption', 700),
    // Primary text on the elevated badge; the icon carries the priority color.
    color: t.colors.text.primary,
  },
  pickMember: {
    ...typeStyle('body', 600),
    color: t.colors.text.primary,
    flexShrink: 1,
  },
  pickSet: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
    flexShrink: 1,
  },
}));
