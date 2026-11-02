import { useState, type ReactNode } from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { FestivalSet } from '@festie/shared/types';
import {
  artistDisplayName,
  fmtStartsIn,
  fmtZonedWeekday,
  fmtTimeLeft,
  fmtZonedClock,
  fmtZonedDayClock,
  settleUpLine,
  timeAgo,
  type ActiveMeet,
  type CrewWhereabout,
  type NowNextSelection,
} from '@festie/shared/utils';
import { COPY } from '@festie/shared/constants';
import { CONCEPT_IONICON } from '../lib/conceptIcons';
import { makeStyles, typeStyle, useTokens, iconSize } from '../hooks/useTokens';
import AppPressable from './AppPressable';
import Avatar from './Avatar';
import Button from './Button';
import LiveDot from './LiveDot';
import SectionLabel from './SectionLabel';
import DisplayWords from './DisplayWords';

/**
 * Building blocks of the day-of Now & Next screen (app/festival-mode.tsx):
 * the NOW/NEXT hero, crew whereabouts, the meeting point and Up Next. Every
 * time is in the festival zone and every figure is tabular.
 */

// Countdown turns coral when a set is this close.
const IMMINENT_MIN = 5;
const DAY_MS = 86_400_000;
const MAX_CREW_ROWS = 5;

type IconName = keyof typeof Ionicons.glyphMap;

function Quiet({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: ReactNode }) {
  const t = useTokens();
  const s = useStyles();
  return (
    <View style={s.card}>
      <View style={s.quietRow}>
        <Ionicons name={icon} size={iconSize.md} color={t.colors.text.muted} />
        <View style={s.flex}>
          <Text style={s.quietTitle}>{title}</Text>
          {body ? <Text style={s.secondary}>{body}</Text> : null}
        </View>
      </View>
      {action}
    </View>
  );
}

interface HeroProps {
  selection: NowNextSelection;
  nowMs: number;
  timeZone?: string;
  b2bSeparator?: string;
  lineupMode: boolean;
  getStageName: (stageId: string) => string | undefined;
  onOpenSet: (set: FestivalSet) => void;
  onBrowse: () => void;
  onWrap?: () => void;
}

export function NowHero({
  selection,
  nowMs,
  timeZone,
  b2bSeparator,
  lineupMode,
  getStageName,
  onOpenSet,
  onBrowse,
  onWrap,
}: HeroProps) {
  const t = useTokens();
  const s = useStyles();
  const { phase, current, upcoming, todayCount, startsAt, startsAtTimed } = selection;
  const live = current.length > 0;
  const next = upcoming[0];
  const name = (set: FestivalSet) => artistDisplayName(set, b2bSeparator);
  const heading = lineupMode ? 'Now on the lineup' : 'Now';

  let body: ReactNode;
  if (live) {
    body = current.map(({ set, end }) => {
      const stage = getStageName(set.stageId) || '';
      return (
        <AppPressable
          key={set.id}
          style={[s.card, s.liveCard]}
          onPress={() => onOpenSet(set)}
          accessibilityRole="button"
          accessibilityLabel={`${name(set)} playing now${stage ? ` at ${stage}` : ''}, ${fmtTimeLeft(end, nowMs)}. Open details`}
        >
          <Text style={s.artist}>
            <DisplayWords text={name(set)} fontSize={s.artist.fontSize} />
          </Text>
          {stage ? <Text style={s.secondary}>{stage}</Text> : null}
          <View style={s.metaRow}>
            <Text style={s.figure}>until {fmtZonedClock(end, timeZone)}</Text>
            <Text style={s.figureMuted}>{fmtTimeLeft(end, nowMs)}</Text>
          </View>
        </AppPressable>
      );
    });
  } else if (phase === 'none') {
    body = (
      <Quiet icon="calendar-outline" title="Set times aren't out yet" body="Now and next appear once the schedule is published." />
    );
  } else if (phase === 'before') {
    const far = startsAt !== null && startsAt - nowMs >= DAY_MS / 2;
    const days = startsAt !== null ? Math.ceil((startsAt - nowMs) / DAY_MS) : 0;
    body = (
      <Quiet
        icon="calendar-outline"
        title={
          startsAt === null
            ? 'Not started yet'
            : startsAtTimed
              ? `Starts ${fmtZonedDayClock(startsAt, timeZone)}`
              : `Starts ${fmtZonedWeekday(startsAt, timeZone)}`
        }
        body={
          startsAt === null
            ? undefined
            : far
              ? `In ${days} day${days === 1 ? '' : 's'}.`
              : !startsAtTimed
                ? undefined
                : `First set ${fmtStartsIn(startsAt, nowMs, timeZone)}.`
        }
      />
    );
  } else if (phase === 'after') {
    body = (
      <Quiet
        icon={CONCEPT_IONICON.wrap}
        title="That's a wrap"
        body="The festival is over."
        action={onWrap ? <Button label={COPY.wrap.open} variant="secondary" onPress={onWrap} /> : undefined}
      />
    );
  } else if (!lineupMode && todayCount === 0) {
    body = (
      <Quiet
        icon="star-outline"
        title="No picks today"
        body={
          next
            ? `Your next pick is ${name(next.set)}, ${fmtStartsIn(next.start, nowMs, timeZone)}.`
            : 'Pick the sets you want to see today.'
        }
        action={<Button label="Browse lineup" variant="secondary" onPress={onBrowse} />}
      />
    );
  } else if (next) {
    const stage = getStageName(next.set.stageId) || '';
    const imminent = Math.floor((next.start - nowMs) / 60_000) <= IMMINENT_MIN;
    const startsIn = fmtStartsIn(next.start, nowMs, timeZone);
    body = (
      <AppPressable
        style={s.card}
        onPress={() => onOpenSet(next.set)}
        accessibilityRole="button"
        accessibilityLabel={`Next: ${name(next.set)}${stage ? ` at ${stage}` : ''}, ${startsIn}. Open details`}
      >
        <SectionLabel style={s.flushLabel}>Next</SectionLabel>
        <Text style={s.artist}>
          <DisplayWords text={name(next.set)} fontSize={s.artist.fontSize} />
        </Text>
        <View style={s.nextRow}>
          {stage ? (
            <View style={s.walk}>
              <Ionicons name="walk-outline" size={iconSize.sm} color={t.colors.accent.aqua} />
              <Text style={s.walkText}>Head to {stage}</Text>
            </View>
          ) : null}
          <View style={s.countdownRow}>
            <Text style={[s.countdown, imminent && s.countdownImminent]}>{startsIn}</Text>
            <Text style={s.figureMuted}>{fmtZonedClock(next.start, timeZone)}</Text>
          </View>
        </View>
      </AppPressable>
    );
  } else {
    body = (
      <Quiet
        icon="musical-notes-outline"
        title={lineupMode ? 'Nothing else on today' : 'No more picks today'}
        body={lineupMode ? undefined : "You've seen everything on your list."}
      />
    );
  }

  return (
    <View style={s.section}>
      <View style={s.headingRow}>
        {live ? <LiveDot label={heading.toUpperCase()} live={live} /> : <SectionLabel style={s.flushLabel}>{heading}</SectionLabel>}
      </View>
      {body}
    </View>
  );
}

function Freshness({ row }: { row: CrewWhereabout }) {
  const t = useTokens();
  const s = useStyles();
  if (row.sos) return <Text style={s.sosTag}>SOS</Text>;
  if (row.live === 'live') {
    return (
      <View style={s.fresh}>
        <View style={[s.dot, { backgroundColor: t.colors.confidence.live }]} />
        <Text style={s.freshText}>Live</Text>
      </View>
    );
  }
  if (row.live === 'stale' && row.liveAt) {
    return (
      <View style={s.fresh}>
        <View style={[s.dot, s.ring, { borderColor: t.colors.confidence.aging }]} />
        <Text style={s.freshMuted}>Seen {timeAgo(row.liveAt)}</Text>
      </View>
    );
  }
  return null;
}

export function CrewNow({ crewName, rows, onOpenCrew }: { crewName: string; rows: CrewWhereabout[]; onOpenCrew: () => void }) {
  const s = useStyles();
  const t = useTokens();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, MAX_CREW_ROWS);
  const more = rows.length - MAX_CREW_ROWS;
  return (
    <View style={s.section}>
      <SectionLabel style={s.flushLabel}>{crewName}</SectionLabel>
      <View style={s.list}>
        {shown.length === 0 ? (
          <Text style={[s.secondary, s.listPad]}>Nobody else in your crew yet.</Text>
        ) : (
          shown.map((row, i) => (
            <View key={row.userId} style={[s.crewRow, i > 0 && s.divider]}>
              <Avatar name={row.name} size="sm" />
              <View style={s.flex}>
                <Text style={s.rowTitle} numberOfLines={1}>
                  {row.name}
                </Text>
                <Text style={s.rowMeta} numberOfLines={1}>
                  {row.statusLabel ? `${row.statusLabel}${row.statusAt ? ` · ${timeAgo(row.statusAt)}` : ''}` : 'No status yet'}
                </Text>
              </View>
              <Freshness row={row} />
            </View>
          ))
        )}
        {more > 0 ? (
          <AppPressable
            onPress={() => setExpanded((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: t.spacing[4] }}
          >
            <Text style={[s.rowMeta, { color: t.colors.accent.aqua }]}>{expanded ? 'Show fewer' : `Show ${more} more`}</Text>
          </AppPressable>
        ) : null}
      </View>
      <Button label="Find your crew" icon="people" onPress={onOpenCrew} />
    </View>
  );
}

export function MeetNow({
  meet,
  nowMs,
  timeZone,
  onOpen,
}: {
  meet: ActiveMeet | null;
  nowMs: number;
  timeZone?: string;
  onOpen: () => void;
}) {
  const t = useTokens();
  const s = useStyles();
  let when: string | null = null;
  if (meet?.atMs) {
    when = `${fmtZonedClock(meet.atMs, timeZone)} · ${meet.atMs > nowMs ? fmtStartsIn(meet.atMs, nowMs, timeZone) : 'now'}`;
  } else if (meet?.timeText) {
    when = meet.timeText;
  }
  return (
    <View style={s.section}>
      <SectionLabel style={s.flushLabel}>Where we meet</SectionLabel>
      <AppPressable
        style={[s.card, s.meetRow]}
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={
          meet
            ? `${meet.label}${meet.location ? `, ${meet.location}` : ''}${when ? `, ${when}` : ''}. Open`
            : 'No meeting point yet. Add one'
        }
      >
        <Ionicons
          name={meet?.kind === 'home-base' ? 'home-outline' : 'location-outline'}
          size={iconSize.md}
          color={t.colors.accent.aqua}
        />
        <View style={s.flex}>
          {meet ? (
            <>
              <Text style={s.meetTitle}>{meet.label}</Text>
              {meet.location && meet.location !== meet.label ? <Text style={s.secondary}>{meet.location}</Text> : null}
              {when ? <Text style={s.figure}>{when}</Text> : null}
            </>
          ) : (
            <>
              <Text style={s.rowTitle}>No meeting point yet</Text>
              <Text style={s.rowMeta}>Add one so the crew knows where to regroup.</Text>
            </>
          )}
        </View>
        <Ionicons name="chevron-forward" size={iconSize.sm} color={t.colors.text.secondary} />
      </AppPressable>
    </View>
  );
}

export function CrewPrompt({ title, body, cta, onPress }: { title: string; body: string; cta: string; onPress: () => void }) {
  const t = useTokens();
  const s = useStyles();
  return (
    <View style={[s.card, s.section]}>
      <View style={s.quietRow}>
        <Ionicons name="people-outline" size={iconSize.md} color={t.colors.accent.aqua} />
        <View style={s.flex}>
          <Text style={s.quietTitle}>{title}</Text>
          <Text style={s.secondary}>{body}</Text>
        </View>
      </View>
      <Button label={cta} onPress={onPress} />
    </View>
  );
}

export function CrewWrapUp({
  crewName,
  balance,
  onSettle,
  onReform,
}: {
  crewName: string;
  balance: number;
  onSettle: () => void;
  onReform: () => void;
}) {
  const t = useTokens();
  const s = useStyles();
  return (
    <View style={[s.card, s.section]}>
      <View style={s.quietRow}>
        <Ionicons name="people-outline" size={iconSize.md} color={t.colors.accent.aqua} />
        <View style={s.flex}>
          <Text style={s.quietTitle}>Wrap up with {crewName}</Text>
          <Text style={s.secondary}>{settleUpLine(balance)}</Text>
        </View>
      </View>
      <Button label={Math.abs(balance) > 0.01 ? 'Settle up' : 'See expenses'} onPress={onSettle} />
      <Button label="Reform this crew for another festival" variant="secondary" onPress={onReform} />
    </View>
  );
}

export function UpNext({
  items,
  nowMs,
  timeZone,
  b2bSeparator,
  getStageName,
  onOpenSet,
}: {
  items: NowNextSelection['upcoming'];
  nowMs: number;
  timeZone?: string;
  b2bSeparator?: string;
  getStageName: (stageId: string) => string | undefined;
  onOpenSet: (set: FestivalSet) => void;
}) {
  const t = useTokens();
  const s = useStyles();
  if (items.length === 0) return null;
  return (
    <View style={s.section}>
      <View style={s.headingRow}>
        <Ionicons name="play-skip-forward" size={iconSize.compact} color={t.colors.text.secondary} />
        <SectionLabel style={s.flushLabel}>Up next</SectionLabel>
      </View>
      <View style={s.list}>
        {items.map(({ set, start }, i) => {
          const name = artistDisplayName(set, b2bSeparator);
          const stage = getStageName(set.stageId) || '';
          const startsIn = fmtStartsIn(start, nowMs, timeZone);
          return (
            <AppPressable
              key={set.id}
              style={[s.nextItem, i > 0 && s.divider]}
              onPress={() => onOpenSet(set)}
              accessibilityRole="button"
              accessibilityLabel={`${name}${stage ? ` at ${stage}` : ''}, ${startsIn}. Open details`}
            >
              <Text style={[s.figure, s.timeCol]}>{fmtZonedClock(start, timeZone)}</Text>
              <View style={s.flex}>
                <Text style={s.rowTitle}>{name}</Text>
                {stage ? (
                  <Text style={s.rowMeta} numberOfLines={1}>
                    {stage}
                  </Text>
                ) : null}
              </View>
              <Text style={s.startsIn}>{startsIn}</Text>
            </AppPressable>
          );
        })}
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  section: { gap: t.spacing[2] },
  flex: { flex: 1, minWidth: 0, gap: t.spacing[1] },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: t.spacing[2], minHeight: 20 },
  flushLabel: { marginBottom: 0 },
  card: {
    padding: t.spacing[4],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
    gap: t.spacing[2],
  },
  // Live is the one glowing state on this screen (Glow Means State).
  liveCard: {
    borderColor: t.colors.accent.coral,
    backgroundColor: t.colors.ring.coral,
  },
  artist: { ...typeStyle('heading'), color: t.colors.text.primary },
  secondary: { ...typeStyle('label'), color: t.colors.text.secondary },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: t.spacing[3], rowGap: t.spacing[1] },
  figure: { ...typeStyle('numeral', 600), color: t.colors.text.primary },
  figureMuted: { ...typeStyle('numeral'), color: t.colors.text.secondary },
  nextRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    columnGap: t.spacing[4],
    rowGap: t.spacing[2],
    marginTop: t.spacing[1],
  },
  walk: { flexDirection: 'row', alignItems: 'center', gap: t.spacing[1], flexShrink: 1 },
  walkText: { ...typeStyle('label'), color: t.colors.text.primary, flexShrink: 1 },
  countdownRow: { flexDirection: 'row', alignItems: 'baseline', gap: t.spacing[2] },
  countdown: { ...typeStyle('heading'), fontVariant: ['tabular-nums'], color: t.colors.accent.aqua },
  countdownImminent: { color: t.colors.accent.coral },
  quietRow: { flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing[3] },
  quietTitle: { ...typeStyle('title'), color: t.colors.text.primary },
  list: {
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
    overflow: 'hidden',
  },
  listPad: { padding: t.spacing[4] },
  divider: { borderTopWidth: 1, borderTopColor: t.colors.border.default },
  crewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[2],
    minHeight: 56,
  },
  rowTitle: { ...typeStyle('label', 600), color: t.colors.text.primary },
  rowMeta: { ...typeStyle('caption'), color: t.colors.text.secondary },
  fresh: { flexDirection: 'row', alignItems: 'center', gap: t.spacing[1] },
  dot: { width: 8, height: 8, borderRadius: 4 },
  ring: { backgroundColor: 'transparent', borderWidth: 2 },
  freshText: { ...typeStyle('caption', 600), color: t.colors.text.primary },
  freshMuted: { ...typeStyle('numeral'), color: t.colors.text.secondary },
  sosTag: { ...typeStyle('micro'), color: t.colors.accent.coral },
  meetRow: { flexDirection: 'row', alignItems: 'center', gap: t.spacing[3], minHeight: 64 },
  meetTitle: { ...typeStyle('title'), color: t.colors.text.primary },
  nextItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    minHeight: 56,
  },
  timeCol: { width: 72 },
  startsIn: { ...typeStyle('numeral'), color: t.colors.accent.aqua },
}));
