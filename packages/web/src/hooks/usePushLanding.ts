import { useEffect } from 'react';
import { useFestivalStore } from '@festie/shared/stores';

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * A lineup-drop or wrap push opens `/?festival=<id>`. Select that festival once,
 * then drop the parameter so a reload does not repeat it.
 */
export function usePushLanding(): void {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('festival');
    if (!id || !ID_PATTERN.test(id)) return;

    (async () => {
      const store = useFestivalStore.getState();
      if (!store.festivals?.length) await store.loadFestivals();
      await useFestivalStore.getState().selectFestival(id);
    })().catch((err) => console.warn('Could not open the festival from the notification link', err));

    params.delete('festival');
    const query = params.toString();
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
    );
  }, []);
}
