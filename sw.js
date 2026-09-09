/* ==============================================================
   SERVICE WORKER — offline app shell + runtime caching.

   This file is NOT one of the classic <script> tags in index.html;
   it runs in its own worker scope and shares nothing with the app.
   It is registered by js/pwa.js.

   Bump CACHE_VERSION whenever a shell file changes so returning
   installs pick the new build up instead of serving a stale one.
   ============================================================== */

const CACHE_VERSION = 'v189';
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
  './js/theme.js',
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
  './js/widget.js',
  './js/spotlight.js',
  './js/nativemedia.js',
  './js/appleauth.js',
  './js/applock.js',
  './js/nativemap.js',
  './js/shareinbox.js',
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
  './js/export.js',
  './js/map.js',
  './js/pwa.js',
  './js/main.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/favicon-16.png',
  /* ⚠️ THE TYPE IS PART OF THE SHELL NOW. Both families used to come
     from fonts.gstatic.com and were caught by VENDOR_HOSTS below; they
     are served from this origin since the Google Fonts <link> was
     removed for the GDPR reason set out at the top of css/fonts.css.
     Left out of this list they would simply not be available offline,
     and the app would fall back to the system serif — which reads as
     the type having failed to load, because it has. */
  './css/fonts.css',
  /* supabase-js, vendored rather than fetched from a CDN — see
     vendor/README.md. ⚠️ THE VERSION IS IN THE PATH, so moving to a new
     one means changing it HERE as well as in index.html. Missed, the
     app boots with no client at all and every screen is empty. */
  './vendor/supabase-js-2.116.0.js',
  './fonts/newsreader-var-latin.woff2',
  './fonts/newsreader-var-latin-ext.woff2',
  './fonts/newsreader-var-italic-latin.woff2',
  './fonts/newsreader-var-italic-latin-ext.woff2',
  './fonts/ibm-plex-mono-400-latin.woff2',
  './fonts/ibm-plex-mono-400-latin-ext.woff2',
  './fonts/ibm-plex-mono-500-latin.woff2',
  './fonts/ibm-plex-mono-500-latin-ext.woff2',
  './fonts/ibm-plex-mono-600-latin.woff2',
  './fonts/ibm-plex-mono-600-latin-ext.woff2',
];

/* Third-party code the app cannot run without: MapLibre GL and
   supabase-js.

   ⚠️ THE TWO GOOGLE FONTS HOSTS ARE GONE FROM HERE ON PURPOSE and must
   not come back. The faces are served from this origin and pre-cached
   in SHELL_ASSETS above; leaving fonts.googleapis.com / fonts.gstatic.com
   in this list would do nothing useful and would quietly re-permit the
   exact request the self-hosting was done to eliminate, if anything
   ever asked for one again. See the top of css/fonts.css. */
const VENDOR_HOSTS = [
  'unpkg.com',
  'cdn.jsdelivr.net',
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
    /* Same rule as cacheFirst(): a partial response is not cacheable and
       cache.put() throws on one. Hoisted declarations, so cacheable()
       and safePut() below are already in scope here. */
    if (cacheable(res)) safePut(cache, request, res.clone());
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
/* ⚠️ `res.ok` IS TRUE FOR A 206 AND cache.put() REFUSES ONE. The range
   bypass in the fetch handler means nothing here should ever see a
   partial response again — this is the belt to that brace, so a future
   caller that reaches cacheFirst() with a ranged request fails by not
   caching rather than by throwing. `status === 200` is the exact test
   the Cache API itself applies. */
function cacheable(res) {
  return !!(res && res.ok && res.status === 200);
}

/* cache.put() rejects for reasons that are not the caller's fault —
   a partial response, a quota that is full, a storage layer that has
   been evicted mid-write. None of them is a reason to fail the request
   that is already in hand, and un-awaited they surfaced as bare
   unhandled rejections with no useful stack. */
function safePut(cache, request, res) {
  cache.put(request, res).catch(err => {
    console.warn('[sw] cache.put failed:', request.url, err && err.message);
  });
}

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
    if (cacheable(res)) safePut(cache, request, res.clone());
    else if (res && res.type === 'opaque' && request.mode === 'no-cors') safePut(cache, request, res.clone());
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
      if (cacheable(res)) safePut(cache, request, res.clone());
      return res;
    } catch (e2) {
      return Response.error();
    }
  }
}

/* Anything the <video> element streams. Matched on the key's extension,
   which is the original file's -- mediaKey() in js/media.js builds
   `${uid}/${uuid}.${ext}` and uploadVideo() passes the real one through,
   so an .mp4 or .mov in the path is a reliable signal and needs no
   lookup. */
const VIDEO_EXT_RE = /\.(mp4|m4v|mov|webm|ogv|ogg|avi|mkv|3gp)(\?|$)/i;

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch { return; }
  if (!/^https?:$/.test(url.protocol)) return;
  if (matchesHost(url, NEVER_CACHE_HOSTS)) return;

  /* ==============================================================
     ⚠️ VIDEO IS NEVER INTERCEPTED, AND NEITHER IS ANY RANGE REQUEST.
     Both lines are load-bearing and neither is an optimisation.

     THIS IS WHY VIDEO PLAYED ON DESKTOP AND NOT ON THE PHONE.
     Every R2 URL matches IMAGE_HOSTS, so video was going through
     cacheFirst() like a photo, and two separate things went wrong:

     1. `cache.match(request)` IGNORES THE RANGE HEADER unless it is
        told not to. So once a video's full body was in the cache --
        which happens on the first plain GET, the one `preload="metadata"`
        makes -- every later `Range: bytes=…` request was answered with
        a 200 CARRYING THE WHOLE FILE instead of a 206 Partial Content.
        Desktop Chrome tolerates that and slices the body itself, which
        is exactly why the site looked fine there. iOS will not: its
        media stack requires a 206 for a request it ranged, and given a
        200 it stops. The video element simply never plays, with no
        error worth reading.

     2. On a cache MISS with a range header, fetch() returns a 206,
        `res.ok` is true for 206 (it is 200-299), and `cache.put()`
        THROWS on a partial response -- "Partial response (status code
        206) is unsupported". It is not awaited, so that surfaced as an
        unhandled rejection rather than as anything pointing here, and
        nothing was ever cached, so it repeated on every request.

     Returning without calling respondWith() hands the request back to
     the browser, which has a media stack built for exactly this and
     does conditional requests, seeking and byte ranges properly. The
     cost is that video is not available offline -- which it effectively
     never was (see above), and which matches the rest of the app:
     uploadVideo() already refuses to work offline, and a 5-20MB clip
     is the first thing evicted from a cache quota anyway.
     ============================================================== */
  if (request.headers.has('range')) return;
  if (VIDEO_EXT_RE.test(url.pathname)) return;
  /* request.destination is the cleanest signal of the three but is the
     least reliable across the WebKit versions this has to run on, so it
     is the backstop rather than the test. */
  if (request.destination === 'video' || request.destination === 'audio') return;

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
