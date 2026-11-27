import { COPY } from '@festie/shared/constants';

/** The boot overlay shows the mark alone for this long, then one status line. */
export const BOOT_STATUS_DELAY_MS = 1500;

/** One line from real boot state: offline wins, then the store restore, then the generic wait. */
export function bootStatusLine({ offline, hydrated }: { offline: boolean; hydrated: boolean }): string {
  if (offline) return COPY.boot.offline;
  return hydrated ? COPY.boot.waiting : COPY.boot.restoring;
}
