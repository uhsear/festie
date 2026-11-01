import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { PHASE_ACTION_LABELS, PHASE_ACTION_ORDER } from '@festie/shared/utils';
import type { FestivalPhase, PhaseActionKey } from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';

interface ActionDef {
  icon: keyof typeof Ionicons.glyphMap;
  href: string;
  a11y: string;
  /** Safety-adjacent destination (live map / SOS) → coral icon per the accent rule. */
  danger?: boolean;
}

// Fixed destination set. Phase never adds or removes a destination — it only
// reorders and re-emphasizes — so everything stays reachable in every phase.
const ACTIONS: Record<PhaseActionKey, ActionDef> = {
  myPlan: { icon: 'star', href: '/(tabs)/picks', a11y: 'Open my plan' },
  crew: { icon: 'people', href: '/(tabs)/crew', a11y: 'Open crew' },
  map: { icon: 'map', href: '/(tabs)/map', a11y: 'Open the map: crew, meeting points and SOS', danger: true },
  nownext: { icon: 'flash', href: '/festival-mode', a11y: 'Open Now and Next' },
  wrap: { icon: 'sparkles', href: '/wrap', a11y: 'Open festival wrap-up' },
};

const PHASE_HEADING: Record<FestivalPhase, { label: string; hint: string }> = {
  pre: { label: 'Before the festival', hint: 'Lock in your picks and rally your crew.' },
  live: { label: 'Happening now', hint: 'Find your crew, check Now & Next, stay safe.' },
  post: { label: 'Festival wrap', hint: 'Relive it and settle up with your crew.' },
};

interface PhaseHomeActionsProps {
  phase: FestivalPhase;
}

/**
 * P1-5 — phase-aware home actions. A compact, horizontally-scrolling shortcut
 * band on the Schedule landing that re-prioritizes the crew's destinations by
 * festival PHASE (derived from the date range vs now via shared `festivalPhase`):
 *  - pre  → My Plan / crew invites lead
 *  - live → Map (crew/SOS/meeting) + crew lead; Now & Next stays one tap away
 *  - post → festival wrap + settle-up lead
 *
 * The destination set is fixed — phase only reorders —
 * so nothing is ever hidden, only re-prioritized.
 */
export default function PhaseHomeActions({ phase }: PhaseHomeActionsProps) {
  const t = useTokens();
  const styles = useStyles();
  const router = useRouter();

  const order = PHASE_ACTION_ORDER[phase];
  const heading = PHASE_HEADING[phase];

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>{heading.label}</Text>
      <Text style={styles.hint}>{heading.hint}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {order.map((key) => {
          const a = ACTIONS[key];
          const iconColor = a.danger ? t.colors.accent.coral : t.colors.text.secondary;
          return (
            <TouchableOpacity
              key={key}
              testID={`phase-action-${key}`}
              style={styles.chip}
              // Tab destinations switch tabs (navigate dedupes to the existing
              // tab instance); the root-level pushed routes (Now & Next,
              // Wrap) must PUSH so Back pops cleanly to the schedule with the
              // festival context intact. router.navigate on those cross-navigator
              // routes warps the stack — on a past festival it dropped the
              // back-to-schedule entry, popping the user out to festival-select /
              // the OS home screen on Back.
              onPress={() => (a.href.startsWith('/(tabs)') ? router.navigate(a.href) : router.push(a.href))}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={a.a11y}
            >
              <Ionicons name={a.icon} size={16} color={iconColor} />
              <Text style={styles.chipText} numberOfLines={1}>
                {PHASE_ACTION_LABELS[key]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: {
    gap: t.spacing[1],
    // Separate the phase block from the filter controls above it.
    marginTop: t.spacing[3],
    paddingBottom: t.spacing[2],
  },
  heading: {
    // typeStyle('caption', 700) selects SpaceGrotesk_700Bold — correct cut.
    // Spreading typeStyle() then overriding fontWeight is inert on native
    // because the weighted fontFamily wins (F4 faux-bold fix).
    ...typeStyle('caption', 700),
    color: t.colors.text.muted,
    textTransform: 'uppercase',
  },
  hint: {
    // Downsize to micro so the hint reads as contextual annotation rather than
    // competing with the filter controls in the same visual register.
    ...typeStyle('micro'),
    color: t.colors.text.secondary,
    marginBottom: t.spacing[1],
  },
  row: {
    gap: t.spacing[2],
    paddingVertical: t.spacing[1],
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    // WCAG 2.5.5 / 2.5.8 minimum 44px touch target — matches the day/filter chips.
    minHeight: 44,
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  chipText: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
}));
