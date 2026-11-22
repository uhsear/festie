/* Web Push handlers. Loaded into the generated Workbox service worker via importScripts. */
self.addEventListener('push', (event) => {
  let payload = { title: 'Festie' };
  try {
    // A JSON null payload would throw on destructuring below, so keep the generic one.
    payload = event.data.json() || payload;
  } catch {
    // No payload or not JSON: show the generic notification.
  }
  const { title, body, tag, url } = payload;
  event.waitUntil(
    self.registration.showNotification(title || 'Festie', {
      body,
      tag,
      // A reminder shares its tag with the one before it; without renotify the replacement would be silent.
      renotify: !!tag,
      data: { url },
      icon: '/icons/icon-192.png',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url;
  let target;
  try {
    target = new URL(url || '/', self.location.origin);
  } catch {
    target = new URL('/', self.location.origin);
  }
  // Same-origin only, so a crafted url cannot act as an open redirect.
  if (target.origin !== self.location.origin) target = new URL('/', self.location.origin);

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows[0];
      if (!existing) {
        await self.clients.openWindow(target.href);
        return;
      }
      await existing.focus();
      if (typeof existing.navigate !== 'function') return;
      try {
        await existing.navigate(target.href);
      } catch {
        // An uncontrolled window cannot be navigated; open the deep link instead.
        await self.clients.openWindow(target.href);
      }
    })(),
  );
});
