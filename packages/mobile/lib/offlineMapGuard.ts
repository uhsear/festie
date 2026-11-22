// Pure decision for the free-space check before the offline map download. No expo imports, so it
// is testable without a file system.
import { OFFLINE_MAP_COPY } from '@festie/shared/constants';

// Headroom on top of the archive, so saving the map never leaves the phone completely full.
export const FREE_SPACE_MARGIN_BYTES = 50 * 1024 * 1024;

export type MapSpaceCheck = { ok: true } | { ok: false; message: string };

/**
 * Whether the archive plus the margin fits in the free space. Unknown on either side (the server sent
 * no length, or the device would not say) is ok: the download then runs as it did before this check.
 */
export function checkMapSpace(archiveBytes: number | null, freeBytes: number | null): MapSpaceCheck {
  if (archiveBytes == null || freeBytes == null || !(archiveBytes > 0) || !(freeBytes > 0)) return { ok: true };
  const needed = archiveBytes + FREE_SPACE_MARGIN_BYTES;
  if (freeBytes >= needed) return { ok: true };
  return { ok: false, message: OFFLINE_MAP_COPY.notEnoughSpace(needed, freeBytes) };
}
