import {
  Text,
  TouchableOpacity,
  FlatList,
  type ListRenderItem,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  type AnnouncedLineupModel,
  type FestivalPhase,
} from '@festie/shared/utils';
import { useTokens, MAX_FONT_SCALE } from '../../hooks/useTokens';
import SetTimesBanner from '../SetTimesBanner';
import AnnouncedLineup from '../AnnouncedLineup';
import DiscoverRow from '../DiscoverRow';
import type { ReactElement, RefObject } from 'react';
import type { ListRow } from './listRow';
import { useStyles } from './styles';

interface ScheduleCardsViewProps {
  announced: AnnouncedLineupModel;
  cardsEmpty: ReactElement | undefined;
  cardsSeparator: () => ReactElement;
  controls: ReactElement;
  genreFilterActive: boolean;
  hPad: number;
  handleCardsScroll: (e: { nativeEvent: { contentOffset: { y: number; }; }; }) => void;
  keyExtractor: (item: ListRow) => string;
  listBottomPad: number;
  listRef: RefObject<FlatList<ListRow> | null>;
  otherDayMatches: ReactElement;
  phase: FestivalPhase | null;
  refreshControl: ReactElement;
  renderRow: ListRenderItem<ListRow>;
  rows: ListRow[];
  scheduleViewportBottomInset: number;
  scrollCardsToTop: () => void;
  searchQuery: string;
  showScrollTop: boolean;
  stageFilterActive: boolean;
}

export default function ScheduleCardsView({
  announced,
  cardsEmpty,
  cardsSeparator,
  controls,
  genreFilterActive,
  hPad,
  handleCardsScroll,
  keyExtractor,
  listBottomPad,
  listRef,
  otherDayMatches,
  phase,
  refreshControl,
  renderRow,
  rows,
  scheduleViewportBottomInset,
  scrollCardsToTop,
  searchQuery,
  showScrollTop,
  stageFilterActive,
}: ScheduleCardsViewProps) {
  const styles = useStyles();
  const t = useTokens();
  return (
    <>
      <FlatList
        ref={listRef}
        style={[styles.scrollBody, { marginBottom: scheduleViewportBottomInset }]}
        data={rows}
        renderItem={renderRow}
        keyExtractor={keyExtractor}
        ListHeaderComponent={
          <>
            {controls}
            <SetTimesBanner hPad={hPad} />
            <DiscoverRow
              hPad={hPad}
              hidden={phase === 'post' || searchQuery.trim() !== '' || stageFilterActive || genreFilterActive}
            />
            {/* A search lists the matching announced acts under the set results instead (footer). */}
            {searchQuery.trim() ? null : <AnnouncedLineup model={announced} hPad={hPad} />}
          </>
        }
        // The controls already apply hPad themselves, so cancel the container's.
        ListHeaderComponentStyle={{ marginHorizontal: -hPad }}
        contentContainerStyle={[styles.listContent, { paddingHorizontal: hPad, paddingBottom: listBottomPad }]}
        refreshControl={refreshControl}
        ItemSeparatorComponent={cardsSeparator}
        // F2 — a failed festival load surfaces the error + retry rather than a
        // misleading "No sets" empty state (see cardsEmpty).
        ListEmptyComponent={cardsEmpty}
        ListFooterComponent={
          <>
            {rows.length > 0 ? otherDayMatches : null}
            {searchQuery.trim() ? <AnnouncedLineup model={announced} /> : null}
          </>
        }
        // Perf for big lineups: cap the initial + per-batch render window so a
        // 200-set day paints fast and scrolls without a long first frame.
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={11}
        onScroll={handleCardsScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentInsetAdjustmentBehavior="automatic"
      />
      {showScrollTop ? (
        <TouchableOpacity
          style={[styles.scrollTopFab, { right: hPad, bottom: t.spacing[5] + scheduleViewportBottomInset }]}
          onPress={scrollCardsToTop}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Scroll to top of the lineup"
        >
          <Ionicons name="chevron-up" size={t.iconSize.action} color={t.colors.text.onLightAccent} />
          <Text style={styles.scrollTopText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            Top
          </Text>
        </TouchableOpacity>
      ) : null}
    </>
  );
}
