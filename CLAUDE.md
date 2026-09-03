# Someday We'll Die — Codebase Guide

**The app is called "Someday We'll Die".** The name lives in `APP_NAME`
(`config.js`) for anywhere it is spoken, and is written out in `index.html`
(title, `apple-mobile-web-app-title`, the auth eyebrow) and
`manifest.webmanifest`. `nav.js` sets it as Home's bar title and `home.js` as
the large greeting.

**Storage identities are deliberately NOT named after it** and must not be
renamed to match: the auth `storageKey` (`bucketlist-auth`), the IndexedDB name
(`bucketlist`), the `sw.js` cache prefix, and the `bl_*` localStorage keys.
Changing any of them signs every existing user out or orphans their cached data.
The repo folder and CSS class names are likewise unchanged.

A single-page web app for curating and tracking bucket-list collections: nested
collections of activities, completion with photos/notes, a location map, and
bulk entry. Vanilla JS + HTML + CSS on the front end; **Supabase** (Postgres +
Auth) on the back end. No build step, no framework, no bundler.

It is also an **installable PWA** — see the PWA section below — and the layout
is mobile-first from 320px up.

## 📌 KEEP THIS FILE CURRENT (do this every time)

**Whenever you add/remove/rename/move a file, feature, page, or notable
function, update this `CLAUDE.md` in the same change** so the file map, function
list, and script-load order below stay accurate. Treat updating this guide as
part of the task, not an optional extra. Specifically:

- New `js/*.js` file → add it to **File structure**, the **JS file map** table,
  add its `<script src>` tag to `index.html` in the correct order, **and add it
  to `SHELL_ASSETS` in `sw.js`** (otherwise it will not be available offline).
- New `css/*.css` file → add it to the **CSS file map**, `<link>` it in
  `index.html` *before* `responsive.css`, **and add it to `SHELL_ASSETS`**.
- New/removed/renamed function → update the affected row in the JS file map.
- New page → note it under `nav.js` and in the **Adding a page** checklist.
- New Supabase table/column/policy → update the **Back end** section.
- Any change to a shell file → **bump `CACHE_VERSION` in `sw.js`** so returning
  installs fetch the new build instead of serving the cached one.

After structural edits, regenerate the function inventory with:

```bash
for f in js/*.js; do echo "=== $f"; grep -oE '^(async function|function|let|const) [A-Za-z0-9_$]+' "$f"; done
```

## ⛔ TWO RULES THAT ARE NOT NEGOTIABLE

**1. STOP WRITING HELP TEXT.** No explanatory subtext under labels, no
"this is what this field is for" captions, no empty-state paragraphs
teaching a feature, no reassuring sentence under a heading. The app
should be legible from its controls and its content. If a control needs
a paragraph to be understood, the control is wrong — fix the control.
A label, a placeholder, and nothing else. When in doubt, delete it.
Explanations belong in *this file*, where the next person editing the
code reads them, not on the user's screen.

**2. NOTHING ON SCREEN MAY MOVE WHEN THE KEYBOARD OPENS.**
Focusing any field anywhere must leave `.tabbar` exactly where it was,
**and must leave an open sheet exactly where it was.** Two different
mechanisms lift things, one in the web layer and one below it, and the
second is the one that actually mattered:

- **The tab bar, in the web layer.** iOS anchors fixed elements to the
  *visual* viewport, which the keyboard shrinks from the bottom, so
  `.tabbar` climbs and parks on top of the keyboard.
  `syncTabbarToKeyboard()` in `nav.js` undoes it by **measuring** the
  bar's real offset from the layout viewport's bottom and translating
  back by that amount — no platform sniffing, no assumption about the
  keyboard's height. Do not add a guard in front of it and do not remove
  the `visualViewport` listeners.
- **Sheets, in the NATIVE layer, and no amount of CSS can fix it.**
  Inside the Capacitor WKWebView the page sits in a native scroll view,
  and when the keyboard opens iOS scrolls *that* to keep the caret
  visible. It drags everything, `position: fixed` included, so an open
  sheet lifted off the bottom of the screen — the strip that appeared
  underneath was the translucent scrim, which is why the sheet looked
  see-through along the bottom and why the page behind it could still be
  scrolled. **`@capacitor/keyboard` is what stops it**, and all three of
  its parts are load-bearing:
  - `plugins.Keyboard.resize: "none"` in `capacitor.config.json` — the
    web view's frame is never resized, and the plugin zeroes the scroll
    view's keyboard content inset on every keyboard event.
  - `setScroll({isDisabled:true})`, which installs a delegate that forces
    the scroll view's `contentOffset` back to zero. This is the piece
    that actually pins the page.
  - It is called from **`nativeScrollLock()`, inside
    `setBodyScrollLock()`** in `nav.js`, not at boot — it disables the
    app's own page scrolling too, which is wanted while a sheet is open
    and not wanted otherwise. Sheet bodies are ordinary in-page
    overflow scrollers and are unaffected.

**Three web-layer fixes were tried first and none of them worked**, so
do not reach for CSS or `visualViewport` maths if this ever regresses —
check the plugin, its config, and that `setScroll` is still being
called. Two hardenings from those attempts were kept because they are
free and correct on their own terms, but neither is the fix: the
`.modal-overlay` height is stated outright (`height: 100dvh`,
`bottom: auto`) instead of `inset: 0` so its box cannot resolve against
a viewport that moves, and `.modal .sheet-body:focus-within::after`
gives every sheet somewhere to scroll while a field in it is focused.
Read their comments in `modals.css` before touching either.

Neither correction is applied to the conversation composer, which is not
an overlay and is *meant* to ride up with the keyboard.

## ⚠️ Critical constraints — read before editing JS

This app was refactored out of one 2,804-line `index.html`, but it is **NOT
modular**. Every `js/*.js` file loads as an ordinary (classic) `<script>` tag at
the end of `<body>`. They all share **one single global scope**. Hard rules:

1. **No `import`/`export`, no `type="module"`.** Modules would scope every
   function away and break all ~100 inline `onclick="..."` handlers in
   `index.html`. This is the single reason for the classic-script design.
2. **Functions are global by design.** The markup calls them inline
   (`onclick="nav('collections')"`, `onclick="openNewList()"`). Do not wrap a
   file in an IIFE, and do not change a top-level `function`/`let`/`const` to
   something scoped.
3. **Load order matters.** `config.js` creates the `sb` Supabase client that
   everything else assumes exists; `state.js` declares the shared mutable
   globals; `main.js` runs the boot sequence and **must stay last**. The full
   order is in the comment block above the `<script>` tags in `index.html`.
4. **Top-level `let`/`const` are shared, but subject to TDZ.** Two files
   declaring the same top-level name is a runtime `SyntaxError`, not a silent
   shadow. Cross-file reads are fine *inside functions* (they run after all
   scripts load) but a file must not read another file's `let` at top level
   unless that file loads first.
5. **A function may live in a different file than where it's called.** If you
   can't find something, grep everything: `grep -rn "functionName" js/`
6. **`responsive.css` must stay last** in the `<link>` list so its media
   queries win.
7. **`sw.js` is the one exception to rules 1–4.** It is a service worker, not a
   classic script: it runs in its own worker scope, shares nothing with the
   app's globals, and must stay at the project root (a worker's scope is capped
   by its own path, so moving it into `js/` would stop it controlling `/`). It
   is registered by `js/pwa.js`; it is *not* in the `<script>` manifest.

Verify a change didn't break the shared-scope model — this concatenation models
exactly what the browser does, so it catches duplicate top-level declarations:

```bash
grep -o 'js/[a-z]*\.js' index.html | while read -r f; do cat "$f"; echo; done > /tmp/all.js && node --check /tmp/all.js
```

⚠️ That grep is a text match over the whole file, not a parse of the
`<script>` tags — so writing `js/foo.js` inside an HTML **comment**
concatenates `foo.js` twice and reports every one of its top-level
declarations as a duplicate. Refer to files as `foo.js` in comments in
`index.html`, or the check cries wolf.

The untouched pre-refactor original is in `_backup/index.original.html`. The
split was verified by diffing every CSS declaration and JS statement against it;
no logic was changed.

## File structure

```
index.html            Markup only — page sections, modals, and the ordered <link>/<script> manifest
CLAUDE.md             This guide
README.md             Human-facing setup + structure overview
manifest.webmanifest  PWA metadata (name, icons, standalone display, theme color)
sw.js                 Service worker — offline app shell + runtime caching. Must stay at the root.
legal/                privacy.html + terms.html, the two documents App Store Connect asks for
                      at a public URL. Deliberately standalone pages with their own _style.css:
                      a privacy policy must load without an account, and linking them into the
                      app shell would mean booting Supabase to read a document.
.well-known/          apple-app-site-association — what iOS fetches to decide whether a link
                      to the site should open the app. Served by the WEB HOST, deliberately not
                      bundled into www/. See **Universal Links** and .well-known/README.md.
supabase/             Backend — schema.sql (reminders + reminder_deliveries), native-push.sql (an APNs
                      device token beside the Web Push rows — see **Push is APNs here, not Web Push**), profiles.sql (the Users row, its RLS and the sign-up trigger), sharing.sql (shared lists), messages.sql (a conversation per shared list, plus the append-only activity_notes log), single-list.sql (drops the retired extra_collection_ids column), target-rollover.sql (one-time: resolves stored target bands to real dates — see **A band is resolved on the way in**), target-band-2-4.sql (one-time: moves rows filed under the old 2-3 year band to the 2-4 window), home.sql (the saved Home address), difficulty.sql (the inferred easy/medium/hard rating), difficulty-override.sql (the flag saying a person overruled it — see **Correcting a rating**), difficulty-profile.sql (the paragraph that rating is judged against — see **Rating for one person, not an average one**), avatars.sql (the profile photo, plus the one RPC that lets other people see it), moderation.sql (reporting, blocking and the agreement record — the one migration that is NOT optional for shipping; see **Reporting and blocking**), storage.sql (the media bucket), cron.sql, functions/_shared/apns.ts (APNs delivery, shared by the two push functions — no imports, the JWT is signed with Web Crypto), and five Edge Functions: send-reminders, send-message-push (an immediate Web Push when a message is sent — see **Notifying a conversation**), unfurl (location prediction *and* the difficulty rating — it used to import shared links and screenshots; see **Importing is gone**), geo (place search, holding the HERE key so the browser never does) and delete-account (erasing an account needs the service_role key, so it cannot live in the client). All optional except profiles.sql; each other piece probes for itself and the UI that needs it hides when it is absent.
css/                  One stylesheet per concern (see CSS file map)
tools/                difficulty-rate.py — asks Claude to rate every un-rated activity and writes the
                      CSV the next one consumes (see **Rating the library you already have**);
                      difficulty-backfill.py — turns a CSV of ratings into one UPDATE (see backlog);
                      media-backfill.py — the one-off that moved every photo to R2 (see **Media**)
cloudflare/           media-worker/worker.js — the Worker that authorizes uploads to R2 and serves
                      downloads. Pasted into the Cloudflare dashboard by hand; there is no deploy step
                      in this repo. See **Media**.
js/                   One script per concern (see JS file map). router.js is the newest —
                      a hash route per screen; see **A URL for every screen**.
icons/                App icon PNGs + generate.py, the script that draws them
Supabase Setup/       CSV exports of the Collections / Activities / Users tables (schema reference; STALE, see Back end)
.github/workflows/    reminders.yml — the daily sweep that fires send-reminders. Replaces
                      supabase/cron.sql; run one or the other, never both.
_backup/              The original single-file version, kept as a safety net
optional-lab.html     The bench for ONE decision: how the new-activity sheet says which
                      of its fields block the save. Six frames — the current sheet plus
                      five options — across three fill states, driven by a single
                      control so they are compared on behaviour rather than on one
                      frozen picture. Option J is what shipped; see **Saying what is
                      still required**. It KEEPS the four rejected alternatives and the
                      reason each died, which is most of its value now. Like
                      theme-lab.html it LINKS the app's own stylesheets (theme.css
                      included) rather than copying tokens, so it cannot drift; every
                      class it invents is `lab-`-prefixed, and the audit for that is one
                      grep against css/*.css — `.ok` collided on the first pass.
                      ⚠️ `?audit=1` MEASURES rather than eyeballs: it walks every frame
                      for horizontal overflow and content outside the frame, then DIFFS
                      each against the baseline, because the app's own plate
                      deliberately bleeds 8px and an absolute report flags six frames
                      for something none of them did. It caught three real defects that
                      looked fine at a glance. Dev tool only: not linked from
                      index.html, not in sw.js, outside build-www.js's allowlist.
                      ?state=empty|partial|full picks a step; #j scrolls to a variant.
color-lab.html        A bench for the four activity colours (done / high / medium / low),
                      rendering the real rails, capsules, cards and pins on both grounds at
                      once. Dev tool only: not linked from index.html, not in sw.js. Open it
                      directly; #ember / #signal / #ladder / #current pick a scheme.
modal-lab.html        The same kind of bench for the completion sheet's layout, showing the
                      variants side by side at 390px. It COPIES the tokens rather than
                      linking base.css, so it drifts — read it as a sketch of a decision
                      already made, never as the current sheet. Dev tool only: not linked
                      from index.html, not in sw.js.
theme-lab.html        The palette bench, and the one to reach for when dark mode looks wrong.
                      THIRTY-ONE frames — every screen in the Screens table (Home, Up Next,
                      Accomplished, Lists, a collection, Messages, a conversation, Map, You,
                      Settings), the signed-out screen, EVERY overlay in index.html (both states
                      of the activity sheet and its notes sub-page, the new-activity and
                      completion sheets, the action sheet, lightbox, alert, calendar, toast, new
                      list, list picker, duplicate, place, share, join, report, blocked, and the
                      plain-field sheets), and a swatch board of every variant none of them
                      happens to show — all rendered from the app's OWN css/*.css, with a control
                      for every colour they draw. A Screens/Sheets/All button filters the stage;
                      it hides frames only, never controls, which stay live and exported.
                      ⚠️ IT SEEDS FROM css/theme.css, NOT from base.css's defaults, so a session
                      opens on the palette already on disk and RESET means "back to that file"
                      rather than "throw away everything you have ever tuned". It PARSES the file
                      rather than reading computed styles, and that is the point of the code:
                      getComputedStyle() and the CSSOM both answer in resolved values, so
                      `color-mix(in srgb, var(--fc) 10%, …)` comes back flattened and a hex comes
                      back as rgb() — the authored form, which is what has to be written back out,
                      is gone. The parse is the exact inverse of cssFor() because both read one
                      table of (selector, property) pairs; reconstructing keys from the file
                      instead would break on a :root raw like --ring, which is written inside the
                      :root block but keyed ':root | --ring'. A value in the file for a control
                      that no longer exists is ignored, and a control the file does not mention
                      keeps its base.css seed — which is how a file written before new controls
                      were added still seeds cleanly. No file, a 404, a file:// origin, or a file
                      holding only its header all fall through to the built-in seeds, and the line
                      under the buttons says which happened. Two invariants
                      are worth re-checking after any edit, and both are one loop in the console:
                      every control's `targets` must match something on the stage, and every rule
                      override must too — a rule matching nothing is dead CSS being exported.
                      ⚠️ THE MAP FRAME IS CHROME ONLY. The globe is MapLibre on a WebGL context
                      and the basemap is CARTO's raster tiles; neither is a colour this file can
                      set, and loading a ~900KB library per frame would cost the bench its
                      responsiveness. The floating filter, count and buttons are real.
                      ⚠️ IT LINKS EVERY STYLESHEET THE APP DOES except pwa.css (install and
                      offline chrome, which no frame shows) and responsive.css. A file left out
                      does not announce itself — the frames using it simply render unstyled, and
                      that is exactly how the invite and duplicate sheets first appeared flush
                      against the glass, with dupes.css and sharing.css missing from the list.
                      ⚠️ IT DOES NOT LINK responsive.css, whose media queries key off the
                      VIEWPORT — on a 1000px-wide bench they would apply tablet layout to 390px
                      frames. But that file is the only definition of `--content-max`, which
                      messages.css uses inside a `@media (min-width:700px)` block that DOES fire
                      here; an unresolvable var() is invalid at computed-value time and falls back
                      to the property's INITIAL value rather than to the shorthand above it, so
                      .conv-scroll's gutters computed to 0 and the conversation sat flush against
                      the glass. `.phone` declares the token to close that. TWO KINDS: a TOKEN (a base.css custom property)
                      and a RULE (an explicit `selector { property: value }`). Rules exist for
                      the places the app hardcodes a colour or reads one from a token shared with
                      something unrelated. ⚠️ A RULE ALWAYS BEATS ITS TOKEN, being a later equally
                      specific declaration, so a rule is only ever written where the app gives no
                      independent control — never as a duplicate of a token that already works,
                      or editing that token would look broken. Every chip and card has its fill
                      and its text on separate rows. Both difficulty scales are split per tier:
                      the four sheet CHIPS get a fill and a text row each (the app shares one
                      declaration across all four) and the three LIST BUTTONS on the Lists tab get
                      a fill, a name and a count each (the app hue-codes only the name). Both are
                      seeded at the app's shared values, so nothing moves until you move it.
                      Any row can be LOCKED, which exempts it from Reset and from an applied
                      answer — the two things that write in bulk — while leaving your own edits of
                      it live. Locks are global rather than per mode, though Reset is per mode: a
                      lock is a statement about the control, not about one of its two values, and
                      a per-mode set would silently change which rows read as locked every time
                      you flipped between light and dark. Locking a row unticks it and disables
                      its tick, because "ask Claude to choose this" and "never overwrite this" are
                      contradictory and the contradiction is better made impossible than resolved
                      later. The lock is the one row control that is visible without hovering, and
                      it takes the row's RIGHT edge — the left already carries three transient
                      states (hover, click-pin, AI-picked) and a lock has to compose with all of
                      them. Light and dark hold
                      fully separate values and Copy CSS emits the dark half inside a
                      @media (prefers-color-scheme: dark) block — which is how the Orchard hues
                      and every hardcoded white on a photo can be given a dark variant they do
                      not have today. Hovering a row outlines what it affects and hovering the
                      screen highlights its rows, but ⚠️ HOVER NEVER SCROLLS THE LIST — it did,
                      and that made the panel unusable: you would hover something, see its row,
                      and then cross half a dozen other demo elements on the way to it, each
                      scrolling the list somewhere else. CLICKING is what moves it, pinning both
                      ends in amber, clearing the filter first (or the jump lands on nothing) and
                      landing on the NARROWEST match — a rule before a token, since clicking
                      "How it went" also matches --bg-elevated and --label, which sit at the top
                      of the list and made the jump look like it had done nothing. Instant rather
                      than smooth: the list is ~13,000px tall. The reverse walk STOPS at the
                      first match rather than collecting the ancestor chain, or every hover
                      inside a sheet also reported .modal and .modal-overlay. Each row takes a typed value and a typed alpha as well as
                      the swatch and slider, and carries copy/paste against one held colour.
                      "Ask Claude for colours" ticks any set of rows, takes a paragraph about
                      what you like, and either copies a prompt (needs nothing set up) or calls
                      the API with a key you supply, loading the Anthropic SDK from a CDN on
                      first use; the answer is flat JSON keyed by control, an unknown key is
                      ignored rather than written somewhere wrong, and Undo restores the
                      snapshot. ⚠️ A TYPED VALUE THE BROWSER CANNOT PARSE IS KEPT BUT MARKED —
                      the value box goes red and Copy CSS reports the count. It is kept because
                      you may be mid-type, and marked because a dropped declaration leaves that
                      one element at its old colour while everything around it changes, which
                      reads as the paste not having worked. That shipped once: `9e1a60`, typed
                      without its `#`, silently left the Where card's chevron behind. The check is
                      `CSS.supports()` rather than a regex, so it knows about var(), color-mix()
                      and every gradient syntax for free; a token row is tested against `color`
                      since a custom property accepts anything, and the four `:root` raws
                      (--ring, --shadow-*) cannot be checked at all. ⚠️ AND COPY CSS SURVIVES A
                      NON-SECURE CONTEXT: `navigator.clipboard` is undefined on file:// and over
                      a LAN IP, and READING it throws before `.then()` can catch anything — the
                      same trap that gates `crypto.randomUUID`. It is wrapped in try/catch with a
                      select-and-⌘C textarea behind it. ⚠️ IT LINKS THE APP'S REAL STYLESHEETS, so every class it invents
                      must be one the app does not use — a collision is silent and reads as the
                      lab's own CSS being ignored. `.chip` (modals.css) and `.empty`
                      (components.css) both bit; the audit is one grep of class names over
                      css/*.css against the lab's <style> block. Unlike modal-lab.html it links
                      rather than copies, so only the seed values can drift: change a value in
                      base.css and change its seed in the control table here. Dev tool only: not
                      linked from index.html, not in sw.js, and outside build-www.js's allowlist.
                      #light opens on the light palette.
```

There is no build step. Serve statically: `python3 -m http.server 8000`.

**Serving over plain http on a LAN IP is not a secure context**, and more than
the service worker depends on that. Testing on a phone against
`http://192.168.x.x:8000` disables:

- **service worker registration** — no offline shell, no install prompt.
  Registration failure is caught and logged; the rest of the app works.
- **`crypto.randomUUID`** — which the app needs for every row id. Always go
  through `uuidv4()` in `utils.js`, never `crypto.randomUUID()` directly. See
  the warning under **Working offline**; this shipped broken once and presented
  as `invalid input syntax for type uuid` on a phone while being perfectly fine
  on localhost.

`crypto.getRandomValues` is *not* gated and stays available. The same applies to
a `file://` URL. If you need the real thing on a device, tunnel localhost
(`ssh -R`, ngrok, Tailscale) rather than serving the LAN address directly.

### Screens and navigation

The app is modelled on a UIKit tab controller: **four root destinations in a
bottom tab bar**, plus three screens that push on top of a tab. All are
`<div class="page">` siblings shown one at a time by `nav()` toggling `.active`.
Every screen has a URL — a hash route, written by `nav()` and read back
by `js/router.js`. See **A URL for every screen**.

| Page id | Route key | Tab | Rendered by |
| --- | --- | --- | --- |
| `page-home` | `home` | Home | `renderHome()` — the dashboard |
| `page-upnext` | `upnext` | (pushed on Home) | `renderUpNext()` — every unfinished activity |
| `page-done` | `done` | (pushed on Home) | `renderDone()` — everything ever completed |
| `page-lists` | `lists` | Lists | `renderCollections()` — every collection as a photo card |
| `page-detail` | `detail` | (pushed on Lists) | `renderDetail()` — one collection's activities, or one of the three derived difficulty lists |
| `page-messages` | `messages` | Chat | `renderMessages()` — a row per shared list's conversation |
| `page-conversation` | `conversation` | (pushed on Messages) | `renderConversation()` — one shared list's messages |
| `page-globalmap` | `globalmap` | Map | `renderGlobalMap()` — every located activity |
| `page-me` | `me` | You | `renderMe()` — profile and account actions |

Tab labels are short ("Lists", "You", "Chat") while every identifier in the
code uses the domain word (`collections`, `me`, `messages`). Both name the
same thing.

**The Messages tab is the fifth and last.** Five is the practical ceiling on a
phone, and this one is hidden entirely until `supabase/messages.sql` has been
run — see **Messages**.

`nav(page, listId)` is the single entry point for changing screens. It:

- picks the entry animation — a rise/fade between tabs, a right-to-left push
  into `detail` (`PAGE_TAB` maps each screen back to the tab that owns it, so
  the right tab stays lit while a pushed screen is showing);
- **tears down the collection map** when leaving `detail`. The Map tab's
  globe is deliberately *kept* — see **The immersive map**;
- rebuilds the navigation bar via `updateNavbar()`, which is where each
  screen's bar buttons are defined.

`selectTab(tab)` handles tab-bar taps and pops back to a tab's root if you tap
the tab you are already inside. `goBack()` returns from `detail` to the tab it
was pushed from (`backTab`).

There is also a screen outside this system: the signed-out `#authPage`, which
`showAuth()`/`showApp()` swap against `#appWrap`. It is not a `.page` and
`nav()` knows nothing about it.

#### A URL for every screen

`js/router.js`. Every screen has a hash route; `nav()` writes it and the
router reads it back. Reloading returns to where you were, a collection
can be linked to, and the browser's own Back — the button, and the back
*gesture* every phone user reaches for first — walks the trail.

| Route | Screen |
| --- | --- |
| `#home` `#upnext` `#done` | Home and the two screens pushed on it |
| `#lists` `#list/<id>` | Lists, and one collection |
| `#messages` `#chat/<id>` | The hub, and one conversation |
| `#map` `#you` | Map, You |
| `#activity/<id>` | One activity's sheet, over its own collection |

**The route key is not the page id.** `#you` and `#chat` are what the tab
bar calls those screens while the code keeps the domain word (`me`,
`conversation`) — the same split the Screens table above describes. A URL
is read by a person.

**Why the hash and not a path.** The app is served statically from
whatever directory it sits in, with no rewrite rule in front of it, so
`/list/<id>` as a real path would 404 on exactly the two occasions a route
earns its keep: a cold load and a refresh. A hash needs nothing from the
server, works from a subdirectory and from the PWA's `start_url`, and —
because it never reaches the server — a deep link **works offline**, since
`sw.js` serves the cached `index.html` for the navigation and the router
does the rest.

It is also orthogonal to the three things already read off the query
string at boot (`?token_hash=`, `?conv=`, `?join=`). A path router would
have had to be threaded through all three.

Things to keep:

- **`routeSync()` writes `location.pathname + location.search + hash`,
  never a rebuilt URL.** The query string is where a confirmation token or
  an invite lives while `main.js` is still consuming it.
- **And the three boot readers now preserve the hash**, for the mirror
  reason. `readPendingJoin()` blanks the search string wholesale and was
  rewriting to `location.pathname` alone, which silently ate the route;
  `readEmailConfirmation()` had the same gap. `readPushLanding()` already
  got this right. **The general rule is that a boot reader owns its own
  keys and nothing else** — the hash included.
- **The session's first write replaces, later writes push.** Booting into
  Home must not leave an entry behind it that Back can return to, because
  there is nothing there.
- **An open sheet eats the back gesture.** `onRouteChange()` dismisses the
  overlay and pushes the current route straight back, so the screen stays
  put and a second Back navigates for real. Navigating out from under an
  open sheet is the same stranded-overlay bug `selectTab()` calls
  `dismissOverlays()` to avoid.
- **`goBack()` still calls `nav()` rather than `history.back()`.** They
  agree whenever the pushed screen was reached from inside the app, and
  differ on a deep link — where `history.back()` would leave the app
  entirely. The chevron must never do that. The cost is a slightly longer
  history trail, which is the right side to err on.
- **A route is honoured once per page life.** `routeEntry()` is consumed
  on its first call, so signing out and back in on the same page starts at
  Home rather than reopening the previous account's collection. A deep
  link opened while signed *out* survives the sign-in screen and lands
  where it pointed, which is the case worth having.
- **A dead id costs nothing.** `renderDetail()` and `renderConversation()`
  already bounce to their tab when the collection is gone or was never
  this account's, and that bounce overwrites the URL on its way.
- **Explicit sign-out calls `routeClear()`; a lapsed session deliberately
  does not.** The same person signing back in should land where they were;
  a shared device should not leave the previous account's collection in
  the address bar.
- `_routeApplying` is what stops `nav()` pushing an entry for a
  navigation the history just handed us. Anything new that navigates from
  inside the router has to set it.

#### A URL for one activity

`#activity/<id>`, written by `openActDetail()` and released by
`afterSheetClosed()`. The thing people want to send someone is *one
activity* — "look at this one" — and until this the closest a link could
get was the list it happened to be filed in.

**It is deliberately not `#list/<listId>/<actId>`.** An activity is
opened from Home's Up Next, from Accomplished, from the map's place
sheet and from the composer's search results as readily as from its own
collection, and none of those screens is a list — so a route that had to
name one would be wrong or unavailable on four of the five ways in. The
id is enough: `routeOpenActivity()` reads the activity's own
`collection_id` back and lands the screen behind the sheet on the right
list.

Things to keep:

- **It replaces, it does not push.** Opening a sheet is not a
  navigation, and every sheet in the app is already dismissed by Back
  through the `overlayOpen()` branch of `onRouteChange()`. Pushing an
  entry here would make closing the sheet take two presses. The URL is
  shareable; the history is untouched.
- **`routeSheetClear()` is a no-op unless the hash actually names a
  sheet**, and that is what lets `dismissOverlays()` call it safely. On
  the Back-with-a-sheet-open path the hash has already moved on, and
  writing the screen route there *as well as* in the branch below would
  leave two entries deep for one press.
- **Every dismissal already funnels through `afterSheetClosed()`**, so
  that is where the URL is handed back — not on the close button. Same
  argument that put the sheet-return registry there: Save, Cancel, the
  scrim, Escape and a swipe down have to agree.
- **`routeOpenActivity()` arms `_routeStarted` by hand.** It navigates
  with the router suspended, so `routeSync()` never gets to set it — and
  without it `routeSheetClear()` would decline to act and strand
  `#activity/<id>` in the address bar for the rest of the session.
- **`showApp()` awaits it, alone among its navigations.** It has to read
  the activity back before it knows which list to land on. Warm, that
  resolves out of the cache; cold — somebody following a shared link on
  a new device — it is one round trip, and holding the splash for it
  beats dropping to a blank app and correcting it.
- **A dead id costs nothing**, like a dead collection id: `fetchActivity()`
  answers null, the screen falls back to Lists, and the URL is rewritten
  on the way rather than left claiming something is there.

#### Home is derived, never authoritative

`renderHome()` owns no state. Every section is computed from
`fetchCollections()` + `fetchAllActivities()`:

- the progress ring, from the completed/total split;
- **Up Next**, the four most pressing unfinished activities, with a "See all"
  that pushes `page-upnext` (`js/upnext.js`) — the same rows grouped into
  urgency bands. Both share `upNextRowHTML()` and `sortUpNext()` from
  `home.js`, so the two screens cannot disagree about what "next" means. Its rows are
  deliberately fixed-height: the name is one ellipsised line and the meta line
  is `flex-wrap: nowrap` with the collection name as the only shrinkable
  child. Both matter — letting either wrap made row height depend on how long
  a name happened to be, so the deadline sat inline on some rows and on its
  own line on others and the list visibly re-flowed as you read down it. Below
  375px the collection name is hidden outright rather than truncated to a
  meaningless stub. Ranked by
  `targetRank()` then `priorityRank()` (both in `utils.js`). Deadline comes
  first and priority second, not the reverse: something due this month
  outranks a high-priority "someday", because the deadline is the part you
  cannot move. Sorting is on `daysToTarget()` — **actual days**, not the
  urgency band: the band is what colours the badge but is too coarse to order
  by, since a flight tomorrow and something three weeks out are both `urgent`
  and priority would otherwise push the flight below it. The grouping on the
  Up Next screen still uses the band, so a row's group always matches the
  colour of its label;
- Recently accomplished, by `completedDate` descending, **capped at six** —
  two rows of three.

Both shelves' "See all" links are shown whenever their section has anything in
it, **not** only once there is more than the shelf displays. Gating them on a
threshold was tried and reverted: it made the Up Next and Accomplished screens
undiscoverable for anyone with a short history, which is exactly the person
still learning where things are.

Home has no floating action button: the composer near the top is already the
add affordance, and two competing ones on a single screen is one too many.

##### One field, both questions

People arrive at Home with one of two things in mind — *put this somewhere*
and *where did I put that* — and the composer only ever answered the first.
Typing "kayak" into it was a way to create a second kayaking activity beside
the one already there. So as you type it also matches what you already have,
in a dropdown under the field (`updateHomeSuggest()` in `home.js`).

**It never blocks the add, and that is the whole contract.** It only draws a
list; Return still opens the plan-or-record chooser, the go arrow still adds,
a URL still routes to the import sheet, and a query matching nothing shows
nothing. Everything the composer did, it still does.

- **Synchronous, against the in-memory cache** — `cachedActivities()` /
  `cachedCollections()`, the same read `dupeGuard()` does. Scoring every
  activity on a keystroke is cheap; a round trip per keystroke is not, and a
  spinner under a field you are typing into would be worse than no feature at
  all. A cold cache means nothing to search and the dropdown stays shut, the
  same way duplicate detection silently does nothing.
- **`searchActivities()` and `searchMark()` live here now.** They were the
  matching core of the Search screen; when that screen went, they moved into
  `home.js` rather than being rewritten, so the tuned constants and the
  highlight rule came across intact. See **Finding things again**.
- **It replaced the Search screen outright** (see **Finding things again**).
  Five rows, activities only, no collections and no filters — which is the
  deliberate trade: the answer arrives where you already are, and the long
  tail is gone. The header row (*Already on your lists*) exists so a list of
  things that already exist, under a field labelled "Add…", cannot be misread
  as autocomplete of what is being typed.
- **Taking a row clears the field**, because the text was a question that has
  now been answered — left in place, the next tap on the go arrow would file
  a duplicate of the thing just opened.
- `renderHome()` closes it, since the composer is static markup and the
  dropdown would otherwise survive navigating away and back. It
also has no lists shelf — that duplicated the Lists tab sitting in the tab bar.

Because Home has no collection context, adding from here goes through the
new activity sheet rather than inserting directly — see **The two-speed
activity flow**. Its one remaining private copy is `toggleCompleteFrom()`,
which reads the activity's own `listId` before updating that collection's
stats rather than assuming `curListId`. Keep it in step with
`toggleComplete()` in `activities.js`.

#### The cache

Two queries back the whole app — every collection, and every activity in
them — and both are held in memory for the session by `js/api.js`, and
on disk in IndexedDB by `js/offline.js`. Switching tabs re-renders from
that cache. It is why moving between screens no longer feels like a page
load, and it is what every other feature below reads from: duplicate
detection, search, and offline all run against it rather than the
network.

Five rules, and the first one is the one that bites:

1. **Every write must keep the cache honest.** `dbInsert`/`dbUpdate`/
   `dbDelete` handle this themselves via `applyOp()`; nothing else
   should have to. Miss it and the screen renders stale rows until
   something else happens to refetch.
2. **A write patches the cache, it does not drop it.** `applyOp()` has
   to compute the new row set for the on-disk snapshot anyway, so it
   hands that same result to `primeActivities()`/`primeCollections()`
   rather than nulling the cache and making the re-render fetch the
   whole table back to learn something the client just wrote. **Both
   refuse a cold cache** — priming one that has never been filled would
   make `cacheWarm()` true off the back of a single write — and fall
   through to the invalidate, which is the old behaviour and still
   correct.
3. **In-flight requests are shared.** Home renders four sections from the
   same two fetches; without this they raced into duplicate round trips.
4. **A failed request is never cached** — it returns `[]` as before but
   leaves the cache empty, so the next call retries instead of pinning an
   empty list for the session.
5. **`fetchActivitiesFor()` filters the shared cache** rather than
   issuing its own query. Entering a collection used to fetch the same
   rows twice, because `renderDetail()` and `renderActivitiesList()` each
   called it.

**`updateCollectionStats()` is not on the critical path and must not go
back on it.** `number_activities`/`activites_completed` are written but
never read — every count the UI shows is derived client-side. They were
nonetheless costing two serialised round trips on *every* mutation (a
select to recount, an update to store it), both awaited before the screen
was allowed to redraw, plus a third from the `invalidateCollections()`
they ended with. So it now returns immediately, does the work detached
and debounced per collection (`recountCollection`), and invalidates
nothing. `cancelPendingStats()` drops anything still queued at sign-out.

Together, rules 2 and that change took completing an activity from **five
serialised round trips to one**.

`cacheWarm()` is what lets a screen skip its spinner: blanking a screen
that is about to paint from memory turns an instant redraw into a visible
flash of nothing. `renderCollections`, `renderUpNext`, `renderDone` and
the list picker all check it.

`revalidate()` covers the case where this client is not the only writer —
the same account on another device, or someone else editing a shared
list — and is called from `auth.js` when the app is foregrounded and when
the network returns. **It flushes the offline write queue before it
refetches**; the other order makes the user's offline additions visibly
disappear and then come back a moment later. Sign-out clears the cache
*and* the on-disk snapshot, or the next person to sign in on the device
inherits the previous one's lists.

`readRows()` is the one helper behind both fetches and the only place
that decides between network and disk. Offline it does not attempt a
request at all — a tunnel should cost nothing, not a timeout.

#### Painting before the network answers

`readRows()` only reaches for the snapshot when the network *cannot*
answer, which is right for any single fetch and wrong for a cold launch:
a complete copy of the user's data is already on disk, and Home was
nonetheless waiting on two **serialised** round trips — collections, then
the activities that depend on their ids — before drawing a row.

So `showApp()` calls **`primeFromSnapshot()`** before its first `nav('home')`.
The screen paints from IndexedDB, and the network refresh happens behind
it. Four things about that sequence are load-bearing:

- **`main.js` awaits `showApp()`.** The splash has to hold until Home has
  actually painted; dropping it first shows an empty shell for the few
  milliseconds the IndexedDB read takes.
- **Everything else in `showApp()` stays un-awaited.** The probes, the
  profile load, the queue flush — none of them gate the first paint, and
  awaiting any of them puts it straight back on the critical path.
- **`probeSharing()` is awaited before `revalidate()`, and only there.**
  Nothing is waiting on that refresh, so letting the probe answer first
  costs nothing visible and guarantees the collections query runs with
  the right scope the first time.
- **A first-ever launch has no snapshot**, `primeFromSnapshot()` returns
  false, and the boot waits exactly as it always did.

`probeSharing()` no longer invalidates unconditionally when it comes back
true. It checks **`collectionsScope()`** — which records whether the
cached collections were fetched under RLS (`true`), under the client-side
`user_id` filter (`false`), or came off the snapshot and are correct by
construction (`null`). Only `false` needs the refetch. Unconditional, it
was a second full fetch of both tables on every single launch.

#### Rendering without reloading

Moving between screens used to look like the app reloading things it
already had. Four separate causes, all of which presented identically,
and none of which was actually a fetch:

**1. The fallback cover was picked at random, at render time.**
`renderCollections()` and `renderDetail()` both did
`list.cover || randCover()` — and `randCover()` picks at random. So a
collection with no cover of its own drew a *different photograph* every
time the Lists tab rendered, and a collection's banner changed on every
mutation. **`coverFor(list)` (`utils.js`) derives it from the row's own
id instead**, so it is stable for the life of the row, identical on
every screen that draws it, and identical across devices. `randCover()
is still what picks a cover when a collection is *created* — a genuine
one-off choice, and the one place randomness belongs.

**2. Every render replaced markup that had not changed.**
Assigning `innerHTML` destroys every `<img>` in the block and builds new
ones, so each visit to a tab re-attached and re-decoded every cover
photo and every completion thumbnail on it. **`setHTML(el, html)`
(`utils.js`) is a drop-in for `el.innerHTML = html` that compares
against the last string it wrote and does nothing when they match** —
which is the common case, because a re-render after navigation usually
produces exactly the same markup. Use it for any block containing
images or re-rendered on navigation; Home's four sections, the Lists
grid, the collection banner and the Me identity row all go through it.

⚠️ **A node managed by `setHTML` must never also be written directly.**
The cache lives on the node, so a direct `innerHTML` write (a spinner,
an empty state) leaves it stale and the next `setHTML` with the
*previous* markup will decline to repaint — leaving the spinner up
forever. Route every writer of that node through `setHTML`.

**3. The collection screen rebuilt its search field on every render.**
`renderDetail()` is where `refreshAfterChange()` lands, so completing,
editing or deleting an activity while a search was active destroyed the
field — dropping the query, the caret and the filtered list the user
was reading. The comment there claimed the split with
`renderActivitiesList()` protected this; it protected *typing* and
nothing else. **The control row is now built once per collection**
(`detControls.dataset.list`), and `syncDetailControls()` updates the
only two things that change without it — which segment is lit and what
the sort button says. `setFilter()` and `setSort()` both call it rather
than patching their own control, so there is one path and it cannot
drift.

**4. Two scroll handlers did real work on every scroll event.**
`applyNavCondense()` ran a `getComputedStyle()` on the root element —
a forced style resolve — plus a `getBoundingClientRect()`, on every
scroll tick. The metric only changes when the viewport does, so it is
measured once and invalidated on resize, and the handler is coalesced
to one call per frame with `requestAnimationFrame`. Separately, the
document-level **capture-phase** scroll listener in `location.js` fired
for every scroll of every scroller in the app and ran a
`querySelectorAll()` over the whole document to reposition a dropdown
that is almost never open; `_locOpenCount` turns the common case into
an integer compare. **Everything that opens or closes a location
dropdown must go through `locOpen`/`locClose`** or that count drifts.

**And each screen now remembers where it was.** The app scrolls the
window rather than a per-page container, so `nav()` stored nothing and
every navigation landed at the top — opening a collection from halfway
down the Lists tab and pressing Back put you back at the very top.
`_scrollMem` keys an offset per screen (per *collection* for detail and
conversation, so two lists do not share one), and `nav()` restores it
**after the render promise settles**, because the content that gives
the page its height has to exist first. A push always starts at the top,
which is what a push means. Nothing is persisted — it is a per-session
convenience, not state. `RENDERERS` exists so `nav()` can hold on to
that promise rather than firing nine `if`s and forgetting all of them.

#### Refreshing after a change

`refreshAfterChange(src)` in `nav.js` is the single answer to "something
was written, what needs redrawing?". **Every mutation ends there**, and
it defaults to whatever screen is actually showing.

That default is the entire point. The old code passed a source string
around by hand and several paths hardcoded `'detail'` — so completing or
editing an activity from Up Next re-rendered the collection screen, a
screen the user was not even on, and the row they had just changed sat
there unchanged until they reloaded. Pass a source only to force a
specific screen; leave it off and the current one is correct by
construction.

The same applies to `selectTab()`. A tab button must **always** go
somewhere: the old guard bailed out whenever the tapped tab was already
lit, which broke every screen pushed on top of a tab — standing on Up
Next or Accomplished and pressing Home did nothing, because Home was
already the selected tab. It only special-cased `detail`. The rule is now
"if you are not on the tab's root, go to it", and tapping the root you
are already on scrolls to the top. It also calls `dismissOverlays()`
first: the tab bar sits above the scrim and stays tappable, so without
that a tap navigated the page underneath and left a sheet stranded over
the wrong screen.

#### Media

**Media lives in Cloudflare R2, not Supabase Storage, and the reason is
egress.** A photo in a shared list is fetched by everyone in it, on
every device, for as long as the list exists. Supabase meters that;
R2 does not charge for it at all. That single difference is what makes
full-quality photos affordable, and it is why the quality constants
below are set where they are.

Three things make it work, and all three are outside this repo except
the last:

- **`cloudflare/media-worker/worker.js`** holds the R2 credentials and
  is the only thing allowed to write. The browser never sees a key —
  the same argument that keeps `HERE_API_KEY` inside the `geo`
  function. It verifies the uploader by asking Supabase whose access
  token this is (`GET /auth/v1/user`) rather than checking the JWT
  signature locally: that works with both legacy JWT secrets and the
  newer signing keys without the Worker knowing which, and it refuses a
  deleted account, which a signature check cannot. **The uid it builds
  the storage key from is the verified one, never anything in the
  request** — a uid from the body would let any signed-in user write
  into somebody else's folder.
- **Reads go straight to the bucket**, not through the Worker. A read
  has nothing to authorize and routing it through a Worker would spend
  a request to add nothing. `MEDIA_PUBLIC_BASE` in `config.js` **must**
  also appear in `IMAGE_HOSTS` in `sw.js`; if the two drift, photos
  silently stop being cached offline.
- **It degrades.** `MEDIA_WORKER_URL` empty falls back to Supabase
  Storage exactly as before, which falls back to inline base64 exactly
  as before. Nothing about this is load-bearing for a checkout that has
  not configured it.

**The compression constants are TWO pairs and the split is
load-bearing.** An uploaded photo is fetched once per device and then
cached forever — the keys are random and never reused, so the objects
are immutable — and on R2 that fetch is free, so quality costs storage
only. `MAX_PHOTO_DIM`/`PHOTO_QUALITY` are therefore generous
(2560/.92). `FALLBACK_PHOTO_DIM`/`FALLBACK_PHOTO_QUALITY` (1280/.72)
are for the two paths that keep the bytes *in the row* instead — no
bucket, or offline — and those bytes ship again on every fetch of the
list. **Raising the upload pair without the split raises the inline
pair with it and quietly rebuilds the problem the backfill existed to
fix.** `uploadPhoto()` picks the pair *before* compressing, and the
upload-failed path re-encodes down, because those bytes are about to
live in a row after all.

**A cross-origin `<a download>` is ignored by browsers**, so a link
straight at the bucket opens the photo instead of saving it.
`mediaDownloadUrl()` points at the Worker's `/download`, which re-serves
the same object with `Content-Disposition` set.

**`tools/media-backfill.py` is the one-off that got everything here.**
It moved 8.9MB of base64 out of `Activities.photos` and re-hosted the
Supabase Storage URLs (`--migrate-storage`); as of that run all 58 media
items are on R2 and none are inline. It is dry-run by default, takes
`--limit N` so one row can be checked before the rest, and only rewrites
a row once every one of its uploads has succeeded — a failure leaves the
row exactly as it was rather than half-converted. Re-running is
harmless. Credentials come from `tools/backfill-config.txt`, which is
gitignored; `tools/backfill-config.example.txt` is the template.


Photos **and video**, in `js/media.js`, stored in a Supabase Storage
bucket called `media`, one folder per user.

The `Activities.photos` column now holds only URLs, and holds two shapes
at once:

```
"https://…/x.jpg"          a photo — or a legacy base64 data URL
{type:'video',url,poster}  a video, with a still frame for thumbnails
```

**Photos stayed bare strings deliberately**, so every row written before
video existed still reads correctly. `normMedia`/`denormMedia` in
`api.js` convert, and `mapActivity` exposes both `a.media` (the full
ordered list — what the completion sheet and the lightbox walk) and
`a.photos` (images only — what thumbnails, grid cards and map pins want,
with a video contributing its poster). Keep that split: dropping
`a.photos` would mean touching every list in the app.

This was also the fix for the app's biggest performance problem. Photos
used to be base64 data URLs *inside the row*, so every render of every
list pulled all of them down again as part of the JSON. Video was never
possible that way — one phone clip is 5–20MB before base64 adds a third.

**It degrades rather than breaking.** `probeStorage()` checks for the
bucket once at sign-in, exactly as `probeRemindColumn()` checks for
`remind_at`. Without it, photos fall back to base64 (what the app did
before, so nothing regresses) and video is refused with an explanation
instead of failing at save time. Run `supabase/storage.sql` to enable it.

**The first piece of media is the cover** — it is what the activity's
row thumbnail, its grid card and its map pin all show. So "choose the
cover" and "reorder" are one operation with one control: tapping a
thumbnail in the completion sheet opens a menu (`openMediaMenu`) with
Make cover / Move earlier / Move later / Remove, and the current cover
carries a badge so the idea is visible without opening anything.

Drag-to-reorder is the obvious gesture and is deliberately not used: a
drag inside a scrolling sheet that also has swipe-to-dismiss on it is
three gestures competing for one finger, and touch behaviour cannot be
verified headlessly.

**The add button is a small pill and the tiles are 92px.** It was a
full-width dashed drop zone 26px deep, which made the control for adding
media louder than the media itself — the photos are the content on that
sheet, the button is only the way in.

`coverIndex()` picks the first entry with an image to show, matching how
`mapActivity()` builds `a.photos` — so the badge cannot disagree with
what the rest of the app draws, and a video whose poster frame failed to
capture is skipped by both (and is not offered "Make cover", since there
would be nothing for a pin to draw).

**Un-completing an activity never touches its media.** The toggle writes
only `date_completed`, and the media lives in `photos` — so photos and
notes attached to a completion survive being marked not-done and are
still there when it is completed again. Anything that changes what
un-completing writes has to preserve that.

Deleting a photo drops the URL from the row; it does not delete the
object. There is no reference counting here to make deletion safe, and
storage is cheap — `storage.sql` carries a sweeper query in a comment.

#### Searching for a place

`locSearch()` and `placeSearch()` in `location.js`. **Two engines behind one
shape** — HERE, and Nominatim when HERE cannot answer. Everything downstream
sees `{name, sub, lat, lng}` either way, so the dropdown, the shortcuts and
the save-time resolve are written once.

**The browser never talks to HERE.** It talks to
`supabase/functions/geo`, which holds the key as a function secret. There is
no key in `config.js` and one must not be added — see **Paying for the proxy**
below, which is the whole reason that file is shaped the way it is.

**Why HERE and not the free OpenStreetMap geocoders.** The field has to answer
two different questions and the free options each answer only one. Measured,
same bias point:

| | Nominatim | Photon | HERE |
| --- | --- | --- | --- |
| `Jamab Juice` | **0 results** | nearby Jamba locations | nearby Jamba locations |
| `eiffel tower` | Paris | a peak in **Alberta** | Paris |
| `kyoto` | Kyoto, Japan | a restaurant in **Berkeley** | Kyoto Prefecture |
| `coffee` | Coffee County, Georgia | nearby cafés | nearby cafés |

Photon is a prefix/POI matcher with no sense of global prominence; Nominatim
ranks prominence well and has **no typo tolerance at all**. Tuning Photon's
`location_bias_scale` across 0.05–0.6 never surfaces Paris or Kyoto — it is
not a knob that fixes it. Running both and merging was the keyless option and
is what the fallback approximates. HERE does both columns in one request.

Without the function deployed, or without the secret set, everything still
works: `placeSearch()` falls back to Nominatim, which is what the app used
before. You lose typo tolerance and near-me ranking, not the feature.

**`null` and `[]` mean different things** coming back from `geoQuery()`.
`null` is "the function could not answer" — not deployed, no secret, HERE
5xx — and is the signal to try Nominatim. `[]` is "asked, and there is
nothing", which is a real answer and is **not** retried, because asking a
worse geocoder the same question spends a round trip to be told the same
thing. The one exception is `geocodeOnce()`, where the answer blocks a save,
so both cases fall through.

Two HERE-specific things to keep:

- **`lang=en`**, or results come back as `京都府` and `La Tour Eiffel`.
- **Items with no `position` are dropped.** HERE returns `chainQuery` and
  `categoryQuery` rows — "Coffee", meaning *search for coffee places* — that
  carry no coordinates. Picking one would file an activity with a name and no
  pin, which is the exact failure the rest of this section exists to close.

**Where "near me" comes from** is `biasPoint()`: a real geolocation fix if we
have one, otherwise the user's **Home** address. Note what deliberately does
*not* happen — focusing the location field never raises a permission prompt.
`primeBias()` asks the **Permissions API**, not the user, and fetches a fix
only when permission is already granted; the only path allowed to prompt is
the user tapping *Current location*. Everyone else is biased by Home, which
costs no permission at all. That is the quieter half of why Home exists.

**Results are referenced by index, not interpolated into the handler.** The
old code escaped a display name twice — a backslash pass, then `esc()` — to
survive being written into an HTML attribute that is then parsed as
JavaScript. It happened to work for apostrophes and would not have survived a
backslash. `_locResults[resultsId]` plus `locPickIdx(id, i)` cannot be
mis-escaped. `_locSeq` drops a slow response a newer keystroke has overtaken,
the same guard `maybeGuessLocation()` has always had.

#### Paying for the proxy

The key could have shipped in `config.js` restricted by origin — that is what
these keys are designed for and what Mapbox and Google Maps JS keys do. It was
**considered and rejected**: an origin check is a header a determined caller
sets themselves, so the key would be a working credential in every visitor's
devtools, billable to the account. Nothing usable ships.

That costs one extra hop, browser → `geo` → HERE, on a path where latency *is*
the experience. Everything in **THE geo FUNCTION** in `location.js` and the
header of `functions/geo/index.ts` is about paying it back, and most of it
works by not making the request at all:

1. **A session cache, misses included** (`_geoCache`). Typing is not a sequence
   of distinct queries, it is one query typed and re-typed — backspacing,
   fixing a typo, a second activity in the same place. All free. This is the
   biggest win by a distance, and it is why the debounce could stay at 320ms
   rather than being lengthened to compensate.
2. **Prefix reuse on an empty answer** (`geoEmptyByPrefix`). If `jamba jui`
   found nothing, `jamba juic` cannot either — the matching only narrows. So
   the longer query is answered instantly, with no request.
3. **A warm isolate.** `warmGeo()` at sign-in starts the function and the TLS
   handshake, so the first search of a session pays for neither. Cold start is
   the slowest request this feature ever makes.
4. **GET with `Cache-Control: private`**, so the browser's own HTTP cache
   absorbs what the session cache misses — across reloads, and across the four
   sheets that each have their own location field. `private` matters: these
   responses are keyed to a bias point, which is roughly where the user is
   standing.

Two things in the function are there for the same reason and look like
over-care until you know why:

- **It has no imports at all.** That is what a cold start actually costs. It
  is also why this is not a branch inside `unfurl` — that function pulls in
  the Anthropic SDK, so every keystroke-pause would pay for a dependency it
  never calls.
- **It trims the payload.** HERE returns a large object per item; the UI draws
  four fields. Trimming server-side keeps the bytes off the slower hop.

**The abort controllers are per-mode** (`_geoAbort`), not one shared. A
save-time geocode and a type-ahead search are different questions asked at the
same moment — the user presses Save while a search is in flight — and a single
controller let whichever started second kill the first. A cancelled geocode
reads as "we couldn't find that place" and blocks a save that should have gone
through.

**Never deploy `geo` with `--no-verify-jwt`**, for the same reason `unfurl`
must not be: without the JWT check it is an open anonymous geocoding endpoint
billed to your HERE account, and its URL is visible to anyone with devtools.
The check is a local signature verification at the gateway and costs nothing
measurable, so there is no speed argument for dropping it.

#### The text and the coordinates must agree

**This shipped broken and the second half was the worse one.** Coordinates
were written by exactly one path — tapping a dropdown row — while the text box
was free to say anything:

- Type "Kyoto", press Save without tapping a suggestion, and the activity
  stored a location with **no coordinates**. It then never appeared on the
  map, which is the one thing the field is for.
- Open an activity that *has* a location, change the text to somewhere else,
  press Save without tapping: the new name was stored against the **old
  coordinates**. A silently wrong pin, which is worse than no pin, because
  nothing about it looks wrong.

So a location input carries **`dataset.geoFor`** — the exact string its
coordinates were resolved for. Anything else is unresolved:
`locInvalidateIfChanged()` drops the coordinates the moment the text stops
matching, and `resolveLocationField()` re-resolves before a save.

**Everything that writes coordinates must call `locGeoMark(input)`**, or the
save-time resolve will geocode a value that was already resolved — a wasted
round trip on every edit. The callers are `locApply()`, `openActDetail()`,
`openComp()`, `acceptPhotoLocation()` (`media.js`) and
`maybeGuessLocation()`.

`resolveLocationField()` **keeps the typed text and only fills in the
coordinates** — the user wrote "Grandma's cabin" and meant it; only the pin
was missing.

#### A location is required

Every activity needs one, enforced by `requireLocation()` in `location.js` and
called from `saveActivity()`, `confirmComplete()` (draft mode only) and
`saveBulkActivities()`. Same argument that pulled the field out of the old
"More options" disclosure: an activity with no location never appears on the
map and the field was the one people skipped.

Two exemptions, and both are load-bearing:

- **It never blocks a save while offline.** Resolving text to coordinates
  needs the network, and refusing without it would break capture in exactly
  the place the app is built for — "ideas arrive on planes and in tunnels" is
  the whole argument for `offline.js`. Offline, typed text is accepted as-is
  and syncs without coordinates.
- **It does not apply to an activity that is already completed.**
  `confirmComplete()`'s edit pass is exempt for the same reason the media rule
  is (see `updateMediaRequirement()`): enforcing a new requirement on the edit
  path strands every row created before it, whose owner then cannot fix a typo
  without first satisfying it.

It **does** block an unresolvable place while online, which is the strict
reading — a location that cannot be found will not be on the map. If that
proves too strict, returning `true` instead of `false` in the `!res.ok` branch
relaxes it to "any text will do" in one line.

#### Home

One saved place per user, set from the You tab (`openHomeSheet()` in `me.js`),
doing two jobs: the **Home** shortcut at the top of every location dropdown,
and the **bias point** for place search when there is no geolocation fix —
which is most of the time, per the permission rule above.

**Storage is two-layered on purpose.** The real home is three columns on
`Users` (`supabase/home.sql`), so it follows the account to a new device. But
the app has to work before that migration is run, and **a missing column would
otherwise take the whole profile query down with it** — so the columns are
read in their own query, a failure is noted once in the console and tolerated,
and localStorage carries the value on this device either way. Once the columns
exist, a value saved locally is pushed up on the next load.

**The localStorage key is per-user** (`bl_home:<uid>`) and `resetHomePlace()`
is called from `resetAccountState()`. A shared key would show the previous
account's home address to the next person to sign in on the device — see
**One account at a time**.

#### Moving house

Change your home address and every activity whose location **is** home moves
with it (`updateHomeActivities()` in `me.js`). "Book a plumber", "clear the
gutters", "finish the garage" are at home rather than at an address; after a
move they would otherwise sit on the map at a house somebody else lives in,
and re-pointing them one at a time is exactly the chore nobody does.

**Which activities: the ones carrying `Activities.location_is_home`, not the
ones whose location text happens to equal the old address.** That distinction
is the whole design and it is worth stating plainly, because the text match is
the obvious implementation and needs no migration:

> Home is "Denver, Colorado". The user separately searched for and picked
> Denver for a hike — because the hike is in Denver, not because they live
> there. They move to Austin. A text match drags the hike to Austin too, and
> nothing on screen says so.

The flag records **intent**, which text cannot. Picking *Home* means "my home,
wherever that is"; picking a place that happens to be the same town means that
town, permanently. Same class of defect as the stale-coordinates bug the
`geoFor` contract closes, so it is not worth trading a migration to avoid.

How the flag is kept honest:

- `locApply(id, r, isHome)` sets it, and **only `locUseHome()` passes true**.
  Anything picked from the results clears it.
- `locInvalidateIfChanged()` clears it when the text is typed over — naming a
  place is not deferring to wherever you live.
- `openActDetail()` and `openComp()` call `locSetHome()` from
  `a.locationIsHome`, so an edit that never touches the location does not
  quietly sever the link.
- **Bulk rows re-render from `bulkEntries` wholesale**, so `renderBulkEntries()`
  writes `data-is-home` back into the markup. A flag living only on the DOM
  node would be lost on the next redraw and the row would silently stop
  following.

It is **one `dbUpdate` against `location_is_home`**, so it costs a single round
trip however many rows match, and `applyOp()` patches the cache and the on-disk
snapshot from the same match — no refetch.

**The user is told, in a toast naming the count.** This rewrites rows they are
not looking at, which nothing else in the app does silently; the toast is what
keeps it from being a silent write, and setting the old address back reverses
it. If that turns out to be too casual for the number of rows involved, the
place to put a confirmation is `saveHomeSheet()`, between the save and the
cascade.

**Removing Home severs rather than moves** (`clearHomeActivityFlags()`). The
activities keep the location they have — they are still at that place — but
they stop following a *future* home address, which the user has just said they
do not have. Without that, setting a new home months later would move rows
nobody remembers flagging.

#### Guessing the location from the name

`maybeGuessLocation()` in `location.js`, over a
`{activity:{name}}` payload on the `unfurl` Edge Function. When a
**new** activity's name names a place, the location field fills itself in.

An activity with no location never appears on the map, and the location field
is the one people skip. The photo's EXIF answers that after the fact; this
answers it at the moment of capture, from the name alone.

**The whole feature is the strictness.** A model asked "can you think of
somewhere plausible" will always answer, and a place written into someone's
records on a guess becomes a wrong fact they believe later, having forgotten
a model put it there. So the bar is not plausibility, it is: *does the name
itself identify one specific place, such that any reader would agree?*

```
"Go on a hike"               → nothing. Anywhere on earth.
"Go to Arches National Park" → Arches National Park, Utah, USA.
"Take a cooking class in Italy" → nothing. A country is not a pin.
"See the Northern Lights"    → nothing. Tromsø is an association, not a reading.
```

**Four gates, and all four must pass.** Three are in `predictPlace()` on the
function — the model answering at all, its `certain` flag, and Nominatim
actually finding the place (somewhere the map cannot plot is worthless, since
plotting it is the only reason to guess). The fourth is `guessMatchesName()`
here: the predicted place has to **share a real word with the activity name**.
That is the rule the feature is built on written as code — if none of the name
is in the answer, the answer came from an association. It costs some true
positives ("See the Mona Lisa" will not resolve to the Louvre) and that is the
right side to miss on.

**It fills rather than offers, unlike the EXIF chip** — a deliberate
difference, and it rests entirely on the above. EXIF says "the camera was at
these coordinates", which is often true of the poster, the screenshot or the
drive there rather than the thing itself, so it has to be asked about. This
says "the name of this activity is the name of this place", which is either
right or the model should not have answered. What is filled in is marked with
a `.loc-guess` caption and one tap clears it — `undoLocationGuess()` empties
the field, because leaving a rejected value in place would be the silent write
the design exists to avoid.

**Making it arrive sooner.** The round trip is the whole cost, and the field
it fills is one somebody is looking at. Seven levers, none of which changes
what the feature will *answer*, and the first two are the ones that moved
the needle:

1. **⚠️ WARM THE ISOLATE AT SIGN-IN** — `warmGuess()` in `location.js`,
   called from `showApp()` beside `warmGeo()`, and **the biggest single win
   here**. `geo` has no imports by design; `unfurl` pulls in the Anthropic
   SDK, so it is the one function in this app with a real cold start — and
   without this the *first* capture of every session paid for it.

   **⚠️ It warms with a REAL call that costs nothing — an empty name.**
   `predictPlace()` returns on `name.trim().length < 3` before it
   constructs an Anthropic client, so the answer is a 200 with the isolate
   booted, the SDK loaded and the connection open, and no model call and no
   geocode spent. Verified against the deployed function:
   `{"activity":{"name":""}}` → `200`.

   **A warm ping must be a request EVERY deployed copy already answers
   2xx**, and two earlier versions were not. POSTing `{}` and letting the
   function's own "expected {activity}" 400 do the work earned a red
   `400 (Bad Request)` in the console on every launch; a GET `?warm=1`
   earned `405 (Method Not Allowed)` from every copy deployed before that
   branch existed. A fake error is a real cost — somebody eventually spends
   an afternoon chasing it — and a pure optimisation must never be able to
   log one, least of all one whose quietness depends on remembering to
   redeploy. There is deliberately **no `?warm=1` branch** in `unfurl`.
1b. **⚠️ AND WHEN THE MODEL CALL FAILS, THE FUNCTION SAYS SO.** A thrown call
   used to return `empty` and log to the Supabase console, which nobody reads
   — and `empty` is byte-identical to "this name names no place", so a broken
   deploy was indistinguishable from the feature working. `predictPlace()`
   returns an `error` string with it now; `maybeGuessLocation()` logs it and,
   the part that matters, **refuses to cache an answer carrying one** — the
   error says nothing about the name, and a cached empty would outlive the fix.
2. **⚠️ AND BOUND THE GEOCODE — the other half, and it is on the server.**
   When the model *does* name a place, `predictPlace()` then waits on public
   Nominatim before answering, so the difficulty — decided several hundred
   milliseconds earlier, and with nothing to do with the geocode — is held
   behind a free endpoint having a slow morning. `GEOCODE_TIMEOUT_MS` (2500)
   caps it. On a timeout the place is dropped, which is exactly what gate
   three already means ("the map cannot plot this"), and the difficulty
   still comes back. Losing the occasional location to a slow geocoder is
   the better trade: the user is looking at an empty field either way, and
   the alternative is looking at it for longer.
3. **It asks while you are still typing.** A debounced `input`
   (`queueLocationGuess()`, `GUESS_IDLE_MS` = **450ms**) fires at a pause, so
   the request overlaps the rest of the sheet being filled rather than
   starting when you leave the field. The original `change` handler stays as
   the backstop. This is **one call per pause, never one per keystroke** —
   that distinction is the whole reason the code used to say "not on input",
   and it still holds. It was 650ms; the pause this sits behind is the one
   between words, not the one at the end of a sentence, and below ~450 it
   starts firing mid-name and spends a model call on a prefix.
4. **It says that it is working.** `guessPending()` marks the difficulty chip
   and — only while it is still empty — the Where row, which dim and pulse
   while an answer is in flight (`.is-guessing` in `detail.css`). It makes
   nothing faster and it is the half the user actually feels: the chip read
   "None" and the field sat empty for the whole round trip, so an answer
   landing two seconds later looked like the app changing its mind rather
   than like an answer arriving. **A state on the control, not a message
   beside it** — see the two non-negotiable rules at the top of this file.
   Only the request that is still current may clear the mark, or a
   superseded call finishing late turns it off under a live one.
5. **`_guessCache`** remembers `name → result` for the session, **including
   the misses**, which are the majority. A retyped name or the same activity
   added twice returns instantly and free. A *failed request* is deliberately
   not cached — it says nothing about the name. Not persisted: the point is
   to kill repeats inside one sitting, not to build a gazetteer.
6. **`effort: 'low'` and `max_tokens: 256`** on `predictPlace()`. The prompt
   decides this answer — the rules and the worked examples do the work, not
   depth of deliberation. If recall drops on names that plainly do name a
   place, raise the effort before touching the prompt.
7. **`PLACE_MODEL` is its own constant**, separate from the imports' `MODEL`,
   and it is **Haiku** — a fraction of the latency and, more to the point, a
   fraction of the cost. This is the app's only per-capture model call, one
   per distinct activity name, so it is the single line with a bill attached
   to it that grows with the user count. It was Opus; that was the one thing
   in the app that scaled badly. The classification is closed and two-field,
   sitting behind three further gates, so the prompt does the work rather
   than depth of deliberation. **If recall drops, raise `effort` before
   touching the prompt, and change the model last.**

Things to keep:

- **Only on create.** `openNewActivity()` arms it, and it is the only
  sheet that can — there is no edit sheet. Renaming an existing activity
  (in place, on the detail sheet) is not an invitation to rewrite where
  it happens.
- **A pause, not a keystroke.** This costs a model call, so the `input`
  handler is debounced and `_guessFor` plus the cache stop it asking twice for
  the same text. `openNewActivity(prefillName)` still asks explicitly, because
  a name that arrived from a composer was never typed into the field and
  neither handler will fire for it — and that is the most common way an
  activity is created.
- **Typing in the location field settles it** (`onActLocInput()`), and a
  dismissal is sticky for the life of the sheet. `_guessSeq` drops answers
  that arrive after the sheet has moved on.
- **The cost is one model call per distinct name**, cached for the session
  and nothing across sessions.

The same "read it, never infer it, never a whole country" rule is now in the
import schema's `location` description, so a typed name, a shared link and a
screenshot cannot disagree about what counts as a place.

#### Guessing how hard it is

`Activities.difficulty` — `easy` | `medium` | `hard`, or null. **The user
is never asked.** It is inferred from the activity's name by the same
`unfurl` call that already guesses a location, and there is deliberately
no control for it anywhere in the app.

The question it answers: *what could I actually do this weekend?*
Priority says how much you want a thing; difficulty says what it costs
you. Neither predicts the other — a local dinner can be high priority and
Norway can be low — so merging them would lose information that cannot be
recovered.

**It shares the location guess's round trip rather than adding one.**
Both are read off the same short string at the same moment, and neither
is worth a call of its own. `PLACE_SYSTEM` is therefore two parts, and
the split is load-bearing: Part One refuses on any doubt (a wrong place
becomes a wrong fact the user believes later), Part Two **always
answers** and has no "unsure" tier. Do not let the strictness of the
first half bleed into the second — a rough difficulty is useful and a
missing one is not.

**Home is the yardstick.** The user's saved Home address is passed as
`{activity:{name,home,profile,examples}}`, because "a few hours away"
means nothing without a point to measure from. That is the third job Home does, after
the location shortcut and the search bias point. With no Home set the
model falls back to an average reading, which is what it did before.

Three costs decide the tier, and any one of them being hard makes it
hard: **distance** from home, **time** to become able to do it (not the
duration of the thing itself), and **money**. Something is easy only when
all three are small. The examples in the prompt are worth reading before
retuning it — the ones doing the real work are "Learn Japanese" (at home,
and hard) and "Try the new ramen place" (in town, and easy), which
together say that distance is only one of the three.

Things to keep:

- **Only on create.** The new-activity sheet is the only caller, and it
  only creates — so an edit carries the stored rating through untouched.
  Re-judging on every rename would silently rewrite a value nobody could
  see changing.
- **It is not gated on the location half.** Most names identify no place
  at all and still have a difficulty, so `predictPlace()` returns the
  rating on every path out, and `maybeGuessLocation()` applies it
  *before* the "leave an existing location alone" check. Reversing those
  two lines is the easy way to break this and it fails silently.
- **The whole answer is cached**, not the useful half. `_guessCache` used
  to store `null` for a name that named no place; that would now throw
  the rating away and re-ask on the next keystroke.
- **Null is a real value and is never defaulted to a tier.** Rows written
  before the migration have it, and so does anything the model declined
  to judge. `diffLabel()` returns `''` and nothing is drawn — an empty
  slot says "not judged", where a fourth label would state something
  nobody decided.
- **It is not hue-coded ON THE CHIP ROW.** Priority owns a three-colour
  scale there and the deadline badge owns the warm end; a third scale on
  the same row would be three rankings arguing over one glance. The word
  is the whole signal *there*. It **is** coloured where it is the only
  scale on screen — the three list buttons on the Lists tab, and the
  Difficulty menu, which uses the same `--green`/`--violet`/`--pri-high`
  via the action sheet's `tone`.
- **Optional, like every other migration.** `probeDifficulty()` in
  `api.js` looks for the column once at sign-in; without it the field is
  never sent and the sort simply orders everything as un-rated. Run
  `supabase/difficulty.sql`.

It surfaces in two places and no more: a chip on the pending activity
sheet, and **Difficulty** in the collection sort menu, which orders
easiest first — un-rated last, because an unknown at the head of a list
of quick wins is the one wrong answer.

##### Rating for one person, not an average one

Home alone still reads as an average life. Two more things ride in the
same round trip, doing different jobs, and **neither is a model being
trained** — there is no fine-tune and no stored feedback, only more
context on each call:

- **The profile** — a paragraph the user writes about themselves in
  You → *About you* (`difficultyProfile()` in `me.js`, stored in
  `Users.difficulty_profile` by `supabase/difficulty-profile.sql`).
  It says *why*: no car, tight budget, hikes every weekend, will not
  fly. Capped at 600 characters, because it is prepended to the one
  model call somebody is watching.
- **The examples** — activities the user already has, with the tier
  they already carry (`difficultyExamples()` in `location.js`). They
  say *what*: where this person's lines actually fall.

**The sample is balanced across the three tiers, and that is the whole
point of it.** Taking the most recent N outright is the obvious build
and it breaks the feature: somebody who spent a month adding weekend
ideas would send twelve `easy` examples and nothing else, and a set
that demonstrates one tier does not teach a scale — it teaches a lean.
So it is up to `DIFF_EX_PER_TIER` (6) from *each* tier that has
anything, newest first, and a tier with nothing contributes nothing.

Things to keep:

- **It costs no round trip.** The ratings are already in the in-memory
  activity cache — the same synchronous read `dupeGuard()` and Home's
  composer make. A cold cache means no examples and the call is
  exactly what it was before.
- **Every layer is optional and degrades to the previous behaviour.**
  No migration, no paragraph written, an empty cache: the function
  drops each absent piece from the message and judges on the generic
  Denver examples, as it did.
- **The user's own examples outrank the prompt's**, and Part Two of
  `PLACE_SYSTEM` says so in as many words. It also says explicitly not
  to copy the nearest-looking example's tier, and not to infer that a
  new activity must be whichever tier is under-represented in the
  sample.
- **Editing the profile clears `_guessCache`** (`resetGuessCache()`),
  because every answer in it was judged under the old paragraph.
- **The examples are the model's own past answers**, so this is a loop
  that can reinforce a mistake. Nothing in the app corrects a rating
  today — that is the missing piece if the lean ever needs breaking.

##### Rating the library you already have

`tools/difficulty-rate.py`, then `tools/difficulty-backfill.py`.

`difficulty` is only ever written at capture, so **everything created
before the feature existed is un-rated** — it sorts last under the
Difficulty sort and appears in none of the three derived lists. That is
not a small gap: for most libraries it is the majority of the rows, and
it is why the three lists read as broken rather than as empty.

Things to keep:

- **Two scripts, not one, and the split is the point.** The first
  produces a CSV of proposed ratings; the second turns a CSV into one
  `UPDATE`. Nothing in the first touches the database. That is what lets
  a few hundred model-written ratings be read — and edited — before any
  of them land on rows the user will then have to correct by hand.
- **Grouped by the owner of the collection**, and rated with that
  person's Home, profile and tier-balanced examples. Difficulty is
  relative to a person; rating a shared project's rows against one
  average reading would be wrong for everybody in it.
- **The prompt is a COPY of Part Two of `PLACE_SYSTEM`**
  (`functions/unfurl/index.ts`), so a backfilled rating is judged by the
  same three costs as a live one. Being a copy it can drift, and the
  failure is silent — the library ends up rated by two standards and the
  sort quietly stops meaning one thing. **Re-copy Part Two whenever it is
  retuned.** It is not imported because that file is Deno TypeScript
  running as an Edge Function.
- **It does not use the model the app uses.** Capture rates with Haiku
  because somebody is watching an empty field; this is a one-off with
  nobody waiting and defaults to the stronger model. The consequence is
  worth stating: these ratings become the **examples** the app sends back
  on every later capture, so this run sets the calibration everything
  after it is judged against.
- **The model answers with an item NUMBER, never the uuid.** Echoing a
  36-character id back is a transcription task with nothing to gain and a
  silent failure mode — one wrong character rates the wrong activity.
- **Completed activities are rated too.** The three lists show finished
  rows, and a library where only the pending half is rated reads as
  though ratings are missing at random.
- **A failed batch costs only that batch.** Every read is
  `difficulty is null`, so anything skipped is picked up by the next run.
- Dry-run by default, `--apply` to write the CSV — the same shape
  `media-backfill.py` already uses.


##### Editing a pending activity in place

`patchActivity()` and the small editors around it in `activities.js`.
The name and the location are edited in place on the sheet itself; the
target, the priority and the difficulty are action-sheet menus, and
`#targetSheet` survives only as the fallback for a browser with no
`showPicker()`.

The name, the list, the target date, the location, the priority and the
difficulty are all changed by **tapping them on the activity's own detail
sheet**. **There is no Edit sheet behind them any more, and no pencil on
a pending activity** — `openEditAct()` and `openEditActFrom()` are gone,
and with them every `editingActId` branch in `activities.js`. A whole
form is the wrong weight for *that name has a typo*, and a second form
holding the same seven values was a second place for them to disagree
while covering the thing being edited. A **completed** activity keeps
its pencil: that one opens the completion sheet, which holds the record
(the photos, "How it went") rather than the plan.

**⚠️ These write immediately, which the completion sheet deliberately does
not.** That is not a contradiction, and the line is worth stating because
it reads like one:

- **Staged** when the thing does not exist yet (the new activity sheet —
  Cancel means "never mind, do not create it"), or when several fields
  change together as one event (a completion: the date, the photos and
  the note are one act).
- **Immediate** for one field on a row that already exists, because the
  picker carries the Cancel. Choosing *High* from a menu is not somewhere
  you arrive by accident, and there is no half-filled state to lose.

Things to keep:

- **⚠️ THE `TARGET` LABEL AND THE LIST NAME ARE ONE THING.** They are
  the plate's two labels, one over each column, so they take the same
  mono face, the same 12.5px, the same `.12em` tracking, the same
  `--tint` and the same 13px chevron (`.ad-target-k` and
  `.ad-eyebrow-btn` in `detail.css`). At 9px the target's read as a
  caption on the date while the list's read as a control, and the two
  halves of one block looked unrelated. **Change one and change the
  other** — and it applies on both sheets, since they share the rules.
- **The countdown beside the title IS the target-date control**, and the
  green Target chip is gone. It said the same thing the countdown already
  said, and dropping it takes the chip row from four across to three —
  which is what stops the values being clipped at 320px.
- **The affordance rule: chevrons on row-shaped controls** (the chips,
  the Where row, the list eyebrow), **press-state only on the plate's two
  display elements** (the 29px serif name and the 34px numeral). Hanging
  glyphs on those turns a title block into a form.
- **The Where row is drawn even when empty**, reading *Add a place* —
  the same argument the difficulty chip makes, and it had a chevron and
  no handler at all before this.
- **`.ad-place` is a div with `role="button"`, NOT a `<button>`, and that
  is measured rather than stylistic.** As a real button the row sizes
  shrink-to-fit, and `.ad-place-v` is `white-space: nowrap` — so a long
  location becomes the row's min-content width and it grew to 357px
  inside a 318px box, which is a sideways scroll, which on iOS drags
  every `position: fixed` element with it. `width: 100%` is the same
  overflow by another route, because the row carries gutters as margins.
  `onRowKey()` gives it and the Links card the keyboard path that
  `role="button"` does not come with.
- **Never `font: inherit` on a control that borrows a class for its
  type.** The shorthand also resets family, size and weight; it silently
  reverted the difficulty chip to the body font at body size once
  already. Hand back only what a `<button>` actually took —
  `text-align`, `white-space`, and `font-family` where the children set
  none of their own.
- **⚠️ AN EDIT REPAINTS `#adHead`, NOT THE WHOLE SHEET.**
  `patchActivity()` used to re-run `openActDetail()`, which awaits a
  notes fetch — a real round trip — before it paints, and then replaces
  every node in the body. So changing a priority left the old value on
  screen for a round trip and then blanked the media grid and the notes
  log while they were rebuilt. `actDetailHeadHTML()` is the plate, the
  chips and the Where row — exactly what the in-place editors change and
  nothing else — and `repaintActDetailHead()` redraws only that, with no
  network at all. It re-establishes `locGeoMark()`/`locSetHome()`
  afterwards, because the location field is rebuilt with it, and falls
  back to the full render when the sheet is showing something else.
- **The name and the location are edited IN PLACE, not in a sheet.**
  Tapping the title swaps it for a `<textarea>` carrying `.ad-title`
  itself — same face, same size, same leading, so the text does not move
  when the field appears (measured: 95.7px vs 96.0px tall). A textarea
  rather than an input because the title wraps; Enter still commits,
  because a name is one line semantically even when drawn as three.
  Tapping the Where row swaps its text for a `.loc-wrap` holding the
  field, the hidden lat/lng and the results box — the same shape every
  other location field uses, because `locFieldsFor()` finds the
  coordinates by querying inside `.loc-wrap`.
- **Both states carry the same box, and that is what makes the swap
  invisible.** The editing title needs padding to read as a field, and
  padding would move the text — so the resting title takes the identical
  padding and both pull it back with a matching negative margin.
  Measured: the box sits at x=24 and the text at x=32 in both states,
  aligned with the eyebrow above. Change one padding and you must change
  the other.
- **⚠️ A `<textarea>` must be given a width.** `width: auto` on one is
  not "fill the parent" — it is the UA's 20-column default, which at
  29px serif is wider than the card and pushed the field out of it.
- **⚠️ AND IT MUST NEVER BE TALLER THAN ITS CONTENT.** A textarea lays
  text out from the TOP, so every pixel of height beyond one line
  becomes dead space *under* the text and the title stops looking
  vertically centred in its own box. `#aName` carried
  `min-height: 44px` against a one-line height of 39.9px — 3.2px of
  slack, small enough to read as sloppy rather than as a bug, and it
  shipped that way. It is `calc(1.1em + 8px)` now, which states the
  arithmetic (the line-height, and the two 4px paddings) instead of a
  magic number and follows the type if either changes. The floor is
  kept rather than dropped because `growNameField()` sizes from
  `scrollHeight` and needs one. Of the three places an activity's title
  can be edited, this was the only one wrong: `#adTitleEdit` never had a
  `min-height`, and the completion sheet's name is an `<input>`, which
  the UA centres itself.
- **The location dropdown positions against the ROW, not its own
  `.loc-wrap`.** `.loc-results` is `left: 0; right: 0` against the
  nearest positioned ancestor, and that wrap sits in the middle column
  past the 34px disc — so the list came out narrow enough to truncate
  every suggestion. `.ad-place` is the positioned ancestor here and that
  wrap is `static`.
- **Commit-on-blur is only safe because `locItemHTML` uses
  `onmousedown`, not `onclick`.** The pick lands before the blur, so the
  value committed is the one that was tapped. Change that and inline
  location editing breaks in a way that looks random.
- **`_titleBusy` / `_placeBusy` exist because Enter commits by blurring**,
  which would otherwise fire the commit a second time and write twice.
- **⚠️ Both swaps toggle `hidden`, and every one of those elements sets
  `display`** — which outranks the browser's own `[hidden]` rule, so
  without the `[hidden]` block in `detail.css` the static value and the
  field are BOTH drawn and the title appears twice. Same trap as the
  hidden file input inside a `.fg`. Anything else here that toggles with
  `hidden` needs a line there.
- **`.ad-place.editing` must stay BELOW `.ad-place.c-where` in the
  file.** Both are (0,2,0), so the tint wins on source order — placed
  above, the editing rule computes to exactly the same plum and does
  nothing, which is what it did on the first attempt.
- **⚠️ THE TARGET DATE SITS BESIDE THE TITLE, and the formatting — not
  the placement — is what kept looking wrong.** Three attempts failed
  for three separate reasons, all rooted in the same thing: `dateInfo()`
  sends whole strings of wildly different lengths through that slot
  (`18 days`, `Dec 31`, `Overdue`, `5+ years`, `—`).
    - A 34px numeral made `Dec 31` nearly as wide as the title and drove
      it onto four lines.
    - Sizing the value to its length (32/21/15px) meant the block
      changed size between activities, which reads as sloppy.
    - A box around it wrapped the **wider** of its two lines, and
      `TARGET` is wider than `Dec 31` once mono tracking counts, so the
      value sat off-centre in a lopsided pill against the card's edge.

  All three go away with one decision: the value is **one short line at
  one fixed size** (23px serif, measured identical across every case),
  label above it, the block right-aligned to the card's own padding.
  A vertical rule divides it from the title, and the air on each side of
  that rule is set in two different places — `.ad-plate`'s `gap` on the
  title side, `.ad-target`'s `padding-left` on the date side. **They are
  both 16px on purpose; change one and change the other**, or the
  divider sits off-centre and reads as a mistake. It was briefly moved out to a row beside
  Where and Links; that was a worse answer and is not the fix.
- **The Remind chip reads `MM/DD/YY`** (`fmtDateNumeric()`), not
  `fmtDate()`. That chip is ~92px wide on a 320px screen; a spelled
  month does not fit, and a date on a chip is scanned rather than read.
  Everywhere the date is prose, `fmtDate()` is still the one to use.
- **Only overdue and urgent tint the value** (`.is-due`, red). Any other
  band would be a fourth colour scale on a sheet already carrying three.
- **The List control is 12.5px in `--tint` with a chevron**, the same
  treatment the target's label uses. At 11px in `--label-2` it read as a
  caption rather than the control it is; the tracking comes in to .12em
  as the size goes up, or the extra width eats the title beneath it.
- **`.ad-place-body` needs `flex: 1`, or the location input is the
  browser's ~20-character default wide** and a location of any length
  scrolls inside it with its start cut off.
- **The Notes tab is gated on an AWAITED probe** (`notesReadyAsync()`),
  not on `notesReady()`. `probeMessages()` is fired un-awaited at
  sign-in, so reading it synchronously answers false for the first
  moments of a session — the sheet is built with no Notes tab and stays
  that way until it is reopened. From the outside the log "only shows up
  sometimes", which is exactly how it was reported.
- **The target date and the reminder are MENUS, not sheets.**
  `openTargetMenu()` offers the five bands plus a row that reads the
  stored date (`Dec 31, 2026`) rather than "Specific date"; picking that
  row opens the OS calendar directly. `openRemindFor()` does the same
  for the offsets and a date, then asks for the note in `showPrompt()` —
  the iOS alert with one field — because a note with no date has nothing
  to fire it.
    - **The calendar is the app's own** (`showCalendar()` in
      `modals.js`), not `<input type="date">`'s. That widget is a
      different thing on every platform, anchors to its field rather
      than the screen — on desktop it ran off the bottom of the window —
      and cannot be styled at all.
    - **⚠️ Local dates only.** `new Date("2026-12-31")` parses as UTC and
      comes back as the 30th anywhere west of Greenwich; every date in
      the calendar is built from y/m/d parts and formatted with
      `isoLocal()`. Verified against all 84 months of 2024–2030: each
      renders exactly six rows, so the card never changes height as you
      page through the year.
    - **An `immediate` escape hatch used to live in `_asPick()`** so a
      menu row could call `showPicker()` inside its own click —
      user activation does not survive the 180ms defer. Our own calendar
      has no such rule, so it went with it. Anything reaching for a
      user-activation-gated API from a menu row will need it back.
    - `openRemindFor()` still seeds `#aRemind`/`#aRemindNote`, because
      the full `#remindSheet` builds itself from them and is still what
      the new-activity sheet uses.
    - **A `separated: true` item gets its own card**, above Cancel —
      how iOS sets a destructive action apart. *Remove reminder* uses
      it; red text alone read as one more option in the list.
    - **Four offsets, not six.** 2 weeks and 3 months were dropped: a
      menu you have to read is worse than one you take in, and neither
      was distinct enough from its neighbours to earn a row. **No data
      changes** — only the resolved date is stored, so an old "2 weeks
      before" keeps its date and reads back as a specific one.
    - **The note field is a growing `<textarea>` with a hard
      `maxlength`**, capped at `PROMPT_MAX_H` (132px) before it scrolls,
      or a long note pushes the buttons off a short screen.
    - **The note is marked optional in the two places a label may say
      so** — the placeholder, and the button you leave by, which reads
      *Skip* rather than *Cancel*. Not a sentence under the field.
    - **`#promptSheet` is z-index 270**, above `.action-sheet`'s 260 and
      later than it in document order. At the shared 200 it rendered
      behind the sheet and Save could not be reached at all — the same
      trap, for the fourth time.
    - **Cancelling the note keeps the date.** `showPrompt`'s `onCancel`
      commits what was already chosen; dismissing means "no note now",
      not "forget the reminder". `closeModal()` routes `promptSheet`
      into `closePrompt()` so the scrim and Escape take that path too —
      the same argument as the sheet-return registry.
    - A menu has no Done, so **nothing is written unless something is
      picked** — which retires the legacy-band problem the target sheet
      had to defend against.
- **`#targetSheet` survives as the fallback for a browser with no
  `showPicker()`**, not as the create path: the new-activity sheet uses
  the same `openNewTargetMenu()` action sheet, so both sheets offer the
  same five bands out of `TARGET_BANDS` and open the same
  `showCalendar()`. **There is no "Remove target date"** — every
  activity gets one, and clearing it drops the row out of Up Next and
  off every deadline reading.
- **⚠️ AND THE CREATE SHEET NO LONGER SEEDS ONE.** `openNewActivity()`
  used to call `setTargetChoice(DEFAULT_TARGET_DATE)`, so every activity
  arrived dated *This Year* whether or not anybody had thought about it
  — a deadline nobody set, in a control that looked answered, driving
  the one ranking Up Next exists to show. It opens blank now and is one
  of the five things `NEW_REQUIRED` blocks the save on, which is what
  keeps the rule above true: an activity still always has a target date,
  it is just no longer guessed. `''` must survive `setTargetChoice()`
  rather than falling back to `DEFAULT_TARGET_DATE`, exactly as `''`
  must survive `setPriorityChoice()`.
- **The unset value reads `—`**, which is what `dateInfo()` and
  `countdownParts()` already produce for no date. Not "None": that slot
  is 23px serif, and the em dash is the app's own empty marker there.
- **The target sheet re-adds a legacy value for the row it is editing.**
  Without it, opening the sheet on an old row and pressing Done rewrites
  a date nobody touched. Nothing equivalent is needed on the create
  sheet — it has no existing value to preserve.
- **The inline location field carries the hidden lat/lng and the results
  box**, because the text and the coordinates travel together through
  `dataset.geoFor`, and `openActDetail()` calls `locGeoMark()` on it
  after every render so an untouched value is not re-geocoded. A plain
  text field there would write a new name against the old pin — the exact
  bug **The text and the coordinates must agree** exists to close.
- **`locGeoMark()` takes the element; `locSetHome`/`locIsHome`/
  `resolveLocationField` take the input's id.** They are neighbours in
  `location.js` and they do not agree. Passing the wrong one fails
  silently.
- **Remind writes through too**, via a second mode on the existing sheet
  rather than a second copy of it. `openRemindFor(id)` sets `_remindFor`
  and seeds the same hidden `#aRemind`/`#aRemindNote` inputs the staging
  path uses, so there is one set of fields and one `inferRemindMode()`
  to trust; Done and Remove then commit through `patchActivity()` and
  clear the flag.
    - **`_remindTargetFor` is not optional.** `currentTargetDate()` reads
      the *new-activity* sheet's date select, which on the detail sheet
      holds whatever the last edit left there — so the relative offsets
      ("1 month before") would count back from the wrong activity.
    - **`resetRemindFor()` runs on every `openActDetail()` render**: a
      sheet dismissed by the scrim or a swipe never reaches Done, and a
      stale id would send the next reminder to the previous activity.
    - The chip falls back to a plain `<span>` when `remindersReady()` is
      false, so a project without the `remind_at` column shows the value
      and offers no control.
- **The target label sits 12px above its value, not 6px.** The eyebrow →
  title pair it is matched to uses a 6px *margin*, but adds 4px of the
  title's own padding and half-leading on both sides — ~15px of visible
  space between glyphs. Measured glyph-to-glyph, 12px here matches it.
  Re-measure if either type size changes; the two numbers are not
  comparable directly.


##### Correcting a rating

`openDifficultyMenu()` / `setActivityDifficulty()` in `activities.js`,
plus `Activities.difficulty_manual` (`supabase/difficulty-override.sql`).

The rating is inferred and was, until this, unarguable. That was worse
than an ordinary missing control for two reasons: the tier decides
membership of the three derived lists, so a wrong one files an activity
where nobody will look for it; and the user's existing ratings are sent
back to the model as examples, every one of them its own past output —
so a lean reinforced itself and **nothing in the app could break the
cycle**. A correction is the only new information in that loop.

**The chip is the control**, the same argument that makes the You tab's
avatar its own button: it is the one thing on that row displaying a
rating, so nothing else a tap could mean, and a "Change difficulty" row
beneath it would be the caption this app does not write. The chevron
carries the affordance.

Things to keep:

- **It is drawn even when there is no rating**, which departs from the
  rule that a null difficulty draws nothing. That rule exists so an
  un-judged row is never labelled with a tier nobody chose, and this
  keeps it — "Not rated" states no tier. Applied literally the rule
  would have hidden the control on exactly the rows that need it, since
  everything captured before the feature is un-rated.
- **The flag records who decided, not what they decided.** `difficulty`
  alone cannot say whether a value may be overwritten or whether it is
  worth sending as an example. It is deliberately a boolean rather than
  a `difficulty_source` enum: the only distinction the app ever draws is
  user-or-not, and a three-state column would invite code to care about
  a difference it does not have. Same shape and reasoning as
  `location_is_home`.
- **Corrections lead each tier in `difficultyExamples()`**, newest
  within each group. That is the half that actually breaks the loop —
  `DIFF_EX_PER_TIER` spends its slots on answers a person gave before it
  spends them on echoes. It is a **re-ordering and not a filter**, so
  somebody who has never corrected anything sends the sample they always
  sent.
- **Nothing guards the guess against overwriting a correction, and
  nothing needs to.** Corrections are made on the detail sheet, against
  a row that already exists; the only sheet that re-asks is the *new*
  activity sheet, which only ever creates. So "only on create" is not
  merely a cost decision — it is what makes a correction stick. **Anything that arms
  the guess on an existing row has to check `difficulty_manual` first.**
- **`saveActivity()` deliberately does not write the flag.** An edit
  updates named columns, so `difficulty_manual` survives untouched.
  Writing it there would reset a correction to whatever the hidden
  `#aDiff` input happened to hold.
- **Clearing hands the row back to the model** rather than pinning
  un-rated as a correction: `difficulty_manual` is set to `!!tier`.
- Optional like every other migration — `probeDifficultyManual()`
  answers false, the tier is still written and still works for the
  session, and only the memory of *who* chose it is lost.


#### How far away it is

`haversineMiles`/`distanceFromHome`/`fmtDistance`/`distanceReady` in
`utils.js`. Every activity carries `location_lat`/`location_lng` and the
user carries a Home, so this is arithmetic the app had every input for and
was not doing.

**It is the half of "what could I do this weekend" that the difficulty
rating cannot answer.** Easy/Medium/Hard deliberately folds three separate
costs — distance, time and money — into one word (see **Guessing how hard
it is**), which is right for a glance and lossy by construction: something
can be genuinely easy and four hours away. Distance pulls the one of the
three that is a *measurable fact* back out, and it needs no model call, no
migration and no column.

Where it shows up, and nowhere else:

- **The Distance sort** on a collection, nearest first. Un-located rows sort
  last, for the same reason un-rated ones do under Difficulty: nothing has
  been said about them, and an unknown at the head of a list of things close
  to hand is the one wrong answer.
- **A distance in the row's meta line, but only while that sort is
  applied.** It is a fourth thing on a line already carrying a priority
  capsule, a deadline badge and a place name, and `.act-meta` is
  `flex-wrap: nowrap` by design — so it earns its width on the one screen
  where it is the answer to the question being asked. Unlike the place name
  it does **not** shrink: an ellipsised place name is still readable, a
  truncated distance is a wrong number.
- **A `Distance` chip on a pending activity's sheet**, beside Priority,
  Difficulty and Target. Untinted, like the difficulty chip: that row
  already carries priority's three-colour scale and the target's moss, and a
  fifth hue would be a fourth ranking arguing over one glance.

Things to keep:

- **Nothing is stored.** Home moves and every distance in the app moves with
  it, which is the same reason `updateHomeActivities()` exists rather than a
  denormalised column.
- **Null is a real and common answer.** No Home set, or an activity typed
  offline that never got geocoded (see the backlog). Every caller handles it
  rather than treating it as zero, which would put un-located rows at the
  top of a nearest-first list.
- **The comparator is written out rather than subtracting ranks.** The
  `Infinity` trick the other sorts could have used yields `NaN` when both
  sides are absent, which is not a comparator at all.
- **"At home" comes off `location_is_home`, not off a small distance.**
  Same distinction **Moving house** rests on: picking *Home* means "my home,
  wherever that is", and a hike that happens to be in your own town is not
  at your house.
- **Miles, spelled out.** The no-abbreviation rule is not only about
  `dateInfo()` — "12 mi" saves four pixels and makes the reader decode a
  label they were meant to glance at.
- **The sort is dropped from the menu rather than disabled** when there is
  no Home. An order that cannot be applied is not a choice, and the sheet
  has no room to explain itself.

#### Where the photo was taken

`js/exif.js` reads the GPS block out of a JPEG, and `handleMedia()`
offers it as the activity's location when there isn't one already.

The case: an activity with no location never appears on the map, and the
completion sheet is exactly where that gets missed — you have just done
the thing, you are attaching the photos of it, and the one field that
would put it on the map is the one you skip. The photos already know.

Three things that are not negotiable:

- **It reads the original `File`, before anything re-encodes it.**
  `compress()` in `utils.js` draws to a canvas and reads back with
  `toDataURL()`, and a canvas knows nothing about EXIF — every tag is
  gone from the result. So the read happens in `handleMedia()` on the
  file as picked, never on anything `uploadPhoto()` has touched. Moving
  it downstream silently returns null for every photo.
- **It suggests, it never fills.** `suggestLocationFromPhoto()` draws a
  `.loc-suggest` chip under the field; `acceptPhotoLocation()` is what
  writes. EXIF can be wrong — a photo of the poster advertising the
  thing, a screenshot someone sent you, a stale fix — and writing a place
  into the record of something you did on that evidence is worse than not
  offering. Same rule the import sheet follows.
- **Only when the field is empty** (`needsLocationSuggestion()`), and a
  dismissal is sticky for the life of the sheet so the next photo does
  not bring the offer back. `openComp()` calls `resetLocationSuggestion()`
  so that stickiness cannot leak into the next activity.

The parser is hand-rolled because it is a fixed walk over a specified
binary layout, and that is smaller than the smallest library. It handles
both byte orders, tolerates junk segments ahead of APP1, and returns null
on anything malformed rather than throwing.

**Two containers, because a phone produces both:**

| | EXIF lives in | Reads |
| --- | --- | --- |
| JPEG | an APP1 segment near the front | one slice |
| HEIC / HEIF / AVIF | an addressable *item*, via the ISOBMFF box tree | two |

HEIC is what an iPhone shoots by default. Safari *usually* converts it to
JPEG on the way through a file input — but "usually" is doing real work
there: it depends on the iOS version and how the picker was opened, and
when it does not convert, the feature silently does nothing. Which is
what it did. The box walk is
`ftyp → meta → iinf` (which item id has type `Exif`) `→ iloc` (where in
the file those bytes are), then a second targeted slice. **The payload
lands on an ordinary TIFF header, so everything downstream is reused
unchanged** — HEIC support is a new way to *find* the same block, not a
second parser. `iloc` is the awkward part: the width of every offset
field is declared inside the box and the layout shifts across its three
versions, all of which are handled.

**Dispatch is on the magic bytes, never on `file.type`.** iOS reports the
type inconsistently and sometimes not at all, and that mislabelling was
itself a way the feature silently failed. The bytes cannot be wrong.

**What it will not find:** screenshots, anything shot with the in-app
camera, and anything that has been through a messaging app (most strip
metadata on send, which is a feature). A real PNG is left alone rather
than guessed at.

`reverseGeocode()` in `location.js` turns the fix into a name, at
`zoom=14` — the default returns a full postal address, which is both too
precise to be useful and slightly unnerving to be shown back to you.

**It runs the moment the fix is read, alongside the uploads rather than
after them.** It used to wait for every upload to finish, on the grounds that
the photos appearing is what the user is waiting on — but the lookup is a
~1KB GET and the uploads are megabytes, so behind a video the chip arrived
seconds after the photo it came from. Running them together costs the uploads
nothing measurable, and `suggestLocationFromPhoto()` re-checks
`needsLocationSuggestion()` on the far side of the round trip, so a user who
typed a place in the meantime still wins.

#### Working offline

`js/offline.js`. Before it, "offline" meant the shell loaded and every
list was empty: `sw.js` caches the app's own files but Supabase is on
`NEVER_CACHE_HOSTS`, so there was nothing to show and nothing you could
do. That is the wrong failure for an app whose purpose is catching an
idea the moment it arrives — ideas arrive on planes and in tunnels.

Two halves: a **snapshot** of the two backing queries in IndexedDB, and
a durable **queue** of writes replayed in order on reconnect.

**The whole design rests on one fact: `Collections.id` and
`Activities.id` are `uuid` columns.** So the client mints a row's
permanent id itself and inserts it explicitly. That removes the hardest
part of offline sync — there are no temporary ids, nothing is rewritten
when a queued insert lands, and a row created offline can be edited,
completed and deleted *by id* before it has ever reached the server. Ids
are minted for online writes too, so the two paths are one code path.
`saveList()` no longer needs `.select().single()` to learn the new id.

⚠️ **Mint them with `uuidv4()` (`utils.js`), never `crypto.randomUUID()`
directly.** `crypto.randomUUID` is only defined in a **secure context** —
https or localhost — so it is `undefined` when the app is served over
plain http on a LAN address, which is exactly how you test it on a phone.
The same restriction that stops the service worker registering there.
This shipped broken once: the fallback returned `'x' + timestamp +
random`, which is not a uuid, and every insert failed with `invalid input
syntax for type uuid` on a LAN IP while working perfectly on localhost.
`uuidv4()` falls back to `crypto.getRandomValues` (which is *not*
secure-context-gated) and formats a real RFC-4122 v4 string, and
`stampRow()` asserts the shape with `isUuid()` before anything is sent.
Anything else that needs a random id — `mediaKey()` in `media.js` —
shares it.

Things to keep in mind:

- **Every mutation goes through `dbInsert`/`dbUpdate`/`dbDelete`**, not
  `sb.from(...)` directly. They return the familiar `{error}` plus
  `offline:true` when queued. They also call `invalidateActivities()`/
  `invalidateCollections()` themselves, so mutation sites no longer do —
  see the backlog note about this being the real fix for rule 1 above.
- **Only a *network* failure queues.** `isNetworkError()` separates
  "could not reach the server" from "the server said no". A row rejected
  by a constraint or by RLS would be rejected again forever, so it is
  reported rather than queued; a replay that keeps failing is dropped
  and logged rather than wedging the queue behind it.
- **Replayed inserts use `upsert(..., {onConflict:'id'})`**, because the
  original attempt may in fact have reached the server before the
  connection dropped.
- **The snapshot stores raw PostgREST rows**, not the camelCase UI
  shapes. `mapActivity()`/`mapCollection()` stay the single place that
  knows column names, so a mapper change applies to cached rows too.
- **`updateCollectionStats()` is skipped offline.** Those two columns are
  written but never read; queueing a write of them would add a round
  trip's worth of ops for a number nothing displays.
- **Media is the one thing not queued.** Photos taken offline fall back
  to inline base64 (what the app did before the bucket existed) so a
  completion syncs whole; video is refused with an explanation, because
  a 5–20MB clip sitting in IndexedDB is a different feature.
- No conflict resolution — last write wins. Correct for a library one
  person curates from their own devices, and the honest answer for
  shared lists too.

The banner's text lives here rather than in `pwa.js`, because what it
should say depends on how many writes are waiting.

#### Finding things again

**There is no Search screen.** There was one — a pushed screen with its own
field, filter segments and result sections, reachable from a bar button on
Home, Lists, Up Next and Accomplished. It is gone, along with `js/search.js`,
`css/search.css`, `#page-search` and every bar button that opened it.

Home's composer answers the same question from the screen people already
start on — see **One field, both questions**. A second, dedicated screen for
it was a tab-bar button, a nav-bar button on four screens, and a whole file,
to reach something now one keystroke away.

What survived the deletion lives in `home.js`, because the composer is its
only caller: `SEARCH_MIN` and `SEARCH_ACT_WEIGHTS` (tuned constants — read
the comments before touching them), `searchActivities()`, and `searchMark()`,
which is still **the one place in the app that does not `esc()` a rendered
string wholesale** — it splits on the raw text and escapes each piece itself,
because only the literal query substring is highlighted and a fuzzy hit has
no single span to point at. Don't "simplify" it.

The detail screen keeps its own search box, which searches only the
collection you are standing in. That is the right scope for it and always
was; the Search screen existed because it was the *wrong* scope for the
library, and the composer is the answer to that now.

#### Catching duplicates

`js/dupes.js`. Pulling scattered ideas into one place necessarily drags
the same idea in more than once, so the moment capture got easy,
duplicates became the next failure. Three rules:

1. **Nothing is ever deleted or merged automatically.** A match is a
   question, not a verdict. "Add anyway" is the primary button, because
   the app being wrong must never cost more than one tap.
2. **It must not slow capture down.** `dupeGuard()` runs synchronously
   against the in-memory cache and calls its callback immediately when
   there is no match — the fast path is unchanged, not merely quick. A
   cold cache means nothing to compare against and the add proceeds.
3. **Matching is fuzzy.** An exact-text check — what most apps ship —
   catches neither "Skydive in Interlaken" vs "Go skydiving in
   Interlaken" nor a typo.

Every add path routes through it: both composers, `saveActivity()`, and
`saveBulkActivities()`. An **edit** is only checked when the name
actually changed, or saving an untouched activity would report it as a
duplicate of every near-miss in the library; `excludeId` stops it
matching itself.

A **batch** is checked as a whole (`dupeGuardBatch()`, which returns a
promise for the subset to keep). Stopping on the first collision would
mean fixing one row and being stopped by the next — intolerable at ten
rows. Every way out of that sheet has to settle the promise, including
the scrim, Escape and a swipe down; cancelling resolves to `[]`.

**On the thresholds.** `DUPE_POSSIBLE` (.58) is deliberately loose.
There is a class of pair — one distinctive word inside a longer phrase —
where no threshold separates a true duplicate ("Eat at Noma" / "Dinner
at Noma Copenhagen") from a false one ("Visit Paris" / "Paris Hilton
documentary"); they score within a hundredth of each other. The tie goes
to catching it: a false positive costs one tap, a missed duplicate is
the problem the user came here to fix.

`similarity()` also uses **location to adjust, never to decide**: two
activities called "Watch the sunrise" in different countries are not
duplicates, and the place is the only thing that says so.

#### How the fuzzy matching works

`js/fuzzy.js` has **two entry points because they are different
problems**, and using one for the other gives bad results both ways:

| | Compares | Used by |
| --- | --- | --- |
| `similarity(a,b)` | two finished phrases, symmetric | duplicate detection |
| `matchScore(q,text)` | a fragment against a whole phrase, asymmetric | search |

Search has to score "fush" highly against "Fushimi Inari" even though
the two are barely similar as strings; duplicate detection must not.

Underneath: normalise (case, accents, punctuation), tokenise (dropping
leading verbs so "Visit X" ≈ "X", and a tiny abbreviation table so
"Mt Fuji" ≈ "Mount Fuji"), then blend **soft token Dice** with
**character trigrams**. "Soft" matters — pairing words by how alike they
are rather than demanding equality is what makes "skydive" match
"skydiving", which no amount of character overlap does. `fuzzyStem()`
exists for exactly that and is a crude suffix stripper, not a real
stemmer.

Containment is scaled hard by the length ratio. A generous floor there
was what made "Visit Paris" a duplicate of "Paris Hilton documentary":
the short name is genuinely inside the long one, but it accounts for a
fifth of it, and a fifth is not a match.

**If you retune any of these, re-run the pairs in the header comment.**
The constants are tuned against real phrasings, not derived.

#### Shared lists

`js/sharing.js` plus `supabase/sharing.sql`. A shared collection is an
**ordinary collection** — it appears on the Lists tab, its activities are
on Home, on the map, in search — so nothing in the app had to learn a
second kind of list. The only differences are a badge, a Share entry in
the ⋯ menu, and Leave in place of Delete for a list you do not own.

**Invites are a link with a random code, not a username lookup.**
Inviting by username needs a policy letting any signed-in user search
`Users`, which turns a private table into a directory; a link needs
nothing known about the other person in advance, works before they have
signed up, and travels over whatever the two people already use to talk.
The code is minted client-side so the link exists the instant the sheet
opens. `?join=<code>` is read at boot **before `restoreSession()`**, for
the same reason `?share=` is: it can arrive while signed out.

**And it has to survive a reload, which is not the same thing.** Both
captures are read at boot, stripped from the URL immediately, and then
held until there is a signed-in user to hand them to — and the gap
between those two moments is precisely where a reload is most likely,
because the recipient of an invite is the one person guaranteed to have
to sign in first. A reload there finds a URL with nothing left in it and
a global that has been reinitialised, so the capture is gone for good.

This shipped broken, and the reload was the app's own: `sw.js` calls
`clients.claim()` on activate, so a **first** visit acquires a controller
it never had, which fired `controllerchange`, which `pwa.js` turned into
`window.location.reload()`. Every invite link opened by someone whose
browser had not seen the app before — which is every recipient, the
first time — landed on the plain app with the code already destroyed. It
presented exactly as "sharing doesn't work; the link just opens the
normal page".

Two things fix it and both should stay, because they fail differently:

- **`pwaHadController` in `pwa.js`.** The reload is for when the worker
  *changes*, never when it *arrives*: on a first install the page is
  already running the newest code, so the reload buys nothing and costs
  the query string. The flag is read at parse time because by the time
  `controllerchange` fires the controller is non-null either way. The
  `updatefound` handler beside it already drew this distinction; this is
  the same check, which it was missing.
- **`bootKeep`/`bootRead`/`bootDrop` (`utils.js`)**, a sessionStorage
  shelf for anything captured from the URL at boot. That is the general
  answer — any reload eats these, not only the service worker's.
  **Reading does not remove**: a capture is dropped when it is
  *consumed*, by `handlePendingJoin()`/`handleSharedInput()`, so it
  survives any number of reloads before sign-in and none after. Dropping
  on consume rather than on accept is what preserves the original
  property that a reload cannot re-run a join.

#### Accepting an invite, and why it needs four answers

The link is the convenient path and it is *not* the reliable one,
because everything it has to survive happens in apps this code does not
control. Three separate defects here all presented identically — "I sent
the link, they opened it, and nothing happened" — which is why the
mechanism now has a floor under it rather than one more fix.

**A shared link dies with its tab; an invite must not.** `bootKeep` is
sessionStorage, which is the right lifetime for `?share=` and the wrong
one for `?join=`, and the difference is what the recipient does next. A
shared link lands on someone already signed in. An invite lands on
someone who has to sign in *first*, and signing in is exactly when people
leave the tab — to open a password manager, to check which email they
used, to fetch a confirmation. iOS Safari discards background tabs
aggressively, so they come back to a fresh tab, an empty sessionStorage,
and a URL whose query string was stripped on the way in. The invite was
gone, and it looked like the link had never carried anything.
**`bootKeepLong`/`bootReadLong`/`bootDropLong` (`utils.js`)** are the same
shelf on localStorage, with an explicit stamp and a 7-day TTL replacing
the "cannot be re-run days later" property sessionStorage gave for free.
Only the join code uses them; a stale link import resurfacing a day later
would be a regression, so `?share=` keeps the short shelf.

**A failed join must not consume the invite.** `handlePendingJoin()`
dropped the code from the shelf one line after reading it, and *three* of
the paths below that can fail before the user has had any chance to join
— the sharing probe answering false, the device being offline, the invite
not reading back. Consuming it first meant a failure destroyed the invite
permanently: the link had already stripped itself out of the URL, so
there was nothing left to retry with. The code is now dropped once
`peek_invite` has succeeded and the sheet is showing, which keeps the
property the early drop existed for — a reload while the sheet is open
finds no code and cannot re-run the join — and leaves every recoverable
failure recoverable. A code that *cannot* be read is still consumed, or
the same error sheet reopens on every launch.

**The sign-in screen has to admit it is holding something.**
`updateAuthInviteNotice()`, called from `showAuth()`. Without it the
recipient sees an ordinary login form, and if anything downstream goes
wrong they cannot tell whether the link ever carried an invite — which is
precisely how this reads from the outside when it breaks.

**And there is a path with no link in it at all.** `openJoinByCode()` /
`submitJoinCode()` / `parseInviteCode()`, reachable from *Join a shared
list* in the You tab and from the error state of a failed invite. The
invite has always *been* an 18-character code; this just lets it be
typed. Same shape as the reminder delivery tiers and the four ways a link
gets shared in — the reliable floor exists so that the convenient path
failing is an annoyance rather than the feature not existing. It lands
straight back on `handlePendingJoin()`, so a code and a link cannot
disagree about what joining looks like, and `parseInviteCode()` accepts a
whole pasted invite URL or share message as readily as a bare code,
because what people have in their clipboard is whatever they were sent.
The share sheet therefore shows the code beside the link, and **both Copy
and Send produce one message carrying the link AND the code** —
`inviteMessage()`, with the code on its own line so it can be selected
without the URL coming with it. `sendInviteLink()` deliberately passes no
`url:` field to `navigator.share`: given one, most targets send the URL and
drop the text, which is precisely the half that fails.

Joining by code is reachable from **Lists → Join a List**, a tile beside New
List (and a button in the empty state, which is where someone invited into
their first list actually lands), and from the error state of a failed
invite. There was a duplicate row in the You tab; it is gone. This is the
floor under every link-based path, so it belongs on the screen the missing
list was supposed to be on — not in a settings tab as well.

#### An invite that survives creating an account

**The state lives on the server, keyed by email address.** Every other
capture in `sharing.js` is bounded by one device, which is enough for a
recipient who already has an account and not enough for the case sharing
exists for — handing the app to somebody who has never seen it. They have to
sign up, this project confirms addresses, and the confirmation link gets
opened wherever their mail is, which is usually the other phone. There the
`bootKeepLong` shelf is empty and the invite is gone with nothing on screen
to say so.

Carrying the code on the auth user's metadata was built and reverted — the
chain ran in-memory global → localStorage → auth metadata → a probe race → a
sheet, and every link in it fails silently. So:

- **`claimInviteForEmail(code, email)`** is called from `handleAuth()` *before*
  `signUp()`, and records "whoever signs up with this address means to join
  this list" in `invite_claims` (section 5 of `sharing.sql`). Before rather
  than after: if the request reaches the server and the response never
  arrives, the account exists and this page may never run again.
- **`claimInvitesForMe()`** redeems it from `showApp()`, on whatever device
  eventually signs in, and **returns what it joined** so the app can say so
  and open the list. A shared list that silently materialises is only
  marginally better than one that never arrives.

Four things hold it up:

- **There is deliberately no trigger on `auth.users`**, though that is the
  obvious shape and the one profiles.sql uses. It would join them before the
  address is confirmed, it fires exactly once so an error loses the invite for
  good, and the client could not then tell them. An unclaimed row simply waits
  and is redeemed on the next sign-in.
- **`inviteSweepDue()` (`auth.js`) decides when to ask**, because for almost
  every launch the answer is "nothing waiting" and this is a round trip. Two
  things make it due: a real authentication just happened (the form, or a
  confirmation link redeemed at boot), **or** the account is under a week old.
  The second is the retry belt — a session restored from storage never passes
  the first test, so a sweep that failed while offline would otherwise never
  run again, the person being already signed in and having no reason to sign
  in twice.
- **The two paths never race.** `showApp()` skips the sweep when the ordinary
  link capture is already running. Nothing is lost: the claim stays on the
  server and a later launch consumes it in silence, because
  `claim_invites_for_me()` reports only lists it actually joined and says
  nothing about one the user is already in.
- **The sign-in screen opens on Create Account** when an invite is pending and
  this browser has never held a session (`showAuth()`), and
  `updateAuthInviteNotice()` names the list — `peek_invite` is granted to
  `anon` precisely so it can. *"Landon shared "Japan 2027" with you"* is a
  reason to make an account; *"sign in to continue"* is a form. Once they have
  gone off to their inbox, `authInviteWaitingNotice()` repoints the same block
  to say the invite is no longer riding on this browser.

What this exposes: `claim_invite` has to be callable by `anon` — there is no
session at sign-up — so anyone holding a live code can register any address
against it, and that list would appear in their account if they later sign up.
Someone holding the code could already have emailed it to them directly.
Claims are capped per address, expire after 30 days, and are readable by
nobody: RLS is on with no policies at all.

**Moving the shelf ate one release's invites, and `bootReadLong()` now
carries the migration.** The join code lived in sessionStorage under the same
key until `bootKeepLong` arrived, and `sw.js` calls `skipWaiting()` on install
plus `clients.claim()` on activate — so opening an invite link on a device
that already had the app cached ran the *old* code first. It captured the code
into sessionStorage and stripped the query string; the new worker took over,
`pwa.js` reloaded the page (correctly — a real update); and the new code looked
in localStorage, found nothing, and the invite was gone with no URL left to
retry from. So a miss falls through to the old location and promotes what it
finds. **Keep that as the general rule, not as this one migration**: any boot
capture that changes where it lives has the same one-page-load window, and it
is silent at both ends.

**iOS cannot be made to open the PWA instead of Safari.** There is no
API for it: Universal Links need a native app and an AASA file, and a
manifest scope is a hint the OS is free to ignore. This is the same
platform wall that makes the app unable to register as a share target.
It matters less than it looks, though, and that is worth stating plainly
in any future debugging: **joining is a server-side membership row**, so
an invite accepted in Safari is already in effect in the installed PWA —
the detour is cosmetically annoying, never the reason a list fails to
appear. If a list is missing after a join, the join did not happen; look
at the four mechanisms above, not at which browser it opened in.

**A shared list is badged on the Lists tab in both directions** — one you
joined and one you own and invited someone into. `isSharedWithMe()` answers
the first from the row itself; `sharedCollectionIds()` answers the second
with one query, since the RLS policy on `collection_members` returns your own
membership rows *plus* every row for a collection you own. It is cached and
dropped by `invalidateSharedIds()` wherever membership can change (join,
leave, remove). The badge is an icon-only disc in the **top-right**, opposite
the "N High" count so the two coexist — a shared list is as likely to have
urgent work in it as any other.

It degrades like everything else optional: `probeSharing()` looks for
`collection_members` once at sign-in. Two traps:

- **The probe races the first render.** `fetchCollections()` has usually
  already answered with `sharingReady()` still false — which means it
  filtered to owned lists and cached that. So the probe invalidates and
  re-renders when it flips true, or joined lists stay invisible until a
  reload.
- **`fetchCollections()` drops its `user_id` filter once sharing is on**
  and relies on RLS to scope the result. That filter was never a
  security boundary (see **Back end**), but with sharing off it is left
  in place: without RLS, removing it would return every user's rows.

Permissions are enforced by **RLS, not by this file** — the checks here
decide which buttons to draw. Owner: everything, including deleting the
list and revoking links. Member: add, complete, edit and delete
activities, rename the list, leave. See the header of `sharing.sql` for
why the `SECURITY DEFINER` helpers exist (policy recursion) and why
`collection_members` deliberately has **no INSERT policy**.

Joining and inviting both need the network. Activities in an
already-joined shared list queue and sync like any other.

#### Messages

`js/messages.js` plus `supabase/messages.sql`. A conversation per
shared list, and a **Messages tab** collecting them — the fifth and
last tab, since five is the practical ceiling on a phone.

**Only shared lists have a conversation, and nothing creates one.** It
is simply the messages that exist for a collection, so sharing a list
makes one. A list nobody else is in has nobody to talk to, and a chat
with yourself on every private list would be the tab's entire content
for most people. The rule is "at least one `collection_members` row",
which is the same set `sharedCollectionIds()` badges on the Lists tab,
and `conversation_list()` applies it server-side so the two cannot
disagree.

##### Messages are deliberately NOT in the app's two backing queries

This is the load-bearing decision, and everything else follows from it.
Collections and activities are fetched whole, cached in memory and
mirrored to IndexedDB, because both are bounded by how much one person
curates. Messages are not: they grow forever and are read from the
tail. Putting them in that cache would mean pulling every message in
every list on every launch.

So there are two things here and they are cached differently:

- **The hub** is one RPC — `conversation_list()` — returning a row per
  shared list with its last message and an unread count. Bounded by the
  number of lists, so it caches for the session like everything else
  and refreshes on foreground. Building it client-side is the thing
  that would have dragged messages into the main cache.
- **A conversation** is fetched when you open it, newest `CONV_PAGE`
  (40) first, paging backwards as you scroll up. Nothing is kept
  between visits.

Paging backwards **corrects the scroll offset by the height it just
added** (`loadOlderMessages`). Without it, loading older messages
throws the reader to a different part of the conversation — the same
class of defect as a list that re-flows while you read down it.

##### Realtime, and how far it reaches

`postgres_changes` filters on a **single column equality**. That is
exactly a conversation (`collection_id=eq.X`) and it cannot express
"any list I am in", which is what the hub would want. Rather than
build a per-user broadcast channel with a database trigger behind it:

- **the open conversation** gets a live channel, subscribed on entry
  and torn down by `nav()` on the way out — the same treatment the
  detail map gets, and for the same reason: it is a resource held for
  one screen;
- **the hub and the tab badge** refresh on foreground and after a send,
  which is the trade `revalidate()` already makes everywhere else.

`onRealtimeMessage()` has three guards worth keeping: a soft delete
arrives as an *update*, so it is matched on `deleted_at` first; your
own send is already on screen (drawn from the row `dbInsert` minted)
so the echo is dropped by id; and it only sticks to the bottom **if
the reader is already there**, or somebody else typing would yank you
out of the history you were reading.

##### Mentioning an activity

The point of the feature: *"which one are we talking about?"* answered
in the message rather than in the next three messages.

Typing `@` opens a list of this collection's activities, scored by
**`searchActivities()`** — Home's composer's own matcher, run against
the in-memory cache, synchronous and free. Picking one **inserts the
activity's name as ordinary text** so the sentence still reads, and
attaches its id to `messages.activity_ids`. The array is authoritative
and the chip under the message is drawn from it; the text is only the
sentence. The chips above the composer are removable, because the
inserted text is editable and the two could otherwise only be
separated by retyping the message.

**Scoped to the conversation's own collection, deliberately.** An
activity in a list some of the readers cannot see would render as
"no longer in this list" for them, which is a worse answer than not
offering it — and the fix when you want to talk about something else
is to add it to this list, which is one action away.

That "no longer in this list" state is a real case, not a defensive
branch: **the reference is permanent and the membership is not.** An
activity removed from the list after being mentioned renders as a
disabled chip saying so, rather than a tap that does nothing.

##### A message outlives its author

`sender_id` is `on delete set null`, and `sender_name` is a snapshot of
the display name taken at send time — the same thing
`collection_members.display_name` does. Deleting an account therefore
leaves the conversation intact and readable, because deleting
somebody's messages tears holes in a discussion other people had and
still need.

**And it says so.** A null `sender_id` renders the author greyed with
a `Deleted account` chip beside the name. A name with no account behind
it that looks like every other name is the quiet kind of wrong this app
tries not to ship — see the same argument under **Moving house**.

Deleting a message is a **soft** delete (`deleted_at`), so the thread
does not reflow under somebody mid-read; the select filters it out.

##### A face on the account

A message header said who wrote it; a photo is what makes that
readable at a glance rather than word by word, which is most of the
difference between a list of rows and a conversation. One image per
account, set by tapping the avatar disc on the **You** tab
(`openAvatarMenu()` in `me.js`).

**The photo is the control.** There is no "Change profile photo" row
under it: the disc is the only picture on that screen and there is
nothing else it could plausibly do when tapped. The camera badge is
what makes that legible — a row spelling it out would be the caption
this app does not write.

**It lives in the `media` bucket, under the uploader's own folder**,
exactly like a completion photo — same bucket, same policies, same
public URLs. There is deliberately no separate avatars bucket: a second
one is a second set of storage policies to keep in step, for a single
file per account.

**Unlike a completion photo it is refused rather than inlined.**
Everything else falls back to base64 when the bucket is missing or the
device is offline (see **Media**), and that is wrong here: this image
is read back on *every message in every conversation*, so a
quarter-megabyte data URL sitting on the `Users` row would be pulled
down and re-parsed constantly. `avatarsReady()` is `_avatarReady &&
storageReady()`, and the control simply does not appear otherwise.

**Reading somebody else's is an RPC, not a join, and that is the whole
design.** `profiles.sql` deliberately does not let a signed-in user
`select` anybody else's `Users` row — that would turn a private table
into a directory of every account on the project, searchable by name
and handle. That decision stands. So `collection_avatars(cid)` in
`supabase/avatars.sql` narrows the disclosure to exactly what the
Messages tab needs: given a collection you are actually in, the avatars
of the people also in it, and **only** the id and the photo — no email,
no handle, no display name (the message already carries a snapshot of
that). Scoped by `can_use_collection()`, the same helper every messages
policy uses.

Three properties worth keeping:

- **One RPC per conversation, not one per message.** The map is fetched
  when the conversation opens and cached for the session, keyed by
  collection — so forty messages cost one request and paging backwards
  costs none.
- **It never blocks the messages.** The thread paints from
  `sender_name`, which is a snapshot on every row, and repaints when
  the photos land. A face arriving a moment after the words is
  invisible; a conversation that waits on it is not.
- **A miss is silence.** No migration, no RPC, an error, or a person
  who never set one: the tinted initial disc that was there before is
  drawn instead, at the same size, so a run of messages from someone
  with a photo and someone without still lines up.

**A deleted account keeps its grey mark even when a photo is known.**
That rule outranks showing the picture, for the reason in the section
above: a name with no account behind it must not look like every other
name.

`invalidateAvatars()` is called when the user changes their own photo —
they are in every conversation the map covers — and from
`resetMessagesState()`, so the map cannot outlive the account it was
fetched for. Removing a photo does **not** delete the object from
storage, matching what removing a completion photo does; the sweeper
query at the bottom of `storage.sql` covers both.

##### Things to keep

- **Sending goes through `dbInsert`**, not `sb.from().insert()`, so a
  message written in a tunnel is queued and replayed like any other
  write. `applyOp()` ignores tables it does not cache, which is exactly
  right — messages are not in the snapshot.
- **`resetMessagesState()` is called from `resetAccountState()`** and
  clears the hub cache, the badge, `curConvId` *and the live channel*,
  which is subscribed under the previous session's token. See **One
  account at a time**.
- **The tab is in the markup but hidden** until `probeMessages()`
  answers true (`applyMessagesAvailability`). `TAB_ORDER` therefore has
  a companion, **`visibleTabs()`**, which is what the swipe gesture
  reads — a hidden tab must not be a dead stop in the middle of the
  bar.
- **`nav()` sets `backTab` when one pushed screen opens another owned
  by a different tab.** The conversation's ⋯ menu opens the collection
  it belongs to, and Back from there has to return to Messages; the
  detail screen's back label reads `backTab` rather than saying
  "Lists" unconditionally.
- **Anything that changes membership calls `refreshConversations()`**
  (join, leave, remove), because membership decides which lists have a
  conversation at all.

##### Notifying a conversation

**Immediate, and not on a schedule.** The two are different problems
and it is worth stating why, because conflating them is the mistake
that was made once in this file:

- A **reminder** is *"tell me on March 3rd."* Nothing happens on March
  3rd — no user acts, no row is written — so something has to wake up
  and check the calendar. That is the *only* thing a schedule buys, and
  it does not generalise.
- A **message's** event is the insert itself, so it pushes the moment
  it is sent.

What is genuinely impossible is the *browser* scheduling its own
notification for a future date (Notification Triggers never shipped
past an experiment). A server pushing on an event is ordinary.

**`send-message-push` is called from the client, not from a database
trigger.** `sendMessage()` invokes it after the insert succeeds, via
`notifyMessageSent()`. That buys: no `pg_net`, no trigger to keep in
step with the table, the caller's JWT already in hand so the function
can verify *who* is sending, and a failure that lands in the console
rather than in Postgres logs.

**The client is trusted with a message id and nothing else.** The body,
the sender, the collection and the audience are all read back inside
the function with the service role, and it refuses a message the caller
did not send. Otherwise it would be "here is a payload, deliver it" —
a way to push arbitrary text to arbitrary people with a valid JWT.

The tradeoff, stated plainly: **a message that reaches the table any
other way does not push.** In practice that is the offline queue
replay, which upserts directly — so a message written in a tunnel syncs
silently. Accepted rather than fixed; the alternative is the trigger.

Everything else follows the shape `send-reminders` already arrived at:
the audience is the owner plus every `collection_members` row, the
sender is dropped from it, and 404/410 endpoints are pruned.

**Muting is per person per list** (`conversation_prefs`, read only by
the function). It stops the push and nothing else — the conversation
still appears on the hub with its unread count, because a mute that
also hid the list would be a way to lose one.

**Tapping the notification has two entirely different paths**, and both
are needed: the app already running is reached by a `postMessage` from
`sw.js` (there is no URL routing here, so there is nothing to navigate
to), and a cold start opens `?conv=<id>`, which `readPushLanding()`
reads at boot. That reader follows `readEmailConfirmation()`'s pattern
— it strips only its own key and puts the rest of the query string
back — so it can run ahead of the two readers that blank the search
string wholesale. An invite link followed to a message notification
would otherwise lose one of the two.

##### The conversation is the app's second full-height screen

`.page-conv` drops the `.page` padding the way `.page-map` does, and
for a related reason: it owns its own scrolling. The history scrolls
inside `.conv-scroll`, pinned between the nav bar and a docked
composer, so the newest message and the field you type into are both
always where you left them.

**The nav bar is condensed unconditionally here** (`applyNavCondense()`).
`.navbar-title` is `opacity: 0` until `.condensed`, and this screen has no
large title and never scrolls the window — so the list's name, the only thing
identifying which conversation you are in, was invisible.

The composer is `position: fixed; bottom: var(--chrome-bottom)` and is
**deliberately allowed to ride up with the iOS keyboard** — the exact
behaviour `syncTabbarToKeyboard()` spends real effort undoing for the
tab bar, and correct here for the same reason bottom-anchored sheets
are left alone. The one correction is `syncComposerToKeyboard()`, which
drops the tab-bar clearance once it has been lifted, since the bar is
no longer underneath it.

#### Reporting and blocking

`js/moderation.js` plus `supabase/moderation.sql`. **This exists for App
Store review, and it is the one migration in `supabase/` that is not
really optional** — every other piece of the app degrades to "the
feature is absent", and here the absent feature is the rejection.

Apple's Guideline 1.2 applies the moment an app carries user-generated
content other people can see. Here that is a shared list's name, its
activities, its notes and its conversation. It asks for four things,
and all four are now present:

| Requirement | Where |
| --- | --- |
| Agreement to terms forbidding objectionable content, **before** the account exists | `.auth-agree` under the Create Account button, `Users.terms_accepted_at` |
| A way to report content | A message's ⋯ menu, and a shared list's conversation menu |
| A way to block an abusive user | The same menu, plus You → Safety → Blocked People |
| A stated commitment to act within 24 hours | `legal/terms.html`, and repeated on the report sheet itself |

##### Blocking is a display preference, not a permission

A blocked person's messages stop being drawn **for you**. They are not
removed from the list, they are not told, and nothing about their own
view changes. Three consequences, and each is deliberate:

- **The filtering is client-side**, in `paintConversation()`. A select
  policy would be stronger and would also let an author discover a
  block by watching their own messages vanish for one reader — and the
  messages remain legitimately readable by a member of that list, so
  the block is a preference rather than a permission boundary.
- **It does not eject anybody from a shared list.** That is somebody
  else's list, often the person who invited you both, and quietly
  removing a member on a private decision by a third party is a worse
  surprise than the messages staying. Leaving is one tap away in the ⋯
  menu and is the right control for "I want nothing to do with this".
  `confirmBlockUser()` says both halves in as many words, because
  people expect the first and discover the second later.
- **The read policy is scoped to `blocker_id` alone**, so a blocked
  user cannot query whether they have been blocked. That is what makes
  the silence real rather than cosmetic.

The list is held in memory for the session like every other
per-account cache, read synchronously on every message drawn, and
cleared by `resetAccountState()`. **A cold list filters nothing**,
which is the right failure: drawing a message you meant to hide is
visible and recoverable, whereas holding the conversation behind a
pending request would look like the messages were lost. A *failed*
load is deliberately not cached as empty, the same rule `readRows()`
follows.

##### A report goes one way

`content_reports` has an insert policy and **no select policy at all**
— not even for the reporter. That sounds over-tight and buys the one
property that matters: a report carries a **snapshot** of what was
reported, so a readable report would be a way to retrieve content
after its author deleted it.

The snapshot is why the column exists. A report pointing at a message
id is worthless the moment that message is soft-deleted, which is
exactly what an author does when somebody reports them.

Things to keep:

- **`openReportSheet()` takes a `{kind, id}`, not a message.** A shared
  list's *name* is user-generated content too, and reporting is offered
  on a conversation as a whole as well as on one line of it — a list
  filled with abuse is not well described by reporting its most recent
  message.
- **The block is offered immediately after a report is sent.**
  Somebody who has just reported a person almost always wants to stop
  seeing them, and making them go and find a separate control is the
  gap that reads as "reporting did nothing". A report is answered by a
  human eventually; a block is answered now, which is what they came
  for.
- **Neither is offered on your own message**, and the block is not
  offered when `sender_id` is null — a deleted account has no uid left
  to act on. It can still be *reported*, since the snapshot is the
  point.
- **`reporter_id` and `reported_id` are `on delete set null`, not
  cascade.** Cascading would make deleting your account the way to
  withdraw an accusation you no longer want looked at.

##### There is no moderation UI, and that is stated rather than hidden

The queue is a `select` in the SQL editor, written out at the bottom of
`moderation.sql`. The 24-hour commitment in the terms is a promise that
somebody runs it daily; nothing in the app enforces it.

Acting on a report is a soft delete of the message plus, if it comes to
it, banning the account from the Supabase dashboard. **That ban takes
effect on every device within a JWT lifetime** rather than waiting for
the person to sign out, because `ensureSessionLive()` already asks —
see **Being signed into an account that no longer exists**, which was
built for a different reason and turns out to be the enforcement
mechanism.

##### The agreement

A line, not a checkbox: `applyAuthMode()` shows `#authAgree` in Create
Account mode only. Apple accepts "by continuing you agree" so long as
the terms are reachable before the account is made, and a checkbox is
one more thing standing between somebody and an app they have already
decided to try. The links are the part that matters and they are real
44px targets.

`terms_accepted_at` is a timestamp rather than a boolean, and
**existing accounts are deliberately not backfilled** — writing
`now()` into every row would record an acceptance that never happened.
Null is a legible "this account predates the requirement".
`recordTermsAcceptance()` is called from `createUserProfile()` and
never awaited: a failure there must not be why somebody cannot finish
signing up, and the acceptance itself happened in the UI.

#### Notes on an activity

`js/notes.js` plus the `activity_notes` table in the same migration, so
`notesReady()` is `messagesReady()`.

**This is not the old Notes field coming back.** That field asked "why
is this on your list?" at the moment of capture, which is the wrong
question at the wrong time — the answer is the activity's name — and it
sat empty on nearly every row. That argument still holds and the
paragraph explaining it should not be deleted from this file.

This is a different thing with a different reason. Once a list is
shared, notes are the **working state of a plan several people are
making**: "we settled on the 14th", "Sarah is booking the car", "the
permit window opens in March". A collaboration artifact, written after
the activity exists rather than while it is being created.

##### Append-only, and that is the whole design

The app is last-write-wins with no presence, which is fine for a
library one person curates and exactly wrong for a field two people
might edit during one conversation — one of them would silently lose
what they wrote.

So a note is a **row**: attributed, timestamped, never rewritten. Two
people adding at the same moment both succeed, because they are not
writing to the same place. There is deliberately **no UPDATE policy**
on the table. A wrong entry is removed and another added.

**This is also why the log is not a JSON column.** `Activities.description`
is dead and unused and would have needed no migration at all — and
stuffing the log into it would have re-created the exact
last-write-wins field the log exists to replace. `description` stays
dead; see **Back end**.

##### Where it appears

- **The activity detail sheet's Notes tab** carries the log and its
  composer, and only on a *pending* activity. On a shared list this is the working state
  of the plan, which is why somebody opened the activity at all;
  location and links are reference and go below it. It is rendered into
  a **placeholder** and filled in behind the sheet, because it is a
  round trip and nothing else on that sheet should wait for it.
- **The new/edit activity sheet** has a Notes field above Links, which
  writes the log's **first entry**. It is written *after* the activity
  and deliberately not as part of that write — they are different rows
  in different tables, and a note that fails must not take the activity
  down with it. The field is always empty, including on an edit:
  filling it with existing entries would invite them to be rewritten,
  which is the one thing a log must not allow.
- **A message's ⋯ menu offers "Add to activity notes"**, which is the
  reason the whole thing is worth building. A decision reached in the
  conversation — *"ok, the 14th then"* — is exactly what should end up
  on the activity, and the alternative is reading the message, opening
  the activity and retyping it. The entry is attributed to **whoever
  filed it**, not to the original sender: they wrote a message, not a
  note, and promoting it was somebody else's decision.

Removing an entry is the author's own, or the owner's of the list the
activity is homed in — the moderation floor a shared space needs, via
`owns_activity_collection()`. RLS decides; the buttons here only draw.

#### The immersive map

The Map tab is full bleed: `.page-map` drops all padding and the map
container is `position:absolute; inset:0`, so it runs under both bars. Every
control floats on top of it — a glass filter pill, a place count, and two
round buttons — rather than being laid out around it.

**It is MapLibre GL, not Leaflet.** That swap was the point: Leaflet is a
DOM/raster map that cannot draw a globe and repositions hundreds of nodes on
every pan. MapLibre renders on the GPU and has a real globe projection, so
zoomed out you get the Earth as a sphere and it eases into flat web-mercator
as you zoom in — the Google Earth behaviour. Things worth knowing:

- **`projection:{type:'globe'}` must be set in the *style*.** Passing it only
  as a `Map` option silently does nothing in v5.
- **The style has no `glyphs` endpoint**, so it cannot contain a `symbol`
  layer with a `text-field` — adding one throws inside the `load` handler and
  leaves the map with no data source at all. That is why cluster bubbles are
  DOM markers (`makeClusterEl`) rather than a GPU symbol layer. Clustering
  itself still happens in MapLibre's worker; only the handful of visible
  bubbles and pins are DOM.
- **In globe projection MapLibre paints nothing outside the sphere**, so the
  sky is a CSS gradient on `#globalMapContainer`, not a map layer.
- **There are no DOM markers.** Pins and cluster bubbles are drawn into
  canvases, registered with `map.addImage()`, and rendered by `symbol` layers,
  so they are composited in the same GPU pass as the map. They started as
  `maplibregl.Marker` elements, which JavaScript repositions once per frame —
  that can never stay in step with a GPU-composited map, and the pins visibly
  swam against the terrain during a pan. The MARKER ICONS section of `map.js`
  is entirely about keeping them welded to the map.
- Because cluster properties are generated by MapLibre, cluster icons are
  selected by the `CLUSTER_ICON_EXPR` expression and the matching images are
  registered on demand as counts appear. Point icons are stamped onto the
  GeoJSON as `_icon` instead, since we own that data.
- Photo pins decode asynchronously and fall back to a dot until ready.
  **⚠️ They need CORS headers on the media host** — reading a canvas back
  taints it otherwise. That note used to say the app's own photos were
  base64 data URLs so only remote covers were affected; media moved to
  R2 and it is now every pin. See the CORS bullet under **Media**.
- **MapLibre's errors are collapsed by cause, not logged per tile**
  (`attachMapErrorLog()`). A basemap refusing every request produced a
  wall of identical stack traces, none of which said why — the 403 body
  (`Key usage restricted`) never reached the console. Attaching an
  `error` listener is also what suppresses MapLibre's own logging, so
  anything unrecognised is re-logged in full. Do not turn it into a
  silent catch.
- **`globeFillZoom()`** computes the zoom at which the globe just fills the
  viewport (the sphere is ~211px across at zoom 0 and doubles per level) and
  is used as the map's `minZoom` and as a floor on `fitGlobal()`. Without it
  you can zoom out to a tiny marble adrift in space, which reads as broken.
  `refreshMapZoomFloors()` recomputes it on resize/rotate.
- **The globe is kept alive across navigation.** `nav()` tears down only
  the collection map. Rebuilding the globe on every visit meant
  re-downloading the style, re-fetching tiles and re-spinning it up,
  which was most of what made this tab feel slow; keeping it leaves at
  most two live WebGL contexts, an order of magnitude under what
  browsers cap. Because a hidden container measures 0,
  `renderGlobalMap()` resizes on the way back in, `globeFillZoom()`
  floors at 0 rather than returning `-Infinity`, and
  `refreshMapZoomFloors()` skips a map that is not on screen.
  `destroyGlobalMap()` still exists and is called on sign-out.
- **Build the map and fetch the data at the same time.**
  `renderGlobalMap()` starts the query, then builds the map without
  awaiting it, and joins the two with `Promise.all`. It also used to call
  `updateGlobalMapMarkers()` on load, which refetched every activity —
  photos included — purely to filter a list it was already holding.
- `webglOK()` degrades to a message rather than a blank rectangle.

The per-collection map inside the detail screen uses the same code but stays
flat — at one collection's scale a globe is unhelpful.

#### Several activities at one point

A pin is a **place**, and a place holds as many activities as you file
there — Home most of all, which collects every chore you will ever have.
That case was unreachable: clustering stopped at zoom 13, so past it every
activity drew its own pin, five activities at one address were five pins on
one pixel, and a tap opened whichever happened to be on top. The rest were
in the database and reachable from nowhere — the same failure the
"an activity must always be in at least one list" rule exists to prevent,
arrived at from the other direction.

Two halves, and neither works without the other.

**Clustering now runs at every zoom** — `clusterMaxZoom` is the map's own
`maxZoom` rather than 13. `clusterRadius` is in *screen pixels* (56, about a
pin's width), so "clustered" means "these pins would be drawn on top of each
other", which is true at street level exactly when it is true: anything
genuinely metres apart separates on its own as you zoom, and only the
coincident ones stay bundled. A stack is therefore always **one bubble
carrying its count**, never N pins pretending to be one.

**And a bubble that zooming cannot split opens the place sheet**
(`openPlaceSheet()`), which is the half that was missing: the list of what is
actually there. `#placeSheet` shows the place's name, a count, and one
`.act-row` per activity — the same row the collection screen uses, so a
completed one is struck through and the priority rail runs down its edge for
free — pending first in Up Next's order, then completed most-recent-first.

Things to keep:

- **"Same place" is read off the cluster, not from a leaf query.**
  `actsToGeoJSON()` stamps each point's own `x`/`y` into its properties and
  the source aggregates `min`/`max` of them into every cluster
  (`clusterProperties`), so `samePlaceCluster()` answers from the feature that
  was tapped, with no round trip. A cluster's own geometry is the *average* of
  its children and says nothing about how far apart they are.
- **That test is available at draw time too**, which is what lets a stacked
  cluster be drawn as a stack — `CLUSTER_STACKED` selects the `-s` icon
  variant, a second disc peeking out behind the first. It has to look
  different, because it *behaves* differently: an identical-looking control
  that zooms in one case and opens a sheet in the other is the kind of thing
  people learn as "the map is flaky".
- **The expansion-zoom check stays as the belt to that brace.** If
  `getClusterExpansionZoom()` comes back past the map's `maxZoom`, zooming
  cannot help whatever the bounding box says, and the sheet opens anyway.
- **`SAME_PLACE_DEG` (0.00022°, ~25m) is not the interesting number.**
  Coordinates picked from the same search result — or from the Home shortcut —
  are *identical*, so this only absorbs the case where one address was
  geocoded twice and came back a few metres apart.
- **The sheet lists what the map is showing**, not what the database holds:
  the activities come from `state.byId`, rebuilt beside the layer data, so the
  Map tab's To Go / Done filter and the collection map's search are already
  applied. `setLayerData()` must keep that index in step.
- **Its rows close the sheet before opening anything.** `#placeSheet` is
  later in `index.html` than the activity and completion sheets, so an overlay
  opened on top of it would render *underneath* it — and `onSheetClose()` is
  not the answer either: the activity sheet has half a dozen buttons that
  close themselves in order to open something else, and a return registered
  here would resurrect this sheet on top of every one of them. Tapping the pin
  again is the way back, and it costs one tap.

#### Staying signed in

Being asked to log in again is the failure users notice most, so the boot path
is defensive about it. `restoreSession()` in `main.js` handles three separate
causes, and they need different answers:

1. **The access token lapsed while the app was closed.** `getSession()` usually
   refreshes it; if that call fails we retry with `refreshSession()` before
   giving up.
2. **The device is offline at launch.** A network failure is *not* a signed-out
   user. If a session is on disk and `navigator.onLine` is false, the app opens
   anyway and the offline banner explains the missing data. Signing someone out
   because their train went into a tunnel is the worst version of this bug.
3. **The refresh timer stalled while backgrounded.** Handled in `auth.js` — see
   its row in the JS map.

The opposite failure — staying signed in when you should *not* be — is
`ensureSessionLive()`; see **Being signed into an account that no longer
exists**.

Supporting pieces: `config.js` spells out the auth options rather than relying
on defaults (and pins `storageKey`, so a supabase-js upgrade cannot silently
sign everyone out by changing it), and `body.booting` shows a splash until the
restore resolves, so a slow connection never flashes the login screen at
someone who is already signed in.

Worth knowing: **an installed PWA has its own storage partition on iOS**, so
signing in inside Safari and then installing to the home screen means signing
in once more. That is the platform, not a bug.

#### Being signed into an account that no longer exists

**This shipped, and it is the other half of staying signed in: a stored
session is not proof the account behind it still exists.** Deleting an account
signs out the device that pressed the button and nothing else — and there is
always something else. Another browser, a laptop, and on iOS the installed
PWA, which by the note above is a second signed-in copy of the app by
construction.

Nothing ever asked the server about any of them:

- `getSession()` answers **from disk with no request** while the access token
  has not expired, so `restoreSession()` saw a perfectly good session;
- PostgREST verifies a JWT's **signature**, not that `auth.uid()` still exists
  in `auth.users`. The token kept being accepted, and reads came back empty
  because the rows had cascaded away — which is indistinguishable from an
  account with nothing in it.

So the app opened as a deleted account for the lifetime of an access token.
It was found by following an invite link into one, and everything downstream
then failed pointing anywhere but here: `peek_invite` succeeded (the JWT is
signed, and it is granted to `anon` regardless), the sheet opened, the invite
was consumed, and only `join_collection()` failed — on a foreign key onto
`auth.users` — reading on screen as *"that invite link isn't valid"* for a
link that was perfectly good.

`ensureSessionLive()`/`verifyLiveUser()` in `auth.js` ask once per launch, via
`sb.auth.getUser()` — a real request to `/auth/v1/user`, which 4xxs for a user
that has been deleted or banned. Four things about it:

- **It never blocks the first paint.** `main.js` starts it and does not await
  it. The two things that must not run against a dead session —
  `handlePendingJoin()` and `claimInvitesForMe()` — await it themselves, and
  `handlePendingJoin()` does so **before** it takes the code out of the global,
  so a rejected session cannot consume an invite.
- **Only a definitive answer signs anyone out** (`authAnswerIsDefinitive`). A
  request that never arrived is not an answer; nor is a 429 or a 408. This is
  the same rule `restoreSession()` follows for the same reason, and getting it
  wrong here would be a worse bug than the one it fixes.
- **It runs at every moment a device could act, not only at launch.** The
  launch check alone leaves an app that is *already open* running as a deleted
  account until somebody closes it, and an installed PWA is rarely killed —
  "the next launch" can be days away. So `recheckSessionSoon()` is also called
  on foreground, on the network returning, every five minutes while the app is
  on screen (`startSessionWatch`), and — the one that matters most — **when
  the server rejects a write**, in all three of `dbInsert`/`dbUpdate`/
  `dbDelete`. That last one means the first thing the user tries to *do* in a
  deleted account throws them out, rather than the next tick. They share one
  30-second throttle, so a run of failing writes is one question and not one
  each: eight rejected writes cost exactly one `getUser`.
- **`signOutStaleSession()` is `handleSignOut()` minus everything needing a
  working session** — no server-side revoke, no push unsubscribe, both of
  which would only 4xx. It keeps `pendingJoin`, so the invite that exposed
  this survives to the sign-in screen it lands on.

**Signing out everywhere is two halves, and only one of them is a server's to
do.** `delete-account` now calls `admin.signOut(jwt, 'global')` before
`deleteUser`, which revokes every refresh token the account holds on every
device — so no other copy of the app can ever *renew*. (Deleting the user
cascades those rows anyway; being explicit is belt to that brace, and it is
placed after the failure check so a half-failed deletion cannot sign the
caller out of an account that is still alive.)

What no server can do is revoke an **access token that has already been
issued**: they are stateless signed JWTs, verified by signature alone, with
nothing consulted while one is inside its lifetime. That residual window is
what the client checks above close, and **its size is the project's JWT
expiry setting** — Authentication → Sessions → *Access token (JWT) expiry*,
3600s by default. Lowering it shortens the worst case for anything that never
opens the app at all; it is the one lever on this that is not code.

#### One account at a time

**This is a security boundary and it shipped broken once. Read this
before touching anything that runs at sign-in.**

Every cache in the app is per-account: the two row caches in `api.js`,
`userProfile`, `_sharedIds`, the live WebGL maps, and the navigation
state. All of them were cleared in `handleSignOut()` **and nowhere
else**, so any sign-in that followed a session ending some *other* way
was served the previous account's rows out of memory. Creating a new
account was the worst case rather than the safest: a new account has no
disk snapshot, so `primeFromSnapshot()` returned false, so `showApp()`'s
`if(warm)` skipped the `revalidate()` that would eventually have
corrected it — and the new account saw the old one's lists, activities,
notes and photos for the entire session.

**Do not repeat the mistake that was made when this was diagnosed.**
It was written up as "client-side only — RLS still refuses every
write", on the strength of an unauthenticated probe coming back empty.
That was wrong. Three `to authenticated ... using (true)` policies were
sitting on `Collections`, `Activities` and `Users`, OR'd over every
correct `bl_*` policy, so the account really did have full read, write
and delete on everyone's data. They granted nothing to a logged-out
request, which is exactly why the probe looked clean.

An anonymous request cannot tell you a project is scoped. Only
`pg_policies` can. See `supabase/rls-lockdown.sql`.

Two mechanisms now, and **both should stay** — they fail differently:

1. **`cacheOwnerCheck()` in `api.js`** is the structural one. The cache
   records whose rows it holds, and every entry point that can read or
   fill it — `fetchCollections`, `fetchAllActivities`, `cacheWarm`,
   `cachedCollections`/`cachedActivities`, `primeCollections`/
   `primeActivities`, `primeFromSnapshot` — calls it first. A mismatch
   wipes the cache rather than answering. It lives beside the cache
   deliberately: anything else relies on every present *and future*
   sign-in path remembering to clear it, which is exactly what failed.
   **A new cache read must call it.**
2. **`resetAccountState()` in `auth.js`** clears the per-account state
   in the other files, which the cache guard cannot see. It runs on
   every auth transition in both directions — `handleSignOut()`, both
   success paths in `handleAuth()`, the `SIGNED_OUT` branch of
   `onAuthStateChange`, and the branch where a *different* user's
   session arrives on an existing page.

Two things `resetAccountState()` deliberately does **not** touch:

- **The disk snapshot.** It is keyed by user id already (`snapKey()` in
  `offline.js`), so it cannot leak, and a session lapsing in a tunnel
  is not a reason to destroy someone's offline copy of their own data.
  Explicit sign-out still clears it.
- **`probeStorage()` / `probeRemindColumn()`.** Facts about the
  database, identical for everyone. `probeSharing()` *is* reset, only
  because `_sharedIds` beside it is per-user.

**The offline write queue is one shared store**, unlike the snapshot,
so `queueWrite()` stamps each op with `uid`. `flushQueue()` skips ops
belonging to anyone else — not replaying them and, importantly, not
dropping them either: they belong to an account that may well sign back
in, and RLS would reject every one under this session. `queueLoadCount()`
counts only the signed-in user's, so the banner never reports someone
else's stranded writes. Ops with no `uid` predate the field and are
treated as the current user's.

#### Deleting an account

`supabase/functions/delete-account` plus `openDeleteAccount()` in
`me.js`. It has to be a function because removing the row from
`auth.users` needs the `service_role` key, which must never reach a
browser.

**The uid comes from verifying the caller's own JWT, never from the
request body**, and there must never be a "delete user X" parameter:
this runs as `service_role`, so a uid taken from the body would let any
signed-in user erase anybody.

Order matters. `auth.users` goes **last** — several tables reference it
with `on delete cascade`, so removing it first would pull rows out from
under the deletes still to run, and a failure after that point would
leave an account that cannot sign in but still owns data. If any earlier
step fails the function stops short and reports, leaving the account
intact and the call re-runnable.

What survives: a shared list the caller *joined* is only left, and the
other members keep it. A list the caller *owns* and has shared is
deleted for everyone on it — there is nobody to hand ownership to
without asking. The sheet says both in as many words.

**Nothing the caller leaves behind may break for anybody else**, and
that is harder than deleting their rows, because three things belonging
to them are pointed at from lists that do not:

- **Media.** `mediaKey()` in `media.js` keys the storage folder by the
  *uploader*, `${uid}/…`, whichever list the photo lands on. So a photo
  attached to an activity in a list the caller merely **joined** is
  stored under the caller and shown to everyone else on that list.
  Deleting the folder wholesale blanked those photos for the other
  members — the exact thing this must not do. `mediaStillInUse()` now
  reads the surviving activities in the lists the caller joined (read
  from `collection_members` **before** those rows go, which is why that
  is step 0 and why a failure there is fatal rather than tolerated),
  collects every URL under `/${uid}/`, and deletes only the rest of the
  folder. **The bias is always toward keeping**: a file wrongly kept
  costs kilobytes, a file wrongly deleted costs somebody else a photo.
  If the question cannot be answered at all, the whole folder stays.
- **List links.** An activity homed in someone else's list can carry one
  of the caller's collections in the retired `extra_collection_ids`.
  `unlinkDeletedCollections()` strips those out after the collections go,
  rather than leaving a dangling id on another person's row.
- **Claimed invites.** `invite_claims` is keyed by email address, so it
  outlives the account unless it is deleted by hand. It now is, by both
  `claimed_by` and the lower-cased address.

Three things are deliberately *not* touched, and all three are how the
guarantee is met rather than exceptions to it: an activity the caller
added to somebody else's list is homed there, so it is never in the
delete set; the completion notes and photos on it go with it; and a
reminder they set on a shared activity stays, because `remind_at` is a
column on the activity and the reminder belongs to the list. Invites are
only creatable by a list's owner (the RLS insert policy checks
`owns_collection`), so deleting the caller's `collection_invites` rows
cannot revoke a link anybody else depends on.

The one gap left: a list the caller was removed from, or left, before
deleting their account is not knowable from `collection_members`, so
media they uploaded there is deleted with the folder. That is the same
orphan problem as the sweeper comment at the bottom of `storage.sql`,
pointed the other way.

**It is the one place in the app that makes you type something.** Every
other destructive action is a single action sheet, which is right when
the cost is one list; this ends the account with no undo, and an action
sheet is dismissed by a stray tap on the scrim. The button stays
disabled until the word matches, so the tap that destroys the account
cannot be the same reflex tap that opened the sheet. The local sign-out
only happens *after* the server confirms, or a failure would look like
success.

#### Signing up

**This project has email confirmation switched on** (`mailer_autoconfirm` is
false — check with `GET /auth/v1/settings`), which means `signUp()` returns a
user and **no session**. That single fact broke profile creation for every
account made here: `handleAuth()` wrote the `Users` row inline right after
`signUp`, which can only work with a session, so the name and username the
person had just typed were dropped and no row was ever created. They
confirmed their email, signed in, and had no name in the You tab and nothing
to be identified by on a shared list.

The fix has two halves and both should stay:

- **The values ride on the auth user.** `signUp()` passes them as
  `options.data`, so they survive the round trip through the confirmation
  email — including the common case where it is opened on a different
  device from the one that signed up.
- **`loadUserProfile()` creates the row when it is missing**, via
  `createUserProfile()`. Running on every sign-in rather than only after
  sign-up is deliberate: it also repairs accounts created while this was
  broken. Username collisions are an expected outcome there, not an error —
  it suffixes and retries.

`supabase/profiles.sql` is the server half and the better one: a trigger on
`auth.users` writes the row inside the sign-up transaction, so it exists
whether or not the person ever comes back to confirm. It also carries the
RLS policies on `Users` — without an INSERT policy the client-side fallback
is simply refused — a unique index on `lower(username)`, and a backfill for
the accounts already stranded. **Run it.**

#### Resetting a password

Until this existed a forgotten password was **total account loss** —
there was no way to ask for a link and no screen to set a new one.

It is built out of the confirmation machinery rather than beside it,
because it is the *same* round trip: out of the app, through a mail
client, very often onto a different device, and back. So it inherits
every floor that section put under that trip — the same boot reader, the
same `verifyOtp()`, the same failure notice, the same per-address
cooldown (`confirmResendAt` is deliberately **shared**, because Supabase
rate-limits per address across both and two independent cooldowns would
only manufacture a failure), and the same rate-limit wording from
`authErrorText()`.

Two halves:

- **Asking.** *Forgot password?* under the Sign In button →
  `requestPasswordReset()` → `sendRecoveryEmail()`. Hidden in Create
  Account mode by `applyAuthMode()`: there is no password to have
  forgotten on an account that does not exist, and the link under a
  Create Account button reads as an invitation to give up before
  starting.
- **Setting.** The link lands, `consumeEmailConfirmation()` redeems it,
  and `showPasswordReset()` draws `#authReset` — the third state of the
  auth screen, after the form and the check-your-email panel.

**A THIRD DASHBOARD TEMPLATE, and it fails the same silent way as the
other two.** Authentication → Emails → **Reset password**:

    {{ .SiteURL }}/index.html?token_hash={{ .TokenHash }}&type=recovery

That is what makes a reset link work on a device other than the one that
asked for it — which here is the *normal* case, because somebody who
cannot get in on their phone will very often go and ask from a laptop.
The default `{{ .ConfirmationURL }}` comes back as `?code=`, and with
PKCE that exchange needs the verifier written to localStorage in the
browser that made the request.

It also carries **`type=recovery`, which is the only thing that tells the
client this landing is a reset**. On the `?code=` path there is nothing
in the URL that says so, so such a link signs the person in and drops
them in the app with their old password unchanged — recoverable, and not
what they asked for. `c.recovery` is read in `readEmailConfirmation()`
and carried through `recoveryLanding` to `main.js`.

Things to keep:

- **The panel is the last step of the reset, not a gate in front of the
  app.** `verifyOtp()` has already established a session by the time it
  is drawn, so a reload from it simply goes in. That is the escape hatch,
  and it is why there is no "skip" button to explain.
- **`confirmFailureHTML()` takes a `recovery` flag**, and it is the whole
  reason the argument exists: offering a *signup confirmation* to
  somebody whose password reset expired sends mail that does nothing, and
  they would have no way to tell. `resendFromNotice(true)` sends the
  right one.
- **The request answers identically whether or not the address has an
  account.** Replying "no such account" would turn the sign-in form into
  a way to test whether any given person has signed up here. Supabase's
  endpoint is silent for the same reason, so there is nothing to report
  even if we wanted to.
- **`PASSWORD_MIN` mirrors a dashboard setting** (Providers → Email →
  minimum password length, 6 by default) and is checked here only to
  avoid spending a round trip on something the server would refuse.
- **The subtitle is the account's email, not an instruction.** On a
  shared device — or for somebody with two addresses here — which account
  is being reset is the one thing worth saying, and it is a fact rather
  than help text.

#### Coming back through the confirmation email

The other half of the same round trip, in the CONFIRMING AN EMAIL ADDRESS
block of `auth.js`. Confirmation takes the person out of the app entirely —
through a mail client, very often onto a different device — so like accepting
an invite it is built with a floor under it rather than one happy path.

**Three of the four things that decide whether the link works are in the
Supabase dashboard, not in this repo**, and every one of them fails
identically from the outside: *"I clicked the link and it opened a broken
page"*.

| Setting | What goes wrong |
| --- | --- |
| **Auth → URL Configuration → Site URL** | Left at the Supabase default it is `http://localhost:3000`, so every recipient lands on a dead page. This is where the link goes. |
| **Auth → URL Configuration → Redirect URLs** | `emailRedirectTo` does **not** override Site URL on its own. Supabase silently ignores a redirect that is not allow-listed and falls back — which is exactly how the setting above hides. The app's real origin has to be listed before `confirmRedirectUrl()` has any effect at all. |
| **Auth → Emails → Confirm signup** | Should be `{{ .SiteURL }}/index.html?token_hash={{ .TokenHash }}&type=email`. |
| **Auth → Emails → Reset password** | The same shape with `type=recovery`. See **Resetting a password** — `type` is the only thing that tells the client a landing is a reset rather than a confirmation. |

**That template is what makes the link work on a device other than the one
that signed up**, which is the common case — people sign up on a laptop and
read their mail on a phone. `config.js` sets `flowType:'pkce'`, so the default
`{{ .ConfirmationURL }}` comes back as `?code=…`, and redeeming that code
needs the verifier `signUp()` wrote to **localStorage in the original
browser**. Anywhere else the exchange fails with *"both auth code and code
verifier should be non-empty"* and the recipient lands on the sign-in screen
having apparently done nothing. `verifyOtp()` carries no such requirement.
The `?code=` branch is still handled, for links already sitting in inboxes.

`detectSessionInUrl` is **off**, and it is the one auth option in `config.js`
that is not the default. supabase-js reads the URL inside `createClient()` —
before any of the app's own code has run — so the landing would be consumed by
a background promise nothing can await, racing the boot sequence and reporting
its failures only to the console. `consumeEmailConfirmation()` does it
explicitly instead, in a known order and with somewhere to show the answer.

Things to keep:

- **`readEmailConfirmation()` runs FIRST of the boot readers**
  (`main.js`). It and `readPushLanding()` remove only their own keys and put
  the rest of the query string back; `readPendingJoin()` blanks the search
  string wholesale once it has taken what it came for, which is why it runs
  last. Reading it last
  looked equivalent and was not — an invite link followed to a sign-up puts
  `?join=` and the confirmation keys on one URL, and the join reader took the
  confirmation down with it, silently.
- **The confirmation is tried before the stored session** (`main.js`). Both
  orders matter: someone confirming on a second device has no stored session
  to find, and someone confirming on the first has a stale one — same account,
  issued before the address was verified.
- **Every failure ends in the same offer**, because every one is fixed the
  same way: send another link. `confirmFailureHTML()` names *which* failure
  (expired, already used, wrong device) and then draws one button. An expired
  link with no way to get another is the same dead end the link itself was.
- **A sign-up that has to be confirmed swaps the form out for
  `#authCheck`** — `setAuthView()`. Leaving a filled-in Create Account button
  on screen only earns "user already registered" when it is pressed again.
  `applyAuthMode()` was split out of `toggleAuthMode()` so coming back can
  *restore* a mode rather than invert the flag underneath it.
- **An already-registered email is caught.** Supabase deliberately returns a
  user and no session for one, so `signUp()` cannot be used to test whether
  someone has an account here; the only tell is an empty `identities` array.
  Without that check the person waits for an email that was never sent.
- **The resend cooldown is not politeness.** Supabase rate-limits per address,
  and a second press inside the window returns an error that reads as though
  the resend itself failed.

#### Sorting a collection

`ACT_SORTS` and `sortActivities()` in `utils.js`, the control in
`sortButtonHTML()` (`detail.js`), the menu in `openSortMenu()`/`setSort()`
(`activities.js`). Five orders: **Date added** (the default, newest first),
**Target date**, **Date completed**, **Difficulty** (easiest first — see
**Guessing how hard it is**) and **Distance from home** (nearest first — see
**How far away it is**).

**Every reader normalises through `normSortKey()`.** Distance is the one
order that can stop being available — it needs a Home to measure from, and
Home can be cleared from the You tab while a collection is sitting sorted by
it. Left alone, `curSort` would keep naming an order that silently degraded
to "everything is equally far away", which is `createdAt` wearing a different
label. The button, the menu and the list all ask `normSortKey()` what is
actually being applied, so they cannot disagree.

**The control is a compact button beside the filter, not a fourth segment.**
The segments answer "which subset"; sort answers "in what order", and four
segments across a 320px phone leaves each one too narrow to read. It carries
the current order as a label so the screen says how it is sorted without being
opened, goes tinted on anything but the default, and below 375px drops to the
glyph alone — the same trade `responsive.css` already makes for the collection
name on an Up Next row.

Two rules every comparator shares, and both are load-bearing:

- **A finished activity sorts to the end of an unfinished order and vice
  versa.** Ordering by target date puts what to do next in front of you, and
  something already done has no next; ordering by completion date, a row with
  no completion has nothing to be ordered by at all.
- **Every comparator ends in a total order**, falling through to `createdAt`.
  Without that the many rows sharing a preset band — every "This Year"
  resolves to the same 31 December — come out in array order and visibly
  shuffle between renders of the same list.

`sortActivities()` sorts a **copy**: its input comes straight out of the
shared activity cache, and sorting in place would reorder it for every other
screen reading it.

`curSort` persists for the session rather than resetting on entry, matching
`curFilter` and unlike `curView`. Filter and sort sit on the same control row,
and having one of the two forget itself between visits reads as a bug.
`setSort()` redraws only the button and the list, never the whole control
block, for the same reason `renderDetail()` and `renderActivitiesList()` are
separate — rebuilding the search field would drop focus.

#### Target dates

Opening a collection always resets `curView` to `list`. It is keyed on
*entering* the detail screen rather than on the collection id, so re-opening
the one you just left resets too — the view mode is a per-visit choice, not a
saved preference.

`Activities.target_date` is a **text** column holding one of two kinds of
value, and code that reads it must handle both:

- a **preset band** — `This Month`, `This Year`, `Next Year`, `In 2-4 Years`,
  `In 5+ Years`;
- an **ISO date** the user picked — `2026-12-25`.

Because the column is text, adding real dates needed no schema change.
`isCustomDate()` tells them apart and `presetTargetDate()` resolves a band to
the end of its window, so `dateInfo()` and `daysToTarget()` can treat both
uniformly.

##### A band is resolved on the way in, not on the way out

**A band is a relative label and `target_date` is an absolute field, so
storing the string stored a promise that decays.** "Next Year" picked in 2026
means 2027 — but the client resolved it again on every read, so in 2027 the
same row read as 2028. The deadline the user set once quietly moved every
January, forever.

The fix is **not** a scheduled job rewriting rows, which would be a yearly
sweep that can never be allowed to miss. `resolveTargetDate()` (`utils.js`)
resolves a band to the date it means **at the moment it is saved** and stores
that; `targetBand()` already derives the label back from a real date, so a row
stored as `2027-12-31` *becomes* "This year" the instant 2027 begins — on every
device, with nothing scheduled. Four bands resolve: This Month, This Year,
Next Year, In 2-4 Years (to the far edge, +4).

**`In 2-3 Years` is retired and deliberately still recognised.** It was
renamed to `In 2-4 Years`; `RESOLVING_BANDS` drops the old name so
nothing writes it again, while `presetTargetDate()` and `OPEN_BANDS`
keep it so a row written under it still resolves and still reads as
something. No migration is needed and none should be written: dates
resolved under the old +3 rule land inside the new band's window
anyway, and `target_date` is free text with no constraint.
`supabase/target-rollover.sql` names the old band because it ran before
the rename — its literals describe rows already converted and must not
be "corrected". **`supabase/target-band-2-4.sql` moves the rows filed
under the old band out by a year** — `2029-12-31` → `2030-12-31` — plus
any surviving literals. The window moved, so its contents move with it.
It matches on intervals off `date_trunc('year', now())` rather than
literal dates, so it reads as what it means; run it in the same year the
old band was last resolved in, or replace the intervals with the dates
you actually mean. An activity whose owner picked `2029-12-31` by hand
moves too — nothing in the column separates the two.

**`In 5+ Years` is deliberately not resolved.** It names no deadline at all —
it resolves to +5 only so it can be sorted and grouped, which is exactly why
`OPEN_BANDS` refuses to count it down — so pinning it to a date would invent
the fact the band exists to avoid stating. It stays a literal string forever,
and `OPEN_BANDS` keeps its `In 2-3 Years` entry too, for rows written before
this.

Things to keep:

- **Every write path calls it, no read path does.** `readTargetDate()`
  (`activities.js`) is the only one, now that the bulk sheet is gone.
  Resolving on read is the bug this replaced.
- **`isoLocal()`, never `toISOString()`.** The latter converts to UTC first, so
  local midnight on 31 December comes back as the 30th anywhere east of
  Greenwich and every band resolves a day early.
- **`bandForStored()` is the reverse, and only the two target pickers on
  an existing row use it** (`openTargetMenu()` and `openTargetSheet()`).
  A stored date that is *exactly* what a band resolves to today reads back
  as that band rather than as a specific date.
  The match has to be exact, or a date the user genuinely picked would be
  snapped to the end of its band on the next save — and because it is exact,
  re-saving an untouched row writes back the identical value.
- **The band you picked stops being the band you see, and that is the
  feature.** Choose "Next year" in December 2026, reopen in January 2027, and
  it reads "This year". It will be reported as a bug; it is not.
- **The resolved date is backend truth and is not read back at the user.**
  Past the end of next year `dateInfo()` shows the band — *2-3yrs*, *5yrs*,
  the `OPEN_BANDS` labels — not *Dec 31, 2029*, which states a precision
  nobody chose. So a resolved row and a legacy unresolved one read
  identically, and the row still rolls: from 2028 that same date is inside
  next year and starts showing as a date again.
- The consequence, since the stored value is identical by design: a date the
  user genuinely picked more than two years out also reads as a band. There is
  nothing left in the column to tell the two apart.
- **`supabase/target-rollover.sql` migrates existing rows**, resolving from
  *today* rather than each row's `created_at` — so it writes exactly the date
  the app is already showing and nothing on screen changes. Its header explains
  the other reading and how to take it. In the sheet the two are one control: a `__custom__` sentinel option
reveals the date field, and `readTargetDate()` collapses select + field back
into the single value that gets stored. The sentinel is never written.

A specific date counts down while it is close and then shows the date itself —
once something is months out, "Dec 25" is more use than "184 days left".

**Bands that name a range or an open end never count down.** `OPEN_BANDS` in
`utils.js` holds `In 2-3 Years` and `In 5+ Years`, and `dateInfo()` returns
their label as-is. Counting down to one states something the user never said:
`In 5+ Years` has no cutoff at all — it resolves to +5 years only so it can be
sorted and bucketed — so rendering it as "5 years left" invents a deadline.
The labels are the same strings `targetBand()` uses for its group headers, so
a row reads identically to the section it sits under. This Month / This Year /
Next Year do close on a real date and keep their countdowns.

**`targetBand()` buckets by the resolved date, not by the band that was
chosen.** That is what lets the two kinds of value interleave correctly on the
Up Next screen: an activity dated 5 September and one set to "This year" both
land under *This year*, and because the band resolves to 31 December the dated
one sorts above it. Grouping and ordering therefore agree by construction —
there is no separate list of rules to keep in step.

"Someday" (`Before I Die`) and "No date" (`''`) were retired from the picker:
both were reachable, one was the default, and anything holding them never
surfaced in Up Next.

They are retired from the *picker*, not from the data. `dateInfo()` still
renders both, because existing rows carry them. **The new-activity sheet
cannot reach one** — it only ever creates, so `addLegacyDateOption()` and
the whole `<select>` it patched are gone with the edit sheet.
`openTargetSheet()` still re-adds a retired value as an option **for that
one activity**, so opening it on an old row and pressing Done cannot
silently rewrite a date nobody touched. Keep that behaviour.

#### Showing priority

`priClass(a)` and `priTagHTML(a)` in `utils.js` are the single source of this,
and every list of activities uses them. **All three levels get the same
treatment — a rail down the row's leading edge and a capsule in the meta line
— and differ only in hue:**

| Priority | Token | Colour |
| --- | --- | --- |
| High | `--pri-high` | terracotta |
| Medium | `--violet` | saturated purple |
| Low | `--slate` | blue-teal |

**High has its own token; it no longer borrows `--tint`.** In light mode the
two hold the same terracotta, which is exactly why the old arrangement looked
harmless — but they agree there by coincidence. `--tint` means "tappable", so
in dark mode it lifts to `#d98f5c` to stay legible as a button on the
near-black, while a high-priority rail wants the full-strength `#9c5a2e` in
both modes. One token could only ever be right for one of them. `--pri-soft`
is separate from `--tint-soft` for the same reason: the priority capsule sits
at `.25`/`.17`, the tinted buttons at `.13`/`.18`. Four places read the
priority tokens — `.tag-high`, `.pri-high::before` and the `.seg-pri` swatch
in `components.css`, and `PRI_VAR` in `map.js`.

**The four activity colours are one palette across both grounds.** Done,
high, medium and low hold the same hexes in light and dark; only the soft
fills change, from `.25` to `.17`. That is a deliberate departure from the
rest of the palette, where every accent is lifted for the dark ground — these
four are separated from their background by the fill strength instead, which
keeps a priority reading as the same colour whichever mode you are in.

**They are separated on chroma as well as hue, and that is deliberate.**
Medium and low were `#8a72b5` and `#4d5a6b` — a muted violet and a muted
slate. Both mid-toned, both cool, both low-chroma, so at 10px inside a
soft tint they read as the same colour twice, which defeats the point of
a three-step scale. Pulling them apart on hue alone was not enough. If
you retune these, check them as capsules at actual size, side by side,
not as swatches.

They are three steps of one scale, so they have to look like it. An earlier
version marked only high, left medium bare and made low recede; that read as
three unrelated things rather than a ranking, and was reverted. **If you touch
this, keep the shape identical across the three and vary only the colour.**

Completed activities show no priority at all — it is about what to do next,
and a finished thing has no next.

**Both sheets pick it from the same action sheet**, whose items carry a
`tone` so all three hues are drawn while you choose:
`openPriorityMenu()` on the detail sheet (which writes) and
`openNewPriorityMenu()` on the new-activity sheet (which stages). The
swatched `.seg-pri` segmented control that used to be on the create
sheet is **gone**, and its CSS with it. Its argument was that a native
`<select>` can show only the level already picked and cannot show its
colour at all — which is true, and is answered better by the chip
itself, since the chip *is* tinted by the value it holds.

The staged value lives in a hidden `#aPri` input so `saveActivity()`
still just reads `$('aPri').value`, which means **anything setting
priority must go through `setPriorityChoice()`** — it repaints the chip
— or the control and the value drift apart. `setDifficultyChoice()` is
the same contract for `#aDiff`, and `maybeGuessLocation()` goes through
it rather than writing the input.

**⚠️ ON THE NEW-ACTIVITY SHEET IT IS REQUIRED AND NO LONGER DEFAULTED.**
The sheet used to open on *Medium* — a value nobody chose, sitting in a
control that looked answered — so every hurried capture claimed a
priority it had never been given, and Up Next then ranked on it.
`setPriorityChoice('')` is now what `openNewActivity()` calls, `''` is a
real value that must not fall back to `'medium'`, and the chip draws
`.ad-chip.c-none` — the same treatment an un-rated difficulty gets,
because both say *nobody has answered this*. Two things to keep:

- **`setPriorityChoice()` writes the hue with `classList`, not
  `className`.** It used to rebuild the whole attribute, which now
  silently drops `ad-req` — the class carrying the required rail. It
  owns `c-high`/`c-medium`/`c-low`/`c-none` and must touch nothing else.
- **The completion draft is unaffected.** `commitCompDraft()` still
  writes `priority:'medium'` for something already done, and that is
  right: a finished thing has no next, the sheet shows no priority
  control, and nothing in the app draws one on it.

**The rail is `.pri-high/.pri-medium/.pri-low::before`** in `components.css`,
absolutely positioned so it is not a flex item on the rows and cards it lands
on, and clipped to the card radius by the `overflow: hidden` already on
`.act-group` / `.act-card`. Grid cards take the rail but not the capsule:
their body is a fixed skeleton so every tile in a row lines up, and there is
no width beside the deadline badge for a second capsule.

**Any row that can show a capsule must reserve its height.** The capsule is
19px and the mono text beside it is not, so `.act-meta` and `.up-meta` both
carry `min-height: 19px`. Without it a row without a capsule is ~6px shorter
than one with, and the list visibly steps as you read down it — the same
defect the `flex-wrap: nowrap` rules on those lines exist to prevent.

On the map the pin takes the priority colour (`PRI_VAR` in `map.js` maps to
the same three tokens), a high-priority pin is drawn larger as well, and
`symbol-sort-key` keeps it above the pins it overlaps. Completed pins stay
olive — done outranks priority. The Lists tab shows an outstanding
high-priority count per collection (`.coll-card-pri`) so the tab says which
list wants attention before you open any of them.

#### One activity, one list

An activity belongs to **exactly one collection**, `Activities.collection_id`.
There is no second membership and no way to add one — `listFieldsFor()` in
`api.js` writes that single column and `setTargetLists()` in `activities.js`
caps the chosen set at one id.

**It used to be able to belong to several**, via an `extra_collection_ids`
array column added by a `multilist.sql` migration. That is gone from the app
and `supabase/single-list.sql` takes it off the table — read that file's
header before running it, because dropping the column loses every extra
membership.

Two things survive the removal and are worth knowing:

- **`a.listIds` still exists**, as a one-element array. Every caller that
  asked "is this activity in that list?" walks the set, and keeping the shape
  meant none of them had to be rewritten. `listIds[0]` and `listId` can never
  disagree, because `mapActivity()` builds one from the other.
- **`recountCollection()` counts on `collection_id`**, which is now simply
  correct — it used to undercount an activity that was in several lists.
  Nothing reads those columns anyway (see **Back end**).

Deleting an activity destroys the row, and deleting a collection deletes its
activities in one statement. Both used to have a second, gentler meaning
(*remove from this list*, leaving the activity alive elsewhere); with one
list there is nothing to remove it to, so `removeActivityFromList()` and the
"Delete Everywhere" wording are gone.

#### Three lists nobody edits

**Easy, Medium and Hard** — one per difficulty tier, on every account,
as a narrow row of three buttons at the top of the Lists tab, directly
under the header and above the user's own lists. They were photo cards
sitting *after* the user's lists, where nobody found them; they are
derived rather than made, so a control strip is also the honest shape
for them. They answer a
question nothing else did: *what could I actually do this weekend*, as
opposed to *what is in my Japan list*.

**They are derived, not stored, and that is the whole design.**
`js/smartlists.js` holds three sentinel ids — `smart:easy`,
`smart:medium`, `smart:hard` — and synthesises a collection-shaped
object for each. There is no row, no seed, no migration and no
maintenance job.

The obvious build is three real `Collections` per user, kept in step by
something that re-files an activity whenever its rating changes. That
needs an activity to be in **two** lists at once — its own and its
difficulty's — which is exactly the `extra_collection_ids` membership
the section above exists to say was removed. Deriving instead means an
activity's rating *is* its membership: nothing to sync, nothing to
backfill, and "the AI files it into the right one" is just the rating
`unfurl` already wrote at capture. Rename a tier and the lists rename
themselves.

**Read-only by construction, not by permission.** There is no rule
anywhere saying the user may not add to these. There is simply nowhere
to add: **`fetchCollections()` never returns them**, and that is the one
function the list picker, both composers, the FAB and every save path
read. A destination that is not in that array cannot be chosen — so the
guarantee needs no check and cannot be forgotten at a new call site.
`isUuid()` in `offline.js` would reject a sentinel id outright if one
ever reached a write.

Four things the detail screen suppresses on top of that, and all four
are about not drawing a control that would do nothing:

- **`fetchCollection(id)` and `fetchActivitiesFor(id)` intercept a
  sentinel id** (`api.js`) and hand off to `smartCollection()` /
  `smartActivitiesFor()`. Everything downstream — the banner, the nav
  title, `coverFor()`, the filter, the sort, the map view — works
  unchanged, because the synthetic object is the shape `mapCollection()`
  returns.
- **No FAB and a different ⋯ menu** (`updateNavbar()` in `nav.js`).
  `openSmartListMenu()` is the view switcher and nothing else; Edit,
  Delete, Share and the conversation would all act on a row that does
  not exist.
- **No composer**, in either the list view or the empty state
  (`detail.js`).
- **The activities themselves stay fully live.** Tap one and it opens,
  complete it, edit it, delete it — it is the same row it is everywhere
  else, and it is still homed in its real collection. Only the container
  is read-only.

**An un-rated activity is in none of the three.** Same rule the
Difficulty sort follows: the model has said nothing about it, and a row
nobody judged does not belong in a list of easy wins. That is also why
`tools/difficulty-backfill.py` exists — see the backlog.

**The buttons carry the tier's name and its done/total count, and no
cover.** Each name takes a hue off the priority scale (`--green`,
`--violet`, `--pri-high`) so the three read as steps of one ranking.
The covers pinned in `SMART_LISTS` are still used by the detail screen's
banner, which is a real photo header. The `.coll-card-auto` badge that
marked the old cards is gone from the Lists tab; the style remains in
`collections.css`.

**The empty prompt differs between the two callers**, which is why
`renderActListValue()` takes it as an argument. The new-activity sheet's
eyebrow has no label beside it — it *is* the value — so on its own
"Choose" names nothing and reads as a stray verb above the title; it says
**Choose List**. The completion sheet's row has a "List" label to its
left, where that would say list twice, so it keeps "Choose". Two words
for one state is the thing to avoid, not two words in one sentence.

#### The list picker

`openListPicker({subtitle, currentId, title, onPick})` in
`modals.js` is the one way to assign an activity to a collection, used by both
the Home composer and the activity sheet's List row. Both previously called
`showActionSheet()`, which lays out a 57px full-width button per list — fine at
three, an unusable tower at twenty. The picker is a normal sheet with a compact
scrollable list, a cover thumbnail per row, and a search field that appears only
past seven lists. **Don't route this back through an action sheet.**

**Single-select, and only that.** A tap picks and closes, and `onPick` gets an
id. There is no Done button: with one tap per choice there is nothing to
confirm. It had a multi-select mode while an activity could be in several
lists; that went with the feature, along with the `HOME` badge that named
which of the chosen lists the rest of the app would call it by.

`.lp-sub` is a single ellipsised line, so a subtitle passed here has to be
short.

#### Gestures

Two, in `js/gestures.js`, both delegated from `document` so nothing that
opens a sheet or renders a row has to opt in.

**Swipe a sheet down to dismiss it.** The grab handle has always looked
draggable; now it is, and so is the rest of the sheet. The rule that
makes this coexist with a scrolling sheet body is that **the drag only
starts when the body is already at the top** — halfway down a long sheet
a downward swipe is a scroll, and stealing it would make the sheet
unreadable. Dismissal needs 110px, *or* 48px at speed: velocity alone
would let a 20px twitch throw the sheet away, because a short fast
movement scores as high as a long one.

**Swipe sideways to change screen.** iOS pops a pushed screen with a
swipe that must start at the very left edge, which is a hard target on a
big phone — here it works from anywhere. Pushed screens go back; root
tabs move to their neighbour in `TAB_ORDER`.

**The map is the exception, and has to be.** The globe is dragged
horizontally to spin it, so a full-screen swipe there would fight the
map on every pan. On a map surface only, the gesture must start within
`SWIPE_EDGE` (34px) of a screen edge — still the iOS gesture, just
narrower — leaving the middle to the globe. Without that escape hatch
the Map tab would be the one screen you cannot swipe out of. The same
applies to the per-collection map inside the detail screen.

Everything else that owns a gesture is listed in `ownsHorizontal()` /
`ownsVertical()`: fields, `.seg` controls, the location dropdown. An
open overlay takes the gesture entirely — the page underneath must not
also react to it.

**Room for a date picker.** A native date picker opens anchored to its
field and the browser will happily run it off the bottom of the window.
Every date field here lives in a bottom-anchored sheet, which is the
worst case: the reminder sheet is short, so its field sits low and the
calendar had nowhere to go. The picker's own placement cannot be set
from script, so `ensurePickerRoom()` in `modals.js` controls the only
thing that can be — the room beneath the field. On focus, if there is
less than `PICKER_ROOM` (310px) below it, the sheet gets that much extra
scrollable space (a `::after` spacer, so releasing it needs no knowledge
of the sheet's real padding) and is scrolled to match. **The size is
clamped**, because a sheet is tappable before it has finished sliding
in: a field focused mid-animation measures from wherever the sheet had
got to and would otherwise ask for a screen-sized spacer.

#### Reminders

`js/reminders.js`. A reminder is a date to be nudged *about* an activity,
separate from the activity's own target — the case it exists for is a campsite
whose reservations open months before the trip.

**There are three delivery paths, in order of reliability. Understand why
before changing any of them.** A web app cannot wake itself up — Notification
Triggers never shipped past an experiment — so nothing in the browser can
schedule a banner for a future date.

1. **The Home banner.** Needs no permission, no backend, no install. The floor.
2. **A local notification** when the app is opened or foregrounded on or after
   the date. Needs permission only.
3. **Real background push**, delivered on the day with the app closed. Needs
   the backend in `supabase/` deployed, `VAPID_PUBLIC_KEY` set in `config.js`,
   permission granted, and on iOS the PWA installed to the home screen.

All three coexist because each fails differently. Building on (3) alone would
mean a reminder that silently never arrives for anyone missing one of its four
prerequisites — and the failure would look like the feature not existing.

The backend lives in **`supabase/`**: `schema.sql` (columns, the
`push_subscriptions` table with RLS, the `reminder_deliveries` table, and a
trigger that re-arms a reminder when its date moves),
`functions/send-reminders/` (the daily sweep, which groups by recipient so
five due reminders are one notification, and prunes endpoints that
return 404/410), and `cron.sql`. `supabase/README.md` has the deploy steps.
The function requires an `x-cron-secret` header — without it, anyone could
trigger a send to every user's devices.

**A reminder on a shared list goes to everyone on it.** The sweep used to
select `Collections!inner(user_id)` and notify that one person, which on a
shared list is both wrong and quiet: three people share a list, one sets a
reminder to book the campsite, and it fires at whoever happens to *own* the
list — possibly not even the person who set it. The audience is now the
owner plus every `collection_members` row.

That forced the delivery marker apart from the activity.
`Activities.reminder_sent_at` is one column for what is now several
recipients, so the first successful send silently consumed the notification
for the whole list. **`reminder_deliveries` is keyed on
`(activity_id, user_id, remind_at)`** instead. Two consequences worth
keeping: the date being part of the key means moving a reminder re-arms it
for everybody with no trigger needed, and a user with **no** registered
device is deliberately *not* recorded as delivered, so they still get the
reminder on the day they turn notifications on. `reminder_sent_at` is still
written, but only so anything reading it directly sees what it expects —
nothing consults it.

The function tolerates `collection_members` not existing (sharing is
optional; the audience is then just the owner) but **refuses to run without
`reminder_deliveries`**, because with no way to tell who has already been
told it would re-notify everyone every day.

There is still **one `remind_at` per activity, not one per person** — a
reminder on a shared list is the list's reminder. That is the right default
("book the campsite" is not a private thought when three people are going)
but it is surprising to discover afterwards, so `updateRemindAudience()`
says so in the sheet, on shared lists only. It deliberately does not
promise a *push*: whether each person gets one depends on their permission
and install state, which this client cannot see.

**A reminder can count back from the target date** — "1 month before"
is how people actually think about a permit window. `REMIND_OFFSETS` in
`reminders.js` holds the choices, and only the *resolved* date is stored
in `remind_at`, so the schema is unchanged and the three delivery paths
need no idea the feature exists. Reopening the sheet infers which offset
was used by matching the stored date back against the target, so a
relative choice still reads as relative without a column to hold it.

**They are offered only when the activity has a specific target date,
and that restriction is the whole design.** A preset band resolves to
the end of its window — "This year" is 31 December. Counting back a week
from that would file a reminder on Christmas Eve for *every* activity
set to "This year", all firing on the same day, none on a date the user
picked or would connect to the thing. The menu is rebuilt on each open,
since the target may have just changed, and when it cannot offer them
the sheet says why rather than leaving them mysteriously absent.

**Location is a top-level field**, in both the activity sheet (under
Priority). It decides whether an activity
ever appears on the map, so hiding it behind "More options" meant most
activities silently never did — and that argument eventually took the whole
disclosure with it. The activity sheet has none: see **The activity sheet's
shape**. The completion sheet still keeps one, holding photos and "How it
went".

**Setting one is a row, not a field.** The activity sheet carries a
`Remind me` row directly under Priority, reading `None` or `Scheduled`,
which opens `remindSheet` (`openRemindSheet`/`saveRemindSheet`/
`clearRemindSheet` in `reminders.js`). It was a date input plus a
textarea at the bottom of the sheet's old "More options" disclosure: two
controls for one optional idea, which made the disclosure look like the
sheet's main event, and neither said whether a reminder was actually set
without reading the date off it.

The sheet only **stages** — Done copies its two fields into the hidden
`#aRemind`/`#aRemindNote` inputs, and nothing reaches the database until
the activity itself is saved. That is what lets Cancel on either sheet
leave everything as it was, and it is why `updateRemindRow()` reads the
label back off those hidden inputs rather than keeping state of its own.
`remindSheet` needs `z-index: 210` because it opens on top of another
`.modal-overlay`, and equal z-index would fall back to document order.

Already-announced reminders are remembered in `localStorage` keyed by
`activityId@date`, so re-opening the app does not re-ping but moving a reminder
re-arms it.

#### Importing is gone

**There was a way to share a TikTok, an X post or a web page into the app
and get a filled-in activity, and a camera button that read a screenshot
of anything at all. Both are removed**, along with the "add many at once"
bulk sheet they handed multi-result imports to.

What went with them: `js/share.js`, `js/bulk.js`, `css/import.css`,
`css/bulk.css`, `#importSheet`, `#bulkSheet`, the composer's URL branch
and its camera, `share_target` in the manifest, `dupeGuardBatch()` and
its half of the duplicate sheet, `setActivityNotice()` and `.act-notice`,
and the link, listicle and vision halves of the `unfurl` Edge Function.

Three things survive and should not be mistaken for leftovers:

- **`unfurl` still exists and is still called**, but only for
  `{activity:{name,home}}` — the location guess and the difficulty
  rating. Its name is deliberately unchanged; see the header of
  `functions/unfurl/index.ts`.
- **`.shr-lead` / `.shr-url` / `.shr-note` moved into `sharing.css`.**
  They were defined in `import.css` and borrowed by the invite and
  accept-an-invite cards, which are now their only users.
- **`?share=` is no longer read at boot.** `readSharedInput()` and the
  `pendingShare` global are gone; `readEmailConfirmation()`,
  `readPushLanding()` and `readPendingJoin()` still run in that order,
  and the first two still strip only their own keys.

The argument for the feature was that pasting a link is how an idea
arrives. That is still true, and if it comes back, the shape to come
back to is in git history — but it is a real amount of machinery (an
LLM call per link, five platform-specific readers, a review sheet, a
bulk sheet) for a path that always ended in the activity sheet anyway.
**Nothing left in the app inserts an activity without showing a sheet
first**, which is the rule that made those two sheets exist; with them
gone there is exactly one way in.

#### The floating action button

The primary "add" action is a fixed `.fab` in the shell, not a bar button. The
top-right corner is the hardest place on a phone to reach, and a bar button
also has to share space with Back and the overflow menu. `updateNavbar()` binds
it per screen via `setFab(fn, label)` and hides it where it makes no sense (Map
and You). Because it is `position: fixed` it never reflows anything; `.page`
simply reserves bottom padding so the last row can scroll clear of it.

### Design language

The app has **iOS bones and its own voice**. The structure is UIKit — tab bar,
collapsing large titles, sheets, action sheets — but the surface is not the
system default. That combination is the whole point: a stock-iOS skin read as
generic, and a purely editorial one read as a website.

Three typefaces, each with exactly one job:

| Token | Face | Used for |
| --- | --- | --- |
| `--serif` | Newsreader | Display: screen titles, collection and activity names, stat numerals, sheet titles, and long-form completion notes (`.ad-note.prose`). Chosen for its large x-height and even stroke weight — a display Garamond was here first and turned to spidery grey below ~24px, which is most of the app. **If you swap the face, rebalance the sizes**: they are tuned to Newsreader's x-height, not to a nominal point size. |
| `--sans` | System stack (SF Pro) | All UI: controls, fields, body copy, anything that should feel like the OS. |
| `--mono` | IBM Plex Mono | The signature small-caps labels: eyebrows, section headers, badges, tags, buttons, tab labels, counts. Always uppercase with wide tracking. |

The serif is what makes a list of activities read as a curated collection
rather than a to-do list, and the mono eyebrow above each large title is what
stops a big heading looking bare. **Don't set UI chrome in the serif, and
don't set content in the mono** — the contrast between the three is the design.

Other rules:

- **Warm parchment grounds, never neutral grey.** Dark mode is a warm
  near-black (`#16140f`), not `#000` — pure black makes the olive and
  terracotta look muddy.
- **`--tint` (terracotta) means "tappable"**; `--green` (olive) means
  completed; `--red` is destructive only. The token is named for its role, so
  the component CSS reads correctly whatever hue it holds.
- **Priority has its own three-colour scale, and red is not on it.**
  `--pri-high` (high), `--violet` (medium) and `--slate` (low). High has its
  own token rather than reusing `--tint`, and medium its own rather than
  reusing `--purple`, which the You tab uses at icon size and wants darker. Red, orange and yellow belong to the deadline badge sitting
  right beside it — an overdue activity and an important one are different
  claims on your attention, and sharing a colour made them argue. The two
  lower steps are cool in a warm palette, which is deliberate: they have to
  read as the bottom of a scale whose top is terracotta, and warm greys just
  looked disabled. See **Showing priority** below.
- **Every surface's edge is `var(--ring)`, never a literal
  `0 0 0 .5px var(--separator)`.** One token, because on the dark
  ground it has to do a different amount of work: the warm near-black
  surfaces sit close together and `--shadow-sm` is black on near-black
  and worth nothing, so the ring is the only thing left drawing an
  edge and goes to a full pixel. A surface that hardcodes the half
  pixel is the one that disappears in dark mode. **Every box you can
  type in has one** — `.fg input/textarea/select` and `.picker-btn` had
  nothing at all, which with the old grounds meant a fill one value off
  the sheet behind it and no edge: the List picker and "How it went"
  simply were not there in dark mode.
- **In dark mode `--bg-elevated` must stay well clear of `--sheet-bg`.**
  They were `#211e18` on `#201d17` — one value apart. The split is now
  ~14 values in every channel (`#2a2620` on `#1c1a15`). If you retune
  the dark grounds, check an untinted field on a sheet, not a card on
  the page: the page ground is much darker and hides the problem.
- **Nothing outside `:root` in `base.css` should contain a raw hex value.**
  Re-theming the entire app is meant to be one file. The `--shadow-*` tokens
  are warm-tinted for the same reason: neutral black shadows grey the
  parchment.
- Cover photos are filtered (`brightness(.82) saturate(.92)`) and carry a warm
  gradient wash, so a set of unrelated stock images still reads as one palette.
- Standard iOS control sizes are kept even where they fall under the 44px
  guideline: segmented controls are 32px and search fields 38px, as in Apple's
  own apps. Primary targets are still 44px+.
- **The icons are the app's own, not SF Symbols lookalikes.** `icons.js` draws
  them at a heavier 2px stroke with a recurring solid-dot accent, and the four
  tab glyphs use metaphors from the app's subject — a sun over a horizon, a
  stack of cards, a compass rose, a flagged summit. Add new glyphs there rather
  than inlining SVG in a template string.
- **Icon bar-buttons are round tinted discs** (`.navbtn.disc`), matching the
  floating buttons on the map, so every control in the app reads as one family.
  Text bar-buttons (Cancel/Save) stay plain.

**On the web fonts.** Two faces are loaded from Google Fonts. This is a
deliberate reversal of an earlier build that used the system stack only: that
version had nothing to look at. `display=swap` plus a `ui-serif` fallback
(New York on Apple platforms) means text paints immediately in a serif and is
swapped in place, so the cost is a small reflow, not blank text. The service
worker caches both faces, so it is a first-visit cost only.

### CSS file map

Loaded in this order; **order matters**.

| File | Domain |
| --- | --- |
| `base.css` | The design system: `color-scheme`, the three type tokens (`--serif`/`--sans`/`--mono`), the warm palette with a full `prefers-color-scheme: dark` variant, the `--shadow-*` depth scale, the priority scale (`--tint`/`--violet`/`--slate` and their `-soft` fills), layout metrics (`--gutter`, `--nav-h`, `--tab-h`), the iOS safe-area tokens (`--safe-*`, plus the `--gx-l`/`--gx-r` gutter+inset shorthands every screen uses for horizontal padding), the type scale (`.t-*`, including `.t-eyebrow` for the mono small-caps label), the reset, and the shared keyframes. Everything depends on it. |
| `layout.css` | The app shell: the translucent `.navbar` and its `.condensed` state, `.large-title`, the `.tabbar`, and the `.page` show/hide system with its push/fade animations. |
| `components.css` | The reusable iOS primitives every screen builds from: `.group`/`.row` inset grouped lists, `.seg` segmented controls, `.btn` styles, `.searchfield`, `.badge`/`.tag`, **`.list-chip`** (a collection's name on any row that could have come from any list — Home's Up Next, the Up Next screen, search results, the duplicate sheet; sized to match `.tag` so the capsules on one row line up), the `.pri-*` priority marks, `.media-tile`/`.media-play` (one tile for a photo or a video, used by three screens), `.empty`, `.progress`, `.spinner`. Look here before inventing a new component. |
| `auth.css` | The signed-out screen — no nav bar, no tab bar, its own centring. Plus `.auth-invite`, the tinted note shown when an invite link was opened while signed out; `.auth-notice`, the same shape for a confirmation link that could not be honoured, but carrying its own way out (a resend button) because "that link expired" with no way to get another is the same dead end the link was; `.auth-check`, the quieter waiting-for-confirmation panel — nothing has gone wrong there, and the title above is already carrying the message — and `.auth-forgot`, quieter still than the `.auth-toggle` beneath it (creating an account is one of the two things this screen is for; recovering one is what you reach for when neither worked) while keeping the same 44px target, since it is pressed by somebody already having a bad time. |
| `home.css` | The dashboard: the greeting, the SVG progress ring, the context-free quick-add composer (`.home-composer-wrap` owns the gutters so `.home-suggest`, its results dropdown, can position against the field), the Up Next list, and the two `.shelf` grids (recently accomplished, your lists). |
| `collections.css` | The Lists tab: `.smart-row`/`.smart-btn` — the three derived difficulty lists as a button strip above everything else (see **Three lists nobody edits**) — `.coll-card` photo cards, the "New List" tile, and the now-unused `.coll-card-auto`. |
| `detail.css` | A collection's screen (**and both activity sheets** — the `.ad-*` blocks are shared, see the note on `#actSheet` in `index.html`): `.det-banner`, `.det-ctl-row`/`.det-sort` (the filter and sort controls sharing a line — the row owns the gutters so `.seg` can give up its own margins), `.act-row` list rows (plus `.act-dist`, the distance shown while a collection is sorted by it — non-shrinking, unlike the place name beside it), `.composer` quick-add, `.act-card` grid cards, and the `.ad-*` activity detail sheet including `.ad-lists`/`.ad-list-chip` and `.ad-chip.c-dist`, which is untinted for the same reason the difficulty chip is. **The `.ad-*` blocks are shared with the NEW-ACTIVITY sheet** — the plate, the chips and the Where card are one set of rules drawn on both, which is why the four Orchard hues are declared on `#actDetailBody, #actSheetBody` together; the handful of differences an empty sheet has live in a block of their own at the end of the file. **`.ad-dock`/`.ad-dock-view`/`.ad-dock-disc` and `.ad-navbar`/`.ad-back`/`.ad-navtitle` are now used by THREE sheets** — the activity sheet, the new-activity sheet and the COMPLETION sheet, none of which has a `.sheet-bar` any more. They are generic sheet furniture despite the `ad-` prefix; change one and check all three. |
| `me.css` | The Me tab: the stats card, the progress card, the identity row. |
| `modals.css` | The three presentation styles — `.modal`/`.sheet-*` bottom sheets, `.action-sheet`, `.lightbox` — plus the form controls that live inside a sheet: `.fg` and its `.fg-hero` (the field a sheet is *about* — now only the completion sheet's name, since the new-activity sheet's is the detail sheet's own `.ad-title-edit`) and `.fg-pair` (two short choices on one line), `.picker-btn` (a value that opens a picker, sized to match a `<select>` beside it), `.chip-field`, `.photo-*`, the completion sheet's own `.comp-*` (`.comp-card`/`.comp-row` — inset grouped rows whose overflow must stay visible for the location dropdown — `.comp-sec`, `.comp-note`), the list picker's `.lp-*`, and `.toast`. There are no disclosure styles here any more — `.more-toggle`/`.more-fields` went with the completion sheet's last collapsed section. |
| `map.css` | Map containers (the full-bleed `.page-map` and the inset detail map), the CSS sky gradient behind the globe, the floating `.map-filter`/`.map-count`/`.map-fab` chrome, `.map-pin`/`.map-cluster` markers, MapLibre's own controls restyled, the `.loc-*` autocomplete dropdown, `.loc-suggest-*` — the "from your photo" chip, deliberately a tinted *offer* rather than a filled control, since it must not read as though the field is already answered — `.loc-guess-*`, which is the opposite case and therefore shaped differently: a quiet caption marking a field the app has already filled in from the activity's name, with an ✕ that takes it back out — and `.pl-*`, the place sheet (everything at one point on the map), whose rows are `.act-row` from `detail.css` unchanged so only its container and header are new. |
| `dupes.css` | `.dupe-*` — the "you may already have this" sheet. Deliberately quiet: no red, no alert iconography, an ordinary tinted confirm. It interrupts the fastest path in the app, so it has to read as a question. |
| `sharing.css` | `.shr-people-*`/`.shr-avatar`/`.shr-role` and `.join-*` — the invite sheet's roster and the accept-an-invite card — plus `.shr-code-head`/`.shr-code` (the invite as something that can be read off one screen and typed into another) and `.join-code-input`. It also **defines** `.shr-lead`/`.shr-url`/`.shr-note`, which used to live in the deleted `import.css` and which the invite and accept-an-invite cards are now the only users of. |
| `messages.css` | `.conv-*` (the hub's rows and the conversation's scroller, composer and `@` picker), `.msg-*` (a message, its author line, its bubble and the activity chips under it) and `.tab-badge`, the unread count on the tab bar. **`.page-conv` is the app's second full-height screen after the map** — it drops `.page`'s padding and owns its own scrolling; read the note there before changing it. |
| `notes.css` | `.note-*` — the append-only log on an activity, its composer, and `.fg-note`, the field on the new/edit activity sheet that writes the log's first entry. The meta line is mono and the body is sans, deliberately **not** the serif `.ad-note.prose` uses: "How it went" is a story you read back, this is working state you scan. |
| `moderation.css` | `.report-*` (the report sheet — a radio group built out of buttons, for the same reason the priority chooser is), `.blocked-row`, `.auth-agree` (the terms line under the sign-up button) and the `.li-slate` glyph tile the Safety row uses. Deliberately quiet: it is opened by somebody already upset, and red panels make the app look like it has taken a side before it knows anything. |
| `pwa.css` | The offline banner, install bar, iOS Add-to-Home-Screen sheet. |
| `theme.css` | **The palette as tuned in `theme-lab.html`** — generated, never hand-written. Two halves: the light values at the top level and the dark ones inside `@media (prefers-color-scheme: dark)`. ⚠️ **It overrides `base.css`, which is therefore no longer the single source of truth for colour** despite its own header still saying so — read this file first when a colour is not what base.css claims. It loads second-to-last because the export's rule overrides (`.ad-chip.c-d-hard { background: … }`) have the same specificity as the rules they replace and win on source order alone, so it must come after base, components, collections, detail, me and modals; `responsive.css` still goes after it and there is no conflict, since responsive.css sets exactly one colour in the whole file (`.loc-item:hover`) and the export does not touch it. **Bump `CACHE_VERSION` in `sw.js` after every paste.** |
| `responsive.css` | Only the two directions away from phone-first: <375px, and ≥700px where the app centres in a column instead of stretching. **Must load last.** |


### JS file map (where to look for what)

**Foundation**

| File | Domain |
| --- | --- |
| `config.js` | `SUPABASE_URL`/`SUPABASE_KEY`, **`MEDIA_WORKER_URL`/`MEDIA_PUBLIC_BASE`** (the Cloudflare Worker that authorizes uploads, and the R2 bucket reads come from — empty falls back to Supabase Storage; see **Media**), **`HERE_API_KEY`** (place search; public by design, restrict it by origin in the HERE portal — empty falls back to Nominatim), the `sb` client (auth options spelled out rather than defaulted — note `detectSessionInUrl:false`, the one that is *not* a default: `auth.js` handles the email-confirmation landing itself), the `COVERS` array of default Unsplash covers, and `randCover(existingCovers)` (picks a cover the user isn't already using). |
| `state.js` | Every shared mutable global: `currentUser`, the navigation triple (`curTab`, `curPage`, `backTab`), `curListId`, **`curConvId`** (which conversation the conversation screen is showing — it *is* a collection id), `editingListId`, `completingId`, `curFilter`, **`curSort`** (see **Sorting a collection**), `curView`, `upMedia`, `coverPhoto`, `userProfile`, and the map handles. Other files declare their own feature-local globals next to their code (`aLinks`, `bulkEntries`, `actMap`, `lbPhotos`, `locTimer`). |
| `utils.js` | `$` (getElementById), `esc` (HTML-escape — **use it on every interpolated value**, all rendering is template strings), **`uuidv4`/`isUuid`** (client-minted row ids — read the warning under **Working offline** before touching them), `cap`, `todayISO`, `fmtDate(s, withYear)` (omits the year when it's the current one, unless `withYear` — a completed date is a record you look back on, so it always carries its year), `dateInfo(a)` (turns a target date like "This Year" into a `{label, cls}` urgency badge), `shakeEl` and **`nudgeEl`** (a refusal and a pointer — see **Saying what is still required**; they are ±6px and ±2px and must not be swapped), `compress`, `confetti`, the priority pair `priClass`/`priTagHTML` (see **Showing priority**), **`ACT_SORTS`/`DEFAULT_ACT_SORT`/`normSortKey`/`sortActivities`** (see **Sorting a collection**), **`haversineMiles`/`distanceFromHome`/`fmtDistance`/`distanceReady`/`EARTH_MILES`** (how far an activity is from Home — see **How far away it is**), **`DIFF_LABELS`/`DIFF_ORDER`/`diffRank`/`diffLabel`** (see **Guessing how hard it is**), **`resolveTargetDate`/`bandForStored`/`isoLocal`/`RESOLVING_BANDS`** (a target band is resolved to a real date on the way *in*, so it cannot silently roll forward every January — see **A band is resolved on the way in**), **`activityListLabel(a, lists)`** — what the `.list-chip` on a row says, and '' when that list is one the user cannot see — and **`bootKeep`/`bootRead`/`bootDrop`**, the sessionStorage shelf that keeps `?join=`/`?share=` alive across a reload (see **Shared lists**; reading deliberately does not remove), plus **`bootKeepLong`/`bootReadLong`/`bootDropLong`** — the same shelf on localStorage with a 7-day TTL, so an invite survives the tab being closed while the recipient goes to find their password — plus **`setHTML(el, html)`** and **`coverFor(list)`**, the two things that stopped navigation looking like a reload (see **Rendering without reloading**). |
| `exif.js` | `exifReadLocation(file)` — the GPS fix out of a photo's EXIF, or null. Handles **JPEG and HEIC/HEIF/AVIF**, dispatching on magic bytes rather than `file.type`. Underneath: the JPEG walk (`exifFindTiff`), the HEIC box walk (`isoBoxes`, `isoType`, `heicReadLocation`, `heicExifExtent`, `heicExifItemId`, `heicItemExtent`, `heicTiffStart`, `isTiffAt`), and the shared TIFF reader both land on (`exifGpsFrom`, `exifTagValue`, `exifDMS`). Pure, no dependencies, every failure path returns null rather than throwing. **Must be called against the original `File`**: a canvas re-encode strips every tag. See **Where the photo was taken**. |
| `haptics.js` | The Taptic Engine, in the native shell only. `hapticsPlugin`, `hapticRun`, `hapticSuccess` (a completion saved), `hapticTap` (the check pressed). Reached through `Capacitor.Plugins.Haptics` with no import, exactly as `nav.js` reaches Keyboard, so it is silent no-ops in a browser. **Two call sites in the whole app, deliberately** — see **Haptics**. Both honour `prefers-reduced-motion` and swallow their own failures. |
| `fuzzy.js` | Approximate string matching, shared by duplicate detection and search. `similarity(a,b)` (symmetric — are these the same thing?) and `matchScore(q,text)` (asymmetric — does this row answer what is being typed?), plus `scoreFields()` and the primitives underneath: `fuzzyNorm`, `fuzzyTokens`, `fuzzyStem`, `fuzzyTokenSim`, `fuzzySoftDice`, `fuzzyTrigrams`, `fuzzyDice`, `fuzzyEditRatio`. Pure and synchronous. **See How the fuzzy matching works** — the constants are tuned, not derived. |
| `icons.js` | `ICON_PATHS`, the app's own inline-SVG glyph set (`sort` is the newest), plus `ICON_FILLED` (glyphs already solid, which must not be stroked) and `icon(name, cls)`. Icons inherit `currentColor`. **Add new glyphs here**, not inline in a template string. |
| `offline.js` | **Reading from disk, queueing writes, syncing on reconnect.** The IndexedDB wrapper (`idbOpen`/`idbGet`/`idbAll`/`idbPut`/`idbDelete`/`idbClear`), the row snapshot (`snapshotSave`/`snapshotLoad`/`snapshotAge`/`snapshotClear`), the write queue (`queueWrite`/`queueLoadCount`/`pendingWrites`/`flushQueue`), **`dbInsert`/`dbUpdate`/`dbDelete` — which every mutation site calls instead of `sb.from(...)`** — the per-user `uid` stamp on every queued op — plus `applyOp`, `stampRow`, `isNetworkError`, `updateSyncUI` (the offline banner's text), `offlineSignOut` and `offlineInit`. Loads before `api.js`. See **Working offline**. |
| `api.js` | **Every Supabase read, and the cache in front of them.** `mapCollection`/`mapActivity` translate snake_case columns into the camelCase shapes the UI uses; `normMedia`/`denormMedia` do the same for the two shapes the `photos` column holds; **`listFieldsFor`/`rowInAnyList`** are the write and read sides of `collection_id`, the one column that says which list an activity is in (see **One activity, one list**); **`probeHomeFlag`/`homeFlagReady`** do the same for `location_is_home` (see **Moving house**), and **`probeDifficulty`/`difficultyReady`** for `difficulty` (see **Guessing how hard it is**), and **`probeDifficultyManual`/`difficultyManualReady`** for `difficulty_manual` (see **Correcting a rating**). Then `readRows` (network or disk — the one place that chooses), `fetchCollections`, `fetchActivitiesFor`, `fetchAllActivities`, `fetchActivity`, `fetchCollection`, and the cache: **`cacheOwnerCheck`** (the cache refuses to answer a user it was not filled for — see **One account at a time**), `invalidateCollections`/`invalidateActivities`/`invalidateAll`, **`primeActivities`/`primeCollections`** (patch it from a computed row set instead of dropping it — called by `applyOp`), **`primeFromSnapshot`** (paint before the network; called once, by `showApp`), `collectionsScope`, `cacheWarm`, `cachedActivities`/`cachedCollections` (synchronous reads, for the duplicate check), `revalidate`. Plus `updateCollectionStats`/`recountCollection`/`cancelPendingStats` — deliberately **off** the critical path, see the cache section. New queries belong here, not inline in a screen file. **Writes go through `offline.js`.** |

**Shell and shared UI**

| File | Domain |
| --- | --- |
| `auth.js` | **`resetAccountState()`** — everything belonging to one account, cleared on every auth transition (see **One account at a time**) — **`ensureSessionLive`/`verifyLiveUser`/`authAnswerIsDefinitive`/`signOutStaleSession`/`resetSessionLiveCheck`/`recheckSessionSoon`/`startSessionWatch`/`stopSessionWatch`**, which is how a session belonging to a deleted account stops being trusted, on every device (see **Being signed into an account that no longer exists**) — **`inviteSweepDue()`/`authJustAuthenticated`**, which decide when to ask the server whether an invite is waiting for this address (see **An invite that survives creating an account**) — plus `showAuth`/`showApp` (swap `#authPage` against `#appWrap`; `showApp` boots into Home, loads the profile, triggers the iOS install hint, and starts the token auto-refresh). Also the `visibilitychange` handler that stops/starts auto-refresh — browsers suspend timers in a backgrounded PWA, and without restarting on resume the access token goes stale and the next request 401s, which reads to the user as being logged out — and the `onAuthStateChange` listener that keeps `currentUser` in step and only shows the login screen on a real `SIGNED_OUT`, `toggleAuthMode`/`applyAuthMode` (tracked by the `authIsSignUp` flag, not by reading the heading text), `setAuthError`, `handleAuth`, `handleSignOut`. Sign-up also inserts the `Users` profile row. Plus **the confirmation-email landing** — `readEmailConfirmation` (boot; reads `token_hash`/`code`/implicit tokens/`error`, and strips only its own keys), `consumeEmailConfirmation`, `confirmFailureHTML`, `confirmRedirectUrl`, `setAuthNotice`, `setAuthView` (three states now: form / check / reset), `showCheckEmail`/`authBackToForm`, and the resend pair `sendConfirmationEmail`/`resendConfirmation`/`resendFromNotice`. See **Coming back through the confirmation email**. Plus **the password reset** — `requestPasswordReset`/`sendRecoveryEmail`/`showPasswordReset`/`savePasswordReset`/`PASSWORD_MIN` and the `recoveryLanding` flag `main.js` branches on. See **Resetting a password**. |
| `router.js` | **A URL for every screen.** `ROUTE_PAGE`/`ROUTE_ID`/`PAGE_ROUTE` (the route-key ↔ page-id table), `routeHash`/`parseRoute`, `routeSync` (called by `nav()`), `routeEntry` (called once by `showApp()`), `routeClear` (called by `handleSignOut()`) and `onRouteChange`, behind `popstate` and `hashchange`. Plus **`ROUTE_SHEET`/`routeSheetSync`/`routeSheetClear`/`routeOpenActivity`** — the one route that names an overlay rather than a screen, so a link can point at a single activity; see **A URL for one activity**. Hash-based deliberately — see **A URL for every screen**. Loads after `nav.js`, before `main.js`. |
| `deeplink.js` | **Universal Links.** `deepLinkPlugin`, `initDeepLinks` (the `appUrlOpen` listener *and* `getLaunchUrl()`, because on a cold start the event can beat the listener) and `handleDeepLink(url)`, which applies an incoming link to the running app — an invite onto the same shelf `readPendingJoin()` writes, a `?conv=`/`?act=` landing onto the same two globals `messages.js` reads, a `#route` handed to `router.js`. It deliberately never navigates the web view to the URL: that would replace the bundled app with the website. Loads after `router.js`, before `main.js`. See **Universal Links**. |
| `nav.js` | `nav(page, listId)` — the single entry point for changing screens (see **Screens and navigation**), and where the screen's URL is written via `routeSync()`. Plus `PAGE_TAB`, `TAB_ROOT`, `TAB_ORDER` and **`visibleTabs()`** (the tabs a swipe can actually reach — the Messages tab is hidden until its migration is run), `selectTab`, `goBack`, `dismissOverlays`, **`refreshAfterChange(src)`** (the single answer to "something was written, what redraws?" — see **Refreshing after a change**), `updateNavbar` (**where each screen's bar buttons are defined**, and where the collection FAB is bound to `startNewActivity`; there is no search bar button — see **Finding things again**), `applyNavCondense`, a debounced `resize` handler, **`setBodyScrollLock(lock)`** — the single place that touches body overflow — `RENDERERS`/`scrollKey`/`_scrollMem` (each screen's renderer in one table, and the offset it was left at — see **Rendering without reloading**), `queueNavCondense` — and **`syncTabbarToKeyboard()`**, which keeps the tab bar behind the software keyboard instead of riding up on top of it (see **Mobile layout rules**). |
| `gestures.js` | The two touch gestures, both delegated from `document`: **swipe a sheet down to dismiss it** (`.modal` and the action sheet) and **swipe sideways to change screen**. `overlayOpen`, `ownsHorizontal`/`ownsVertical` (surfaces with their own gesture), `SHEET_DISMISS_PX`/`SHEET_FLICK_PX`, `SWIPE_MIN`/`SWIPE_EDGE`, `TAB_ORDER` (in `nav.js`). See **Gestures** below. |
| `modals.js` | **`showActionSheet` items take an optional `tone`** — `high`/`medium`/`low`/`easy`/`hard` — which colours the label with the scale the rest of the app already draws (priority's rails, capsules and pins; the three difficulty buttons on the Lists tab). The menu used to be the one place those scales went missing. `openModal` (**resets `.sheet-body` scrollTop** — see the note under *Sheets* below) / `closeModal` (they call `setBodyScrollLock`, so use them rather than toggling `.open` yourself), the scrim-click and Escape handlers, **`showActionSheet(opts)`** and `showConfirm` (iOS confirms destructive actions with an action sheet, not a dialog — `confirmDeleteCollection`/`confirmDeleteActivity` wrap it), the photo lightbox (swipe sideways to page, down to close), the list picker (`openListPicker`/`renderListPickerRows`/`listPickerPick` — single-select, see **The list picker**), `ensurePickerRoom`/`releasePickerRoom` (see **Gestures**), and `showToast`. |

**Reusable form widgets**

| File | Domain |
| --- | --- |
| `links.js` | The URL chip input: `aLinks`, `handleTagKey`, `removeTag`, `renderTagChips`. ⚠️ `getChipArr(which)` ignores its argument and always returns `aLinks` — vestigial from when there were two chip fields. Adding a second means fixing this first. |
| `location.js` | Everything that resolves a place. (Note `maybeGuessLocation()` applies the difficulty half through **`setDifficultyChoice()`**, never straight into `#aDiff` — the chip on the new-activity sheet is painted by that function.) Plus **`warmGuess()`** — `warmGeo()`'s counterpart for `unfurl`, and the biggest single win on capture latency, since that function imports the Anthropic SDK and is the one thing here with a real cold start — and **`guessPending()`**, which marks the difficulty chip and the empty Where row while an answer is in flight. **`placeSearch(q, limit)`** — the one search entry point, HERE Autosuggest or Nominatim depending on `HERE_API_KEY` (`hereReady`, `hereSearch`, `nominatimSearch`, `hereName`, `hereSub`) — and `locSearch(input, resultsId)`, the debounced dropdown around it (`locItemHTML`, `locShortcutsHTML`, `locOpen`/`locClose`, `locPickIdx`, `locApply`, `locUseHome`, `locUseCurrent`, and the `_locSeq` race guard). Then the bias point (`biasPoint`, `requestBiasPoint`, `primeBias`) and **the text/coordinate contract** — `locGeoMark`, `locFieldsFor`, `locInvalidateIfChanged`, `resolveLocationField`, `requireLocation`, and the Home-intent pair `locIsHome`/`locSetHome`. See **Searching for a place**, **The text and the coordinates must agree** and **A location is required**. Plus `geocodeOnce(q)` (one-shot, no debounce, no DOM: resolves a place name we already have — an imported link's location — to `{display, lat, lng}` or null), `reverseGeocode(lat, lng)` (the other direction, for a photo's EXIF fix — `zoom=14`, so a place rather than a postal address), `positionLocBox` (the bulk sheet's dropdown is `position:fixed` so it can escape the sheet's scroll container, and therefore has to be placed by hand) and `locPick`. Plus the **guess from the activity's name** — which also carries the difficulty rating, see **Guessing how hard it is**: `maybeGuessLocation`, **`queueLocationGuess`** (the debounced `input` trigger) and the session-lived `_guessCache` — the two things that make the guess arrive while the sheet is still being filled — plus **`difficultyExamples`/`DIFF_EX_PER_TIER`/`resetGuessCache`** (the tier-balanced sample of the user's own ratings sent with every guess — see **Rating for one person, not an average one**), `guessMatchesName`, `resetLocationGuess`, `onActLocInput`, `undoLocationGuess`, `clearLocationGuessMark`. See **Guessing the location from the name**. |
| `media.js` | Photos **and video**. `probeStorage()`/`storageReady()`, **`r2Ready`/`uploadToR2`/`uploadToSupabase`/`mediaDownloadUrl`** (uploads go to Cloudflare R2 through the Worker, with Supabase Storage as the fallback — see **Media**), `uploadPhoto`/`uploadVideo`, `videoPoster` (grabs a still so thumbnails and map pins have an image), `handleMedia`, `rmMedia`, `mediaTileHTML`, `renderThumbs` (which ends in `updateMediaRequirement()` — the completion sheet's media rule, owned by `activities.js`), and the ordering set — `coverIndex`, `moveMedia`, `makeCover`, `openMediaMenu`. Also the photo→location offer: `needsLocationSuggestion`, `suggestLocationFromPhoto`, `acceptPhotoLocation`, `dismissPhotoLocation`, `resetLocationSuggestion` (see **Where the photo was taken**). Working list is the `upMedia` global. Replaced `photos.js`; see **Media** below. |

**Screens and features**

| File | Domain |
| --- | --- |
| `dupes.js` | **Fuzzy duplicate detection.** `dupeGuard(opts, proceed)` — the single gate every add path goes through — plus `findDupes`, `dupeScore`, the sheet's handlers (`dupeAddAnyway`/`dupeOpenExisting`/`dupeCancel`) and the `DUPE_LIKELY`/`DUPE_POSSIBLE` thresholds. The batch half — `dupeGuardBatch`/`dupeSkipDuplicates` — went with the bulk sheet. Loads before every screen that adds an activity. See **Catching duplicates**. |
| `sharing.js` | **Shared lists.** `probeSharing`/`sharingReady`/`resetSharingProbe`, `ownsCollection`/`isSharedWithMe` (which buttons to draw), the invite sheet (`openShareList`/`renderShareList`/`createInvite`/`revokeInvite`/`copyInviteLink`/`copyInviteCode`/`sendInviteLink`/`removeMember`), leaving (`confirmLeaveList`/`leaveList`), and accepting (`readPendingJoin` at boot, `handlePendingJoin`/`acceptJoin`/`declineJoin`, `updateAuthInviteNotice`/`authInviteWaitingNotice` for the signed-out case, and the link-free path `openJoinByCode`/`submitJoinCode`/`parseInviteCode`), plus **`claimInviteForEmail`/`claimInvitesForMe`** — the server-side copy of the code, which is the only one that survives a sign-up confirmed on another device — and `makeInviteCode`/`inviteUrl`. See **Shared lists**, **Accepting an invite** for why that link-free group exists, and **An invite that survives creating an account** for the last pair. |
| `moderation.js` | **Reporting content and blocking people.** `probeModeration`/`moderationReady`/`resetModerationProbe`, the block list (`loadMyBlocks`/`isBlocked`/`blockedCount`/`confirmBlockUser`/`blockUser`/`unblockUser`/`openBlockedList`/`renderBlockedList`), the report sheet (`REPORT_REASONS`/`openReportSheet`/`pickReportReason`/`submitReport`), `recordTermsAcceptance`, and `resetModerationState` — called by `resetAccountState()`. Loads after `sharing.js`. See **Reporting and blocking**. |
| `upnext.js` | The Up Next screen pushed from Home: every unfinished activity, bucketed by `targetBand()`. Borrows its rows and sort from `home.js`. |
| `done.js` | The Accomplished screen pushed from Home: everything completed, grouped by the month it was finished. Reuses Home's photo tiles. |
| `home.js` | The Home tab. `renderHome()` plus one function per section, the shared `upNextRowHTML()`/`sortUpNext()` the Up Next screen also uses, the context-free composer (`homeQuickAdd`, which asks plan-or-record via `startNewActivity()`), the composer's search half (`updateHomeSuggest`/`homeSuggestRowHTML`/`openHomeSuggest`/`closeHomeSuggest`, plus `searchActivities`/`searchMark`/`SEARCH_MIN`/`SEARCH_ACT_WEIGHTS` — all that survives of the deleted Search screen; see **One field, both questions** and **Finding things again**), and `toggleCompleteFrom()` — Home's copy of the completion toggle, which cannot rely on `curListId`. |
| `smartlists.js` | **The three derived lists — Easy, Medium, Hard.** `SMART_PREFIX`/`SMART_LISTS`, `isSmartList`/`smartTier`, `smartCollection`/`smartCollections` (the synthetic collection `fetchCollection()` hands back for a sentinel id), `smartActivitiesFor` (the query that *is* the list), `smartRowHTML` (the three buttons at the top of the Lists tab) and `openSmartListMenu`. Loads before `collections.js` and `detail.js`, which both draw them. **They are deliberately absent from `fetchCollections()`** — that is what makes them impossible to add to. See **Three lists nobody edits**. |
| `collections.js` | `renderCollections()` (the Lists tab) plus the collection CRUD: `openNewList`, `openEditList`, `renderCoverPreview`, `clearCover`, `handleCoverUpload`, `saveList`, `delList`. `delList` deletes the collection's activities first — there is no DB cascade — in one statement, since an activity belongs to exactly one list. |
| `detail.js` | One collection. Rendering is **deliberately split in two**: `renderDetail()` builds the banner and the controls, `renderActivitiesList()` rebuilds only the list. Search and filter call the second, so the search field never loses focus mid-typing. Also `activityRowHTML`/`activityCardHTML`, `sortButtonHTML()` (the sort control beside the filter), and the quick-add composer helpers (`composerHTML`, `onComposerKey`, `focusComposer`). |
| `activities.js` | The whole activity flow. **Creating always goes through a sheet** — `quickAddActivity()` only takes the composer's text and hands it to **`startNewActivity()`**, the plan-or-record chooser, which opens either `openNewActivity(name)` or **`openCompDraft(name)`** (see **Adding something you already did**, plus `setCompNameShape`/`renderCompListRow`/`commitCompDraft`). Nothing here inserts an activity directly except `commitSaveActivity()` and `commitCompDraft()`, which are those two sheets' own Saves. `toggleComplete(id, isDone)` is the one-tap completion (see the note below). Then **the new-activity sheet, which only ever CREATES** — `openNewActivity`, `saveActivity`/`commitSaveActivity`, `delActivity`, the name field's `growNameField`/`onNameFieldKey`, and the staged editors that make it the detail sheet's twin: `setTargetChoice`/`openNewTargetMenu`/`readTargetDate`, `setPriorityChoice`/`openNewPriorityMenu`, `setDifficultyChoice`/`openNewDifficultyMenu`, `setRemindField`. Each is the only writer of its hidden input and repaints its own control. Plus **`NEW_REQUIRED`/`firstMissingRequired`/`updateNewSaveButton`/`nudgeMissingField`** — the four fields that block the save, the Add button that names the first one outstanding and the nudge that points at it (see **Saying what is still required**). Its three pages are `newSheetPane`/`NEW_PANES` (Cancel/Add ride the dock, the header is a title only, and a sub-page swaps it for its own `.ad-navbar`), the staged links page `openNewLinks`/`renderNewLinks`/`newLinkSummary`/`addNewLink`/`removeNewLink`/`onNewLinkKey` — editing `aLinks`, the array `saveActivity()` is about to send, so there is nothing to commit — and the first-note page `openNewNotes`/`renderNewNoteCard`, over the same `#aNotes` field `notes.js` already flushes. Plus `renderActListPicker()`/`renderActListValue()`/`setTargetLists()` and the `targetListIds` global (an array capped at one id, with `targetListId` as its alias) — the list eyebrow that lets an activity be filed from outside any collection, hidden when there is no choice to make. **`openEditAct`/`openEditActFrom` are GONE**, and with them `editingActId`, `addLegacyDateOption` and the `.seg-pri` chooser. Also **`revealNewActivity()`** — where an add lands: the list it was filed in, with the activity's own sheet open on top (see **The two-speed activity flow**). Also **`patchActivity`** and the in-place editors around it — the name (**`startTitleEdit`/`growTitleEdit`/`onTitleEditKey`/`cancelTitleEdit`/`commitTitleEdit`**), the location (**`startPlaceEdit`/`onPlaceEditKey`/`endPlaceEdit`/`cancelPlaceEdit`/`commitPlaceEdit`**), **`openActivityListPicker`**, **`openPriorityMenu`**, **`openDifficultyMenu`/`setActivityDifficulty`**, the target sheet (**`openTargetSheet`/`onTargetSheetChange`/`saveTargetSheet`/`clearTargetSheet`**) and **`onRowKey`** — every field on a pending activity's detail sheet is changed by tapping it there, and there is no longer an Edit form to open instead (see **Editing a pending activity in place** and **Correcting a rating**). Also `openComp`/`openCompletedDate`/`confirmComplete` — the one completion sheet, every field on it — and `updateMediaRequirement()`, which is why that sheet will not save a *new* completion with no photo or video (see **The two-speed activity flow**) — and `openActDetail`/`actDetailHeadHTML`/`repaintActDetailHead`/`adShowPane` which build the activity sheet and swap its details / notes / links pages. Plus `openCollectionMenu` (the ⋯ action sheet, which holds the view switcher and everything the old five-button hero row spelled out; a derived difficulty list gets `openSmartListMenu()` in `smartlists.js` instead), `setFilter`, `setView`, and `openSortMenu`/`setSort`. |
| `me.js` | `renderMe()` (stats), `renderMeIdentity()`, **Home** — `homePlace`/`loadHomePlace`/`saveHomePlace`/`resetHomePlace`/`renderMeHome`/`openHomeSheet`/`saveHomeSheet`/`clearHomePlace` and the `bl_home:<uid>` localStorage mirror (see **Home**), plus **`updateHomeActivities`/`clearHomeActivityFlags`** — the cascade that moves everything set to Home when the home address changes (see **Moving house**) — **the difficulty profile** — `difficultyProfile`/`loadDifficultyProfile`/`resetDifficultyProfile`/`openDiffProfileSheet`/`saveDiffProfileSheet` (see **Rating for one person, not an average one**) — **the profile photo** — `avatarsReady`/`myAvatarUrl`/`openAvatarMenu`/`pickAvatar`/`handleAvatarFile`/`removeAvatar`/`saveAvatarUrl` (see **A face on the account**) — `openDeleteAccount`/`onDeleteAccountInput`/`deleteAccount` (see **Deleting an account**), `loadUserProfile()` (reads the `Users` row once per session into `userProfile` — **and creates it when missing**, via `createUserProfile`/`profileSeed`/`USERNAME_RE`; see **Signing up**), `confirmSignOut()`. The tab's one App row, Add to Home Screen, is wired to `pwaShowInstallHelp()` in `pwa.js`. *Share links into the app* and *Join a shared list* both used to sit beside it; the first went with the Shortcut tier (see **Sharing a link in**) and the second lives on the Lists tab, which is the screen the missing list was supposed to be on. |
| `nativepush.js` | **APNs — push for the iOS shell.** `nativePush`/`nativePushAvailable`/`nativePushState`/`refreshNativePushState`, `saveNativeToken`, `initNativePush` (the registration, foreground and tap listeners), `requestNativePush` (the user pressing the row) / `registerNativePush` (the silent re-register at sign-in, which must never prompt) and `unregisterNativePush`. Exists because WKWebView gives the `capacitor://` scheme neither a service worker nor a Notification API, so every line of `reminders.js` that reaches for `PushManager` is dead in the shipping app. Loads before `reminders.js`, which branches to it. See **Push is APNs here, not Web Push**. |
| `messages.js` | **A conversation per shared list, and the hub over them.** `probeMessages`/`messagesReady`/`resetMessagesProbe`/`applyMessagesAvailability` (the tab is hidden until the migration is run), the hub cache (`fetchConversations`/`refreshConversations`/`invalidateConversations`/`cachedConversations`/`unreadTotal`/`updateMessagesBadge`/**`setAppIconBadge`** (the same count on the home-screen app icon, via `navigator.setAppBadge`; the worker keeps its own copy in a `bucketlist-badge` cache entry and increments it on a push, the page overwrites it with the truth)) and its screen (`renderMessages`/`convRowHTML`), then one conversation — `openConversation`/`renderConversation`/`leaveConversation`, `loadMessages`/`loadOlderMessages`/`paintConversation`/`msgRowHTML`/`scrollConversationToEnd`, `sendMessage` (through `dbInsert`, so it queues offline), the `@` picker (`mentionQuery`/`updateMentionSuggest`/`pickMention`/`renderPendingMentions`/`removePendingMention`), `openMessageMenu`/`deleteMessage` (soft), the sender's photo (`loadConversationAvatars`/`avatarsFor`/`msgAvatarHTML`/`invalidateAvatars` — see **A face on the account**), read state (`markConversationRead`), realtime (`subscribeConversation`/`unsubscribeConversation`/`onRealtimeMessage`), `syncComposerToKeyboard`, the push pair `notifyMessageSent`/`loadConversationMute`/`toggleConversationMute`, the notification landing (`readPushLanding` at boot, `handlePushLanding` from `showApp`, and the `serviceWorker` message listener), and `resetMessagesState` — called by `resetAccountState()`. Plus the naming helpers `msgSenderLabel`/`msgSenderGone`/`msgIsMine` and the time ones `msgClock`/`msgWhenShort`/`msgDayLabel`, which `notes.js` also uses. See **Messages**. |
| `notes.js` | **The append-only log on an activity.** `notesReady()` (= `messagesReady()`), `fetchNotes`, `renderActivityNotes`/`noteRowHTML`/`onNoteInput`/`onNoteKey`, `addNote`/`submitActivityNote`/`openNoteMenu`/`copyNote`/`deleteNote`, **`addMessageToNotes`** — promoting a message into the activity's log, which is the reason the feature exists — and the new/edit sheet's pair `resetActivityNoteField`/`flushActivityNoteField`. There is deliberately no update path. See **Notes on an activity**. |
| `map.js` | All MapLibre GL. **`ensureMapLibre()`** — the library is loaded on demand here, not from `<head>`; at ~900KB it was the biggest single cost of a cold launch, blocking the parser on the way to a Home screen with no map on it. Both entry points await it and fall back to the "map unavailable" state if it cannot be fetched. Then `mapStyle()` (raster CARTO basemap + globe projection + sky), `webglOK()`, `actsToGeoJSON()`, and `attachActivityLayer()` — which adds the clustered GeoJSON source and the two symbol layers, and owns the click handlers. Then the marker icons (`ensureDotIcon`, `ensurePhotoIcon`, `ensureClusterIcon`, `stampPointIcons`). Then **one point, several activities**: `SAME_PLACE_DEG`/`CLUSTER_STACKED`/`samePlaceCluster` (is this bubble one place or a neighbourhood?), `indexActs`/`placeActs` (the id → activity index kept beside the layer data), `openClusterPlace`, `openPlaceSheet`/`placeTitle`/`sortPlaceActs`/`placeRowHTML`, and the two row actions `placeOpenActivity`/`placeToggleActivity` — see **Several activities at one point**. Then the two instances: the Map tab (`renderGlobalMap`, `fitGlobal`, `zoomGlobe`, `globeFillZoom`, `setGlobalMapFilter`) and the per-collection map (`renderMap`, `updateMapMarkers`). Plus `mapLoaded(map)` and `hasGeo`. Teardown is explicit — `destroyGlobalMap()`/`destroyDetailMap()` — because each map holds a WebGL context, but **only the detail map is torn down on navigation**. See **The immersive map** above for the traps. |
| `pwa.js` | Service-worker registration and the install/offline UI: `isStandalone()`/`isIOS()` (which stamp `.standalone`/`.ios` on `<html>`), the `beforeinstallprompt` capture behind `pwaInstall()`, the iOS Add-to-Home-Screen sheet, `pwaShowInstallHelp()` (the Me tab row), and `pwaUpdateOnlineState()`. Dismissals persist in `localStorage` under `bl_*` keys. **It also calls `reg.update()` on foreground and on reconnect** — an installed PWA is rarely killed, and registration is the only moment the browser looks for a new `sw.js`, so without it a shipped fix can sit undelivered on the home-screen copy for days and look like it was never made. **`pwaHadController` gates the `controllerchange` reload** so it fires on an update and not on a first install — see **Shared lists**, where getting that wrong silently destroyed every invite link. |
| `main.js` | Boot: `paintStaticIcons()` fills the empty icon placeholders left in `index.html` from the sprite map, then the query-string readers run in a **fixed order** — `readEmailConfirmation()`, `readPushLanding()`, `readPendingJoin()` — all **before** the session restore, because an invite can be opened or an address confirmed while signed out. The first two strip only their own keys; the last blanks the search string wholesale, which is why it goes last. Then `consumeEmailConfirmation()` is tried ahead of `restoreSession()`, and `showApp()`/`showAuth()` follows — or `showPasswordReset()`, when the link that just signed someone in was a recovery one. **Loads last.** See **Staying signed in** (why `restoreSession()` is more than one `getSession()` call) and **Coming back through the confirmation email** (why the reader order is not arbitrary). |

### The two-speed activity flow

The most important interaction decision in the app, and the reason several
functions look redundant:

- **Adding. ⚠️ NOTHING EVER INSERTS AN ACTIVITY WITHOUT SHOWING A SHEET
  FIRST.** This is a hard rule, not a default — if you add a new way to create
  an activity, it routes through `openNewActivity(prefillName)` (a plan) or
  `openCompDraft(prefillName)` (something already done) too.

  Both composers — the one on Home and the one at the end of a collection's
  list — are a way to *start* an activity, not a way to file one. They take a
  name, clear themselves, and open a sheet with it prefilled.

  **Which sheet is a question, asked first.** `startNewActivity(prefillName)`
  shows a two-item action sheet — *New Activity* / *Completed Activity* — and
  routes. See **Adding something you already did**.

  This is a deliberate reversal of the original design, in which the composers
  inserted on Return with only a name. That was the fastest path in the app and
  also the one that produced its worst rows: no priority, no real target date,
  no location — so the activity never surfaced in Up Next and never appeared on
  the map. An idea captured into a hole is not captured. Nothing on the sheet is
  required beyond the name, so the cost is one extra tap rather than any actual
  filling-in, and the fields are in front of the user at the one moment they are
  thinking about the thing.

  There is exactly one way in now: both composers and the FAB land on
  `startNewActivity()`, which asks plan-or-record and opens one of the two
  sheets. The bulk sheet and the link/screenshot import used to be the other
  two, and both satisfied the rule in their own way — see **Importing is
  gone**.

  The composer's old "Details" button is gone — once Return opened the sheet,
  the two did the same thing. A go arrow (`.composer-go`) replaces it, matching
  Home's.

  **And an add ends on the activity, not on the screen you typed it into.**
  `revealNewActivity(listId, id)` in `activities.js` navigates to the list the
  activity was filed in and opens its own sheet on top, and both insert paths
  end there — `commitSaveActivity()` for a plan and `commitCompDraft()` for
  something already done. Saving used to close the sheet and leave you standing
  on Home, which does not show the row you just wrote: the one thing you wanted
  to look at was the one thing you had to go and find. Three things about it:

  - **Only an insert, and now that is all there is.**
    `commitSaveActivity()` used to gate on `editingActId` so an edit
    stayed where it was; the sheet cannot edit any more, so the gate is
    gone with it.
  - **It replaces the `refreshAfterChange()` on that path**, rather than
    running after it. `nav()` renders the screen it lands on, so redrawing the
    one being left is wasted work.
  - **It returns false when it has nothing to open** — no list, or an insert
    whose id did not come back — and the caller falls through to the ordinary
    redraw. The delay before `openActDetail()` is the sheet's dismissal
    animation, the same 240ms `dupeOpenExisting()` waits.

  **⚠️ THE NEW ACTIVITY SHEET IS THE DETAIL SHEET'S SHAPE, TO THE
  PIXEL.** It used to be a form — a `.fg-hero` name box, a `.fg-pair`
  holding the date and the list, a swatched `.seg-pri`, a `.fg` for the
  location, a `.row` for the reminder — and the activity you got back a
  moment later was a plate, a chip row and a tinted card. Two screens
  for one thing, and the controls had to be learned twice.

  It is now built from the same `.ad-*` blocks in `detail.css`: the
  plate (list eyebrow, 29px serif name, target block with its divider),
  the row of Priority / Difficulty / Remind chips, and the plum Where
  card. `revealNewActivity()` opens exactly that sheet on the far side
  of Add, so the two are the same screen with the fields filled in.

  - **THE ONE DIFFERENCE THAT MATTERS IS INVISIBLE: every control here
    STAGES**, into a hidden input, because there is no row yet and
    Cancel has to mean "never mind". The detail sheet's editors write
    immediately, which is right there and wrong here — see **Editing a
    pending activity in place** for where that line falls. Each staged
    value has exactly one writer (`setTargetChoice`,
    `setPriorityChoice`, `setDifficultyChoice`, `setRemindField`) and
    each repaints its own control.
  - **The pickers are the detail sheet's, with the write taken out.**
    `openNewTargetMenu()` shares `TARGET_BANDS` and the app's own
    `showCalendar()` with `openTargetMenu()`; the priority and
    difficulty menus share their labels and `tone`s. Two copies of a
    band list is how the two sheets would come to offer different
    answers.
  - **Two fields differ from the detail sheet, and both are because the
    sheet is empty.** The name is a live `<textarea>` from the start
    rather than tap-to-edit (it is what you came here to write), and so
    is the Where field — that is the field that decides whether the
    activity ever appears on the map, and an extra tap in front of it is
    the friction that made it the one people skip. The Where card keeps
    its plum wash for that reason: `.ad-place.editing` takes the tint
    off a row that had a resting state, and this one never had.
  - **⚠️ The name's placeholder has to fit ONE LINE.** A textarea's
    `scrollHeight` counts its content, not its placeholder, so an empty
    box measures one line however long the prompt is and
    `growNameField()` cannot make room for one that wraps. At 29px serif
    in the plate's ~170px column that is about twenty characters.
  - **Links and Notes are PAGES, not fields, and both are optional.**
    Neither is something most people have at the moment of capture, so
    neither may cost the main page height it would spend empty — but a
    field that vanishes when empty says nothing at all, where a card
    reading "None" says there is nothing there yet. `openNewLinks()` /
    `openNewNotes()` swap the page in; `aLinks` and `#aNotes` are what
    `saveActivity()` and `flushActivityNoteField()` already read, so
    nothing downstream changed. The links page is the activity sheet's
    own, with `saveActLinks()` left out of it — the rows edit the array
    that is about to be inserted.
  - **⚠️ FOUR THINGS BLOCK THE SAVE, AND THE SHEET SAYS SO — see
    **Saying what is still required** below. `NEW_REQUIRED` is the one
    table the rail, the Add button and the nudge all read.
  - **⚠️ NO BUTTONS IN THE HEADER — THE ACTIONS ARE IN A DOCK, like the
    activity sheet's.** Cancel is a `.ad-dock-disc` and Add a
    `.btn.btn-filled.btn-block`, which is the same disc-plus-block pair
    Delete and *Mark accomplished* make at the foot of a pending
    activity. So the two sheets agree about **where an action lives**
    as well as about what the fields look like, and the primary control
    is under the thumb rather than in the hardest corner of the phone
    to reach. What is left at the top is a `.sheet-bar.sheet-bar-title`
    holding *New Activity* and nothing else — with no buttons beside it
    the title takes the whole width rather than the half `.sheet-title`
    normally leaves for two.
  - **And each page carries its own `.ad-navbar`**, again the detail
    sheet's. The left button used to be Cancel and Back at once —
    `newSheetPane()` swapped its text and its handler — which is one
    control meaning two things; now a page's way out is the Back bar at
    the top of that page and the sheet's way out is the dock. Anything
    that adds a page here writes its own Back bar with it, and
    `NEW_PANE_TITLES` is gone with the bar it retitled. Back rather
    than Cancel on a page is not a lost escape hatch — the dock's
    Cancel, the scrim, Escape and a swipe down all still dismiss the
    whole sheet from anywhere.
  - **⚠️ ONE HEADER AT A TIME.** `newSheetPane()` hides `#actSheetHead`
    on a sub-page and adds `barless` to the `.modal`, because that page
    is bringing its own `.ad-navbar` — two stacked headers is exactly
    the confusion the completion sheet's old bar-swap was written to
    avoid, and it still applies. Two traps in those two lines:
    `.sheet-bar` sets `display: flex`, which outranks the browser's own
    `[hidden]` rule (hence `.sheet-bar[hidden]` in `modals.css`), and
    `barless` is what gives the body back the top room the bar was
    holding, or the grabber sits on the Back button.
  - **`#actSaveBtn` keeps its id in the dock.** `saveActivity()` shakes
    it through `requireLocation()` and `commitSaveActivity()` disables
    it while the insert is in flight; both find it by id.
  - **⚠️ THE NOTES BLOCK IS `.ad-nsec`, THE ACTIVITY SHEET'S OWN — not a
    card of its own.** `renderNewNoteCard()` is `paintActivityNotes()`
    over one staged entry instead of a fetched log: same head, same
    count-or-*Add* on the right, same `.note-card`, same `.note-empty`,
    and the whole block a button onto the page. This was briefly a
    tinted `.ad-place` row with a disc, invented here rather than taken
    from there — which made the one thing on this sheet that also
    exists on that one look like a different feature. **If a Notes
    style is wanted it goes in the `.ad-nsec` block and both sheets get
    it.** (Links, by contrast, genuinely *is* `.ad-place.c-link` on both.)
  - **⚠️ The staged note's `author_id` must be truthy.** `noteWho()` and
    `noteAvatarHTML()` read a falsy one as "the account that wrote this
    was deleted" and render the entry greyed over the words *Deleted
    account* — on a note the user is in the middle of typing. The sheet
    cannot open without a signed-in user, so the fallback in
    `renderNewNoteCard()` is belt to that brace.
  - **The Notes page holds one field, and that is not the log.** What is
    staged is the log's *first entry*: the log is append-only and lives
    on an activity that does not exist yet. The block is hidden entirely
    without `activity_notes` — it carries the id `#aNotesRow` that
    `resetActivityNoteField()` has always hidden, so `notes.js` needed
    no change. "Why is this on your list?" is still the wrong question
    at capture, which is why this is a page and not a box under the
    name. `Activities.description` still exists and nothing writes it;
    see **Back end**.
  - **There is no Edit mode.** See the ⚠️ at the top of **Editing a
    pending activity in place**: `openEditAct()` is gone, `saveActivity()`
    only ever inserts, and `editingActId` no longer exists.
- **Completing.** Tapping the check opens `openComp()` — **one sheet**, with
  every field on it: the name, the date, the place, the photos and video, and
  how it went. **Nothing is written until Save**, so an accidental tap costs a
  Cancel rather than a wrong date to find later.

  It used to be two sheets: a date-only one that completed the activity, and a
  separate details one you had to go and find afterwards, three taps down
  inside the activity sheet. The moment you tick something off is the moment
  you have the photos, so they belong in the same place.

  **The name is an editable `.fg-hero` field in all three modes** —
  completing something, editing something already done, and logging
  something that never existed as a plan. It was briefly a static heading
  while completing, on the grounds that the name was a fact the user had
  already written; that was wrong in practice. The moment you tick something
  off is exactly when you notice the name is wrong, and having to save,
  reopen and edit to fix it was worse than the box being there. (The
  `.sheet-subject` style that heading used is gone with it — don't
  reintroduce it here without reading this paragraph.)

  **⚠️ NO BUTTONS IN ITS HEADER EITHER — the actions are in a dock, like
  both activity sheets'.** An `.ad-dock` under the body with one
  `.ad-dock-view` per page, swapped by `compShowPane()`: Cancel (an
  `.ad-dock-disc`) plus the save button on the main page, and *Add a photo
  or video* on the media page. `#compSaveBtn` keeps its id there —
  `requireLocation()` shakes it and `confirmComplete()` disables it while
  the write is in flight, both by id.

  **The header is a title and nothing else**, reading *Mark as
  Accomplished* or *Edit* — `openComp()`/`openCompDraft()` are its only
  writers, alongside the button label they set in the same breath (**Done**
  completes, **Save** edits a record, **Add** files something that was
  never a plan). `compShowPane()` hides it on the media page and adds
  `barless`, because that page has its own `.ad-navbar`: that is the same
  "one header at a time" rule the new-activity sheet follows, and it is
  what the old two-bar swap was doing by other means.

  **Below the name it is three blocks, not four fields.** It was four
  identically-shaped `.fg` blocks in a column — same mono label, same 46px
  box, same 22px gap — so nothing said which part was the record of what
  happened and which was the story you tell about it, and the two one-word
  answers were as visually loud as the photos. Now:

  - **`.comp-card`** — Date and Where as inset grouped rows, icon and mono
    label on the left, value on the right, split by a hairline inset past
    the icon column. Worth ~80px. **Its overflow stays `visible`**: the
    location dropdown hangs out of the bottom of it, so the rows carry no
    background of their own and nothing needs clipping to the corner radius.
    `.loc-wrap` is the *whole row*, not the input, or `.loc-results` would
    drop at the width of the value rather than the width of the card. The
    date input's native calendar glyph is suppressed, since the row already
    leads with one.
  - **The card's rows are Date, Where and List**, all three on every mode.
    The **Date** row opens the picker from anywhere on the row
    (`openCompDatePicker()` calls `showPicker()`): the native calendar glyph
    is suppressed because the row leads with one, and on desktop that glyph
    is the only part of a date input a click opens the picker from. The
    **List** row is a move — `confirmComplete()` writes the list columns only
    when the set actually changed (`compListsBefore`), because with the
    an untouched edit must not rewrite `collection_id` at all. It matters
    most on a *completed* activity: the
    activity sheet hides "Edit details" once something is done, so this is
    the only way to refile one.
  - **`.comp-sec`** — a mono head with its action on the same line, then the
    content. The Add pill moved onto the photos head: it stays the small pill
    the media section above requires, and gives up the line of its own that
    it had no content to justify.
  - **`.comp-note`** — "How it went" set in the **serif**, because that is
    the face it is read back in (`.ad-note.prose`) and it is the one thing on
    the sheet the user writes rather than picks. The placeholder stays sans.

  **At least one photo or video is required to mark something
  accomplished.** A completion with nothing attached is a date, and the media
  is also what gives the activity a cover, a grid card and a map pin — so the
  one moment the user certainly has it is the one moment to ask. Three parts,
  and the third is the one that keeps it from being a wall:

  - `confirmComplete()` refuses to save when `compNew && !upMedia.length`,
    shaking and scrolling to `#compMediaSec`. An upload still in flight
    (`_mediaPending`) gets its own message — the user has already done the
    thing being asked for.
  - **The rule applies on the way in only.** `compNew` gates all of it, so an
    activity completed before the rule existed, or one whose media was
    removed afterwards, can still be edited and saved. Enforcing it on the
    edit pass would strand those rows — their owner could not fix a date or a
    note without first finding a photo of something they did years ago.
  - `updateMediaRequirement()` (`activities.js`) swaps the section's
    qualifier between *optional* and *required* and shows `#compMediaHint`
    while the rule is unmet. It is called from **`renderThumbs()`**, which
    every change to `upMedia` ends in, so the hint cannot drift out of step
    with the tiles. A requirement discovered by pressing the button you
    thought would finish is a dead end, not a rule.

  It is satisfiable offline: photos fall back to inline base64 without the
  storage bucket or a connection. **Video is not** — it is refused offline —
  so a tunnel means the requirement has to be met with a photo.

#### Saying what is still required

`NEW_REQUIRED` / `firstMissingRequired()` / `updateNewSaveButton()` /
`nudgeMissingField()` in `activities.js`, `.ad-req` in `detail.css`.

`saveActivity()` blocks on five things — a **list**, a **name**, a
**target date**, a **priority** and a **place** — and until this the
sheet said so nowhere.
You found out by pressing Add and being shaken at, which is the same
dead end `updateMediaRequirement()` already exists to close on the
completion sheet: *a requirement discovered by pressing the button you
thought would finish is a dead end, not a rule.*

Three things answer it and **all three read one table, in one order**,
so they cannot disagree:

- **A red rail** beside each of them (`.ad-req`), static markup;
- **the Add button**, which *names* the first one outstanding —
  `Pick a list` → `Name it` → `Set a target date` → `Set a priority` →
  `Add a place` → `Add`;
- **a nudge**, which points at that one when the button is pressed.

Things to keep:

- **⚠️ `NEW_REQUIRED` IS READING ORDER, not the order the old code
  happened to check in.** The button names the *first* unanswered field,
  so an order that did not match the layout would send somebody down the
  sheet past two blank fields to a third. It used to check name, then
  the date, then the list, then the place.
- **`el` is a getter, not an element.** The table is built once at parse
  time, when none of the sheet's markup has been touched yet.
- **The button is never `disabled`.** A disabled button cannot be
  pressed, and pressing it is how you ask *which* field — which is the
  whole point of the nudge. `.is-blocked` makes it look unavailable and
  leaves it live.
- **⚠️ `nudgeEl()` IS NOT `shakeEl()`,** and the two must not be
  confused. `shakeEl()` is ±6px and means *refused* — a save was
  attempted and rejected. `nudgeEl()` is ±2px over three passes and
  means *that one, there*, about a field nobody has reached on a sheet
  where nothing has gone wrong. It also honours
  `prefers-reduced-motion`, which `shakeEl()` predates and does not: a
  rejection has to register somehow, but a pointer has a free
  alternative, because the button's own label already carries the whole
  message.
- **It scrolls first and nudges 160ms later**, or on a short phone the
  movement happens off-screen and the button appears to do nothing.
- **Only the two typed fields take focus.** Opening the keyboard for a
  control whose answer is a menu would cover the menu.
- **⚠️ SETTING `.value` FIRES NO `input` EVENT**, so
  `updateNewSaveButton()` is called from every *writer* of the four —
  `setTargetLists()`, `growNameField()`, `setTargetChoice()`,
  `setPriorityChoice()`, `onActLocInput()`, `locApply()` and
  `undoLocationGuess()`. `locApply()`
  is the one that is easy to miss and covers four paths at once: a
  dropdown pick, the Home shortcut, *Current location*, and the name
  guess. Without it the button went on reading *Add a place* over a
  filled field.
- **The rail is block-level on the plate, and that is now exact.** It
  marks the plate, the priority chip and the Where card; the plate
  holds the list, the name *and* the target, and since the target
  became required all three of its controls are. It was an imprecision
  when the target was optional and is not one any more — which is worth
  knowing before anything optional is added to that card.
- **⚠️ THE RAIL IS A BORDER, NOT A BAR.** The first version was an
  absolutely positioned 4px block at `left: 0`, which cannot follow a
  rounded corner — so it had to be inset far enough to stay in the
  straight part of the edge (16px against the plate's 18px radius) or
  it poked visibly out of the curve, leaving three short stubs. A
  full-inset pseudo-element with `border-radius: inherit` and a left
  border only is drawn along the card's own curve, tapering where it
  meets the zero-width top and bottom borders. No inset, no per-radius
  tuning, and no clipping — which matters because `.ad-place` must keep
  `overflow: visible` for the location dropdown, so it could never have
  been clipped to shape.
- **⚠️ THE HUE IS THE THING TO ARGUE WITH.** `--red` is destructive
  everywhere else in this app, and the warm end is spoken for twice
  besides — the deadline badge owns overdue/urgent, `--pri-high` owns
  high priority. A required field is none of those. It was chosen over
  `--tint` anyway because `--tint` means *tappable* and every control on
  this sheet is tappable, so the rail would have marked nothing. If it
  ever reads as an error, `--tint` at 3px is a one-line change in
  `detail.css`.
- **The rail does not clear when a field is answered.** It is a
  statement about which fields are required, not a to-do list, so a
  complete sheet still shows all four. That was the version benched and
  chosen; making it clear as each is filled is one line in
  `updateNewSaveButton()` if it reads as unfinished business.
- **NEW-ACTIVITY SHEET ONLY.** `ad-req` lives in that sheet's markup and
  nowhere else — the detail sheet edits a row that already exists, where
  nothing is outstanding. Do not add it there.

The bench these five options were compared on is `optional-lab.html`
(dev tool, not linked, not in `sw.js`, outside `build-www.js`). It
carries the four rejected alternatives and why, plus a `?audit=1` pass
that measures every frame for overflow against the baseline.

#### Adding something you already did

You ride in a helicopter on a whim. It counts, it belongs in the app, and
there was no path to it: you had to create the plan and immediately complete
it, which is two sheets and a fiction in between. The app was worst at
exactly the thing it is for.

**The completion sheet already was the form** — name, date, place, photos,
how it went — so it grew a **draft mode** rather than a second sheet being
built beside it. `openCompDraft(prefillName)` opens it with no row behind it
and `commitCompDraft()` inserts instead of updating. Everything the sheet
enforces still applies, the mandatory photo above all: something worth adding
after the fact is something you have a picture of.

- **`compNew` and `compDraft` are separate flags.** `compNew` means "this
  save is the moment it becomes accomplished" (media required, the dock's
  button reads *Done*, and it inserts nothing); `compDraft` means "there is
  no row yet, so that button reads *Add* and inserts one". Every completion
  path sets `compNew`; only this one sets both.
- **It grows one field: the list.** A third `.comp-row` in the card,
  `renderCompListRow()`, hidden outside draft mode — an activity completed in
  place is already filed, and moving it belongs on the activity sheet. It
  shares `targetListIds` and `renderActListValue()` with the activity sheet
  (the two are never open at once), so `listFieldsFor()` works unchanged and
  the "3 lists" wording cannot drift between them.
- **`target_date` is null and `priority` is the default.** Neither means
  anything once something is done, and the app draws neither on a completed
  activity.
- **`dupeGuard()` runs, because this is an add path.** Fields are read off
  the sheet before the check, as in `saveActivity()` — the check can open a
  sheet on top of this one.

**The chooser is on the three human entry points and nowhere else** — Home's
composer, a collection's composer, and the FAB on a collection. Not inside
`openNewActivity()` itself: a link import (`handOffSingle`) and the bulk
sheet land there too, and both are plans by construction, so the question
would have only one answer. On Home it sits **after** the `looksLikeUrl()`
branch for the same reason — a pasted TikTok link is not something you
already did.

**It costs the fast path a tap.** The composers were tuned so capture costs
one extra tap and it is now two. *New Activity* is first so the common answer
stays under the thumb. If that ever grates, the fallback is keeping the
composers going straight to the activity sheet and leaving the chooser on the
FAB alone — you are typing a *plan* into a composer.

There is no fourth entry point. The Search screen's "add what you typed"
(`searchAddAsNew()`) used to be one; it went with the screen.

  The photos and notes then spent a while behind an "Add photos, video &
  notes" disclosure *on* this sheet, which was the same mistake one level in —
  the collapsed half held the single thing people most want to attach. **There
  is no disclosure left anywhere in the app**; don't reintroduce one here. It
  costs the fast path nothing: press the check, press Done, without touching
  anything in between.

  Un-completing is still immediate: there is nothing to ask. It writes **only
  `date_completed`**, so un-completing never destroys the notes and photos on
  a past completion.

  **The activity sheet reads name → badges → photos → "How it went".** The
  title leads because it is what the sheet is about, and the state/date pair
  reads as the caption beneath it while still sitting directly above the media
  it names. **Both states carry the same pair of full-width badges** — state
  and date when it is done, priority and deadline when it is not — sized to
  the sheet's other controls rather than to the small chips the rest of the
  app uses, because at 29px the serif title left them stranded in an empty
  row. The deadline badge is bare coloured text everywhere else, so
  `.ad-badges .badge` mixes its fill out of `currentColor`; that way the chip
  cannot disagree with the urgency hue and no per-urgency token is needed. The
  name is centred on a completed activity, where the sheet is a record rather
  than a plan. Spacing runs downward from the title — `.ad-title` has no top
  margin and `.ad-badges` carries the gap.

  **There is no Target section.** The deadline badge in the header already
  says it, and a second copy three sections down said it twice.

  **A pending activity's sheet is two tabs: Details and Notes, and the
  tab bar is the first thing on the sheet.** The Notes pane carries no
  title and no badges — it is a log, and the header belongs to Details.
  `setActDetailTab()` swaps `#adPaneDetails`/`#adPaneNotes`; both are
  rendered up front, so switching costs nothing. The notes log needed room
  to be worked in and was competing with the photos and the action buttons
  for the same screen. **A completed activity has no tab bar and no notes
  at all** — its record is the photos and "How it went", and the log is the
  working state of a plan that no longer has one.

  **The media grid is capped at six tiles** (`AD_GRID_MAX` in
  `activities.js`) — two rows. Past that it shows five and folds the rest
  behind a `+N` tile (`.ad-photo-more`) that opens the lightbox at the first
  item it is hiding; the lightbox walks the whole list, so nothing is
  unreachable. Uncapped, a dozen photos pushed the notes and every action
  button off the bottom of the sheet.

  **"How it went" is capped in height and scrolls inside itself**
  (`.ad-note.prose`, 240px). It is the one field the user can write without
  limit, and an uncapped block made the sheet read as if it held nothing but
  notes. It is listed in `ownsVertical()` in `gestures.js` and sets
  `overscroll-behavior: contain`, so scrolling it neither dismisses the sheet
  nor chains into the sheet body.

  Its actions differ by state too. Completed: **Edit** takes a full-width row
  because it is what you came for, and *Mark as not done* pairs with *Delete*
  on the last row (`.sheet-actions-row`) — both are corrections, undoing a
  record rather than adding to one. Pending: *Mark accomplished* is the
  primary and keeps a full-width row of its own.

  **Once something is done, this sheet is the only way to edit it.** The
  activity sheet's pencil is gone from a *pending* activity entirely (its
  fields are edited in place) and on a completed one it opens this sheet —
  everything the old Edit form offered (target date, priority, reminder) is
  about what to do next, and a finished thing has no next. So the name and the location live here too, not only the photos and
  notes.

  It is opened by `openCompFrom()`, which registers a return *before* opening —
  so Save, Cancel, the scrim, Escape and a swipe down all land back on the
  activity sheet rather than dropping you on the bare page behind it. See
  `onSheetClose()` in `modals.js`: registering the return there rather than on
  the Save button is what makes all five paths agree, and **any new dismissal
  route must go through `closeModal()` or call `afterSheetClosed()` itself.**

## Back end

Supabase project `xxdmendegyxlkikejvps`. Three core tables plus two
optional ones for sharing, one storage bucket (`media`, optional — see
**Media**), two Edge Functions — `send-reminders` and `unfurl` (see
**Sharing a link in**), both optional — and two RPCs that exist only
once `sharing.sql` has been run. Reads are direct PostgREST via
`supabase-js` from `js/api.js`; **writes go through `js/offline.js`** so
they can be queued when there is no network.

| Table | Columns |
| --- | --- |
| `Collections` | `id`, `created_at`, `name`, `description`, `cover_image`, `user_id`, `number_activities`, `activites_completed`, `category_tag` |
| `Activities` | `id`, `created_at`, `collection_id` *(the only list an activity is in — see **One activity, one list**)*, `name`, `description` *(dead — see below)*, `target_date`, `priority`, `date_completed`, `experience_notes`, `photos`, `links`, `location`, `location_lat`, `location_lng`, `location_is_home` *(optional — added by `home.sql`; see **Moving house**)*, `difficulty` *(optional — added by `difficulty.sql`; `easy`/`medium`/`hard` or null, inferred and never asked for — see **Guessing how hard it is**)*, `difficulty_manual` *(optional — added by `difficulty-override.sql`; whether a person chose that tier rather than the model — see **Correcting a rating**)*, `category_tag`, `remind_at` (see below) |
| `Users` | `id` (= `auth.users.id`), `created_at`, `display_name`, `username`, `icon`, `terms_accepted_at` *(optional — added by `moderation.sql`; null on accounts predating it, deliberately not backfilled)*, `home_location`, `home_lat`, `home_lng` *(the last three optional — added by `home.sql`; see **Home**)*, `avatar_url` *(optional — added by `avatars.sql`; see **A face on the account**)*, `difficulty_profile` *(optional — added by `difficulty-profile.sql`; a paragraph about the user, read only by the difficulty rating — see **Rating for one person, not an average one**)* |
| `collection_members` *(optional)* | `collection_id`, `user_id`, `role`, `display_name`, `created_at` — added by `sharing.sql` |
| `collection_invites` *(optional)* | `code` (PK), `collection_id`, `created_by`, `role`, `revoked`, `expires_at`, `created_at` |
| `invite_claims` *(optional)* | `email`, `code` (composite PK), `created_at`, `claimed_at`, `claimed_by` — added by `sharing.sql` section 5. An invite waiting for an account that does not exist yet. **RLS on with no policies**, so only the two `SECURITY DEFINER` RPCs can see it. |
| `messages` *(optional)* | `id`, `collection_id`, `sender_id` (**`on delete set null`**), `sender_name` (a snapshot), `body`, `activity_ids uuid[]`, `created_at`, `edited_at`, `deleted_at` — added by `messages.sql`. See **Messages** |
| `conversation_reads` *(optional)* | `collection_id`, `user_id`, `last_read_at` (composite PK) — how far each person has read each conversation. Same shape as `reminder_deliveries`, for the same reason |
| `conversation_prefs` *(optional)* | `collection_id`, `user_id`, `muted` (composite PK) — read only by `send-message-push`. Absent means nothing is muted, which is the right default |
| `activity_notes` *(optional)* | `id`, `activity_id`, `author_id` (**`on delete set null`**), `author_name`, `body`, `created_at` — the append-only log. **No UPDATE policy, deliberately.** See **Notes on an activity** |
| `user_blocks` *(optional)* | `blocker_id`, `blocked_id` (composite PK), `blocked_name` (a snapshot, for the same reason `messages.sender_name` is one), `created_at` — added by `moderation.sql`. Select is scoped to `blocker_id` alone, so a blocked user cannot discover the block |
| `content_reports` *(optional)* | `id`, `reporter_id`, `reported_id` (both **`on delete set null`**), `target_kind`, `target_id`, `collection_id`, `reason`, `detail`, `snapshot`, `created_at`, `reviewed_at`, `resolution` — added by `moderation.sql`. **Insert-only: no select policy at all**, not even for the reporter. See **Reporting and blocking** |
| `push_subscriptions` | `id`, `user_id`, `endpoint` (unique), `p256dh`, `auth` *(both nullable since `native-push.sql`)*, `platform` *(`'web'` \| `'ios'`, added by `native-push.sql`)*, `user_agent`, `created_at` — added by `schema.sql`. **A native row holds an APNs device token in `endpoint` and has no keys**; a check constraint keeps a *web* row from doing the same. One table rather than two because every question either push function asks is per-user, not per-transport — see **Push is APNs here, not Web Push** |
| `reminder_deliveries` | `activity_id`, `user_id`, `remind_at` (composite PK), `sent_at` — added by `schema.sql`. Who has already been told about which reminder, per person. See **Reminders**. |

RPCs, from `sharing.sql`: `peek_invite(code)` reads an invite without
accepting it, and `join_collection(code)` is **the only way a member row
is ever created** — there is deliberately no INSERT policy on
`collection_members`. Section 5 adds two more: `claim_invite(code, email)`
(callable by `anon`, because it runs before the account exists) records an
invite against an address, and `claim_invites_for_me()` redeems whatever is
waiting for the signed-in one and returns what it joined. See **An invite
that survives creating an account**. `messages.sql` adds `conversation_list()` — the whole Messages tab in
one round trip, which is what keeps messages out of the app's two
backing queries — plus two more `SECURITY DEFINER` helpers,
`can_use_activity` and `owns_activity_collection`, which are
`can_use_collection`/`owns_collection` reached through an activity.
`can_use_activity` is installed in a wider form when
`extra_collection_ids` existed; `single-list.sql` puts the narrow form
back.

The `SECURITY DEFINER` helpers `owns_collection`,
`is_collection_member` and `can_use_collection` exist to break RLS
policy recursion; read that file's header before touching them.

**`Collections.id` and `Activities.id` are `uuid`**, and the client now
mints them itself (`stampRow()` in `offline.js`) rather than letting the
database default fill them in. That single fact is what makes the
offline write queue tractable — see **Working offline**.

Schema notes and traps:

- **`Activities.description` is dead and must stay that way.** It was the
  activity's "Notes / Why is this on your list?" field, which is gone from
  the sheet, from the bulk rows, from the import drafts, from the activity
  detail sheet, from both search paths and from `mapActivity()` — so
  nothing in the app reads or writes it. **The column is deliberately not
  dropped**: existing rows still hold whatever people typed, and a
  `drop column` is the one step of this that cannot be undone. Run
  `alter table "Activities" drop column description;` only if you are
  certain nobody wants it back. **Notes came back and this column was
  deliberately not reused for them** — see **Notes on an activity**:
  the log is append-only precisely so two people cannot clobber each
  other, and a JSON array in one column would have been the
  last-write-wins field it exists to replace. `Collections.description` is a different
  field and is very much alive — it is the blurb on a list's banner.
- **`Collections.activites_completed` is misspelled in the database** (missing
  the second `i`). `api.js` matches the real column name. Don't "fix" it in code
  without renaming the column.
- **`number_activities` / `activites_completed` are written but never read.**
  `updateCollectionStats()` keeps them roughly current, but all displayed
  counts are computed client-side from the fetched activities. They're
  denormalized columns waiting for a use — and because nothing reads them,
  that write is **debounced and detached** rather than awaited. Don't put it
  back on the critical path; see the cache section. They also count on
  `collection_id` alone, so they undercount an activity that is in several
  lists. Anything that starts *reading* them has to fix that first.
- **`collection_id` is the home list, not the only list.** Once
  there was an `extra_collection_ids` array holding the rest. It is gone —
  `collection_id` is now the whole answer, in the client and in the policies.
  Run `supabase/single-list.sql` if the column is still on your table.
- **`Users` needs `supabase/profiles.sql` run against it.** Nothing else
  manages its RLS, and without an INSERT policy the profile row cannot be
  created. See **Signing up**.
- **`category_tag` (both tables) and `Users.icon` are unused** by the front end.
- **The CSVs in `Supabase Setup/` are stale.** `Activities.csv` predates
  `location_lat`/`location_lng`, which the live table has and the code depends
  on. Treat the table above as the reference, not the CSVs.
- `target_date` is **usually an ISO date now**, but the column is text and
  still holds bands. New writes resolve This Month / This Year / Next Year /
  In 2-3 Years to a real date (see **A band is resolved on the way in**);
  `"In 5+ Years"` is still stored as itself, and the retired `"Before I Die"`
  and `""` survive on old rows. `dateInfo()` in `utils.js` maps every one of
  them to a deadline and an urgency badge. Run `supabase/target-rollover.sql`
  to convert the rows written before this. `date_completed` *is* a real
  date; completion is inferred from it being non-null.
- `photos` and `links` are JSON array columns. `mapActivity` tolerates them
  arriving as either arrays or JSON strings. **`photos` holds two shapes** — a
  bare string for a photo, an object for a video — see **Media** above.
- **Storage:** a `media` bucket holds completion photos and video, one folder
  per user, created by `supabase/storage.sql`. Optional; the app falls back to
  inline base64 photos without it.

**Security:** `SUPABASE_KEY` in `config.js` is the publishable/anon key and is
meant to be public, but it only protects data if **Row Level Security is enabled
on all three tables *and* no permissive policy undoes it**. This project shipped
for a while with a policy literally named `ALL` on each table —
`to authenticated`, `cmd ALL`, `using (true)` — which OR'd over every correct
policy and gave every signed-in user full access to everyone's rows.
`supabase/rls-lockdown.sql` removes them and carries the audit query.
**Checking this from the client is not possible**: those policies grant nothing
to an anonymous request, so an unauthenticated probe returns `[]` and the
project looks locked down. `fetchActivitiesFor`/`fetchAllActivities` query by
`collection_id` with no user check and rely entirely on RLS to scope results;
`fetchCollections` filters on `user_id` client-side, which is not a security
boundary. Confirm RLS policies before treating any of this as private.

Running `sharing.sql` **enables RLS on `Collections` and `Activities`** and
adds `bl_*`-named policies covering owner-or-member access. It leaves any
pre-existing policies alone, and multiple permissive policies are OR'd
together — so check the Policies tab afterwards and drop anything now
superseded, or an older broader policy will keep granting what it granted.

Note that with sharing on, `fetchCollections()` **drops its client-side
`user_id` filter** and leans entirely on RLS, because a joined list is not
one you own. With sharing off the filter stays, since without RLS removing
it would return every user's rows.

## PWA / installability

The app installs to an iPhone home screen and runs chrome-less and offline.
Four pieces make that work, and all four must stay in sync:

1. **`manifest.webmanifest`** — `display: standalone`, `start_url: ./index.html`,
   `theme_color`/`background_color` both `#efece6` (matching `--bg`, so the
   splash and status bar don't flash a different color), and three icons.
2. **The `<head>` meta block in `index.html`.** iOS ignores the manifest's
   display mode and icons, so `apple-mobile-web-app-capable`,
   `apple-mobile-web-app-status-bar-style`, `apple-mobile-web-app-title` and
   `<link rel="apple-touch-icon">` are what actually drive the iOS install.
   The status-bar style is `default` (an opaque light bar with dark text);
   switching it to `black-translucent` would put white status text over the
   cream background and make it unreadable.
3. **`viewport-fit=cover`** on the viewport meta, which is what makes the
   `env(safe-area-inset-*)` values in `base.css` non-zero once installed. Any
   fixed or full-bleed element must add the relevant inset — see `.navbar`,
   `.tabbar`, `.lightbox`, and the `pwa.css` overlays for the pattern.
4. **`sw.js`** — pre-caches the shell listed in `SHELL_ASSETS` on install,
   then serves same-origin files stale-while-revalidate, vendor bundles/fonts/
   map tiles/Unsplash covers cache-first, and navigations network-first with
   the cached `index.html` as the offline fallback. **Supabase and Nominatim
   are on `NEVER_CACHE_HOSTS`** — caching auth or live rows would serve a
   signed-out user stale data.

The icons are committed PNGs, not build output. `icons/generate.py` redraws the
whole set (`python3 icons/generate.py`, needs Pillow) — edit `draw_art()` there
rather than hand-editing the PNGs. Note the maskable variant deliberately draws
the artwork smaller so Android's adaptive-icon mask cannot crop the peaks.

Offline means *the shell*, not the data: activities come from Supabase, so a
cold offline launch shows the UI with empty lists plus the `.offline-bar`.

## The native iOS app

A Capacitor shell around the same web app: `capacitor.config.json`, the
Xcode project in `ios/`, and `scripts/build-www.js` assembling `www/` as
the bundle. **The assets are bundled, never fetched** — read the header
of that script before reaching for `server.url`.

**Three facts about WKWebView drive everything in this section**, and
all three are invisible from a browser:

1. **The page is served from `capacitor://localhost`.** So
   `location.origin` is not an address anybody else can open, and
   anything that builds a link out of it produces a dead one.
2. **A custom scheme gets no service worker.** `sw.js` never registers,
   so the offline shell, the update-reload and the install bar are all
   inert. That costs nothing — the assets are already in the binary,
   and the *data* offline layer (`offline.js`: the IndexedDB snapshot
   and the write queue) is untouched, which is the half that mattered.
3. **There is no `Notification` API either.** Which took the whole push
   feature with it — see below.

### Push is APNs here, not Web Push

`js/nativepush.js`, `supabase/native-push.sql`, and
`supabase/functions/_shared/apns.ts`.

**This shipped broken and silently.** Every push in the app went
through the service worker, so in the native build
`notificationsSupported()` answered false, the feature hid itself
exactly as designed, and reminders collapsed to the Home banner while
message notifications simply never arrived. Nothing said so; the code
was working correctly against a platform that could not do the thing.

Worse, the You tab's **Reminder alerts** row was a *dead control*. Its
handler was built as `state==='default' ? request : () => { if denied …
else if granted … }`, and `'unsupported'` — the state the native app
was always in — fell off the end into a function that ran and did
nothing at all.

So the native app registers with APNs and stores its **device token in
the same `push_subscriptions` table**, with `platform='ios'`.

Things to keep:

- **One table, not two.** Every question either sending function asks —
  who the audience is, who has muted, who has already been told, which
  endpoints are stale — is per *user*, not per transport. Splitting it
  would duplicate all of that and give the two halves somewhere to
  disagree about who was notified. `platform` is read at exactly one
  point: which sender to use.
- **The token is the `endpoint`.** It is unique in the same way a Web
  Push endpoint is — one install, one device — so it shares the unique
  key. `p256dh`/`auth` are null, and a check constraint keeps
  "nullable" from meaning "optional for a web row too".
- **The transports are branched once, in `reminders.js`.**
  `notificationsSupported()` and `notificationState()` are the only two
  functions that know there is a choice; nothing else touches
  `Notification` directly.
- **The notification is composed once and rendered twice.** Both Edge
  Functions build one object, then stringify it for Web Push and map it
  onto `aps` for APNs. Two renderings of one object cannot disagree
  about what the banner says.
- **A tap lands in the same place either way.** `nativepush.js` writes
  the same `pendingConv`/`pendingAct` globals `messages.js` already
  reads, then calls its `handlePushLanding()` — so a cold start and a
  warm one cannot drift apart.
- **Registration never prompts.** `registerNativePush()` re-registers
  only when permission is already granted, on every launch — a token is
  reissued after a restore from backup. The prompt lives behind the You
  tab's row, the same rule `primeBias()` follows for geolocation. It is
  called directly from `showApp()` rather than from the
  `probeRemindColumn()` block beside it, because the native permission
  is read *asynchronously* and that block's `notificationState()` check
  would still be reading a stale `'default'` on the first launch.
- **The middle delivery tier does not exist natively, and does not need
  to.** Tier 2 — a local notification fired because the app happened to
  be opened on the day — exists for browsers that can show a
  notification but cannot receive a push. The native app *can* receive
  one, so `checkDueReminders()` returns early there. Tier 1, the Home
  banner, is unaffected.
- **⚠️ `APNS_ENV` is the trap.** An Xcode build gets a **sandbox**
  token; TestFlight and the App Store get **production** ones. Sending
  one to the other's host answers `400 BadDeviceToken` — identical to a
  genuinely uninstalled app — so the row is *pruned* and the device
  silently stops receiving. Both functions report `apnsSkipped` so an
  unconfigured project is a count rather than a mystery. See
  `supabase/README.md` §2b.

**No badge on a message push.** An absolute count would need one query
per recipient on a path the sender is waiting on; omitting `badge`
leaves it untouched, and `updateMessagesBadge()` overwrites it with the
truth on the next open. `navigator.setAppBadge` itself is a no-op in
WKWebView, so the icon badge is web-only today.

### Links that leave the device

`APP_WEB_ORIGIN` + `publicOrigin()` in `config.js`. **`location.origin`
is `capacitor://localhost` in the shell**, and two things were building
links out of it:

- **`inviteUrl()`** produced `capacitor://localhost/index.html?join=…`.
  Copying worked, sending worked, and the recipient got a URL their
  phone did not recognise. Every invite shared from the iOS app was
  dead.
- **`confirmRedirectUrl()`** produced the same thing for
  `emailRedirectTo`. Supabase silently falls back to the project's Site
  URL for a redirect that is not allow-listed, so confirmation *worked*
  — by landing in Safari, on the web copy, leaving the person who just
  signed up inside the app with an apparently unconfirmed account.

Both now go through `publicOrigin()`, which answers with
`APP_WEB_ORIGIN` when it is set, `location.origin` in a browser, and
**nothing** on a `capacitor:`/`file:` origin — a link nobody can open
is worse than no link.

### Universal Links

`js/deeplink.js`. CLAUDE.md's **Shared lists** section says "iOS cannot
be made to open the PWA instead of Safari, [because] Universal Links
need a native app and an AASA file." There is now a native app, so that
wall is down: an invite tapped in Messages opens the list in the app.

**Four things must name the same domain or this silently does nothing:**
`APP_WEB_ORIGIN` (`config.js`), `applinks:<host>` in
`ios/App/App/App.entitlements`, the `appIDs` entry in
`.well-known/apple-app-site-association`, and the host actually serving
that file. iOS fetches it once at install, caches the result, and
reports no error anywhere — links just keep opening in Safari. See
`.well-known/README.md` for the four things the *host* has to get right
(https, no redirect, `application/json`, no auth).

Things to keep:

- **It does not navigate the web view to the URL.** That would replace
  the bundled app with the website — the Guideline 2.5.2 problem
  `build-www.js` warns about, arrived at from the other end. What
  travels is the link's *meaning*, handed to the same globals the boot
  readers use.
- **`getLaunchUrl()` as well as the `appUrlOpen` listener.** On a cold
  start the event can fire before the listener exists, which is a race
  this file cannot win. `handleDeepLink()` is idempotent for one URL,
  so being told twice costs nothing.
- **`initDeepLinks()` runs after the three boot readers**, in
  `main.js`. `getLaunchUrl()` is a promise and cannot resolve before
  the next tick, so it always lands second — the other order would have
  `readPendingJoin()` overwrite the captured code with the nothing it
  finds in a `capacitor://` URL.
- **A hash route is handed to `router.js`**, by writing
  `location.hash`, rather than re-implementing the routing table. When
  the hash is already the current one no `hashchange` fires, so
  `onRouteChange()` is called directly.
- **`.well-known/` is deliberately NOT in `www/`.** It is served by the
  website to a device that has not opened the app; `build-www.js`
  assembles what goes *inside the binary*. Two different jobs.
- **A confirmation or reset link arriving mid-session is not handled.**
  Those are consumed at boot, and replaying that sequence with a live
  session in place is a different problem. In practice somebody
  following one is signed out and launching cold, which works.

### Haptics

`js/haptics.js`. Two calls, and deliberately no more: `hapticTap()`
when the check is pressed, `hapticSuccess()` when a completion is
saved. **Haptics on every tap is the same mistake as captioning every
field** — it stops meaning anything, and it is the specific thing
people turn off. Do not add one to navigation, sheet dismissal or
ordinary buttons.

Both honour `prefers-reduced-motion`, the same test `confetti()`
already makes, and both swallow their own failures: a device with the
Taptic Engine switched off rejects them, and an unhandled rejection for
something purely cosmetic is not worth a console line.

`hapticTap()` hangs off **`openCompletedDate()`**, not `openComp()` —
both `toggleComplete()` and Home's `toggleCompleteFrom()` funnel
through the first, while the second is also reached by
`openCompFrom()` when *editing* something already finished, where a
completion haptic would be a lie.

### Plugins are reached through `Capacitor.Plugins`, never imported

The pattern `nav.js` already established for Keyboard, and the reason
none of this needs a bundler: the native side registers a plugin and
the runtime exposes it on `window.Capacitor.Plugins`. So every guard in
these three files is load-bearing rather than defensive — in a browser
`window.Capacitor` does not exist and they all do nothing.

**They still need the npm package installed and `npx cap sync ios` run**:
the JS is a proxy onto native code that has to be in the binary.
Without it every function answers the same "unsupported" a browser
gets, which is the honest degradation this app applies everywhere else.

### iPhone only

`TARGETED_DEVICE_FAMILY = "1"`. It was `"1,2"`, which declares iPad
support — and that obliges the submission to carry 13" iPad screenshots
and makes iPad layout reviewable. The layout caps content at
`--content-max` (720px at ≥1000px), so on a 13" iPad the app is a
narrow column in a field of parchment: honest phone-first design, and
not something to put in front of a reviewer as an iPad app. Setting it
back to `"1,2"` means designing for iPad first.

`UISupportedInterfaceOrientations~ipad` is still in `Info.plist` and is
now inert.

## Mobile layout rules

Worth knowing before touching any stylesheet. The layout is **phone-first** —
these are the defaults, not overrides.

- **Horizontal padding comes from `--gutter`**, via `var(--gx-l)`/`var(--gx-r)`
  (gutter + the matching safe-area inset). Don't hardcode a screen inset — set
  `--gutter` at the breakpoint and everything follows.
- **Inputs must never compute below 16px.** Safari zooms the whole page when a
  focused field's text is smaller, and it stays zoomed. Every field in the app
  uses `font-size: max(16px, 17px)`.
- **A `width: 100%` element must never also carry horizontal margins.**
  Together they make it wider than its parent, and the resulting horizontal
  scroll drags `position: fixed` elements sideways on iOS — so the tab bar and
  any open sheet end up visibly offset. That happened with `#mapContainer`
  (`.map-box` sets `width: 100%`, the detail map adds gutters) and presented as
  three unrelated-looking bugs: a map that ran off screen, a clipped "Add Many"
  sheet, and a drifting tab bar. `width: auto` is the fix and is load-bearing.
- **The tab bar is `translateZ(0)`** so iOS gives it its own layer; without it
  fixed elements repaint late during momentum scrolling and appear to drift.
  `--tab-inset` is floored at 6px for the same reason `--nav-inset` is.
- **The tab bar must stay behind the keyboard, not ride up on it.** It is
  `position: fixed; bottom: 0`, and on iOS the software keyboard shrinks the
  *visual* viewport while leaving the layout viewport alone — Safari then
  re-anchors fixed elements to the visual one, so the bar climbs and parks
  on top of the keyboard, under the predictive-text row. Script cannot opt
  out of that, but `syncTabbarToKeyboard()` in `nav.js` corrects it by
  **measuring the bar itself**: it clears its own transform, reads
  `getBoundingClientRect().bottom` against `window.innerHeight`, and
  translates back down by the difference. Three things to keep:
  - **Measured, not platform-sniffed.** A browser that already pins fixed
    elements to the layout viewport (Chrome on Android) measures a drift of
    zero and gets no transform, so no `isIOS()` guess is involved — and one
    that lifts the bar by something other than the keyboard's height is
    still corrected exactly.
  - **The tab bar and nothing else.** Bottom-anchored sheets *should* rise
    with the keyboard — that is the entire reason they are bottom-anchored.
    Do not generalise this to them.
  - **`translate3d`, not `translateY`.** An inline transform overrides the
    CSS `translateZ(0)`, so it has to carry the layer promotion itself.
- **The nav bar has its own inset, `--nav-inset`,** floored at 14px. In an
  installed PWA the notch inset already provides room; in a browser tab
  `safe-area-inset-top` is 0 and the back button ended up pinned against the
  viewport edge. Only pushed screens (`.page-pushed`) pad down to match — root
  tabs keep the tighter offset, since their bar is empty until you scroll and
  padding it out just puts dead space above the title.
- **One column, and the cap is on `.page`, not on its children.** Every
  screen-level container insets itself by a gutter, but they use two different
  mechanisms — `margin: 0 var(--gx-r) 0 var(--gx-l)` (the detail banner, the Up
  Next card, `.act-group`) or the matching `padding` (`.searchbar`, `.shelf`,
  `.home-sec-head`). On a phone the two are indistinguishable, and **either is
  fine**.

  They stop being equivalent the moment something caps the *children*. That is
  what `responsive.css` used to do (`.page > * { max-width: 640px;
  margin-inline: auto }`), and `margin-inline: auto` overrides a margin gutter
  while leaving a padding one untouched — so margin-based containers ran a full
  gutter wider on each side than padding-based ones. It shipped twice: Home's
  photo shelf sat narrower than the cards above it, and on a collection screen
  the banner visibly bled past the search field and list beneath it.

  Capping `.page:not(.page-map)` instead keeps both mechanisms honest: every
  child measures from the same edge and applies the same gutter to it, so they
  line up by construction. `--content-max` is the single token (640px, 720px at
  ≥1000px); the page cap and both nav-bar paddings derive from it.
- **Fixed chrome has to re-derive the column.** `.navbar` is `position: fixed`,
  so it spans the viewport and inherits nothing from `.page`. It takes
  `var(--gx-l)`/`var(--gx-r)` on a phone and, at ≥700px, is padded to
  `(100% - var(--content-max)) / 2` — the content's own left edge — so the back
  button sits directly above the first card's corner rather than floating
  inboard of it. The tab bar deliberately stays centred and compact instead:
  four tabs stretched across 720px drift away from the thumb.
- **`.sheet-body` has NO horizontal padding, so every block inside a
  sheet insets itself — and a block written for life inside a `.fg`
  does not.** This is the single commonest way text ends up flush
  against the glass, and it shipped in five places at once: the
  completion sheet's requirement hint and its photo-location chip, the
  reminder sheet's resolved date (`.fg-hint`), the join-by-code sheet's
  lead, error and note, and the whole of the invite and accept-invite
  sheets, whose bodies are rendered by `sharing.js` out of blocks
  (`.shr-*`, `.join-*`, bare `.btn-block`s) that carry no gutters at
  all. Two shapes of fix, and which one you want depends on the body:
  a body whose children are *all* bare takes the padding itself
  (`#shareListBody`, `#joinBody` — and the two children that do inset
  themselves, `.group` and `.sheet-actions`, have their margins zeroed
  there or they are inset twice); a body that mixes the two insets only
  the bare blocks (`#joinCodeSheet`). **Re-run the audit below after
  touching any sheet.**
- **A component's container and one of its inner spans must not share a class
  name.** This bit twice, in the same way. `.up-list` was the card wrapping
  Home's Up Next rows *and* the span naming a row's collection; `.dupe-list`
  was the card holding duplicate matches *and* the span naming a match's
  collection. Both spans silently inherited their card's ring and radius with
  no padding, so the list name rendered inside a stray outlined box with the
  text flush against it. Both now use **`.list-chip`** (see below). If you find
  yourself writing `.foo .foo`, rename one of them.
- **A label belongs to the field below it.** Keep the gap under a label
  smaller than the gap above it (currently 6px vs 22px), or it reads as a
  caption for whatever precedes it. This was a real bug: the first label in a
  disclosure sat flush against the toggle button.
- **Fixed chrome must account for the safe areas.** `--chrome-top` and
  `--chrome-bottom` already fold the nav/tab bar heights together with the
  notch and home-indicator insets; use them rather than re-deriving.
- **Never abbreviate a unit in a glanceable label.** `dateInfo()` spells out
  "5 months left", not "5 mos left" — an abbreviation saves a few pixels and
  makes the reader decode instead of read. Give the label a fixed slot and
  truncate something else around it.
- **A hidden `<input>` inside a `.fg` needs `.fg [hidden] { display: none }`.**
  `.fg input { display: block }` outranks the browser's own `[hidden]`
  rule, so a hidden file input paints as a full-width native "Choose
  File" control — a second, unstyled button beside the real one. Both
  file pickers in the app (cover photo, and photos/video) sit in a `.fg`
  and both showed it.
- **Put the tap target on the row, not on the text inside it.**
  `.act-row`, `.up-row` and `.rem-row` carry the `onclick`; the inner
  `.act-main`/`.up-main` button is layout only, and the check button
  calls `stopPropagation()` so it still toggles rather than opening.
  With the handler on the inner button instead, the thumbnail and the
  trailing chevron — the part that most looks like "tap to open" — were
  dead space.
- **Tap targets are 44px** for anything primary. Deliberate exceptions, matching
  Apple's own control sizes: segmented controls (32px) and search fields (36px).
- **Viewport heights use `svh`/`dvh` with a `vh` fallback.** Plain `100vh` is
  wrong on iOS, where it counts the collapsed-URL-bar height.
- **A sheet must be reset to the top when it opens.** `.sheet-body` keeps its
  `scrollTop` between openings, so once one has been scrolled — to reach the
  buttons at the bottom of the activity sheet, say — every later opening starts
  there and whatever is at the top is silently missing. It does not *look*
  scrolled, because `.sheet-grabber` is `position: absolute` on the `.modal`
  and stays put. This cost real time twice: it presented as "the activity sheet
  has no title" when the title was there all along. `openModal()` resets it.
- **Every bottom sheet is one locked height — 75dvh — never its content
  height.** `.modal` sets `height`, not just `max-height`, so the activity
  sheet, the completion sheet and the reminder sheet are all the same size
  whatever is inside them. A sheet that resizes per contents reads as the app
  guessing. Landscape opens it out to full height, since there is no room to
  give up. Don't add a per-sheet height override; `#remindSheet`'s is gone
  because every sheet now covers the one below it by construction.
- **Sheets are the only modal style below 700px** — bottom-anchored, full width,
  rounded top. Anchoring to the bottom edge keeps a focused field in a stable
  place when the keyboard resizes the viewport. At ≥700px `responsive.css`
  re-centres them as dialogs and drops the grab handle.
- **Nothing may be hover-only.** There is no hover on a phone. `responsive.css`
  confines every hover affordance to `@media (hover: hover)`.
- **Nothing may sit within 14px of the window edge.** Every screen is audited
  for this (see below); the gutter is 16px even on a 320px phone, and the fixed
  bars, sheet bars and action sheet all inset their contents to match. When
  adding a full-bleed element, pad its *contents* rather than letting text or
  icons run to the glass. The only deliberate exception is the map, which is
  meant to bleed.

  This is also why Home's two shelves are **grids, not horizontal
  scrollers**. A scroller necessarily runs its content off the edge — at rest
  the last card sits clipped flush against the glass — so `.shelf` lays them
  out in an inset grid instead. Resist re-introducing a carousel here.

### A note on verifying layout in headless Chrome

Four traps cost real time when this was built, all worth knowing before
trusting a screenshot:

1. **Chrome clamps its window to a 500px minimum width**, so `--window-size=390`
   silently renders at 500 and crops. Render the app inside a fixed-width
   `<iframe>` instead — media queries and `dvh` resolve against the iframe.
2. **CSS animations don't advance under `--virtual-time-budget`.** A screen
   that enters with `anim-push` will be measured at its `translateX(28px)`
   start offset and look like a 28px horizontal overflow that does not exist.
   Neutralise the animation before measuring; `--force-prefers-reduced-motion`
   does *not* reach into an iframe.
3. **WebGL is off under `--disable-gpu`**, which the map needs. Run Chrome with
   `--enable-unsafe-swiftshader --use-gl=angle --use-angle=swiftshader`, and
   expect it to be slow: the map's tiles and markers need ~10s of *real* time,
   which `--virtual-time-budget` does not provide. Keep the browser alive with
   `--remote-debugging-port` and have the page report its own state if you need
   to check the map actually loaded.
4. **Measure the content box, not the border box,** when auditing edge insets.
   A full-width block whose text is padded inwards is fine; comparing
   `getBoundingClientRect()` alone reports it as touching the edge.

**The edge-inset audit is worth rebuilding rather than eyeballing.** Copy
`index.html`, replace the supabase CDN tag with a stub `createClient`, drop
`main.js` and `pwa.js` so nothing tries to authenticate, reassign the
`fetch*` functions to return fixtures (they are plain function
declarations in one shared scope, so they can simply be overwritten), then
for each screen and each `.modal-overlay` walk every element that owns a
text node or is a field and flag a content edge inside 14px. Chrome clamps
its window to 500px, which is fine — a block with no gutter measures 0
there too. Headless cannot print to stdout in this Chrome, so have the page
write its findings into a fixed white `<div>` and take a `--screenshot`.

## Adding a screen

1. Add `<div class="page" id="page-yourpage">` in `index.html`.
2. Decide whether it is a **root tab** or a **pushed screen**:
   - root tab → add a `<button class="tab" data-tab="yourtab">` to `.tabbar`,
     a `PAGE_TAB` entry in `nav.js`, a case in `selectTab()`, and a line/solid
     glyph pair in `paintStaticIcons()` (`main.js`). Five tabs is the practical
     ceiling on a phone;
   - pushed screen → add a `PAGE_TAB` entry pointing at the tab that owns it,
     and give it a back button in `updateNavbar()`.
3. Add its bar buttons to `updateNavbar()` in `js/nav.js`.
4. Create `css/yourpage.css`; `<link>` it *before* `responsive.css`. Use
   `var(--gx-l)`/`var(--gx-r)` for horizontal padding, and reach for the
   primitives in `components.css` before writing new ones.
5. Create `js/yourpage.js` with `renderYourPage()`; add its `<script>` tag
   *before* `pwa.js`.
6. Add `if(page==='yourpage') renderYourPage();` to `nav()`, and a line to
   `refreshAfterChange()` if a mutation can happen while it is showing.
6b. Add a route key to `ROUTE_PAGE` in `js/router.js` (plus `ROUTE_ID` if it
   addresses one collection), or the screen writes no URL and Back skips
   straight past it.
7. If it is a pushed screen, add it to the `PUSHED` array in `nav()` so it
   animates in from the right and swipes back.
8. Add both new files to `SHELL_ASSETS` in `sw.js` and bump `CACHE_VERSION`.
9. **Update this file** — File structure, the CSS/JS file maps, and the
   Screens table.

Two things that will bite:

- **Refer to files as `foo.js`, never `js/foo.js`, in `index.html`
  comments.** The shared-scope check greps the whole file, so a path in a
  comment concatenates that file twice and reports every top-level
  declaration in it as a duplicate. This cost real time on the search
  screen.
- **`--dump-dom` produces nothing in Chrome 151.** The headless recipes in
  the layout note below need driving over CDP (`--remote-debugging-port`
  plus `Runtime.evaluate`) rather than dumping to stdout.

## Verifying which migrations have run

Every optional piece of this app probes for itself and hides when it is
absent, which is the right behaviour and means **a migration nobody ran
is invisible from inside the app**. Several entries in the backlog below
were stale for months for exactly that reason. Ask the database rather
than trusting them:

```sql
select
  (select count(*) from information_schema.columns
     where table_name='Activities' and column_name='extra_collection_ids') as needs_single_list,
  (select count(*) from information_schema.columns
     where table_name='Users' and column_name='difficulty_profile') as has_diff_profile,
  (select count(*) from information_schema.columns
     where table_name='Activities' and column_name='difficulty_manual') as has_diff_override,
  (select count(*) from information_schema.columns
     where table_name='Users' and column_name='avatar_url') as has_avatars,
  (select count(*) from information_schema.columns
     where table_name='Users' and column_name='terms_accepted_at') as has_moderation,
  (select count(*) from information_schema.tables
     where table_name='user_blocks') as has_blocks,
  (select count(*) from information_schema.columns
     where table_name='push_subscriptions' and column_name='platform') as has_native_push,
  (select count(*) from "Activities"
     where target_date in ('This Month','This Year','Next Year','In 2-3 Years')) as needs_rollover;
```

`needs_single_list` and `needs_rollover` should be **0**; everything else
should be **1**.

**`has_native_push` is the one that is not optional if the iOS app is
being shipped.** Without it the native app cannot store an APNs token
at all, so reminders and message notifications do not exist on the one
platform being submitted — and, like every other missing migration
here, that is invisible from inside the app. Run
`supabase/native-push.sql`.

**And the migration is only half of it.** The `APNS_*` function
secrets cannot be checked from SQL or from the client. Both push
functions report `apnsSkipped` in their JSON for exactly this reason:
a non-zero count means a device is registered and the secrets are not
set. See `supabase/README.md` §2b.

**And the RLS audit is a different question that no client can answer.**
The project shipped for a while with a policy literally named `ALL` on
each of the three core tables, granting every signed-in user full access
to everyone's rows — and an anonymous probe came back empty, so it
looked locked down. Only `pg_policies` can tell you:

```sql
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies where schemaname='public' order by tablename;

select tablename, rowsecurity from pg_tables
where schemaname='public' order by tablename;
```

Anything with `qual` of `true` on `Collections`, `Activities` or `Users`
is the bug; `supabase/rls-lockdown.sql` removes them. Note that an
INSERT policy's condition lives in `with_check` and is null in `qual`,
so a query selecting only `qual` reports every insert policy as
unconstrained when it is nothing of the kind.

*Audited 31 Aug 2026: all 12 tables have RLS on, every policy correctly
scoped, and `reminder_deliveries` / `invite_claims` are RLS-on with no
policies at all — reachable only by the service role, which is the
design.*

## Known issues / cleanup backlog

- **⚠️ FOUR PLACEHOLDERS HAVE TO BE FILLED IN BEFORE THE NATIVE APP
  SHIPS**, and every one of them fails silently rather than loudly:
  `APP_WEB_ORIGIN` in `js/config.js` (empty — invite links and the
  confirmation redirect fall back to `location.origin`, which in the
  shell is `capacitor://localhost`), `applinks:REPLACE-WITH-YOUR-DOMAIN.example`
  in `ios/App/App/App.entitlements`, `REPLACE-WITH-TEAM-ID` in
  `.well-known/apple-app-site-association`, and `[YOUR JURISDICTION]`
  in `legal/terms.html`. Grep for `REPLACE-WITH` and `[YOUR`.
- **Native push is unverified against a real device**, like the
  location guess and the difficulty rating before it. The JWT signing,
  the payload shape, the prune reasons and the client branch are all
  written and none of it has spoken to Apple. Expect the first failure
  to be `APNS_ENV` (see below) or a missing Push Notifications
  capability on the App ID.
- **⚠️ `APNS_ENV` mismatches present as a dead device, not an error.**
  An Xcode build gets a sandbox token and TestFlight/App Store get
  production ones; sending one to the other's host answers
  `400 BadDeviceToken`, which `_shared/apns.ts` treats as terminal and
  prunes — correctly, since that is also what an uninstalled app
  answers. So a debug build silently stops receiving after one send and
  the row is gone. There is no way to serve both from one setting,
  because the token does not say which it is.
- **The app icon badge is web-only.** `navigator.setAppBadge` is a
  no-op in WKWebView, and `send-message-push` deliberately omits APNs's
  `badge` because an absolute count would cost one query per recipient
  on a path the sender is waiting on. So the native app never shows an
  unread count on its home-screen icon. Fixing it means either a
  fourth Capacitor plugin or a cheap per-user unread count the service
  role can read.
- **There is no local-notification tier in the native app.** Tier 2 of
  the three in `reminders.js` — a banner fired because the app was
  opened on the day — needs `@capacitor/local-notifications`, a fourth
  plugin, and was left out: the native app has real push, which is
  strictly better, and the Home banner still covers the case where the
  cron has never run. It becomes worth adding the moment background
  delivery proves unreliable.
- **A message sent while offline still never notifies anybody**, and
  the native app does not change that — `flushQueue()` upserts directly
  and never calls `notifyMessageSent()`. Unchanged from the Web Push
  version of this entry; teaching the flush to fire it for replayed
  `messages` inserts is still the few-line fix.
- **Nothing in the repo can assert that Universal Links work.** Four
  things have to name one domain and a fifth (the host's content-type
  and redirect behaviour) is outside the repo entirely. iOS caches the
  AASA at install and reports nothing on failure, so the only test is
  to install the app and tap a link. Delete and reinstall after
  changing the file — the cached copy is not refreshed.
- **`target="_blank"` on the two legal links is unverified in
  WKWebView.** `index.html` opens `legal/privacy.html` and
  `legal/terms.html` that way from the sign-up screen and the You tab,
  and Capacitor's handling of `_blank` on a *local* URL may be a no-op.
  If it is, the Terms link under Create Account is dead — which is
  precisely the Guideline 1.2 requirement that the terms be reachable
  before the account exists. Test on device; the fix is
  `@capacitor/browser` or an in-app route.
- **The launch screen is still the stock Capacitor splash.** All three
  `Splash.imageset` PNGs are byte-identical defaults and
  `LaunchScreen.storyboard` uses `systemBackgroundColor` — so launching
  in dark mode flashes **black** before the app's `#16140f`, and white
  before `#efece6` in light. Cheap to fix and the first thing anyone
  sees.
- **The App target has no `PrivacyInfo.xcprivacy`.** Capacitor ships
  privacy manifests for its own frameworks
  (`node_modules/@capacitor/ios/…`), but the app target declares
  nothing. Separately, the App Store Connect privacy questionnaire is
  mandatory and non-trivial here: the app collects email, name, photos,
  **precise location** and user content.
- **App Review needs a demo account.** The app is behind an auth wall
  with email confirmation on, so a reviewer who signs up has to go and
  find a confirmation email. Put pre-confirmed credentials in the
  review notes, on an account with real lists, photos, and a shared
  list carrying a conversation — otherwise the likely outcome is a 2.1
  "unable to review".

- **A location typed offline never gets coordinates.** `requireLocation()`
  accepts the text and lets the activity sync without a pin, because blocking
  capture in a tunnel is the worse failure — but nothing re-resolves it when
  the connection comes back, so it stays off the map until someone edits it.
  A sweep in `revalidate()` over rows with a `location` and null
  `location_lat` would close it.
- **Place search needs `geo` deployed and `HERE_API_KEY` set as a secret**,
  or it runs on the Nominatim fallback: no typo tolerance ("Jamab Juice"
  returns nothing) and no near-me ranking. Everything works, less well. See
  **Searching for a place**.
- **The geo function has no server-side cache.** The client's session cache
  and the browser's HTTP cache absorb most repeats, but two different users
  searching the same thing are two HERE calls, and so is the same user
  tomorrow. A small `query → results` table would fix it — the same table the
  import path already wants.
- **Nothing re-flags an activity as Home retroactively.** The `location_is_home` column defaults false, so activities set to your home address *before* this shipped do not follow a move. They have to be re-picked with the Home shortcut once.
- **Home is one place, not several.** No Work, no saved favourites. The
  storage is three columns on `Users`; the point at which that stops being
  enough is the point it becomes a `user_places` table, and `home.sql` says so
  in its header.
- **The location requirement is not enforced on existing rows.** Activities
  created before it still have no location and are only fixed by hand. The
  edit path is deliberately exempt (see **A location is required**), so
  nothing forces the issue.
- **~~Rows written before the `media` bucket existed still carry base64
  photos.~~ DONE.** `tools/media-backfill.py` moved them; the audit after
  that run showed 0 inline items. The script stays for anything that
  slips through — it is idempotent and dry-run by default.
- **Reordering media is drag-only.** There is no keyboard or
  assistive-technology path to it, and the tiles are not focusable. The button
  menu it replaced was reachable; this is not. A long-press menu as a fallback
  would fix it without giving the gesture up.
- **EXIF location is unverified on a real iPhone.** JPEG and HEIC are both
  handled and mime-type mislabelling no longer matters, so the known ways
  it could silently fail are closed — but it has only been tested against
  constructed fixtures and headless Chrome, never a real camera roll. It
  degrades to silence, which is correct and also means a failure is
  invisible; `handleMedia()` logs one `[media] photo location:` line to
  the console naming which gate it fell through. The same parser could
  read `DateTimeOriginal` to suggest the completion date too; it does not.
- **Deleted media is not removed from storage** — only its URL is dropped
  from the row. That is now true in **two** places: the sweeper query at the
  bottom of `supabase/storage.sql` covers the old Supabase objects, and
  nothing at all reaps orphans in R2. The backfill also left every migrated
  original in the Supabase bucket rather than deleting it, deliberately —
  keeping a file costs kilobytes, deleting one somebody still references
  costs them a photo.
- **Mutations re-render from the cache, but there are no optimistic updates.**
  A quick-add still waits for the insert itself before the row appears — one
  round trip now, down from five, but not instant. (Offline it *is* instant,
  because the write is applied to the snapshot and queued — which is a good
  hint at how the online path should eventually work.)
- **~~Legacy base64 photos are still on the list query's critical path.~~
  DONE.** This was the egress overage: 8.9MB of images inside
  `Activities.photos`, re-sent on every cold launch and every
  `revalidate()`, on every device. All of it is on R2 now. **The shape of
  the bug is worth remembering** — `photos` cannot be dropped from the
  select, because `a.photos[0]` is the cover every thumbnail, grid card and
  map pin draws, so anything inline in that column is on the critical path
  by construction.
- **⚠️ Media created offline stays base64 forever, and this is now the
  ONLY way base64 can re-enter the table.** A photo attached with no
  connection is embedded in the row and syncs that way; nothing later
  uploads it and rewrites the column. `FALLBACK_PHOTO_QUALITY` keeps
  those rows small so the bleed is slow, and `tools/media-backfill.py`
  clears them whenever it is run — but that is a person remembering to
  run it. **The durable fix is a sweep in `revalidate()`** over `photos`
  entries starting with `data:`, re-uploading through the same path
  `uploadPhoto()` uses. Until that exists, re-run the backfill
  occasionally.
- **The write queue has no cap and no age-out.** Someone offline for a very
  long time accumulates ops indefinitely, and a queued write against a row
  another device has since deleted is dropped on replay with only a console
  warning — the user is told "1 change couldn't be synced" but not which.
- **A message sent while offline never notifies anybody.** The push is
  fired by the client right after the insert; the offline queue replays
  through `sb.from().upsert()` in `flushQueue()`, which does not go near
  it. Fixing it means either the database trigger this deliberately
  avoids, or teaching `flushQueue()` to call `notifyMessageSent()` for
  replayed `messages` inserts — the second is a few lines and is the one
  to do if it bites.
- **Nothing notifies about a note.** Adding to an activity's log is
  silent, including when a message is promoted into it. Arguably correct
  — the conversation already carried it — but somebody adding a note
  nobody discussed goes unseen.
- **The hub does not update live.** `postgres_changes` filters on a single
  column, so realtime reaches the open conversation and nothing else — the
  unread counts refresh on foreground and after a send. Somebody sitting on
  the Messages tab watching it will not see a new message arrive in another
  list. The fix is Supabase's broadcast-from-database pattern with a
  per-user channel, which is a real amount of machinery for a case the push
  above would mostly cover.
- **A conversation cannot be read offline.** Unlike every other screen,
  messages are not in the IndexedDB snapshot (deliberately — see
  **Messages**), so a tunnel shows an explanatory empty state. *Sending*
  offline works and queues. Caching the last page per conversation in its
  own object store would close it without dragging messages into the main
  snapshot.
- **Notes cost a round trip per activity opened.** `renderActivityNotes()`
  queries on every open of the activity sheet, whether or not that activity
  has any notes, and whether or not its list is shared. It is a small query
  behind a placeholder so nothing waits on it, but a count denormalised onto
  `Activities` — or simply skipping the fetch on unshared lists — would
  avoid most of them.
- **There is no unread mark on individual messages.** `conversation_reads`
  stores one `last_read_at` per person per list, which is enough for the
  count and not enough to draw a "new messages" line in the thread itself.
- **Reading a conversation marks the whole thing read**, even if you only
  saw the top of it. Opening the screen calls `markConversationRead()`;
  there is no per-message viewport tracking.
- **`activity_ids` is never cleaned up.** An activity deleted outright
  leaves its id in every message that mentioned it, which renders as "no
  longer in this list" — correct-ish, but it conflates *deleted* with
  *moved out of this list*. Distinguishing them needs a lookup the chip
  deliberately does not make.
- **A message cannot be edited.** Only soft-deleted. The `edited_at` column
  exists and nothing writes it.
- **Shared lists are last-write-wins with no presence.** Two people editing the
  same activity in the same minute silently clobber each other, and there is no
  indication that anyone else is in a list or has changed something. Realtime
  subscriptions would be the natural fix; `revalidate()` on foreground is what
  there is today.
- **A shared list has one reminder, not one per person.** `remind_at` is a
  column on the activity, so the last person to save a reminder overwrites
  whatever the previous one set, and nobody can keep a private nudge about a
  shared activity. The delivery side is per-user now
  (`reminder_deliveries`); the *setting* side is not. Making it per-person
  means moving `remind_at` out to its own table, which is a real schema
  change and a real UI change — the sheet would have to say whose reminder
  it is showing.
- **Background push depends on the cron, not on the key or the deploy.**
  `VAPID_PUBLIC_KEY` *is* set in `config.js` and `send-reminders` *is*
  deployed (verified: a nonexistent function name returns 404, this one
  returns 401 on a bad JWT). What is left is the two function secrets
  (`VAPID_PRIVATE_KEY`, `CRON_SECRET`) and the pg_cron job from
  `cron.sql`, which nothing in the repo can assert. Until the sweep
  actually runs, reminders are the Home banner plus the on-open local
  notification. (This entry used to say the key was empty; it is not.)
- **⚠️ The cron call needs an `Authorization` header, and this is a silent
  failure.** `send-reminders` is deployed with JWT verification on, so
  Supabase's gateway rejects a bearer-less request *before it reaches the
  function* — meaning the 401 never appears in the function's own logs and
  the whole thing looks like a cron that never fired. `cron.sql` now
  presents the anon key (public by design, already in `config.js`) purely
  to clear the gateway; `x-cron-secret` is still what authorises the send.
  Deploying with `--no-verify-jwt` is the alternative and is defensible
  for this one function because it has that second gate — it remains
  forbidden for `unfurl` and `geo`, which do not.
- **A member can rename a shared list.** The RLS update policy on `Collections`
  allows owner-or-member; narrowing it to the owner is a one-line change in
  `sharing.sql` if that turns out to be wrong.
- **`peek_invite` is granted to `anon`.** It exposes a list's name, its owner's
  display name and an activity count to anyone holding a valid code. That is
  intentional — the join sheet has to say what is being joined — but it is a
  real, if small, disclosure.
- **Duplicate detection only compares against the cache.** With a cold cache it
  silently does nothing, and it never sees activities in lists that failed to
  load. It also cannot catch a duplicate of something a *different* device
  added moments ago.
- **Search has no result-count cap on the underlying scan.** Every activity is
  scored on every keystroke. Fine at hundreds; it would need an index at tens
  of thousands.
- **`getChipArr(which)` ignores its parameter** (see `links.js` above).
- **~~No URL/route state.~~ DONE.** `js/router.js` — see **A URL for every
  screen**. The activity sheet is addressable too now (`#activity/<id>` —
  see **A URL for one activity**); every *other* sheet still is not, so a
  link cannot point at a completion sheet or the invite sheet. Those are
  transient states rather than things anyone would send, so this is
  probably where it should stop.
- **~~There is no password reset.~~ DONE.** See **Resetting a password**.
  The one thing it needs that the repo cannot assert is the dashboard
  template — Authentication → Emails → **Reset password** has to point at
  `token_hash` and `type=recovery`, exactly like the confirmation one, or a
  link opened on a second device fails the PKCE way and a link opened on the
  first signs the person in without ever offering them the panel.
- **`sw.js` duplicates the asset list in `index.html`.** `SHELL_ASSETS` must be
  updated by hand; nothing enforces it. The pre-cache loop tolerates a missing
  path (it warns and continues), so the failure mode is a silently non-offline
  file rather than a broken install.
- **`CACHE_VERSION` is bumped by hand.** Forgetting it means returning installs
  keep serving the previous build until stale-while-revalidate catches up on a
  second load.
- **No swipe-to-delete on activity rows.** Delete lives in the activity sheet
  and the ⋯ menu. A swipe action would be the native touch, but it was left out
  rather than shipped untested — touch gestures can't be verified headlessly.
- **The difficulty rating is unverified against a real model**, like the
  location guess it rides along with, and for the same reason — the
  function has to be redeployed first. Expect to tune Part Two of
  `PLACE_SYSTEM` against real activity names. It commits rather than
  refusing, so the failure to watch for is a systematic lean (everything
  coming back `medium`), not silence.
- **~~A rating cannot be corrected.~~ DONE.** See **Correcting a
  rating** — the detail sheet's Difficulty chip is now the control, and
  corrections lead each tier in `difficultyExamples()`. What is still
  missing is any way to correct one **in bulk**: fixing a systematic
  lean means opening rows one at a time.
- **~~`supabase/difficulty-profile.sql` has to be run by hand.~~ DONE**
  (verified against `information_schema` on 31 Aug 2026 —
  `Users.difficulty_profile` exists). Re-check with the query in
  **Verifying which migrations have run** below rather than trusting
  this line.
- **Nothing rates the activities that already exist, automatically.**
  `difficulty` defaults to null and is only ever written at capture, so
  every row predating this is un-rated: it sorts last under **Difficulty**
  and appears in none of the three smart lists.
  **Two scripts do it, and they are deliberately separate.**
  `tools/difficulty-rate.py` asks Claude to rate every row still null,
  grouped by the owner of the collection so each is judged against that
  person's Home and profile, and writes an `id,difficulty` CSV;
  `tools/difficulty-backfill.py` turns that CSV into a single
  `UPDATE ... FROM (VALUES ...)`. Splitting them is what lets the ratings
  be READ, and edited, before any of them land — and the backfill writes
  only rows still null, so neither can overwrite a rating the app has
  since inferred and both are safe to re-run. They have to be run by
  hand, and until they are the three lists are missing most of the
  library.
- **Only the activity sheet rates anything.** `openCompDraft()` — logging
  something you already did — inserts without going near
  `maybeGuessLocation()`, so it carries no rating and lands in none of the
  three smart lists. Arguably right (a finished thing does not need to be
  found again) and arguably not, since the lists show completed rows too.
- **A smart list has no map view worth the name at scale, and no
  conversation.** Both are suppressed rather than absent-by-design:
  `openSmartListMenu()` keeps the view switcher, so Map works, but there
  is nothing shared about a derived list and the ⋯ menu says so by
  omission.
- **The smart lists are not on Home and not in the tab bar.** They are
  reachable only from the Lists tab, which is the right place for them
  and also the only place — someone who lives on Home will not find them.
- **So does creating an activity, now.** The location guess is a model call
  per *distinct* name of at least three characters, whether or not it turns
  out to name a place — and the great majority do not, so most of those calls
  buy nothing. The `name → place` cache is written and kills the repeats
  within a session; it does not persist, so the same name asked tomorrow pays
  again. The cheap client-side pre-filter (does the name contain a
  capitalised word that is not the first?) would skip most of the remainder
  and is deliberately **not** written: it is lossy, and a lowercase
  "go to arches national park" is exactly the input it would silently drop.
- **The location guess is unverified against a real model.** The gates, the
  rejection rule and the fill/undo path are all tested, but the prompt in
  `predictPlace()` has never been run against Claude from this app — the
  function has to be redeployed first. Expect to tune `PLACE_SYSTEM`
  against real activity names; it errs strict by design, so the failure to
  watch for is it refusing things it should catch, not inventing places.
- **~~`supabase/target-rollover.sql` has to be run by hand.~~ DONE** —
  zero rows still hold an unresolved band (verified 31 Aug 2026). Note
  the query that checks this looks for `This Month` / `This Year` /
  `Next Year` / `In 2-3 Years` and deliberately **not** `In 5+ Years`,
  which is stored as itself forever by design.
- **~~`supabase/single-list.sql` has to be run by hand.~~ DONE** —
  `extra_collection_ids` is off the table (verified 31 Aug 2026), and
  the narrow `can_use_activity` is what the policies use.
- **There is no moderation UI.** Reports land in `content_reports` and
  are worked with a `select` in the SQL editor (the query is at the
  bottom of `moderation.sql`). The 24-hour commitment in the terms is a
  promise that somebody runs it daily; nothing enforces it, nothing
  alerts on a new report, and there is no record in the app of a report
  having been acted on. A single admin page reading that table is the
  obvious fix and is the thing most likely to matter if the app gets
  any real use.
- **A report is fire-and-forget from the reporter's side.** By design —
  see **A report goes one way** — but it does mean somebody who reports
  something gets no confirmation beyond a toast and can never check what
  came of it. The block offered immediately afterwards is what makes
  that tolerable.
- **Blocking hides messages and nothing else.** A blocked person's
  activities, notes and completion photos in a shared list are still
  drawn, and their name is still on them. That is defensible — they are
  the list's content, not a message aimed at you — but somebody who
  blocks a person expects rather more silence than they get.
- **`legal/privacy.html` and `legal/terms.html` carry placeholders.**
  `[YOUR NAME OR COMPANY]`, `[YOUR ADDRESS]`, `[CONTACT EMAIL]` and
  `[YOUR JURISDICTION]` have to be filled in before either is submitted
  to App Store Connect, and the privacy policy URL there must be a live
  public URL. Grep for `[` in that directory.
- **The two legal pages are not in `SHELL_ASSETS`**, deliberately —
  they are separate documents rather than part of the app shell, so
  they are not available offline. Opening one in a tunnel fails.
- **Nothing tells an existing account that the terms now exist.**
  `terms_accepted_at` is null for every account created before
  `moderation.sql`, and no prompt ever asks them. That is the honest
  record and it is also, strictly, a set of users who have not agreed
  to anything.
- **Account deletion is not transactional.** `delete-account` runs a
  sequence of deletes; a failure part-way leaves the auth user in place
  (deliberately, so it can be re-run) but some rows already gone. A
  single `SECURITY DEFINER` RPC doing the lot in one statement would
  fix it, leaving the function to do nothing but `deleteUser`.
- **Nothing reaps a deleted account's Storage objects beyond its own
  folder listing**, which is capped at 1000 files. Someone with more
  than that leaves the remainder orphaned. Same sweeper problem as the
  one at the bottom of `storage.sql`.
- **An invite that survives sign-up needs section 5 of `sharing.sql` to
  have been run.** It is new, so a project that ran an earlier version
  of that file does not have `invite_claims` and the two RPCs. Both
  client halves fail soft — one `console.info` naming the fix — and the
  app behaves exactly as it did before, which means the failure is
  invisible unless you read the console. Re-run the file.
- **A claimed invite is redeemed against the address, not the person.**
  Someone who signs up with a different address from the one they were
  invited at — a work address on the laptop, a personal one on the
  phone — gets nothing, and there is no way for the app to notice. They
  fall back to **Lists → Join a List** with the code, which is why
  `sendInviteLink()` puts the code in the message body.
- **There is no password reset.** The confirmation landing already redeems
  a `type=recovery` link — it goes through the same `verifyOtp()` — so
  someone following one is signed in, but there is no "forgot password"
  link on the auth screen to request one and no screen to set a new
  password once they arrive. `sb.auth.resetPasswordForEmail()` plus a
  sheet calling `sb.auth.updateUser({password})` is the whole of it.
- **The confirmation email template is configured by hand.** Three
  dashboard settings decide whether a signup link works at all (see
  **Coming back through the confirmation email**), nothing in the repo
  asserts them, and getting any of them wrong looks identical from the
  outside. The app now says which failure it hit, which is the closest
  thing to a check there is.
- **`Users.icon` and `category_tag` (both tables) remain unused.** The
  profile photo went to a new `avatar_url` column rather than reusing
  `icon`: nothing reads `icon`, but it is a name that promises a glyph
  and this holds a URL.
- **~~A profile photo needs `supabase/avatars.sql` run.~~ DONE** —
  `Users.avatar_url` exists (verified 31 Aug 2026). The RPC half is
  still worth knowing about and is *not* covered by that check:
  `Users.avatar_url` can exist while `collection_avatars()` does not
  (sharing not installed), in which case you can set your own photo and
  nobody else sees it.
- **The old avatar file is not deleted when you replace it.** Same
  orphan problem as every other piece of media — see the sweeper query
  at the bottom of `storage.sql`.
- **An avatar is not in the offline snapshot.** The map comes from an
  RPC, and a conversation cannot be read offline anyway, so this costs
  nothing today; it would matter the moment the backlog entry about
  caching the last page per conversation is done.
- **`setHTML()` compares whole strings.** It skips the repaint when a
  block is identical, which is the common case after navigation, but a
  one-character change still rebuilds the entire block. Real DOM
  diffing is the next step and is not worth it yet.
- **There is no way back from the place sheet.** Tapping a row closes it and
  opens the activity; closing that lands on the map, not on the list of
  everything at that point. The pin is one tap away, and the alternative —
  `onSheetClose('actDetailSheet', …)` — would fire on the half-dozen buttons
  that close the activity sheet in order to open something *else*. Fixing it
  properly means the activity sheet knowing what pushed it.
- **The Map tab's count says "N places" and counts activities.** Now that
  coincident activities are one bubble, the two numbers genuinely differ. It
  has always said this; it is just newly wrong-looking.
- **Coincident pins are bundled, not spread.** Tapping the stack lists them;
  it does not fan them out into a ring around the point the way a spiderfier
  would. A list is the better answer on a phone, but it does mean you cannot
  see the individual pins at all.
- **The map needs WebGL.** There is no 2D fallback — `webglOK()` shows a
  message instead. In practice every browser that can run the rest of the app
  has it, but it is a hard dependency where Leaflet was not.
- **`GLOBE_PX_AT_Z0` in `map.js` is an empirical constant** (measured, not
  derived from MapLibre's projection maths). If a future MapLibre changes how
  the globe is sized, `globeFillZoom()` will be slightly off and the globe will
  open a little too large or too small.
- **Home and the detail screen still duplicate the completion toggle.**
  `toggleCompleteFrom()` / `toggleComplete()` do the same work against
  different assumptions about `curListId`. Folding them into one that always
  takes an explicit collection id would be a good tidy-up. (The add half of
  this is gone: Home's composer now routes through the activity sheet, so
  `addActivityToList()` was deleted.)
- **Home still re-renders in full after a quick add or a completion toggle.**
  It reads from the cache rather than the network now, so the cost is a
  re-render rather than two round trips, but it is still more work than
  patching the single row that changed.
