/* ==============================================================
   CONFIG — Supabase client + default cover images
   Loaded first. Everything else assumes `sb` already exists.
   ============================================================== */

/* The app's name, for anywhere it is spoken rather than laid out — the
   OS share sheet, a toast. The marks in index.html (title, manifest,
   the auth eyebrow, the nav title) are written out there.

   Note what is deliberately NOT renamed with it: the auth storageKey
   below, the IndexedDB name in offline.js, the sw.js cache prefix and
   the bl_* localStorage keys. Those are storage identities — changing
   one signs everyone out or orphans their cached data. */
const APP_NAME='Someday We’ll Die';

/* ---- The app's public web address ----

   Two jobs, and the first one is a bug fix rather than a feature.

   1. INVITE LINKS. inviteUrl() builds a link out of location.origin.
      In a browser that is the site. Inside the Capacitor WKWebView it
      is `capacitor://localhost` — so every invite shared from the iOS
      app was a link nobody else on earth could open, and it failed
      silently: the sheet copied happily, the recipient got a URL their
      phone did not recognise. A native app has no origin worth sharing,
      so it has to be told the canonical one.

   2. UNIVERSAL LINKS. This is the domain iOS matches an incoming link
      against, and the one that has to serve
      /.well-known/apple-app-site-association. See js/deeplink.js.

   ⚠️ SET THIS TO WHERE index.html ACTUALLY LIVES — scheme, host, and
   the subdirectory if there is one, with no trailing slash. It is a
   base, not strictly an origin: the two consumers both append
   `/index.html`, so a project site served from a subpath has to carry
   that subpath here or every link 404s. Left EMPTY the app behaves
   exactly as it did before: links are built from location.origin, and
   Universal Links are simply off.

   ⚠️ THE TWO JOBS ABOVE HAVE DIFFERENT REQUIREMENTS, and on a host
   like GitHub Pages only the first one is satisfiable. Job 1 needs
   this to be a URL a recipient can open — a subpath is fine. Job 2
   needs the DOMAIN ROOT to serve /.well-known/apple-app-site-association,
   which on a project site (`user.github.io/repo/`) belongs to the
   user's own root Pages site and not to this repo at all. Whenever the
   host here, the `applinks:` entry in ios/App/App/App.entitlements and
   the AASA file do not all name one domain that actually serves it,
   iOS silently declines to open the app and the link opens in Safari
   — which is a degradation and not a breakage: joining is a
   server-side membership row, so an invite accepted in Safari is
   already in effect in the app. See the Shared lists section of
   CLAUDE.md. */
const APP_WEB_ORIGIN='https://landonjames1.github.io/SomedayWellDie';

/* The origin to build a shareable link from: the configured one when
   there is one, and otherwise wherever the page is actually being
   served — which is right in a browser and is the pre-existing
   behaviour everywhere. */
function publicOrigin(){
  if(APP_WEB_ORIGIN) return APP_WEB_ORIGIN.replace(/\/+$/,'');
  /* capacitor://localhost is not somewhere anyone else can reach, so
     it is worse than nothing in a link. Nothing is what they get. */
  if(/^capacitor:|^ionic:|^file:/.test(location.protocol)) return '';
  return location.origin;
}

/* ---- Media storage ----
   Photos and video live in Cloudflare R2 rather than Supabase Storage,
   for one reason: R2 does not charge for egress. A photo in a shared
   list is viewed by everyone in it, on every device, forever, and on a
   metered bucket that is the single largest cost the app has.

   MEDIA_WORKER_URL is the Worker that authorizes uploads (see
   cloudflare/media-worker/worker.js). It holds the R2 credentials; the
   browser never does. Leave it EMPTY and uploads fall back to Supabase
   Storage exactly as before -- the same way every optional piece of
   this app degrades rather than breaking.

   MEDIA_PUBLIC_BASE is the bucket's public URL. Reads go straight
   there, not through the Worker: a read has nothing to authorize, and
   routing it through a Worker would spend a request to add nothing.
   It must also be listed in IMAGE_HOSTS in sw.js or photos stop being
   cached offline. */
const MEDIA_WORKER_URL='https://swd-media-worker.landon-talus.workers.dev';
const MEDIA_PUBLIC_BASE='https://pub-316c43a551774a47b23000d0b88a37f0.r2.dev';

/* ---- Map tiles ----
   MapTiler. The map used CARTO's open basemap, which needed no key --
   until CARTO started stamping "API KEY REQUIRED" across every
   unauthenticated tile, which is not something that can ship.

   This key is PUBLIC by design, exactly like HERE's would have been if
   it were not proxied: it is fetched by the browser on every tile, so
   there is nowhere to hide it. Restrict it in the MapTiler dashboard
   instead -- Account -> Keys -> allowed origins. The native app's
   origin is `capacitor://localhost`, so BOTH that and the web origin
   have to be listed or the map goes blank in one of the two.

   Left EMPTY it falls back to the watermarked CARTO tiles, so the map
   still works and looks wrong rather than disappearing -- the same way
   every other optional key in this file degrades. */
const MAPTILER_KEY='HMcPs7bBeXAoUvSrp2Xw';

const SUPABASE_URL='https://xxdmendegyxlkikejvps.supabase.co';
const SUPABASE_KEY='sb_publishable_45ETmiEMgvWn3QAd58ck5Q_opy0TWnX';

/* Auth options are spelled out rather than left to the defaults. Most of
   these *are* the defaults, but staying signed in is the thing users
   notice when it breaks, so it should be obvious here what the app is
   relying on rather than implied.

   storageKey is pinned so the stored session survives a supabase-js
   upgrade that might otherwise change the key and silently sign
   everyone out.

   detectSessionInUrl is OFF, which is the one setting here that is not
   the default. supabase-js reads the URL inside createClient() — before
   any of the app's own code has run — so a confirmation link would be
   consumed by a background promise nothing can await, racing the boot
   sequence in main.js and reporting its failures only to the console.
   consumeEmailConfirmation() in auth.js does it explicitly instead, in
   a known order and with somewhere to show the answer. Nothing else
   relies on it: this project has no OAuth providers, only email and
   password. See CONFIRMING AN EMAIL ADDRESS in js/auth.js. */
const sb=supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{
  auth:{
    persistSession:true,        /* keep the session in localStorage */
    autoRefreshToken:true,      /* renew the access token before it lapses */
    detectSessionInUrl:false,   /* auth.js handles the landing itself */
    storageKey:'bucketlist-auth',
    flowType:'pkce',
  },
});

/* ==============================================================
   WEB PUSH

   The public half of a VAPID key pair. It is a public key by design —
   it identifies the sender to the push service and is safe to ship.
   The private half lives only in the Edge Function's secrets.

   Generate a pair with:  npx web-push generate-vapid-keys
   Then paste the public key here and set the private one with:
     supabase secrets set VAPID_PRIVATE_KEY=...

   Left empty, everything still works except background push: reminders
   fall back to the Home banner and a notification on next open.
   ============================================================== */
const VAPID_PUBLIC_KEY='BGkQr3oXiXD5Cs1iyVT6YI5lagtApiNOkFXOk6KPXVnZrnOgWMt-ikNCa_XiHne4GWfjjcE73LlcqMPonu_RpkI';

/* ==============================================================
   PLACE SEARCH — HERE

   ⚠️ THERE IS NO KEY IN THIS FILE, AND ONE MUST NOT BE ADDED.

   The location field searches HERE, but the browser never talks to
   HERE. It talks to supabase/functions/geo, which holds the key as a
   function secret:

     supabase secrets set HERE_API_KEY=...
     supabase functions deploy geo

   A domain-restricted client key is the industry-normal answer to this
   and it was considered and rejected: an origin check is a header a
   determined caller sets themselves, so a key in this file is a
   working credential in every visitor's devtools, billable to your
   account. The proxy costs one extra hop and js/location.js is written
   around making that hop close to free — read THE geo FUNCTION there
   before changing any of it.

   Free tier is 250k requests/month, far past what this app will use.
   Get a key at https://platform.here.com.

   Without the function deployed, or without the secret set, place
   search falls back to Nominatim — what the app used before. You lose
   typo tolerance and near-me ranking, not the feature.

   ---- Why HERE rather than the OpenStreetMap geocoders ----

   The field has to answer two different questions, and the free OSM
   options each answer only one. Measured, same bias point:

     "Jamab Juice"   Nominatim: 0 results.   Photon: the nearby Jamba
                     locations, typo and all.
     "eiffel tower"  Photon: a mountain in Alberta.  Nominatim: Paris.

   Photon is a prefix/POI matcher with no sense of global prominence;
   Nominatim ranks prominence well and has no typo tolerance at all.
   Running both and merging was the keyless option. HERE returns the
   nearby Jamba Juices AND puts Paris first, in one request.
   ============================================================== */

/* Default cover images */
const COVERS=[
  'https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=1600&q=90',
  'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=1600&q=90',
  'https://images.unsplash.com/photo-1612278675615-7b093b07772d?w=1600&q=90',
  'https://images.unsplash.com/photo-1505832018823-50331d70d237?w=1600&q=90',
  'https://images.unsplash.com/photo-1498307833015-e7b400441eb8?w=1600&q=90',
  'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1600&q=90',
  'https://images.unsplash.com/photo-1519451241324-20b4ea2c4220?w=1600&q=90',
  'https://images.unsplash.com/photo-1461237439866-5a557710c921?w=1600&q=90',
  'https://images.unsplash.com/photo-1483729558449-99ef09a8c325?w=1600&q=90',
  'https://images.unsplash.com/photo-1528164344705-47542687000d?w=1600&q=90',
];
let usedCovers=[];
function randCover(existingCovers){
  /* Pick a cover not already used by the user's other collections.
     existingCovers = array of cover URLs already in use.
     Falls back to cycling through COVERS once all 9 are used. */
  const inUse=existingCovers||usedCovers;
  const available=COVERS.filter(c=>!inUse.includes(c));
  if(available.length) return available[Math.floor(Math.random()*available.length)];
  return COVERS[Math.floor(Math.random()*COVERS.length)];
}
