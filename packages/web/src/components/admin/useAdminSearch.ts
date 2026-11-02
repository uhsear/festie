import { useCallback } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';

export const ADMIN_TABS = ['dashboard', 'festivals', 'users', 'crews', 'audit', 'analytics'] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];

const ADMIN_VIEWS = ['edit', 'map', 'import'] as const;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

export type AdminSearch = {
  tab?: AdminTab;
  festival?: string;
  view?: (typeof ADMIN_VIEWS)[number];
  q?: string;
  /** T35 user detail deep link. */
  user?: string;
  /** T35 preview deep link. */
  preview?: string;
};

const asId = (v: unknown): string | undefined => (typeof v === 'string' && ID_PATTERN.test(v) ? v : undefined);

/** Keeps only valid admin URL params; everything else is dropped. */
export function parseAdminSearch(raw: Record<string, unknown>): AdminSearch {
  const tab = ADMIN_TABS.find((t) => t === raw.tab);
  const view = ADMIN_VIEWS.find((v) => v === raw.view);
  const festival = asId(raw.festival);
  const user = asId(raw.user);
  const preview = asId(raw.preview);
  const q = typeof raw.q === 'string' ? raw.q.trim() : '';
  return {
    ...(tab && { tab }),
    ...(festival && { festival }),
    ...(view && { view }),
    ...(q && q.length <= 200 && { q }),
    ...(user && { user }),
    ...(preview && { preview }),
  };
}

/** Admin URL state. `setAdminSearch` navigates to exactly `next` (not merged); push by default. */
export function useAdminSearch(): [AdminSearch, (next: AdminSearch, opts?: { replace?: boolean }) => void] {
  const search = useSearch({ from: '/admin' }) as AdminSearch;
  const navigate = useNavigate();
  const setAdminSearch = useCallback(
    (next: AdminSearch, { replace = false }: { replace?: boolean } = {}) => {
      void navigate({ to: '/admin', search: next, replace });
    },
    [navigate],
  );
  return [search, setAdminSearch];
}
