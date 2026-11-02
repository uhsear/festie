export type InstallEvent = 'shown' | 'accepted' | 'dismissed';

export function installPlatform(ua: string): 'ios' | 'android' | 'desktop' {
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  return 'desktop';
}

let shownPosted = false;

/** Reports an install-button event. `shown` posts once per page load. sendBeacon is out: it sends text/plain and the route reads JSON. */
export function postInstallEvent(event: InstallEvent): void {
  if (event === 'shown') {
    if (shownPosted) return;
    shownPosted = true;
  }
  void fetch('/api/v1/analytics/install', {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform: installPlatform(navigator.userAgent), event }),
  }).catch(() => {});
}
