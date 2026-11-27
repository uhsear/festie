import { useEffect, useRef, useState } from 'react';
import { useFestivalStore } from '@festie/shared/stores';

/**
 * The festival a Wrap, Rate or Caught screen shows: the ?festival= link when it has one, else the
 * selected festival. Once the user picks another festival in the picker the link is stale, so the
 * pick wins. A festival that loads for the first time is not a pick.
 */
export function useRouteFestivalId(linked: string | undefined): string | undefined {
  const currentId = useFestivalStore((s) => s.currentFestival?.id);
  const seen = useRef(currentId);
  const [picked, setPicked] = useState(false);
  useEffect(() => {
    if (seen.current && currentId && currentId !== seen.current) setPicked(true);
    if (currentId) seen.current = currentId;
  }, [currentId]);
  return picked ? currentId : (linked ?? currentId);
}
