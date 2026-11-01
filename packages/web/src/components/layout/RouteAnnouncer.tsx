import { useEffect, useRef, useState } from 'react';
import { useLocation } from '@tanstack/react-router';
import { useFestivalStore } from '@festie/shared/stores';

const ROUTE_TITLES: Record<string, { page: string; festival: boolean }> = {
  '/': { page: 'Schedule', festival: true },
  '/cards': { page: 'Schedule', festival: true },
  '/timeline': { page: 'Timeline', festival: true },
  '/grid': { page: 'Grid', festival: true },
  '/picks': { page: 'My Picks', festival: true },
  '/crew': { page: 'Crew', festival: true },
  '/crew-plan': { page: 'Crew plan', festival: true },
  '/compare': { page: 'Compare schedules', festival: true },
  '/festival-mode': { page: 'Now & Next', festival: true },
  '/wrap': { page: 'Wrap', festival: true },
  '/account': { page: 'Account', festival: false },
  '/admin': { page: 'Admin', festival: false },
  '/login': { page: 'Sign in', festival: false },
  '/register': { page: 'Create account', festival: false },
  '/forgot-password': { page: 'Reset password', festival: false },
};

export function routeTitle(pathname: string): { page: string; festival: boolean } {
  if (pathname.startsWith('/set/')) return { page: 'Set', festival: true };
  return ROUTE_TITLES[pathname] ?? { page: 'Page not found', festival: false };
}

/** Sets the tab title per route and announces route changes to screen readers. Never moves focus. */
export default function RouteAnnouncer() {
  const { pathname } = useLocation();
  const festivalName = useFestivalStore((s) => s.currentFestival?.name);
  const [message, setMessage] = useState('');
  const firstRun = useRef(true);

  useEffect(() => {
    const { page, festival } = routeTitle(pathname);
    document.title = festival && festivalName ? `${page} · ${festivalName} · Festie` : `${page} · Festie`;
  }, [pathname, festivalName]);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    setMessage(`${routeTitle(pathname).page} page`);
  }, [pathname]);

  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}
