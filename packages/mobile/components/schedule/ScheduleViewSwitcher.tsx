import { View, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SCHEDULE_VIEWS, type ScheduleView } from '@festie/shared/utils';
import { useTokens } from '../../hooks/useTokens';
import SegmentedControl from '../SegmentedControl';
import type { Dispatch, SetStateAction } from 'react';
import { useStyles } from './styles';

// Mobile schedule views, in the shared order: Cards, Timeline, then Grid. Grid
// is a pushed route, not a view the Schedule tab can show or remember (T18 makes
// it in-place). It rides in the switcher (instead of a header icon) so Find your
// crew keeps its header slot on 360dp phones.
const VIEW_OPTIONS_WITH_GRID: readonly { value: ScheduleView; label: string }[] = SCHEDULE_VIEWS.map((v) => ({
  value: v.key,
  label: v.label,
}));
const VIEW_OPTIONS = VIEW_OPTIONS_WITH_GRID.filter((v) => v.value !== 'grid');

interface ScheduleViewSwitcherProps {
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
        options={festivalHasTimedSets ? VIEW_OPTIONS_WITH_GRID : VIEW_OPTIONS}
        value={viewMode}
        onChange={(next: ScheduleView) => (next === 'grid' ? router.push('/grid') : setScheduleView(next))}
        accessibilityLabel="Schedule view"
      />
    </View>
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
        size={18}
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
        size={18}
        color={filtersOpen ? t.colors.accent.aqua : t.colors.text.secondary}
      />
      {filtersActive ? <View style={styles.toggleDot} /> : null}
    </TouchableOpacity>
  </View>
  );
}
