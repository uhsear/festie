import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { markSosSeen } from '../services/checkin';
import { useActiveSos } from './useDayOf';

// One ack per SOS per app session. Module-level so remounting the banner never re-acks.
const acked = new Set<string>();

/** Acks every other member's active SOS once, so the raiser and crew see who has seen it. Never throws. */
export function useSosSeenAck(): void {
  const selfId = useAuthStore((s) => s.user?.id ?? null);
  const list = useActiveSos();
  useEffect(() => {
    if (!selfId) return;
    for (const entry of list) {
      if (entry.userId === selfId) continue;
      const key = `${entry.crewId}|${entry.userId}|${entry.raisedAt}`;
      if (acked.has(key)) continue;
      acked.add(key);
      markSosSeen(entry.crewId, entry.userId).catch(() => acked.delete(key));
    }
  }, [selfId, list]);
}

/** Test seam: forget which SOS were acked. */
export function resetSosSeenAcks(): void {
  acked.clear();
}
