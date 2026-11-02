import { useCallback, useEffect, useRef, useState } from 'react';
import { finishCheckin, getCheckin, startCheckin, type CheckinState } from '../services/checkin';
import type { SosPosition } from '../services/sos';

export interface UseCheckIn {
  checkin: CheckinState | null;
  busy: boolean;
  /** Resolves to the server's timer. Throws on failure. Show `checkinErrorMessage(err, 'start')`. */
  start(minutes: number, position?: SosPosition): Promise<CheckinState | null>;
  /**
   * Resolves to `cleared`: `false` means the timer had already ended (the crew
   * got an SOS) or was stopped elsewhere. Throws on failure. Show `checkinErrorMessage(err, 'done')`.
   */
  done(): Promise<boolean>;
}

export function useCheckIn(crewId: string | null): UseCheckIn {
  const [checkin, setCheckin] = useState<CheckinState | null>(null);
  const [busy, setBusy] = useState(false);
  const crewRef = useRef(crewId);
  crewRef.current = crewId;

  useEffect(() => {
    setCheckin(null);
    if (!crewId) return;
    getCheckin(crewId)
      .then((c) => {
        if (crewRef.current === crewId) setCheckin(c);
      })
      .catch((err) => console.warn('[useCheckIn] load failed; keeping current state', err));
  }, [crewId]);

  // The server fires the timer at dueAt and deletes it. Drop it here too, so the
  // card stops saying "1 min left" after the crew has been alerted.
  useEffect(() => {
    if (!checkin) return;
    const { dueAt } = checkin;
    const id = setTimeout(
      () => setCheckin((c) => (c?.dueAt === dueAt ? null : c)),
      Math.max(0, Date.parse(dueAt) - Date.now()),
    );
    return () => clearTimeout(id);
  }, [checkin]);

  const start = useCallback(
    async (minutes: number, position?: SosPosition) => {
      if (!crewId) return null;
      setBusy(true);
      try {
        const res = await startCheckin(crewId, { minutes, position });
        const next = { dueAt: res.dueAt, minutes: res.minutes };
        if (crewRef.current === crewId) setCheckin(next);
        return next;
      } finally {
        setBusy(false);
      }
    },
    [crewId],
  );

  const done = useCallback(async () => {
    if (!crewId) return false;
    setBusy(true);
    try {
      const { cleared } = await finishCheckin(crewId);
      if (crewRef.current === crewId) setCheckin(null);
      return cleared;
    } finally {
      setBusy(false);
    }
  }, [crewId]);

  return { checkin, busy, start, done };
}
