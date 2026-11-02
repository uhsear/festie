import { useCallback, useEffect, useState } from 'react';
import { getStorage } from '../platform/storage';

export const SHARE_EXPLAINER_SEEN_KEY = 'festie:live-share-explainer-seen';

/**
 * The one-time "before you share" explainer. `needed` turns true once storage
 * says the user has not tapped Got it on this device. A failed read shows it
 * again, which is the safe side for a privacy notice.
 */
export function useShareExplainer(): { needed: boolean; markSeen: () => void } {
  const [needed, setNeeded] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => getStorage().getItem(SHARE_EXPLAINER_SEEN_KEY))
      .then((seen) => {
        if (live) setNeeded(seen !== '1');
      })
      .catch(() => {
        if (live) setNeeded(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const markSeen = useCallback(() => {
    setNeeded(false);
    Promise.resolve()
      .then(() => getStorage().setItem(SHARE_EXPLAINER_SEEN_KEY, '1'))
      .catch((err) => console.warn('[useShareExplainer] could not save; it will show again', err));
  }, []);

  return { needed, markSeen };
}
