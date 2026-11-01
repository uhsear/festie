import { useCallback, useEffect, useRef, useState } from 'react';
import { useFestivalDataStore } from '../stores/festivalDataStore';
import { useUIStore } from '../stores/uiStore';

export type NoteSaveStatus = 'idle' | 'saving' | 'saved' | 'queued' | 'failed';

export interface UseDebouncedNoteArgs {
  festivalId: string | undefined;
  profileId: string | undefined;
  /** set.id, or 'crew:' + set.id */
  noteKey: string;
  initialValue: string;
  /** Default 500. */
  delayMs?: number;
  onSaved?: () => void;
  onError?: (err: unknown) => void;
}

export interface UseDebouncedNoteReturn {
  value: string;
  setValue: (v: string) => void;
  retry: () => void;
  status: NoteSaveStatus;
}

interface PendingSave {
  timer: ReturnType<typeof setTimeout>;
  festivalId: string;
  noteKey: string;
}

/**
 * An editable note draft that saves through the store after `delayMs` of no
 * typing. A pending save is flushed, never dropped, when the component
 * unmounts (sheet closed right after typing), when the note key changes, and
 * on web `pagehide`.
 */
export function useDebouncedNote({
  festivalId,
  profileId,
  noteKey,
  initialValue,
  delayMs = 500,
  onSaved,
  onError,
}: UseDebouncedNoteArgs): UseDebouncedNoteReturn {
  const [value, setValueState] = useState(initialValue);
  const [status, setStatus] = useState<NoteSaveStatus>('idle');
  const valueRef = useRef(initialValue);
  const pendingRef = useRef<PendingSave | null>(null);
  const mountedRef = useRef(false);
  // Latest props for the timer and the unmount flush, which outlive the render that scheduled them.
  const argsRef = useRef({ festivalId, profileId, noteKey, delayMs, onSaved, onError });
  argsRef.current = { festivalId, profileId, noteKey, delayMs, onSaved, onError };

  const send = useCallback((note: string, key: string, fid: string) => {
    const { onSaved: saved, onError: failed } = argsRef.current;
    if (mountedRef.current) setStatus('saving');
    useFestivalDataStore
      .getState()
      .saveNote({ festivalId: fid, setId: key, note })
      .then(
        () => {
          if (mountedRef.current) setStatus(useUIStore.getState().offlineMode ? 'queued' : 'saved');
          saved?.();
        },
        (err: unknown) => {
          if (mountedRef.current) setStatus('failed');
          failed?.(err);
        },
      );
  }, []);

  const flush = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingRef.current = null;
    send(valueRef.current, pending.noteKey, pending.festivalId);
  }, [send]);

  const setValue = useCallback(
    (v: string) => {
      valueRef.current = v;
      setValueState(v);
      if (pendingRef.current) clearTimeout(pendingRef.current.timer);
      pendingRef.current = null;
      const { festivalId: fid, profileId: pid, noteKey: key, delayMs: delay } = argsRef.current;
      if (!fid || !pid) return;
      pendingRef.current = { festivalId: fid, noteKey: key, timer: setTimeout(flush, delay) };
    },
    [flush],
  );

  const retry = useCallback(() => {
    if (pendingRef.current) {
      flush();
      return;
    }
    const { festivalId: fid, profileId: pid, noteKey: key } = argsRef.current;
    if (fid && pid) send(valueRef.current, key, fid);
  }, [flush, send]);

  // Re-seed only when the note or profile actually changes, not on every new
  // profile object: background refreshes (AppState foreground, offline-readiness
  // download) hand back a fresh profile reference with the same id, and
  // re-seeding on those clobbers whatever the user is mid-typing.
  const seedKey = `${profileId ?? ''}|${noteKey}`;
  useEffect(() => {
    flush(); // save text typed under the previous key before replacing it
    valueRef.current = initialValue;
    setValueState(initialValue);
    setStatus('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: reseed on key change only (see comment above)
  }, [seedKey]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      flush();
    };
  }, [flush]);

  // React Native has `window` but no addEventListener.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [flush]);

  return { value, setValue, retry, status };
}
