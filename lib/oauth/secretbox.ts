/**
 * Authenticated encryption for small secrets at rest (Apple refresh tokens).
 * AES-256-GCM, 12-byte random IV, format `v1.<iv>.<tag>.<ct>` in base64url.
 * `key` is 32 bytes, as a Buffer or as the base64 text of OAUTH_TOKEN_KEY.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

function toKey(key: Buffer | string): Buffer {
  return typeof key === 'string' ? Buffer.from(key, 'base64') : key;
}

export function seal(plain: string, key: Buffer | string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, toKey(key), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), ct]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

/** Throws when the format is unknown, the key is wrong or the data was changed. */
export function open(sealed: string, key: Buffer | string): string {
  const [version, iv, tag, ct, ...extra] = sealed.split('.');
  if (version !== 'v1' || iv === undefined || tag === undefined || ct === undefined || extra.length > 0) {
    throw new Error('secretbox: unsupported format');
  }
  const decipher = createDecipheriv(ALGORITHM, toKey(key), Buffer.from(iv, 'base64url'), { authTagLength: 16 });
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}
