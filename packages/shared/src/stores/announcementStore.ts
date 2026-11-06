import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getStorage } from '../platform/storage';
import { announcementsApi } from '../services/announcements';
import type { FestivalAnnouncement } from '../types/announcement';

const MAX_DISMISSED = 50;
// The endpoint is rate limited (429). After any failure, leave the festival alone for a minute.
const BACKOFF_MS = 60_000;
const inFlight = new Map<string, Promise<void>>();
const retryAfter = new Map<string, number>();

interface AnnouncementState {
  festivalId: string | null;
  items: FestivalAnnouncement[];
  /** Device preference, like `theme`: resetStores does not clear it. */
  dismissed: string[];
  load: (festivalId: string | null) => Promise<void>;
  dismiss: (id: string) => void;
}

export const useAnnouncementStore = create<AnnouncementState>()(
  persist(
    (set, get) => ({
      festivalId: null,
      items: [],
      dismissed: [],

      load: async (festivalId) => {
        if (!festivalId) {
          set({ festivalId: null, items: [] });
          return;
        }
        // Keep old items on error only for the same festival; never show A's banner on B.
        if (festivalId !== get().festivalId) set({ festivalId, items: [] });
        if (Date.now() < (retryAfter.get(festivalId) ?? 0)) return;
        const pending = inFlight.get(festivalId);
        if (pending) return pending;
        const request = (async () => {
          try {
            const items = await announcementsApi.list(festivalId);
            retryAfter.delete(festivalId);
            if (get().festivalId === festivalId) set({ items });
          } catch (err) {
            retryAfter.set(festivalId, Date.now() + BACKOFF_MS);
            console.warn('announcements: load failed', err);
          } finally {
            inFlight.delete(festivalId);
          }
        })();
        inFlight.set(festivalId, request);
        return request;
      },

      dismiss: (id) =>
        set((s) => (s.dismissed.includes(id) ? s : { dismissed: [...s.dismissed, id].slice(-MAX_DISMISSED) })),
    }),
    {
      name: 'festie-announcements',
      storage: createJSONStorage(() => getStorage()),
      partialize: (state) => ({ dismissed: state.dismissed }),
    },
  ),
);
