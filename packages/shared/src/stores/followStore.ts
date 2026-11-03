import { create } from 'zustand';
import { api } from '../services/api';
import { useAuthStore } from './authStore';

/**
 * Festivals the signed-in user follows, backed by /festivals/follows.
 * Writes are online only and skip the offline queue: a failed write reverts the toggle.
 */
interface FollowState {
  festivalIds: string[];
  loaded: boolean;
  load: () => Promise<void>;
  setFollowing: (festivalId: string, on: boolean) => Promise<void>;
  isFollowing: (festivalId: string) => boolean;
}

// Every mounted FollowButton calls load(), so concurrent calls share one request.
let inflight: { userId: string; promise: Promise<void> } | null = null;
// Toggles made while a load is in flight, replayed over the server snapshot so it cannot undo them.
const editsDuringLoad = new Map<string, boolean>();

function withFollow(ids: readonly string[], festivalId: string, on: boolean): string[] {
  const without = ids.filter((id) => id !== festivalId);
  return on ? [festivalId, ...without] : without;
}

export const useFollowStore = create<FollowState>((set, get) => ({
  festivalIds: [],
  loaded: false,

  load: () => {
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return Promise.resolve();
    if (inflight?.userId === userId) return inflight.promise;
    editsDuringLoad.clear();
    const promise = api
      .get<{ festivalIds: string[] }>('/festivals/follows')
      .then((res) => {
        // A sign-out or account switch while the request ran makes this snapshot someone else's.
        if (useAuthStore.getState().user?.id !== userId) return;
        let ids = res.festivalIds ?? [];
        for (const [festivalId, on] of editsDuringLoad) ids = withFollow(ids, festivalId, on);
        set({ festivalIds: ids, loaded: true });
      })
      .finally(() => {
        if (inflight?.promise !== promise) return;
        inflight = null;
        editsDuringLoad.clear();
      });
    inflight = { userId, promise };
    return promise;
  },

  setFollowing: async (festivalId, on) => {
    const prev = get().festivalIds;
    const track = (value: boolean) => {
      if (inflight) editsDuringLoad.set(festivalId, value);
    };
    set({ festivalIds: withFollow(prev, festivalId, on) });
    track(on);
    try {
      const path = `/festivals/${encodeURIComponent(festivalId)}/follow`;
      if (on) await api.put(path, {});
      else await api.delete(path);
    } catch (err) {
      set({ festivalIds: prev });
      track(prev.includes(festivalId));
      throw err;
    }
  },

  isFollowing: (festivalId) => get().festivalIds.includes(festivalId),
}));
