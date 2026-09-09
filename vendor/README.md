# vendor/

Third-party runtime code, served from this origin rather than from a CDN.

## supabase-js-2.116.0.js

The Supabase JS client, UMD build, pinned. Defines the global `supabase`,
which `js/config.js` reads to build `sb`.

It used to be `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2">`
— an unpinned major, fetched from a CDN on every cold launch. Three
things were wrong with that and vendoring closes all three:

1. **Supply chain.** Every visitor executed whatever the newest 2.x
   happened to be, with full access to the session token and to every
   row the app can read. A compromise of the package or of the CDN would
   have run here. Pinning plus `integrity` was the first fix; removing
   the third party from the request path entirely is the complete one.

2. **The native app fetched its own code over the network.** Capacitor
   bundles the assets — that is the whole point of `scripts/build-www.js`,
   whose header warns against `server.url` for exactly this reason
   (App Store Guideline 2.5.2, an app that updates itself outside the
   Store). A CDN `<script>` tag is the same argument by another route,
   and it also meant the shipped app could not boot at all without a
   connection: no service worker exists on `capacitor://`, so nothing
   cached that file.

3. **Privacy.** Same shape as the Google Fonts problem this repo also
   fixed — see the top of `css/fonts.css`. A request to a CDN is a
   request that hands an IP address to a third party the user never
   chose.

### Updating it

Manual, and deliberately so. Nothing bumps this on its own, security
fixes included, so check the changelog periodically.

    V=2.130.0   # whatever you are moving to
    curl -sfL "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@$V/dist/umd/supabase.js" \
      -o "vendor/supabase-js-$V.js"

Then: change the `<script src>` in `index.html`, change the path in
`SHELL_ASSETS` in `sw.js`, bump `CACHE_VERSION`, delete the old file,
and re-run `node scripts/build-www.js && npx cap sync ios`.

The filename carries the version on purpose. A generic `supabase.js`
would be cached by returning installs under a name whose contents had
silently changed, which is the one thing `CACHE_VERSION` exists to make
impossible.

### Not here

**MapLibre GL** is still fetched from unpkg, by `ensureMapLibre()` in
`js/map.js`, and that is a considered exception rather than an
oversight. It is ~900KB, it is loaded on demand rather than at boot, and
in the native app the Map tab is MapKit (`js/nativemap.js`) — so it is
reached only by the small per-collection map. Bundling it would add
900KB to the binary to remove a request most sessions never make. If the
2.5.2 argument above is ever tested, this is the other place to look.
