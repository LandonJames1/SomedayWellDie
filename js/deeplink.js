/* ==============================================================
   DEEP LINKS — Universal Links, in the native shell

   ---- What this buys, and why it is not cosmetic ----

   CLAUDE.md has a paragraph under **Shared lists** that begins "iOS
   cannot be made to open the PWA instead of Safari", and explains that
   Universal Links need a native app and an AASA file. There is now a
   native app. So the wall that paragraph describes comes down: an
   invite link tapped in Messages opens the list inside the app instead
   of dropping the recipient into a Safari tab.

   Everything that paragraph says about *why it did not matter much*
   still holds — joining is a server-side membership row, so a join
   accepted in Safari was always already in effect. What was lost was
   the handoff, every time, for the one feature whose whole job is to
   bring somebody else in.

   ---- Three things have to agree, or this silently does nothing ----

     1. APP_WEB_ORIGIN in js/config.js — the host links are built with
     2. `applinks:<host>` in ios/App/App/App.entitlements
     3. /.well-known/apple-app-site-association served by that host,
        over https, with content-type application/json, NO redirect,
        and no .json extension

   iOS fetches (3) once at install and caches the result. If it fails,
   there is no error anywhere — links simply keep opening in Safari.
   That is the failure to expect, and the only way to tell it from a
   code bug is to check that the file is actually being served.

   ---- Reached through Capacitor.Plugins, with no import ----

   Same as js/nativepush.js and nav.js's Keyboard: classic scripts, one
   shared scope, no bundler. Without @capacitor/app installed and
   synced this file does nothing at all, which is what a browser gets.
   ============================================================== */

function deepLinkPlugin(){
  return (window.Capacitor && window.Capacitor.Plugins &&
          window.Capacitor.Plugins.App) || null;
}

let _deepLinksOn=false;

function initDeepLinks(){
  const app=deepLinkPlugin();
  if(!app||_deepLinksOn) return;
  _deepLinksOn=true;

  /* The app was already running. */
  app.addListener('appUrlOpen',e=>{ handleDeepLink(e&&e.url); });

  /* The link is what launched it. Capacitor fires appUrlOpen for this
     too, but only if the listener was registered before the event —
     which on a cold start is a race this file cannot win. Asking is
     the reliable half. handleDeepLink() is idempotent for the same
     URL, so being told twice costs nothing. */
  if(app.getLaunchUrl){
    Promise.resolve(app.getLaunchUrl())
      .then(r=>{ if(r&&r.url) handleDeepLink(r.url); })
      .catch(()=>{});
  }
}

let _lastDeepLink='';

/* Applies an incoming URL to the running app.

   Deliberately NOT by navigating the web view to it. The page is
   served from capacitor://, the assets are bundled, and loading an
   https URL would replace the app with the website — the Guideline
   2.5.2 problem scripts/build-www.js warns about, arrived at from the
   other end. What travels is the *meaning* of the link, handed to the
   same three readers that already consume it at boot. */
function handleDeepLink(rawUrl){
  if(!rawUrl||rawUrl===_lastDeepLink) return;
  _lastDeepLink=rawUrl;

  let u;
  try{ u=new URL(rawUrl); }catch{ return; }

  /* ---- Something shared into the app ----
     The share extension leaves the payload in the App Group and opens
     this URL, which carries nothing but "there is something waiting" —
     see js/shareinbox.js for why it is not on the query string. First,
     because it is the one branch identified by the scheme itself
     rather than by a parameter. */
  if(u.protocol==='somedaywelldie:'&&u.host==='share'){
    if(typeof handleSharedInput==='function') handleSharedInput();
    return;
  }

  /* ---- Something shared into the app ----
     The share extension leaves the payload in the App Group and opens
     this URL, which carries nothing but "there is something waiting" —
     see js/shareinbox.js for why it is not on the query string. It is
     first because it is the one branch identified by the scheme itself
     rather than by a parameter. */
  if(u.protocol==='somedaywelldie:'&&u.host==='share'){
    if(typeof handleSharedInput==='function') handleSharedInput();
    return;
  }

  /* ---- An invite ----
     Straight onto the same shelf readPendingJoin() writes, so a link
     that arrives before sign-in survives exactly as a link opened in a
     browser does, with the same 7-day TTL. */
  const join=(u.searchParams.get('join')||'').trim();
  if(join){
    pendingJoin=join;
    try{ bootKeepLong(JOIN_STASH,join); }catch{}
    if(currentUser&&typeof handlePendingJoin==='function') handlePendingJoin();
    return;
  }

  /* ---- A notification landing ----
     The two globals messages.js reads, then its own handler — the same
     path js/nativepush.js takes for a tapped banner, so a link and a
     notification cannot land in different places. */
  const conv=u.searchParams.get('conv'), act=u.searchParams.get('act');
  if(conv||act){
    if(conv) pendingConv=conv;
    if(act)  pendingAct=act;
    if(currentUser&&typeof handlePushLanding==='function') handlePushLanding();
    return;
  }

  /* ---- A screen ----
     Writing the hash lets js/router.js do the work: it is already
     listening for hashchange and already knows every route, including
     #activity/<id>, and already handles a dead id by bouncing to the
     tab. Re-implementing any of that here would give the two somewhere
     to disagree. */
  if(u.hash&&u.hash.length>1){
    if(location.hash===u.hash){
      /* Same route as the one showing: assigning it fires no
         hashchange, so nothing would happen. Ask the router directly. */
      if(typeof onRouteChange==='function') onRouteChange();
    } else {
      location.hash=u.hash;
    }
    return;
  }

  /* A bare link to the app with nothing in it. Opening is the whole
     of what was asked for, and it has already happened. */
}

/* ---- What this does NOT handle ----
   A confirmation or password-reset link (?token_hash=&type=) arriving
   while the app is already running. Those are consumed by
   readEmailConfirmation()/consumeEmailConfirmation() at boot, and
   replaying that sequence mid-session would mean re-entering the boot
   path with a live session already in place. In practice somebody
   following one is signed out and launching the app cold, which is the
   path that already works. Worth knowing before assuming it is
   covered. */
