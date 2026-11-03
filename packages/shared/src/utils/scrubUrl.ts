const R = '[redacted]';

// Redacts secrets from a URL or deep link before it reaches Sentry. Keeps the
// key so the event still says what was there. Idempotent; never throws.
export function scrubSensitiveUrl(s?: string): string | undefined {
  if (typeof s !== 'string') return s;
  return s
    .replace(/([?&](?:token|code|joinCrew)=)[^&#]*/g, `$1${R}`)
    .replace(/(\/reset\/)[^/?#]+/g, `$1${R}`)
    .replace(/(\/cal\/)[^/?#]+?(\.ics)/g, `$1${R}$2`)
    .replace(/(\/join\/)[^/?#]+/g, `$1${R}`);
}
