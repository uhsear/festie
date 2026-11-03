import { CloudOff } from 'lucide-react';
import { useFestivalStore } from '@festie/shared/stores';
import { COPY } from '@festie/shared/constants';
import { pickDefaultFestival } from '@festie/shared/utils';
import EmptyState from '../ui/EmptyState';

/** Festival-list load failure with a retry; the store already holds the message, so rejections are ignored. */
export default function FestivalLoadError() {
  const error = useFestivalStore((s) => s.error);
  const loadFestivals = useFestivalStore((s) => s.loadFestivals);
  const selectFestival = useFestivalStore((s) => s.selectFestival);

  const retry = async () => {
    try {
      await loadFestivals();
      const { festivals, currentFestival } = useFestivalStore.getState();
      const first = pickDefaultFestival(festivals);
      if (!currentFestival && first) await selectFestival(first.id);
    } catch {
      // The store set the message this screen shows.
    }
  };

  return (
    <EmptyState
      icon={<CloudOff className="w-12 h-12" aria-hidden="true" />}
      title={COPY.festivalLoad.errorTitle}
      description={error ?? COPY.festivalLoad.errorBody}
      cta={{ label: COPY.festivalLoad.retry, onClick: retry }}
    />
  );
}
