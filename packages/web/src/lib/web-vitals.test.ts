import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const handlers: Array<(m: unknown) => void> = [];
vi.mock('web-vitals', () => {
  const reg = (cb: (m: unknown) => void) => handlers.push(cb);
  return { onCLS: reg, onLCP: reg, onINP: reg, onFCP: reg, onTTFB: reg };
});


describe('initWebVitals', () => {
  let initWebVitals: () => void;

  beforeEach(async () => {
    localStorage.clear();
    handlers.length = 0;
    // Fresh module per test: web-vitals.ts keeps its pending metrics at module level.
    vi.resetModules();
    ({ initWebVitals } = await import('./web-vitals'));
  });

  afterEach(() => {
    // Drop the overrides so they do not leak into other tests in this file's environment.
    delete (document as { visibilityState?: unknown }).visibilityState;
    delete (navigator as { sendBeacon?: unknown }).sendBeacon;
  });

  it('sends each metric once, with its latest value, when the page is hidden', () => {
    const beacon = vi.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    initWebVitals();
    const cls = handlers[0]!;
    cls({ name: 'CLS', value: 0.01, rating: 'good', delta: 0.01, id: 'a' });
    cls({ name: 'CLS', value: 0.05, rating: 'good', delta: 0.04, id: 'a' });
    expect(beacon).not.toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));

    expect(beacon).toHaveBeenCalledTimes(1);
    expect(JSON.parse((beacon.mock.calls[0] as unknown as [string, string])[1]).value).toBe(0.05);
  });

  it('keeps the queue when the page is hidden offline', () => {
    const beacon = vi.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    const queued = [{ name: 'LCP', value: 1, rating: 'good', delta: 1, id: 'q', url: '/' }];
    localStorage.setItem('fp:webvitals:queue', JSON.stringify(queued));
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    initWebVitals();

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(beacon).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('fp:webvitals:queue')!)).toEqual(queued);
    online.mockRestore();
  });
});
