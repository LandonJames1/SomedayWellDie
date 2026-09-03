/* ==============================================================
   NATIVE PUSH — APNs, for the iOS shell

   ---- Why this file exists ----

   Every push in this app went through the service worker: reminders,
   messages, the icon badge. Inside the Capacitor WKWebView none of
   that machinery is there at all. The page is served from the
   `capacitor://` scheme, and WKWebView gives a custom scheme neither a
   service worker nor a Notification API — so `notificationsSupported()`
   answers false, the whole feature hides itself exactly as designed,
   and all three reminder tiers collapse to the Home banner.

   That is correct behaviour for a browser that cannot do push. It is
   the wrong answer on the one platform the app is being submitted to,
   where push is not merely available but is most of what makes a
   reminder a reminder. So the native app registers with APNs instead
   and stores its device token in the same `push_subscriptions` table,
   with `platform` set to 'ios'. See supabase/native-push.sql, and
   supabase/functions/_shared/apns.ts for the sending half.

   ---- Reached through Capacitor.Plugins, with no import ----

   Exactly as nav.js reaches the Keyboard plugin. This app is classic
   scripts in one shared scope with no bundler (see CLAUDE.md), and a
   Capacitor plugin does not need one: the native side registers itself
   and the runtime exposes it on `window.Capacitor.Plugins`. So every
   guard below is load-bearing rather than defensive — in a browser
   `window.Capacitor` does not exist, and this file does nothing at all.

   ⚠️ IT STILL NEEDS THE PACKAGE INSTALLED. `Capacitor.Plugins.PushNotifications`
   is only there once `@capacitor/push-notifications` has been added and
   `npx cap sync ios` has run — the JS is a proxy onto native code that
   has to be in the binary. Without it every function here returns the
   same "unsupported" it returns in a browser, which is the honest
   answer and leaves the web build untouched.
   ============================================================== */

function nativePush(){
  return (window.Capacitor && window.Capacitor.Plugins &&
          window.Capacitor.Plugins.PushNotifications) || null;
}

/* Native push is possible only in the native shell AND only with the
   plugin present. Both halves matter: the web build must keep using
   Web Push, and a native build that predates the plugin must not
   pretend it can do something it cannot. */
function nativePushAvailable(){
  return !!(typeof isNativeApp==='function' && isNativeApp() && nativePush());
}

/* Mirrors Notification.permission — 'unsupported' | 'default' |
   'granted' | 'denied' — so reminders.js can ask one question and get
   one vocabulary back whichever transport is underneath. Capacitor's
   'prompt' and 'prompt-with-rationale' are both "not asked yet". */
let _nativePerm='default';
function nativePushState(){
  if(!nativePushAvailable()) return 'unsupported';
  return _nativePerm;
}

async function refreshNativePushState(){
  const p=nativePush();
  if(!p) return 'unsupported';
  try{
    const r=await p.checkPermissions();
    _nativePerm=r.receive==='granted'?'granted':r.receive==='denied'?'denied':'default';
  }catch{ _nativePerm='default'; }
  return _nativePerm;
}

/* ==============================================================
   THE TOKEN

   APNs identifies a device by a token, which takes the place of a Web
   Push endpoint — and is unique in the same way, per install per
   device, which is why it can share the table's unique key.

   It is NOT stable forever: iOS reissues one after a restore from
   backup, and occasionally otherwise. So registration runs on every
   launch once permission is granted rather than only at the moment it
   is given, and the upsert quietly corrects the row when it changes.
   ============================================================== */
let _nativeToken='';
let _nativeListenersOn=false;

async function saveNativeToken(token){
  if(!token||!currentUser) return false;
  _nativeToken=token;
  const{error}=await sb.from('push_subscriptions').upsert({
    user_id:currentUser.id,
    endpoint:token,
    /* Null, and the check constraint in native-push.sql allows it only
       because platform says this row is not Web Push. */
    p256dh:null,
    auth:null,
    platform:'ios',
    user_agent:navigator.userAgent.slice(0,300),
  },{onConflict:'endpoint'});
  if(error){ console.warn('[nativepush] could not store token',error.message); return false; }
  return true;
}

/* Registered once per page life. The listeners outlive any single
   sign-in, so the token is stored against whoever is signed in when it
   arrives rather than captured here. */
function initNativePush(){
  const p=nativePush();
  if(!p||_nativeListenersOn) return;
  _nativeListenersOn=true;

  p.addListener('registration',t=>{ saveNativeToken(t&&t.value); });
  p.addListener('registrationError',e=>{
    console.warn('[nativepush] APNs registration failed',e&&e.error);
  });

  /* Foreground. iOS does not draw a banner over an app that is already
     open, and it should not — the user is looking at the app. What they
     want is the thing itself to be up to date, which is the same answer
     the realtime channel gives on the conversation screen. */
  p.addListener('pushNotificationReceived',n=>{
    const d=(n&&n.data)||{};
    if(d.kind==='message'&&typeof refreshConversations==='function'){
      refreshConversations();
    }
    /* A reminder's banner is suppressed while the app is open, so the
       Home banner is the only thing that will say so — and it is drawn
       from the activity list, which has to be refetched to know. */
    if(d.kind==='reminder'&&curPage==='home'&&typeof refreshAfterChange==='function'){
      refreshAfterChange('home');
    }
  });

  /* Tapped, from the lock screen or Notification Center. This lands in
     exactly the same place the Web Push path does: the two pending
     globals messages.js already reads, then its own handler. Doing it
     that way rather than navigating here is what keeps a cold start and
     a warm one from drifting apart — showApp() consumes the same two
     values when the tap is what launched the app. */
  p.addListener('pushNotificationActionPerformed',a=>{
    const d=(a&&a.notification&&a.notification.data)||{};
    if(d.collectionId) pendingConv=d.collectionId;
    if(d.activityId)   pendingAct=d.activityId;
    if(currentUser&&typeof handlePushLanding==='function') handlePushLanding();
  });
}

/* ==============================================================
   ASKING, AND RE-ASKING

   requestNativePush() is the user pressing the row. registerNativePush()
   is the silent path taken at sign-in when permission already exists —
   it must never prompt, for the same reason primeBias() asks the
   Permissions API rather than the user.
   ============================================================== */
async function requestNativePush(){
  const p=nativePush();
  if(!p) return false;
  initNativePush();
  try{
    const r=await p.requestPermissions();
    _nativePerm=r.receive==='granted'?'granted':r.receive==='denied'?'denied':'default';
    if(_nativePerm!=='granted') return false;
    await p.register();
    return true;
  }catch(e){
    console.warn('[nativepush] permission request failed',e);
    return false;
  }
}

async function registerNativePush(){
  const p=nativePush();
  if(!p||!currentUser) return false;
  initNativePush();
  if(await refreshNativePushState()!=='granted') return false;
  try{ await p.register(); return true; }
  catch(e){ console.warn('[nativepush] register failed',e); return false; }
}

/* Signing out has to drop this device's row, or the next person to sign
   in on the phone keeps receiving the previous account's reminders —
   the same argument that puts every other per-account cache in
   resetAccountState(). Best-effort: a failure here must never be what
   stops somebody signing out. */
async function unregisterNativePush(){
  if(!_nativeToken) return;
  const token=_nativeToken;
  _nativeToken='';
  try{ await sb.from('push_subscriptions').delete().eq('endpoint',token); }
  catch(e){ console.warn('[nativepush] could not remove token',e); }
}
