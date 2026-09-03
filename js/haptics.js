/* ==============================================================
   HAPTICS — the Taptic Engine, in the native shell only

   ---- Why this exists ----

   Partly because it is the right feel: the moment you tick something
   off is the app's one emotional beat, it already fires confetti, and
   on a phone a completion that makes no physical impression is the
   one place this reads as a web page rather than an app.

   And partly for Guideline 4.2. A WKWebView with no native integration
   is the classic "minimum functionality" rejection; native push is the
   substantial answer to that and this is the cheap one, but a reviewer
   feels it within ten seconds of using the app.

   ---- Deliberately three call sites and no more ----

   Haptics used as punctuation on every tap is the same mistake as
   captioning every field: it stops meaning anything, and on iOS it is
   the specific thing people turn off. So it fires where something was
   *accomplished* and nowhere else. Do not add one to navigation, to
   sheet dismissal, or to ordinary buttons.

   ---- Reached through Capacitor.Plugins, with no import ----

   Same pattern as nav.js's Keyboard and js/nativepush.js: this app is
   classic scripts in one shared scope with no bundler, and a Capacitor
   plugin needs neither. `window.Capacitor` does not exist in a
   browser, so every guard is load-bearing and the web build is
   untouched. Without @capacitor/haptics installed and synced these are
   silent no-ops, which is exactly what a browser gets.
   ============================================================== */

function hapticsPlugin(){
  return (window.Capacitor && window.Capacitor.Plugins &&
          window.Capacitor.Plugins.Haptics) || null;
}

/* Every call is fire-and-forget and swallows its own failure. A device
   with the Taptic Engine disabled in Settings rejects these, and a
   rejected promise on a path nobody awaits is an unhandled rejection
   in the console for something entirely cosmetic. */
function hapticRun(fn){
  const h=hapticsPlugin();
  if(!h) return;
  /* Somebody who has asked the OS for less motion has asked for less
     of this too — the same test confetti() already makes before it
     draws anything. */
  try{
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    Promise.resolve(fn(h)).catch(()=>{});
  }catch{}
}

/* A completion landed. iOS's success pattern is two taps, which is the
   one the whole system uses for "that worked" — so it is what a user
   already recognises without being taught. */
function hapticSuccess(){
  hapticRun(h=>h.notification&&h.notification({type:'SUCCESS'}));
}

/* The check being pressed, before anything has been written. Light,
   because it acknowledges the touch rather than announcing a result —
   the result is hapticSuccess() a moment later. */
function hapticTap(){
  hapticRun(h=>h.impact&&h.impact({style:'LIGHT'}));
}
