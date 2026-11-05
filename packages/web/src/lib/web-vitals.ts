import { onCLS, onLCP, onINP, onFCP, onTTFB, type Metric } from 'web-vitals';

// Note: web-vitals v5 removed onFID (deprecated in favor of INP).
// We include INP + the remaining Core Web Vitals + TTFB.

const ENDPOINT = '/api/v1/metrics/web-vitals';
const QUEUE_KEY = 'fp:webvitals:queue';
const QUEUE_CAP = 50;

interface Payload {
  name: string;
  value: number;
  rating?: string;
  delta?: number;
  id?: string;
  url: string;
  navigationType?: string;
}

function readQueue(): Payload[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, QUEUE_CAP) : [];
  } catch {
    return [];
  }
}

function writeQueue(items: Payload[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(items.slice(-QUEUE_CAP)));
  } catch {
    /* quota exceeded / private mode — drop silently */
  }
}

function enqueue(p: Payload): void {
  const q = readQueue();
  q.push(p);
  writeQueue(q);
}

function postOne(p: Payload): boolean {
  const body = JSON.stringify(p);
  if (navigator.sendBeacon) {
    try {
      return navigator.sendBeacon(ENDPOINT, body);
    } catch {
      return false;
    }
  }
  // Fallback fetch — treat as best-effort; success not guaranteed.
  fetch(ENDPOINT, {
    body,
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
  }).catch(() => {});
  return true;
}

function flushQueue(): void {
  const q = readQueue();
  if (q.length === 0) return;
  const remaining: Payload[] = [];
  for (const item of q) {
    const ok = postOne(item);
    if (!ok) remaining.push(item);
  }
  writeQueue(remaining);
}

// Latest value per metric. CLS and INP keep changing during a visit, so each one
// goes out once, when the page is hidden, instead of on every update.
const pending = new Map<string, Payload>();

function collect(metric: Metric) {
  pending.set(metric.name, {
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    delta: metric.delta,
    id: metric.id,
    url: window.location.pathname,
    navigationType: metric.navigationType,
  });
}

function sendPending(): void {
  for (const payload of pending.values()) {
    // Offline: queue for the next reconnect.
    if (navigator.onLine === false || !postOne(payload)) enqueue(payload);
  }
  pending.clear();
}

export function initWebVitals(): void {
  onCLS(collect);
  onLCP(collect);
  onINP(collect);
  onFCP(collect);
  onTTFB(collect);

  // Flush on reconnect.
  window.addEventListener('online', flushQueue);

  // Page-hide is the last chance before unload; pagehide covers browsers that skip visibilitychange.
  const onHide = () => {
    flushQueue();
    sendPending();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onHide();
  });
  window.addEventListener('pagehide', onHide);

  // Attempt an initial drain if we booted with pending queued items.
  if (navigator.onLine !== false) flushQueue();
}
