import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { HomeAction, HomeActionKey } from '@festie/shared/utils';
import { CONCEPT_IONICON } from '../lib/conceptIcons';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';

interface ActionTarget {
  icon: keyof typeof Ionicons.glyphMap;
  href: string;
  /** Safety-adjacent destination (live map) -> coral icon per the accent rule. */
  danger?: boolean;
}

// Destinations for the link actions. 'first-pick' is a hint and never navigates.
// Find lives on the Map tab, so it switches tabs instead of pushing a route.
const TARGETS: Record<Exclude<HomeActionKey, 'first-pick'>, ActionTarget> = {
  crew: { icon: 'people', href: '/(tabs)/crew' },
  find: { icon: CONCEPT_IONICON.find, href: '/(tabs)/map', danger: true },
  wrap: { icon: CONCEPT_IONICON.wrap, href: '/wrap' },
  settle: { icon: 'wallet-outline', href: '/(tabs)/crew' },
};

const COMPACT_HIT_SLOP = { top: 6, bottom: 6, left: 6, right: 6 };

interface PhaseHomeActionsProps {
  actions: HomeAction[];
  /** When set, a close button hides the band for this festival and phase. */
  onDismiss?: () => void;
  /** Slim variant for the schedule status line: no band margin, small chips with hit slop. */
  compact?: boolean;
  /** With `compact`, return the chips bare so the caller's row lays them out (no wrapping wrapper). */
  inline?: boolean;
}

/**
 * Next-step band on the Schedule landing. The caller computes `actions` with
 * shared `getHomeActions` (picks and crew before the festival, finding the crew
 * during it, wrap and settle-up after) and mounts this only when the list is
 * not empty. Tab destinations are not repeated here: the tab bar already
 * carries them. A `hint` renders as a plain chip, not a button.
 */
export default function PhaseHomeActions({ actions, onDismiss, compact, inline }: PhaseHomeActionsProps) {
  const t = useTokens();
  const styles = useStyles();
  const router = useRouter();

  // The trailing no-break space absorbs Fabric's one-glyph under-measure of a Text after an icon sibling.
  const content = (
    <>
      {actions.map((a) => {
        if (a.kind === 'hint' || a.key === 'first-pick') {
          return (
            <View key={a.key} testID={`phase-action-${a.key}`} style={compact ? styles.chipCompact : styles.chip} accessibilityLabel={a.a11y}>
              <Ionicons name="star-outline" size={t.iconSize.sm} color={t.colors.text.secondary} />
              <Text style={styles.chipText} numberOfLines={1}>
                {a.label + '\u00A0'}
              </Text>
            </View>
          );
        }
        const target = TARGETS[a.key];
        const iconColor = target.danger ? t.colors.accent.coral : t.colors.text.secondary;
        return (
          <TouchableOpacity
            key={a.key}
            testID={`phase-action-${a.key}`}
            style={compact ? styles.chipCompact : styles.chip}
            hitSlop={compact ? COMPACT_HIT_SLOP : undefined}
            // Tab destinations switch tabs (navigate dedupes to the existing
            // tab instance); the root-level pushed routes (Wrap) must
            // PUSH so Back pops cleanly to the schedule with the festival
            // context intact. router.navigate on those cross-navigator routes
            // warps the stack and can pop the user out to the OS home screen.
            onPress={() => (target.href.startsWith('/(tabs)') ? router.navigate(target.href) : router.push(target.href))}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={a.a11y}
          >
            <Ionicons name={target.icon} size={t.iconSize.sm} color={iconColor} />
            <Text style={styles.chipText} numberOfLines={1}>
              {a.label + '\u00A0'}
            </Text>
          </TouchableOpacity>
        );
      })}
      {onDismiss ? (
        <TouchableOpacity
          style={compact ? styles.dismissButtonCompact : styles.dismissButton}
          hitSlop={compact ? COMPACT_HIT_SLOP : undefined}
          onPress={onDismiss}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Hide these shortcuts"
        >
          <Ionicons name="close" size={t.iconSize.action} color={t.colors.text.muted} />
        </TouchableOpacity>
      ) : null}
    </>
  );

  // The compact chips wrap inside the status line row, so none is ever cut at the screen edge.
  if (compact && inline) return content;
  return compact ? (
    <View style={styles.wrapCompact}>
      <View style={styles.rowCompact}>{content}</View>
    </View>
  ) : (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {content}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: {
    gap: t.spacing[1],
    // Separate the band from the controls above it.
    marginTop: t.spacing[3],
    paddingBottom: t.spacing[2],
  },
  // Status-line slot: the chips sit beside the status chips when they fit and wrap whole
  // to the next line when they do not. The compact chips are 32 pt tall; hitSlop restores
  // the 44 pt target.
  rowCompact: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
    alignItems: 'center',
  },
  wrapCompact: {
    flexShrink: 1,
    minWidth: 0,
  },
  chipCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[2],
    minHeight: 32,
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  dismissButtonCompact: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 32,
    minHeight: 32,
  },
  dismissButton: {
    alignItems: 'center',
    justifyContent: 'center',
    // WCAG 2.5.5 / 2.5.8 minimum 44px touch target.
    minWidth: 44,
    minHeight: 44,
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
