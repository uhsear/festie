// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useEffect, useState } from 'react';
import { checkinErrorMessage } from '@festie/shared/services';
import type { SosPosition } from '@festie/shared/services';
import { useCheckIn } from '@festie/shared/hooks';
import { CHECKIN_COPY, CHECKIN_DURATIONS } from '@festie/shared/constants';
import { fmtZonedClock, formatCountdown } from '@festie/shared/utils';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';

interface Props {
  crewId: string;
}

// Best-effort one-shot fix for the missed-timer SOS. Never blocks the start.
function oneShotPosition(): Promise<SosPosition | undefined> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(undefined);
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? undefined,
          capturedAt: new Date(pos.timestamp).toISOString(),
        }),
      () => resolve(undefined),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 8_000 },
    );
  });
}

/**
 * Check-in timer. The server holds the timer, so a dead phone still alerts the crew:
 * if the user does not tap "I'm OK" in time, the crew gets an SOS with the last location.
 */
export default function CheckInCard({ crewId }: Props) {
  const { toast } = useToast();
  const { checkin, busy, start, done } = useCheckIn(crewId);
  const [now, setNow] = useState(() => Date.now());

  // Keeps "{n} min left" true. Same 30 s cadence as the share card.
  useEffect(() => {
    if (!checkin) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [checkin]);

  async function begin(minutes: number) {
    try {
      const position = await oneShotPosition();
      const timer = await start(minutes, position);
      if (timer) toast(CHECKIN_COPY.started(fmtZonedClock(Date.parse(timer.dueAt))), 'success');
    } catch (err) {
      toast(checkinErrorMessage(err, 'start'), 'error');
    }
  }

  async function finish() {
    try {
      const cleared = await done();
      toast(cleared ? CHECKIN_COPY.done : CHECKIN_COPY.ended, cleared ? 'success' : 'error');
    } catch (err) {
      toast(checkinErrorMessage(err, 'done'), 'error');
    }
  }

  const dueMs = checkin ? Date.parse(checkin.dueAt) : 0;

  return (
    <div className="rounded-lg border border-border bg-bg-card p-3 space-y-2" data-testid="checkin-card">
      {checkin ? (
        <>
          <p className="font-bold text-text-primary">{CHECKIN_COPY.activeTitle(fmtZonedClock(dueMs))}</p>
          <p className="text-sm text-text-secondary">
            {CHECKIN_COPY.activeBody(formatCountdown(Math.max(0, dueMs - now)))}
          </p>
          <Button onClick={finish} disabled={busy} aria-label={CHECKIN_COPY.okA11y}>
            {CHECKIN_COPY.ok}
          </Button>
        </>
      ) : (
        <>
          <p className="font-bold text-text-primary">{CHECKIN_COPY.title}</p>
          <p className="text-sm text-text-secondary">{CHECKIN_COPY.idleBody}</p>
          <div className="flex flex-wrap gap-2">
            {CHECKIN_DURATIONS.map((d) => (
              <Button key={d.minutes} variant="outline" size="sm" disabled={busy} onClick={() => begin(d.minutes)}>
                {d.label}
              </Button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
