/* ==============================================================
   SERVICE WORKER — offline app shell + runtime caching.

   This file is NOT one of the classic <script> tags in index.html;
   it runs in its own worker scope and shares nothing with the app.
   It is registered by js/pwa.js.

   Bump CACHE_VERSION whenever a shell file changes so returning
   installs pick the new build up instead of serving a stale one.
   ============================================================== */

const CACHE_VERSION = 'v168';
const SHELL_CACHE = `bucketlist-shell-${CACHE_VERSION}`;
const VENDOR_CACHE = `bucketlist-vendor-${CACHE_VERSION}`;
const IMAGE_CACHE = `bucketlist-images-${CACHE_VERSION}`;
const CURRENT_CACHES = [SHELL_CACHE, VENDOR_CACHE, IMAGE_CACHE];

/* Everything needed to boot the UI with no network. Keep in sync with the
   <link>/<script> manifest in index.html. */
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/base.css',
  './css/layout.css',
  './css/components.css',
  './css/auth.css',
  './css/home.css',
  './css/collections.css',
  './css/detail.css',
  './css/me.css',
  './css/modals.css',
  './css/map.css',
  './css/dupes.css',
  './css/sharing.css',
  './css/messages.css',
  './css/notes.css',
  './css/moderation.css',
  './css/pwa.css',
  './css/theme.css',
  './css/responsive.css',
  './js/config.js',
  './js/state.js',
  './js/utils.js',
  './js/fuzzy.js',
  './js/exif.js',
  './js/haptics.js',
  './js/icons.js',
  './js/offline.js',
  './js/api.js',
  './js/auth.js',
  './js/nav.js',
  './js/router.js',
  './js/deeplink.js',
  './js/modals.js',
  './js/gestures.js',
  './js/links.js',
  './js/location.js',
  './js/media.js',
  './js/dupes.js',
  './js/sharing.js',
  './js/moderation.js',
  './js/home.js',
  './js/upnext.js',
  './js/done.js',
  './js/nativepush.js',
  './js/reminders.js',
  './js/smartlists.js',
  './js/collections.js',
  './js/detail.js',
  './js/activities.js',
  './js/messages.js',
  './js/notes.js',
  './js/me.js',
  './js/map.js',
  './js/pwa.js',
  './js/main.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/favicon-16.png',
];

/* Third-party code and assets the app cannot run without: MapLibre GL,
   supabase-js, and the two display faces. */
const VENDOR_HOSTS = [
  'unpkg.com',
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

/* Remote imagery — default collection covers and map tiles. */
const IMAGE_HOSTS = [
  'images.unsplash.com',
  /* Both tile hosts: MapTiler when a key is set in config.js, CARTO as
     the keyless fallback. Missing MapTiler here would mean the map
     works online and goes blank in a tunnel, which is the failure the
     offline shell exists to prevent. */
  'api.maptiler.com',
  'basemaps.cartocdn.com',
  /* The R2 bucket holding every photo and video. Keys are random and
     never reused, so these are immutable and cache-first is exactly
     right. Must match MEDIA_PUBLIC_BASE in js/config.js -- if the two
     drift, photos silently stop being available offline. */
  'pub-316c43a551774a47b23000d0b88a37f0.r2.dev',
];

/* Never cache: live data and the geocoder. Supabase auth in particular must
   always hit the network or a signed-out user could be served a stale session.

   Note what this does NOT do to place search. The geo function is on
   supabase.co, so it lands here and the worker returns without calling
   respondWith — which hands the request back to normal browser handling,
   HTTP cache included. That is deliberate: geo answers a GET with
   `Cache-Control: private, max-age=…`, and the browser cache is the right
   place to honour it. Taking these responses into a Cache Storage bucket
   here would ignore that header and outlive it.

   hereapi.com is deliberately absent: the browser never contacts HERE
   directly. See THE geo FUNCTION in js/location.js. */
const NEVER_CACHE_HOSTS = [
  'supabase.co',
  'nominatim.openstreetmap.org',
];

const matchesHost = (url, hosts) => hosts.some(h => url.hostname === h || url.hostname.endsWith('.' + h));

/* ---------- Install: pre-cache the shell ---------- */
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    /* addAll() is all-or-nothing; cache each asset on its own so one
       bad path can never abort the whole install. */
    await Promise.all(SHELL_ASSETS.map(async asset => {
      try {
        await cache.add(new Request(asset, { cache: 'reload' }));
      } catch (e) {
        console.warn('[sw] could not pre-cache', asset, e);
      }
    }));
    self.skipWaiting();
  })());
});

/* ---------- Activate: drop caches from older versions ---------- */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k.startsWith('bucketlist-') && !CURRENT_CACHES.includes(k))
          .map(k => caches.delete(k))
    );
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }
    await self.clients.claim();
  })());
});


/* ---------- App icon badge ----------
   The red count on the home-screen icon (iOS 16.4+ installed PWA,
   Android, desktop). navigator.setAppBadge needs an absolute number,
   so the count is kept in a cache entry rather than in a variable —
   the worker is killed between pushes. The page is authoritative and
   overwrites it with the real unread total whenever it renders the
   tab badge; the worker only increments while nothing is running. */
const BADGE_CACHE = 'bucketlist-badge';

async function badgeGet() {
  try {
    const c = await caches.open(BADGE_CACHE);
    const r = await c.match('count');
    return r ? (Number(await r.text()) || 0) : 0;
  } catch { return 0; }
}

async function badgeSet(n) {
  n = Math.max(0, Number(n) || 0);
  try {
    const c = await caches.open(BADGE_CACHE);
    await c.put('count', new Response(String(n)));
  } catch {}
  try {
    if (n > 0) await self.navigator?.setAppBadge?.(n);
    else await self.navigator?.clearAppBadge?.();
  } catch {}
}

self.addEventListener('message', event => {
  const d = event.data || {};
  if (d.type === 'badge-count') event.waitUntil(badgeSet(d.count));
});

/* ---------- Push ----------
   Two senders now, and they want different banners:

     send-reminders     a date arrived  → the activity is the headline
     send-message-push  somebody spoke  → "Sarah · Japan 2027"

   They are told apart by payload.kind, which only the newer one sets;
   anything without it is a reminder, so a push already in flight from
   an older function still lands correctly.

   The payload is JSON and a malformed one still shows a banner: a push
   that arrives and shows nothing is worse than a vague one, and the
   browser will show its own "This site has been updated in the
   background" if we resolve without displaying anything at all. */
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const isMessage = payload.kind === 'message';

  const title = payload.title || (isMessage ? 'New message' : 'Reminder');
  const body = payload.body ||
    (isMessage ? 'Tap to read it.' : 'You have something coming up.');

  /* Tagging collapses repeats rather than stacking them. A conversation
     tags by collection, so a burst of messages in one list replaces
     itself instead of filling the shade — renotify brings the alert
     back for each one so it is still noticed. */
  const tag = isMessage
    ? 'bl-conv-' + (payload.collectionId || 'all')
    : (payload.activityId ? 'bl-reminder-' + payload.activityId : 'bl-reminders');

  event.waitUntil((async () => {
    await badgeSet(await badgeGet() + 1);
    return self.registration.showNotification(title, {
    body,
    icon: 'icons/icon-192.png',
    badge: 'icons/favicon-32.png',
    tag,
    renotify: isMessage,
    data: {
      url: './index.html',
      kind: isMessage ? 'message' : 'reminder',
      collectionId: payload.collectionId || null,
      activityId: payload.activityId || null,
    },
    });
  })());
});

/* Tapping should bring the app forward rather than opening a second
   copy of it — and, for a message, land on the conversation it came
   from. There is no URL routing in this app (see the backlog), so the
   destination is handed to the running page as a postMessage rather
   than as a query string; js/messages.js listens for it. A cold start
   has no page to tell, so the collection id rides on the URL and
   readPushLanding() in messages.js picks it up at boot. */
self.addEventListener('notificationclick', event => {
  const data = event.notification.data || {};
  event.notification.close();
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of clients) {
      if ('focus' in c) {
        if (data.kind === 'message' && data.collectionId) {
          c.postMessage({ type: 'open-conversation', collectionId: data.collectionId });
        } else if (data.kind === 'reminder' && data.activityId) {
          c.postMessage({ type: 'open-activity', activityId: data.activityId });
        }
        return c.focus();
      }
    }
    const url = data.kind === 'message' && data.collectionId
      ? './index.html?conv=' + encodeURIComponent(data.collectionId)
      : data.kind === 'reminder' && data.activityId
        ? './index.html?act=' + encodeURIComponent(data.activityId)
        : './index.html';
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});

/* Let the page tell a waiting worker to take over immediately. */
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

/* ---------- Caching strategies ---------- */

/* Serve from cache, refresh in the background. Used for the shell so the app
   opens instantly offline but still picks up edits on the next load. */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request).then(res => {
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  return cached || network || fetch(request);
}

/* Serve from cache, only hit the network on a miss. Used for immutable
   vendor bundles, fonts, map tiles and remote photos.

   ⚠️ AN OPAQUE ENTRY MAY ONLY BE SERVED TO A no-cors REQUEST, and
   `cache.match()` does not know that — it matches on URL and ignores
   request mode. That is a real bug with a loud symptom, and this is
   how it happened:

     - A cover photo on the Lists tab loads through a plain <img>, which
       is a `no-cors` request. R2 sends no CORS headers, so the response
       is OPAQUE, and it was cached here as opaque.
     - The map then wants the same photo for a pin. ensurePhotoIcon()
       sets crossOrigin='anonymous' — it has to, or the canvas is
       tainted and cannot be read back — which makes it a `cors`
       request.
     - This function handed it the cached OPAQUE response, and the
       browser rejected it: "an 'opaque' response was used for a request
       whose type is not no-cors", once per photo, plus a failed image.

   So an opaque hit is ignored for anything but a no-cors request, and
   an opaque response is only STORED for the request mode that can use
   it. The cost is one extra network request for the CORS case; the
   alternative is a response the browser refuses to hand over. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const opaqueMismatch = cached && cached.type === 'opaque' && request.mode !== 'no-cors';
  if (cached && !opaqueMismatch) return cached;
  /* ⚠️ fetch() REJECTS on a network or CORS failure, and this runs
     inside event.respondWith() — so an unhandled rejection here surfaced
     as `Uncaught (in promise) TypeError: Failed to fetch` with the
     service worker's own line number, which points investigation at the
     cache rather than at the host that refused. Answer with a network
     error instead: the <img> that asked gets its onerror and the map
     falls back to a plain dot, which is the degradation it already
     has. */
  /* ⚠️ A STALE OPAQUE ENTRY IS DELETED, NOT JUST SKIPPED. Left in place
     it is re-checked and re-skipped on every single load, and — worse —
     it keeps the URL looking cached while never being usable. */
  if (opaqueMismatch) cache.delete(request);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    else if (res && res.type === 'opaque' && request.mode === 'no-cors') cache.put(request, res.clone());
    return res;
  } catch (e) {
    /* ⚠️ RETRY ONCE PAST THE HTTP CACHE. A cross-origin response fetched
       before the host had a CORS policy is stored by the browser's own
       HTTP cache WITHOUT the Access-Control-Allow-Origin header, and it
       keeps being replayed from there — so adding the policy on the host
       appears to change nothing, for as long as that entry lives. The
       bucket sends long cache lifetimes (the keys are immutable), so
       "for as long" can be a very long time.
       `cache: 'reload'` forces a fresh trip, which is the only way the
       new header can be seen. One retry, on the failure path only, so a
       genuinely offline load still costs a single request. */
    try {
      const res = await fetch(new Request(request, { cache: 'reload' }));
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    } catch (e2) {
      return Response.error();
    }
  }
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch { return; }
  if (!/^https?:$/.test(url.protocol)) return;
  if (matchesHost(url, NEVER_CACHE_HOSTS)) return;

  /* Navigations: try the network so a redeploy lands, fall back to the
     cached shell when offline. */
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preload = await event.preloadResponse;
        if (preload) return preload;
        return await fetch(request);
      } catch {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match('./index.html')) ||
               (await cache.match('./')) ||
               Response.error();
      }
    })());
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
    return;
  }
  if (matchesHost(url, VENDOR_HOSTS)) {
    event.respondWith(cacheFirst(request, VENDOR_CACHE));
    return;
  }
  if (matchesHost(url, IMAGE_HOSTS)) {
    event.respondWith(cacheFirst(request, IMAGE_CACHE));
  }
});
