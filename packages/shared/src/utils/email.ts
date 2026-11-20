/**
 * Email validation — a single UX-level check shared by web (register) and mobile
 * (forgot-password). This is intentionally a lightweight client-side gate; the
 * backend Zod schemas remain the authoritative validation boundary.
 *
 * Pure, no globals — safe for both web and React Native.
 */

import { z } from 'zod';

/**
 * The pattern Zod's `.email()` applies, so a client-side pass is a server-side pass.
 * The backend schemas in `lib/schemas.ts` use `z.string().email()`; both depend on the same
 * zod major, so the two do not drift.
 */
export const EMAIL_RE = z.regexes.email;

/** True when `value` looks like a valid email (UX check only — not a security boundary). */
export function isValidEmail(value: string | null | undefined): boolean {
  if (!value) return false;
  return EMAIL_RE.test(value);
}
