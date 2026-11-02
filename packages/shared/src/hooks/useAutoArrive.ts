import { useEffect, useRef } from 'react';
import type { CrewMeetingPoint } from '../types';
import { useCrewStore } from '../stores/crewStore';
import { useLiveLocationStore } from '../stores/liveLocationStore';
import { arrivalTarget } from '../utils/crewStatus';

interface UseAutoArriveArgs {
  crewId: string;
  userId: string;
  meetingPoints: ReadonlyArray<CrewMeetingPoint>;
  onArrive?: (label: string) => void;
}

/**
 * While sharing live location to this crew and "On my way" to a pinned meeting
 * point, flips my status to "I'm here" once I am within ARRIVE_RADIUS_M. Runs only
 * where the live-location publisher runs (the crew Find tab).
 */
export function useAutoArrive({ crewId, userId, meetingPoints, onArrive }: UseAutoArriveArgs): void {
  const coord = useLiveLocationStore((s) => (s.sharingCrewId === crewId ? s.lastSentCoord : null));
  const mine = useCrewStore((s) => s.crewStatuses.find((x) => x.user_id === userId));
  const firedKey = useRef<string | null>(null);

  useEffect(() => {
    if (!crewId || !userId) return;
    const point = arrivalTarget(mine, meetingPoints, coord, Date.now());
    if (!point || !mine) return;
    const key = `${point.id}:${mine.updated_at}`;
    if (firedKey.current === key) return;
    firedKey.current = key;
    useCrewStore
      .getState()
      .updateMyStatus(
        crewId,
        { status: 'here', targetMeetingPointId: point.id, etaMinutes: null, note: mine.note ?? null },
        userId,
      )
      .then(() => onArrive?.(point.label))
      .catch(() => {
        // The store records the error; nothing more to do here.
      });
  }, [crewId, userId, mine, meetingPoints, coord, onArrive]);
}
