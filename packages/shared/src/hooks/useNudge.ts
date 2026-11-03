import { useCallback, useEffect, useRef, useState } from 'react';
import { FIND_FRIEND_COPY } from '../constants/config';
import { nudgeCrewMember, nudgeErrorMessage } from '../services/nudge';

/** How long the button stays "sent". The server holds the real 5-minute limit; this only stops a double tap. */
export const NUDGE_COOLDOWN_MS = 300_000;

export type NudgeStatus = 'idle' | 'sending' | 'sent' | 'error';

export interface UseNudge {
  send: () => Promise<void>;
  status: NudgeStatus;
  message: string | null;
}

/** "Looking for you": one push to a crewmate. Online-only, never queued. */
export function useNudge(crewId: string | null, userId: string | null, name: string): UseNudge {
  const [status, setStatus] = useState<NudgeStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const key = `${crewId ?? ''}:${userId ?? ''}`;
  const keyRef = useRef(key);
  keyRef.current = key;
  const statusRef = useRef<NudgeStatus>('idle');
  statusRef.current = status;

  // A new person or crew starts fresh.
  useEffect(() => {
    setStatus('idle');
    setMessage(null);
  }, [key]);

  useEffect(() => {
    if (status !== 'sent') return;
    const id = setTimeout(() => {
      setStatus('idle');
      setMessage(null);
    }, NUDGE_COOLDOWN_MS);
    return () => clearTimeout(id);
  }, [status]);

  const send = useCallback(async () => {
    if (!crewId || !userId) return;
    if (statusRef.current === 'sending' || statusRef.current === 'sent') return;
    const sentFor = key;
    statusRef.current = 'sending';
    setStatus('sending');
    setMessage(null);
    try {
      await nudgeCrewMember(crewId, userId);
      if (keyRef.current !== sentFor) return;
      setStatus('sent');
      setMessage(FIND_FRIEND_COPY.nudgeSent(name));
    } catch (err) {
      if (keyRef.current !== sentFor) return;
      setStatus('error');
      setMessage(nudgeErrorMessage(err, name));
    }
  }, [crewId, userId, key, name]);

  return { send, status, message };
}
