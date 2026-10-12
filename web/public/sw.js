/**
 * Minimal service worker: it makes the CRM installable and keeps the shell
 * available offline. API responses are deliberately never cached — a stale lead
 * board is worse than no board.
 */
const CACHE = 'emir-crm-v2';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never serve stale CRM data.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/webhooks/') || url.pathname.startsWith('/b/')) return;

  // Navigations: network first, falling back to the cached shell.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/index.html').then((r) => r ?? Response.error())));
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});

/* ── Notifications ──────────────────────────────────────────────────────
 *
 * Firebase Cloud Messaging delivers a plain Web Push event here. We display
 * it ourselves rather than letting Firebase's own service worker do it, so
 * there is one service worker rather than two racing to show the same thing —
 * which is how an agent ends up with a lead buzzing twice.
 *
 * A lead alert that an agent misses is a lead a competitor answers first, so
 * these are deliberately loud: they require interaction, and they re-use the
 * contact's tag so two alerts about the same person replace one another
 * instead of stacking up.
 */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // A push with a body we cannot read is still worth showing.
    payload = { notification: { title: 'Emir CRM', body: event.data ? event.data.text() : '' } };
  }

  const notification = payload.notification ?? {};
  const data = payload.data ?? {};
  const link = data.link ?? payload.fcmOptions?.link ?? '/';

  event.waitUntil(
    self.registration.showNotification(notification.title ?? 'Emir CRM', {
      body: notification.body ?? '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // One notification per contact: a second alert replaces the first.
      tag: data.contactId ? `contact-${data.contactId}` : undefined,
      renotify: Boolean(data.contactId),
      requireInteraction: data.priority === 'high',
      data: { link, tel: data.tel ?? null },
      actions: data.tel ? [{ action: 'call', title: 'Call' }] : [],
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { link, tel } = event.notification.data ?? {};
  const target = event.action === 'call' && tel ? tel : new URL(link || '/', self.location.origin).href;

  event.waitUntil(
    (async () => {
      if (event.action === 'call' && tel) {
        await self.clients.openWindow(tel);
        return;
      }
      /*
       * Re-use an open window rather than stacking tabs. An agent who already
       * has the CRM open should land on the lead, not on a third copy of it.
       */
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of open) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          await client.focus();
          if ('navigate' in client) await client.navigate(target);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
