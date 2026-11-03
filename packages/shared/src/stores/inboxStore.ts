import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getStorage } from '../platform/storage';
import { api } from '../services/api';
import { mapErrorToUserMessage } from '../services/errors';
import { INBOX_COPY } from '../constants/inboxCopy';

export interface InboxItem {
  id: string;
  type: string;
  title: string;
  body: string;
  createdAt: string;
  data: { deepLink?: string; setId?: string; festivalId?: string; crewId?: string };
}

export const INBOX_LIMIT = 50;

/** Seen-marker for an empty first load: a fast device clock must not hide later items. */
const EPOCH_ISO = '1970-01-01T00:00:00.000Z';

export interface InboxState {
  items: InboxItem[];
  /** Device-local: items newer than this are unread. Persisted. */
  seenAt: string | null;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  markAllSeen: () => Promise<void>;
}

export function isInboxItemUnread(item: InboxItem, seenAt: string | null): boolean {
  if (seenAt == null) return false;
  return Date.parse(item.createdAt) > Date.parse(seenAt);
}

export function selectInboxUnread(s: { items: InboxItem[]; seenAt: string | null }): number {
  return s.items.filter((item) => isInboxItemUnread(item, s.seenAt)).length;
}

let inFlight: Promise<void> | null = null;

export const useInboxStore = create<InboxState>()(
  persist(
    (set, get) => ({
      items: [],
      seenAt: null,
      loaded: false,
      loading: false,
      error: null,

      load: () => {
        // A caller that awaits load() then markAllSeen() must see the running request's items.
        if (get().loading && inFlight) return inFlight;
        set({ loading: true });
        const request = (async () => {
          try {
            const items = await api.get<InboxItem[]>(`/notifications/history?limit=${INBOX_LIMIT}`);
            // First load starts from "all seen" so nobody opens to a badge of 50.
            const seenAt = get().seenAt ?? items[0]?.createdAt ?? EPOCH_ISO;
            set({ items, seenAt, loaded: true, loading: false, error: null });
          } catch (err) {
            set({ loading: false, error: mapErrorToUserMessage(err, INBOX_COPY.error) });
          }
        })().finally(() => {
          if (inFlight === request) inFlight = null;
        });
        inFlight = request;
        return request;
      },

      markAllSeen: async () => {
        const { seenAt, items } = get();
        const newest = items[0]?.createdAt;
        if (newest && (seenAt == null || Date.parse(newest) > Date.parse(seenAt))) {
          set({ seenAt: newest });
        }
        try {
          await api.post('/notifications/read', {});
        } catch (err) {
          console.warn('inbox: mark read failed', err);
        }
      },
    }),
    {
      name: 'festie-inbox',
      storage: createJSONStorage(() => getStorage()),
      partialize: (state) => ({ seenAt: state.seenAt }),
    },
  ),
);
