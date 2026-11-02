import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { useUIStore } from '../stores/uiStore';

export interface SpotifyPreview {
  embedType: 'artist' | 'track' | null;
  embedUrl?: string;
  artistId?: string;
  artistName?: string;
  trackId?: string;
  trackName?: string;
  albumArt?: string | null;
}

export type SpotifyPreviewStatus = 'loading' | 'ready' | 'none' | 'offline';

interface Settled {
  key: string;
  status: SpotifyPreviewStatus;
  preview: SpotifyPreview | null;
}

/** Spotify embed info for a set. Fetches again when signal returns (`offlineMode` turns false). */
export function useSpotifyPreview(setId: string | undefined): {
  status: SpotifyPreviewStatus;
  preview: SpotifyPreview | null;
} {
  const offlineMode = useUIStore((s) => s.offlineMode);
  const [settled, setSettled] = useState<Settled | null>(null);
  const key = `${setId}|${offlineMode}`;

  useEffect(() => {
    if (!setId || offlineMode) return;
    let cancelled = false;
    api
      .get<SpotifyPreview>(`/spotify/preview/${encodeURIComponent(setId)}`)
      .then((preview) => {
        if (cancelled) return;
        const ready = !!preview?.embedType && !!preview.embedUrl;
        setSettled({ key, status: ready ? 'ready' : 'none', preview: ready ? preview : null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const network = (err as { isNetworkError?: boolean } | null)?.isNetworkError === true;
        const offline = network || useUIStore.getState().offlineMode;
        setSettled({ key, status: offline ? 'offline' : 'none', preview: null });
      });
    return () => {
      cancelled = true;
    };
  }, [setId, offlineMode, key]);

  if (!setId) return { status: 'none', preview: null };
  if (offlineMode) return { status: 'offline', preview: null };
  if (settled?.key === key) return { status: settled.status, preview: settled.preview };
  return { status: 'loading', preview: null };
}
