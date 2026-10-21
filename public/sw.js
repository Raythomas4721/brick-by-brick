// Service worker: shows reminders pushed by the backend, even when the app is closed.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || '積木城市', {
      body: data.body || '你有一件事項要做',
      tag: data.tag,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: { url: self.registration.scope },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.startsWith(url));
      return open ? open.focus() : self.clients.openWindow(url);
    }),
  );
});
