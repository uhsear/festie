// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { FIND_FRIEND_COPY } from '@festie/shared/constants';
import { useNudge } from '@festie/shared/hooks';

interface PeerNudgeButtonProps {
  crewId: string;
  userId: string;
  name: string;
}

/** "Looking for you" in the pursue bar. Sends one push and never a location. */
export default function PeerNudgeButton({ crewId, userId, name }: PeerNudgeButtonProps) {
  const { send, status, message } = useNudge(crewId, userId, name);
  const disabled = status === 'sending' || status === 'sent';
  return (
    <>
      <button
        type="button"
        onClick={() => void send()}
        disabled={disabled}
        aria-disabled={disabled}
        aria-label={FIND_FRIEND_COPY.nudgeA11y(name)}
        title={FIND_FRIEND_COPY.nudgeHint(name)}
        className="min-h-11 shrink-0 rounded px-3 text-sm font-medium text-accent-aqua focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {FIND_FRIEND_COPY.nudge}
      </button>
      {message && (
        <p
          role="status"
          aria-live="polite"
          // The pursue bar wraps; order-last + basis-full put this line under the whole row.
          className="order-last basis-full text-xs text-text-secondary"
        >
          {message}
        </p>
      )}
    </>
  );
}
