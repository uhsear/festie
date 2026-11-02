import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useFestivalStore } from '../stores/festivalStore';

export type NotificationTopic = 'crew' | 'schedule';
type TopicSubscriptions = { crew: boolean; schedule: boolean };

/**
 * Per-festival topic mutes for the current festival, via GET/PUT /notifications/topics/:festivalId.
 * The endpoint is member-scoped, so `festival` is null (and no request is made) unless the user
 * is signed in and joined the current festival.
 */
export function useNotificationTopics(): {
  festival: { id: string; name: string } | null;
  subs: TopicSubscriptions | null;
  error: boolean;
  setTopic: (topic: NotificationTopic, value: boolean) => Promise<void>;
} {
  const user = useAuthStore((s) => s.user);
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const currentProfile = useFestivalStore((s) => s.currentProfile);
  const festivalId =
    user && currentFestival && currentProfile?.festivalId === currentFestival.id ? currentFestival.id : null;
  const festivalName = currentFestival?.name ?? '';

  const [subs, setSubs] = useState<TopicSubscriptions | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!festivalId) return;
    let cancelled = false;
    setSubs(null);
    setError(false);
    api
      .get<TopicSubscriptions>(`/notifications/topics/${encodeURIComponent(festivalId)}`)
      .then((data) => {
        if (!cancelled) setSubs({ crew: data.crew !== false, schedule: data.schedule !== false });
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [festivalId]);

  const setTopic = useCallback(
    async (topic: NotificationTopic, value: boolean) => {
      if (!festivalId) return;
      setSubs((s) => (s ? { ...s, [topic]: value } : s));
      try {
        await api.put(`/notifications/topics/${encodeURIComponent(festivalId)}`, { [topic]: value });
      } catch (err) {
        // Roll back only the key we changed so a concurrent toggle of the other topic survives.
        setSubs((s) => (s ? { ...s, [topic]: !value } : s));
        throw err;
      }
    },
    [festivalId],
  );

  return { festival: festivalId ? { id: festivalId, name: festivalName } : null, subs, error, setTopic };
}
