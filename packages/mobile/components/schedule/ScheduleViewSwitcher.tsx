import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SCHEDULE_VIEWS, type ScheduleView } from '@festie/shared/utils';
import { useTokens, MAX_FONT_SCALE } from '../../hooks/useTokens';
import SegmentedControl from '../SegmentedControl';
import type { Dispatch, SetStateAction } from 'react';
import { useStyles } from './styles';

// In-place views only: Cards and Timeline swap under the tab header. Grid is a pushed
// route with its own chrome, so it is a separate "Full grid" push action, not a segment.
// Web keeps Grid in its segmented control because it renders Grid inside the lineup shell.
const VIEW_OPTIONS: readonly { value: ScheduleView; label: string }[] = SCHEDULE_VIEWS.filter(
  (v) => v.key !== 'grid',
).map((v) => ({ value: v.key, label: v.label }));

// The lineup flyer renders only in Cards, so Timeline is inert while it shows.
const FLYER_OPTIONS = VIEW_OPTIONS.map((o) => ({ ...o, disabled: o.value === 'timeline' }));

interface ScheduleViewSwitcherProps {
  /** The lineup flyer shows (no set has a time): only Cards can render it, so Timeline is disabled. */
  flyerShowing: boolean;
  festivalHasTimedSets: boolean;
  filtersActive: boolean;
  filtersOpen: boolean;
  hPad: number;
  revealControls: () => void;
  searchOpen: boolean;
  setScheduleView: (view: ScheduleView | null) => void;
  setSearchQuery: (query: string) => void;
  setShowFilters: Dispatch<SetStateAction<boolean>>;
  setShowSearch: Dispatch<SetStateAction<boolean>>;
  viewMode: "timeline" | "cards";
}

export default function ScheduleViewSwitcher({
  flyerShowing,
  festivalHasTimedSets,
  filtersActive,
  filtersOpen,
  hPad,
  revealControls,
  searchOpen,
  setScheduleView,
  setSearchQuery,
  setShowFilters,
  setShowSearch,
  viewMode,
}: ScheduleViewSwitcherProps) {
  const styles = useStyles();
  const t = useTokens();
  const router = useRouter();
  return (
  <View style={[styles.viewSwitcher, { paddingHorizontal: hPad }]}>
    {/* No now-indicator here: it crowded the row and truncated the
        Timeline/Cards labels on narrow phones. The real now/next surface is
        NowNextStrip above (shown only when a pick is actually live). */}
    <View style={styles.switcherFlex}>
      <SegmentedControl
        options={flyerShowing ? FLYER_OPTIONS : VIEW_OPTIONS}
        value={viewMode}
        onChange={setScheduleView}
        accessibilityLabel="Schedule view"
      />
    </View>
    {festivalHasTimedSets ? (
      <TouchableOpacity
        testID="full-grid-action"
        style={styles.fullGridButton}
        onPress={() => router.push('/grid')}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Full grid"
      >
        <Text style={styles.fullGridText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Full grid
        </Text>
        <Ionicons name="chevron-forward" size={t.iconSize.sm} color={t.colors.text.secondary} />
      </TouchableOpacity>
    ) : null}
    <TouchableOpacity
      style={[styles.toggleButton, searchOpen && styles.toggleButtonActive]}
      // searchOpen stays true while a query is present (searchOpen = showSearch
      // || search.length > 0), so merely toggling showSearch can't close an
      // active search — the panel re-opens itself. Closing must also CLEAR the
      // query so the X reliably collapses the bar.
      onPress={() => {
        if (searchOpen) {
          setSearchQuery('');
          setShowSearch(false);
        } else {
          revealControls();
          setShowSearch(true);
        }
      }}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ expanded: searchOpen }}
      accessibilityLabel={searchOpen ? 'Hide search' : 'Search the lineup'}
    >
      {/* When the search bar is open a search icon inside the field already
          serves as the affordance — switch the header trigger to a close icon
          so the two search icons don't appear simultaneously on screen. */}
      <Ionicons
        name={searchOpen ? 'close' : 'search'}
        size={t.iconSize.action}
        color={searchOpen ? t.colors.accent.aqua : t.colors.text.secondary}
      />
    </TouchableOpacity>
    <TouchableOpacity
      style={[styles.toggleButton, filtersOpen && styles.toggleButtonActive]}
      onPress={() => {
        if (!filtersOpen) revealControls();
        setShowFilters((v) => !v);
      }}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ expanded: filtersOpen }}
      accessibilityLabel={filtersOpen ? 'Hide filters' : 'Show filters'}
    >
      <Ionicons
        name="options-outline"
        size={t.iconSize.action}
        color={filtersOpen ? t.colors.accent.aqua : t.colors.text.secondary}
      />
      {filtersActive ? <View style={styles.toggleDot} /> : null}
    </TouchableOpacity>
  </View>
  );
}
