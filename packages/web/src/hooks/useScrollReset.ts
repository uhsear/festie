import { useEffect } from 'react';

/**
 * Resets scroll position on every route change. Two rAF ticks because
 * lazy-loaded routes mount AFTER the first effect fires — a plain
 * `scrollTop = 0` lands on an empty Suspense placeholder and the newly
 * mounted content (esp. pages with min-h-screen) can restore a previous
 * scroll offset. Two rAFs ensure the reset sticks after Suspense commits
 * and layout settles. A URL hash that names an element on the page (e.g. /account#danger) is a deep
 * link: the page scrolls itself there, so the reset must not undo it.
 */
const hasHashTarget = () => {
  const id = window.location.hash.slice(1);
  return id !== '' && document.getElementById(id) !== null;
};

export function useScrollReset(pathname: string) {
  useEffect(() => {
    const mainContent = document.getElementById('main-content');
    const parentScroller = mainContent?.parentElement;
    const scrollEls: HTMLElement[] = [];
    if (mainContent) scrollEls.push(mainContent);
    if (parentScroller && parentScroller.scrollTop > 0) scrollEls.push(parentScroller);
    if (scrollEls.length === 0) return;
    const resetAll = () => {
      if (hasHashTarget()) return;
      scrollEls.forEach((el) => { el.scrollTop = 0; });
    };
    resetAll();
    const r1 = requestAnimationFrame(() => {
      resetAll();
      const r2 = requestAnimationFrame(() => { resetAll(); });
      if (mainContent) (mainContent as unknown as Record<string, number>).__rafScrollReset = r2;
    });
    return () => {
      cancelAnimationFrame(r1);
      if (mainContent) {
        const r2 = (mainContent as unknown as Record<string, number>).__rafScrollReset;
        if (r2) cancelAnimationFrame(r2);
      }
    };
  }, [pathname]);
}
