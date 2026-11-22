import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import SpotifyAttribution from '../SpotifyAttribution';
import { DISCOVER_COPY, genreChipLabel } from '@festie/shared/constants';
import {
  toggleStageFilter,
  toggleGenreFilter,
  toggleHiddenDay,
  scheduleResultsSummary,
  type FestivalPhase,
  type FestivalReadyItem,
  type HomeAction,
} from '@festie/shared/utils';
import type { FestivalSet, Profile, Stage, User } from '@festie/shared/types';
import { useTokens, MAX_FONT_SCALE } from '../../hooks/useTokens';
import { CONCEPT_IONICON } from '../../lib/conceptIcons';
import { useHaptics } from '../../hooks/useHaptics';
import NowNextStrip from '../NowNextStrip';
import PhaseHomeActions from '../PhaseHomeActions';
import FestivalReadyCard from '../FestivalReadyCard';
import ScheduleDayChips from '../ScheduleDayChips';
import ScheduleResultsRow from '../ScheduleResultsRow';
import FreshnessChip from '../FreshnessChip';
import SaveStatusChip from '../SaveStatusChip';
import OfflineStatusChip from '../OfflineStatusChip';
import { useStyles } from './styles';
import type { UseViewAsReturn } from '@festie/shared/hooks';

interface ScheduleControlsProps {
  activeGenres: string[];
  activeStages: string[];
  allStageIds: string[];
  anyFilterActive: boolean;
  canFilterMine: boolean;
  clearAllFilters: () => void;
  currentProfile: Profile | null;
  days: { index: number; date: string; label?: string; }[];
  dismissPhaseBand: (phase: FestivalPhase | null) => void;
  dismissedPhase: FestivalPhase | null;
  filteredSets: FestivalSet[];
  filtersOpen: boolean;
  genreAttribution: { href: string } | null;
  genreChips: string[];
  genreFilterActive: boolean;
  hPad: number;
  handleRefresh: () => void;
  hiddenDays: number[];
  homeActions: HomeAction[];
  isLoading: boolean;
  mineActive: boolean;
  onlyMine: boolean;
  phase: FestivalPhase | null;
  ready: { visible: boolean; items: FestivalReadyItem[]; doneCount: number; total: number; progressLabel: string; hide: () => void; };
  resolveStageColor: (stageId: string) => string;
  searchOpen: boolean;
  searchQuery: string;
  setActiveGenres: (genres: string[]) => void;
  setActiveStages: (stageIds: string[]) => void;
  setHiddenDays: (days: number[]) => void;
  setOnlyMine: (onlyMine: boolean) => void;
  setSearchQuery: (query: string) => void;
  showSearch: boolean;
  stageFilterActive: boolean;
  stages: Stage[];
  timelessSets: FestivalSet[];
  user: User | null;
  viewAs: UseViewAsReturn;
  viewMode: "timeline" | "cards";
  visibleDays: number[];
  width: number;
  zoneLabel: string | null;
}

export default function ScheduleControls({
  activeGenres,
  activeStages,
  allStageIds,
  anyFilterActive,
  canFilterMine,
  clearAllFilters,
  currentProfile,
  days,
  dismissPhaseBand,
  dismissedPhase,
  filteredSets,
  filtersOpen,
  genreAttribution,
  genreChips,
  genreFilterActive,
  hPad,
  handleRefresh,
  hiddenDays,
  homeActions,
  isLoading,
  mineActive,
  onlyMine,
  phase,
  ready,
  resolveStageColor,
  searchOpen,
  searchQuery,
  setActiveGenres,
  setActiveStages,
  setHiddenDays,
  setOnlyMine,
  setSearchQuery,
  showSearch,
  stageFilterActive,
  stages,
  timelessSets,
  user,
  viewAs,
  viewMode,
  visibleDays,
  width,
  zoneLabel,
}: ScheduleControlsProps) {
  const styles = useStyles();
  const t = useTokens();
  const router = useRouter();
  const haptics = useHaptics();
  return (
<>
  {/* Before the festival the Festival ready checklist takes the band's place
      until it is done or hidden. It covers the band's pre-festival rows
      (first pick, crew), so the two are never shown together. It is
      first-run guidance, so it is not gated on the filters.
      Otherwise: next-step band from shared getHomeActions (picks and crew
      before the festival, find the crew during it, wrap and settle-up
      after). It is empty, and so hidden, when there is nothing left to do. It
      rides in the controls so it scrolls with the Cards list. The close
      button hides it for this festival and phase. */}
  {ready.visible ? (
    <View style={{ paddingHorizontal: hPad }}>
      <FestivalReadyCard ready={ready} />
    </View>
  ) : homeActions.length > 0 && phase && dismissedPhase !== phase ? (
    <View style={{ paddingHorizontal: hPad }}>
      <PhaseHomeActions actions={homeActions} onDismiss={() => dismissPhaseBand(phase)} />
    </View>
  ) : null}

  {/* Live-day Now & Next surface: shows the picked set playing now / up next
      inline, tapping through to the full Now & Next screen. Renders nothing
      when there's no current/upcoming pick. */}
  <View style={{ paddingHorizontal: hPad }}>
    <NowNextStrip onPress={() => router.push('/festival-mode')} />
  </View>

  {/* F19 — offline-honest freshness for the flagship schedule surface,
      matching the crew tab's chip. Driven by festivalDataStore's
      _festivalCachedAt; renders nothing until the schedule is cached once. */}
  <View style={[styles.freshnessRow, { paddingHorizontal: hPad }]}>
    <FreshnessChip surface="schedule" />
    {currentProfile ? <SaveStatusChip /> : null}
    {/* Cards and fallback views support pull-to-refresh. Timeline owns both
        scroll axes, so narrow phones need this compact manual action after
        the header sheds secondary icons to preserve the festival title. */}
    {width < 400 && viewMode === 'timeline' ? (
      <TouchableOpacity
        style={styles.compactRefreshButton}
        onPress={handleRefresh}
        disabled={isLoading}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Refresh schedule"
        accessibilityState={{ busy: isLoading }}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color={t.colors.accent.aqua} />
        ) : (
          <Ionicons name="refresh" size={18} color={t.colors.accent.aqua} />
        )}
      </TouchableOpacity>
    ) : null}
  </View>
  {user ? (
    <View style={{ paddingHorizontal: hPad, paddingTop: t.spacing[2] }}>
      <OfflineStatusChip remind />
    </View>
  ) : null}

  {/* DC1 — search and the stage / my-picks + phase-action setup chrome are
      folded behind the search/filter toggles in the control row above; only
      the day chips (the one mid-festival control) stay always visible. The
      panels expand inline here when toggled (or when they carry active
      state), so on small phones the timeline keeps ~70% of the viewport. */}
  {searchOpen ? (
    <View style={[styles.searchRow, { marginHorizontal: hPad }]}>
      <Ionicons name="search" size={16} color={t.colors.text.placeholder} style={styles.searchIcon} />
      <TextInput
        style={styles.searchInput}
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder="Search artists or stages"
        placeholderTextColor={t.colors.text.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={showSearch && searchQuery.length === 0}
        accessibilityLabel="Search the lineup"
        returnKeyType="search"
      />
      {searchQuery.length > 0 ? (
        <TouchableOpacity
          onPress={() => setSearchQuery('')}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={13}
        >
          <Ionicons name="close-circle" size={18} color={t.colors.text.muted} />
        </TouchableOpacity>
      ) : null}
    </View>
  ) : null}

  {/* Day selector */}
  <ScheduleDayChips hPad={hPad} />
  {days.length > 1 && zoneLabel ? (
    <Text style={[styles.zoneLabel, { paddingHorizontal: hPad }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
      {zoneLabel}
    </Text>
  ) : null}

  {/* Stage + my-picks filters, then the days the person attends — folded
      behind the filter toggle (DC1). */}
  {filtersOpen && (currentProfile || stages.length > 1 || days.length > 1 || genreChips.length > 0) ? (
    <View style={styles.filterRow}>
      {currentProfile || stages.length > 1 || genreChips.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.filterContent, { paddingHorizontal: hPad }]}
          // Android-native right-edge fade — signals scrollable overflow without
          // requiring expo-linear-gradient. No-op on iOS (ignored silently).
          fadingEdgeLength={Platform.OS === 'android' ? 32 : 0}
        >
          {currentProfile ? (
            // R3 single-accent-fill-per-screen: the SegmentedControl already
            // holds the solid-aqua primary fill. The My picks chip uses the
            // outlined/tinted secondary variant (aqua border + aqua text on
            // transparent bg) so two solid aqua fills never appear together.
            // With no picks it is muted and inert so it can never blank the lineup.
            <TouchableOpacity
              style={[
                styles.filterChip,
                !canFilterMine && styles.filterChipMuted,
                mineActive && styles.filterChipActiveTinted,
              ]}
              onPress={canFilterMine ? () => setOnlyMine(!onlyMine) : undefined}
              activeOpacity={canFilterMine ? 0.7 : 1}
              accessibilityRole="button"
              accessibilityState={canFilterMine ? { selected: onlyMine } : { disabled: true, selected: false }}
              accessibilityLabel="Show only my picks"
            >
              <Ionicons
                name={CONCEPT_IONICON.picks}
                size={12}
                color={mineActive ? t.colors.accent.aqua : t.colors.text.muted}
              />
              <Text
                style={[
                  styles.filterChipText,
                  !canFilterMine && styles.filterChipTextMuted,
                  mineActive && styles.filterChipTextTinted,
                ]}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
              >
                {canFilterMine ? 'My picks' : 'Pick a set first'}
              </Text>
            </TouchableOpacity>
          ) : null}
          {stages.length > 1 ? (
            <>
              <TouchableOpacity
                style={[styles.filterChip, activeStages.length === 0 && styles.filterChipActiveTinted]}
                onPress={() => {
                  haptics.select();
                  setActiveStages([]);
                }}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityState={{ selected: activeStages.length === 0 }}
                accessibilityLabel="All stages"
              >
                <Text
                  style={[styles.filterChipText, activeStages.length === 0 && styles.filterChipTextTinted]}
                  numberOfLines={1}
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                >
                  All stages
                </Text>
              </TouchableOpacity>
              {stages.map((st) => {
                const on = activeStages.includes(st.id);
                // Stage dots keep their data-driven identity color (matching the
                // timeline columns) — the accent rule governs UI accents, not the
                // stage palette.
                return (
                  <TouchableOpacity
                    key={st.id}
                    style={[styles.filterChip, on && styles.filterChipActiveTinted]}
                    onPress={() => {
                      haptics.select();
                      setActiveStages(toggleStageFilter(activeStages, allStageIds, st.id));
                    }}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={st.name}
                  >
                    <View style={[styles.stageDotSmall, { backgroundColor: resolveStageColor(st.id) }]} />
                    <Text
                      style={[styles.filterChipText, on && styles.filterChipTextTinted]}
                      numberOfLines={1}
                      maxFontSizeMultiplier={MAX_FONT_SCALE}
                    >
                      {st.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </>
          ) : null}
          {genreChips.length > 0 ? (
            <View style={styles.genreGroup} accessibilityRole="toolbar" accessibilityLabel={DISCOVER_COPY.genres.groupA11y}>
              <TouchableOpacity
                style={[styles.filterChip, !genreFilterActive && styles.filterChipActiveTinted]}
                onPress={() => {
                  haptics.select();
                  setActiveGenres([]);
                }}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityState={{ selected: !genreFilterActive }}
                accessibilityLabel={DISCOVER_COPY.genres.clear}
              >
                <Text
                  style={[styles.filterChipText, !genreFilterActive && styles.filterChipTextTinted]}
                  numberOfLines={1}
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                >
                  {DISCOVER_COPY.genres.clear}
                </Text>
              </TouchableOpacity>
              {genreChips.map((g) => {
                const on = activeGenres.some((a) => a.toLocaleLowerCase() === g.toLocaleLowerCase());
                return (
                  <TouchableOpacity
                    key={g}
                    style={[styles.filterChip, on && styles.filterChipActiveTinted]}
                    onPress={() => {
                      haptics.select();
                      setActiveGenres(toggleGenreFilter(activeGenres, g));
                    }}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={genreChipLabel(g)}
                  >
                    <Text
                      style={[styles.filterChipText, on && styles.filterChipTextTinted]}
                      numberOfLines={1}
                      maxFontSizeMultiplier={MAX_FONT_SCALE}
                    >
                      {genreChipLabel(g)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {genreAttribution ? <SpotifyAttribution href={genreAttribution.href} /> : null}
            </View>
          ) : null}
        </ScrollView>
      ) : null}
      {days.length > 1 ? (
        <>
          <Text style={[styles.daysGoingLabel, { paddingHorizontal: hPad }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            Days I&apos;m going
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[styles.filterContent, { paddingHorizontal: hPad }]}
          >
            {days.map((day) => {
              const shown = !hiddenDays.includes(day.index);
              const onlyShown = shown && visibleDays.length === 1;
              return (
                <TouchableOpacity
                  key={day.index}
                  style={[styles.filterChip, shown && styles.filterChipActiveTinted]}
                  onPress={() => {
                    haptics.select();
                    setHiddenDays(toggleHiddenDay(hiddenDays, days.length, day.index));
                  }}
                  disabled={onlyShown}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityState={onlyShown ? { selected: shown, disabled: true } : { selected: shown }}
                  accessibilityLabel={day.label ?? day.date}
                >
                  <Text
                    style={[styles.filterChipText, shown && styles.filterChipTextTinted]}
                    numberOfLines={1}
                    maxFontSizeMultiplier={MAX_FONT_SCALE}
                  >
                    {day.label ?? day.date}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </>
      ) : null}
    </View>
  ) : null}

  {/* Results summary + Clear-all. Surfaces honestly how many sets the active
      search/stage/my-picks filters resolve to, and gives a single recovery
      tap when a filter is hiding most of the lineup. Only shown while a
      filter is actually narrowing the list. In Timeline mode the count spans
      the whole filtered day but only timed sets are plotted, so the TBA
      count qualifies the number. */}
  {anyFilterActive ? (
    <ScheduleResultsRow
      summary={scheduleResultsSummary({
        count: filteredSets.length,
        onlyMine: mineActive,
        activeStageCount: stageFilterActive ? activeStages.length : 0,
        activeGenreCount: activeGenres.length,
        viewAsName: viewAs.target?.name,
        tbaCount: viewMode === 'timeline' ? timelessSets.length : 0,
      })}
      onClearAll={clearAllFilters}
      hPad={hPad}
    />
  ) : null}
</>
  );
}
