import { safeReturnPath } from '@festie/shared/utils';

// In-memory on purpose: it only has to survive the hop through sign-in or
// sign-up, and a cold start must not replay a stale path.
let pendingPath: string | null = null;

export function setReturnTo(path: string | null): void {
  pendingPath = safeReturnPath(path);
}

export function takeReturnTo(): string | null {
  const path = pendingPath;
  pendingPath = null;
  return path;
}
