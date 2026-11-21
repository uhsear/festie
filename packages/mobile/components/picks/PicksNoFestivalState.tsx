import { festivalLoadState } from '@festie/shared/utils';
import { COPY } from '@festie/shared/constants';
import EmptyState from '../EmptyState';
import LoadingState from '../LoadingState';
import type { Festival } from '@festie/shared/types';

interface PicksNoFestivalStateProps {
  currentFestival: Festival | null;
  error: string | null;
  festivals: Festival[];
  isLoading: boolean;
  loadFestivals: () => Promise<void>;
}

export default function PicksNoFestivalState({
  currentFestival,
  error,
  festivals,
  isLoading,
  loadFestivals,
}: PicksNoFestivalStateProps) {

  const loadState = festivalLoadState({ currentFestival, festivals, isLoading, error });
  return (
loadState === 'error' ? (
  <EmptyState
    icon="cloud-offline-outline"
    title={COPY.festivalLoad.errorTitle}
    message={error ?? COPY.festivalLoad.errorBody}
    action={{ label: COPY.festivalLoad.retry, onPress: () => void loadFestivals().catch(() => {}) }}
  />
) : loadState === 'loading' ? (
  <LoadingState />
) : (
  <EmptyState
    icon="calendar-outline"
    title={COPY.festivalLoad.noneTitle}
    message="Choose a festival from the Schedule tab to start saving picks."
  />
)
  );
}
