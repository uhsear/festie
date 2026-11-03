export const GOOGLE_GSI_SRC = 'https://accounts.google.com/gsi/client';
export const APPLE_JS_SRC = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';

const pending = new Map<string, Promise<void>>();

/** Adds a `<script>` once per URL and resolves on `load`. A failed load is retried on the next call. */
export function loadScript(src: string): Promise<void> {
  const existing = pending.get(src);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      el.remove();
      pending.delete(src);
      reject(new Error('That sign-in did not load. Check your connection and try again.'));
    };
    document.head.appendChild(el);
  });
  pending.set(src, promise);
  return promise;
}
