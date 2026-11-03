import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import { mapErrorToUserMessage } from '../services/errors';
import { ACCOUNT_COPY } from '../constants/accountSettings';
import { timeAgo } from '../utils/timeAgo';

export interface SignedInDevice {
  id: string;
  device: string | null;
  createdAt: string;
  lastAccess: string;
  current: boolean;
}

function sortDevices(list: SignedInDevice[]): SignedInDevice[] {
  return [...list].sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    return Date.parse(b.lastAccess) - Date.parse(a.lastAccess);
  });
}

export function deviceTitle(d: SignedInDevice): string {
  return d.device ?? ACCOUNT_COPY.unknownDevice;
}

export function deviceSubtitle(d: SignedInDevice): string {
  return d.current ? ACCOUNT_COPY.thisDevice : ACCOUNT_COPY.lastActive(timeAgo(Date.parse(d.lastAccess)));
}

export function useSignedInDevices(enabled = true) {
  const [devices, setDevices] = useState<SignedInDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.get<SignedInDevice[]>('/auth/sessions');
      setDevices(sortDevices(list ?? []));
    } catch (err) {
      setError(mapErrorToUserMessage(err, ACCOUNT_COPY.devicesLoadFailed));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, reload]);

  const signOut = useCallback(async (id: string) => {
    await api.delete(`/auth/sessions/${encodeURIComponent(id)}`);
    setDevices((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const signOutOthers = useCallback(async () => {
    await api.delete('/auth/sessions');
    setDevices((prev) => prev.filter((d) => d.current));
  }, []);

  return { devices, loading, error, reload, signOut, signOutOthers };
}
