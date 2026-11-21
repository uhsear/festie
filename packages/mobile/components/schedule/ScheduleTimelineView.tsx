import { View, ScrollView, type ScrollViewInstance } from 'react-native';
import type { Festival, FestivalSet, Priority, Stage } from '@festie/shared/types';
import type { TimeBounds } from '../../hooks/useNowIndicator';
import TimelineView from '../TimelineView';
import AnnouncedLineup from '../AnnouncedLineup';
import type { Dispatch, ReactElement, RefObject, SetStateAction } from 'react';
import ScheduleSkeleton from './ScheduleSkeleton';
import { useStyles } from './styles';
import type { AnnouncedLineupModel } from '@festie/shared/utils';

interface ScheduleTimelineViewProps {
  allSets: FestivalSet[];
  announced: AnnouncedLineupModel;
  controls: ReactElement;
  currentFestival: Festival;
  days: { index: number; date: string; label?: string; }[];
  emptyScheduleState: ReactElement;
  errorScheduleState: ReactElement;
  getMyPick: (setId: string) => Priority | null | undefined;
  hPad: number;
  handleSetPress: (set: FestivalSet) => void;
  hasTimeline: boolean;
  height: number;
  lineupStandsIn: boolean;
  listBottomPad: number;
  myPicks: Record<string, Priority> | null;
  refreshControl: ReactElement;
  resolveStageColor: (stageId: string) => string;
  scheduleColdLoading: boolean;
  scheduleLoadError: string | null;
  scheduleViewportBottomInset: number;
  selectedDay: number;
  setTimelineControlsH: Dispatch<SetStateAction<number>>;
  setTimelineViewportH: Dispatch<SetStateAction<number>>;
  tbaSection: ReactElement | null;
  timeBounds: TimeBounds | null;
  timedSets: FestivalSet[];
  timelineControlsH: number;
  timelineScrollRef: RefObject<ScrollViewInstance | null>;
  timelineViewportH: number;
  visibleStages: Stage[];
}

export default function ScheduleTimelineView({
  allSets,
  announced,
  controls,
  currentFestival,
  days,
  emptyScheduleState,
  errorScheduleState,
  getMyPick,
  hPad,
  handleSetPress,
  hasTimeline,
  height,
  lineupStandsIn,
  listBottomPad,
  myPicks,
  refreshControl,
  resolveStageColor,
  scheduleColdLoading,
  scheduleLoadError,
  scheduleViewportBottomInset,
  selectedDay,
  setTimelineControlsH,
  setTimelineViewportH,
  tbaSection,
  timeBounds,
  timedSets,
  timelineControlsH,
  timelineScrollRef,
  timelineViewportH,
  visibleStages,
}: ScheduleTimelineViewProps) {
  const styles = useStyles();
  return (
    <ScrollView
      ref={timelineScrollRef}
      style={[styles.scrollBody, { marginBottom: scheduleViewportBottomInset }]}
      onLayout={(e) => setTimelineViewportH(Math.round(e.nativeEvent.layout.height))}
      // Rest either on the controls or on the full-size timeline, never half way
      // (only when the controls fit the viewport; a taller stack scrolls freely).
      snapToOffsets={
        hasTimeline && timelineControlsH > 0 && timelineControlsH <= timelineViewportH
          ? [0, timelineControlsH]
          : undefined
      }
      snapToEnd={false}
      decelerationRate={hasTimeline ? 'fast' : undefined}
      showsVerticalScrollIndicator={!hasTimeline}
      refreshControl={refreshControl}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={hasTimeline ? undefined : [styles.fallbackScroll, { paddingBottom: listBottomPad }]}
      contentInsetAdjustmentBehavior={hasTimeline ? undefined : 'automatic'}
    >
      {/* One ScrollView for both states so the search TextInput inside
          `controls` is never remounted (which would drop the keyboard). */}
      <View onLayout={(e) => setTimelineControlsH(Math.round(e.nativeEvent.layout.height))}>{controls}</View>
      {hasTimeline ? (
        <>
          <View style={[styles.timelineBody, { height: timelineViewportH || Math.round(height * 0.6) }]}>
            <TimelineView
              key={selectedDay}
              visibleStages={visibleStages}
              timedSets={timedSets}
              timeBounds={timeBounds}
              selectedDay={selectedDay}
              b2bSeparator={currentFestival.b2bSeparator}
              getMyPick={getMyPick}
              getStageColor={resolveStageColor}
              onSetPress={handleSetPress}
              days={days}
              allSets={allSets}
              picks={myPicks}
            />
          </View>
          {/* The TBA list sits below the full-size timeline as part of the
              page scroll, so it never shrinks the timeline's viewport. */}
          {tbaSection}
        </>
      ) : (
        <>
          {scheduleColdLoading ? (
            <ScheduleSkeleton hPad={hPad} />
          ) : scheduleLoadError ? (
            errorScheduleState
          ) : lineupStandsIn ? null : (
            emptyScheduleState
          )}
          {tbaSection}
        </>
      )}
      {/* The lineup follows the day's own content; a search lists the matching acts here too. */}
      <AnnouncedLineup model={announced} hPad={hPad} />
    </ScrollView>
  );
}
