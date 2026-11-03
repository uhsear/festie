import { useState, useEffect } from 'react';

/**
 * Tracks viewport dimensions for the schedule grid. Row height comes from the
 * grid's zoom level, not from here.
 */
export function useTimelineViewport() {
  const [vpH, setVpH] = useState(() => (typeof window === 'undefined' ? 900 : window.innerHeight));
  const [vpW, setVpW] = useState(() => (typeof window === 'undefined' ? 1024 : window.innerWidth));

  useEffect(() => {
    let rafId: number | null = null;
    const onResize = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        setVpH(window.innerHeight);
        setVpW(window.innerWidth);
        rafId = null;
      });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  return { vpH, vpW };
}
