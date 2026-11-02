import { AVATAR_COPY } from '../constants/accountSettings';

// Mirrors the AVATAR_MAX_UPLOAD_BYTES default in lib/config.ts and ALLOWED_AVATAR_MIME_TYPES in lib/app-context/avatar.ts.
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export const AVATAR_ACCEPT = AVATAR_TYPES.join(',');
export type AvatarUploadFile = File | Blob | { uri: string; name: string; type: string; size?: number | null };

/** A missing size or type passes; the server still checks. */
export function validateAvatarFile(f: { size?: number | null; type?: string | null }): string | null {
  if (f.type && !(AVATAR_TYPES as readonly string[]).includes(f.type)) return AVATAR_COPY.wrongType;
  if (typeof f.size === 'number' && f.size > AVATAR_MAX_BYTES) return AVATAR_COPY.tooBig;
  return null;
}
