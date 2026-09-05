/* ==============================================================
   THE LOCK SCREEN

   Native only, off by default, and turned on from Settings. In a
   browser the plugin does not exist, the row hides and none of
   this runs — the web app is untouched.

   ⚠️ IT IS A DOOR, NOT ENCRYPTION. It asks iOS "is this the
   phone's owner" and covers the screen until the answer is yes.
   The rows, the photos and the session are exactly as readable to
   anything with the device passcode and a debugger as they were
   before. It is for the person handing their phone across a table,
   which is the actual thing that happens to a list like this.

   ⚠️ THE COVER GOES UP ON THE WAY OUT, NOT ON THE WAY BACK IN.
   iOS screenshots the app for the multitasking switcher the moment
   it resigns active, and it does that BEFORE the app is told it
   went to the background — so a lock applied on resume has already
   let the card in the switcher show the last screen. lockNow() is
   therefore called from the same visibilitychange auth.js already
   listens on, and the overlay is painted before the prompt.
   ============================================================== */

/* Per device, not per account, and deliberately not cleared by
   resetAccountState(): it is a statement about this phone. Keyed
   like the other bl_* preferences. */
const APPLOCK_KEY='bl_applock';

/* How long the app may sit in the background before it re-locks.
   Zero would prompt for Face ID after glancing at a notification,
   which is how people turn a feature like this back off. */
const APPLOCK_GRACE_MS=60*1000;

let _lockKind='none';
let _lockAvailable=false;
let _lockOpen=false;      /* the cover is up */
let _lockBusy=false;      /* a prompt is on screen */
let _lockLeftAt=0;

function appLockPlugin(){
  return (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.AppLock) || null;
}
function appLockAvailable(){ return _lockAvailable; }
function appLockOn(){
  try{ return localStorage.getItem(APPLOCK_KEY)==='1'; }catch(e){ return false; }
}
function appLockLabel(){
  return _lockKind==='face'?'Face ID':_lockKind==='touch'?'Touch ID':'Passcode';
}

/* From showApp(). Asks the device what kind of door it has; a phone
   with no passcode set has none and the setting stays hidden rather
   than offering a lock that cannot lock. */
async function probeAppLock(){
  const p=appLockPlugin();
  if(!p) return;
  try{
    const r=await p.available();
    _lockAvailable=!!(r&&r.available);
    _lockKind=(r&&r.kind)||'none';
  }catch(e){ _lockAvailable=false; }
  renderAppLockRow();
  /* A cold launch is the one case with no hide/show pair to hang
     off, so the first probe covers and asks in one go. */
  if(_lockAvailable&&appLockOn()){ lockNow(); tryUnlock(); }
}

/* ---- The cover ---- */

function lockNow(){
  if(!_lockAvailable||!appLockOn()||_lockOpen) return;
  _lockOpen=true;
  const el=$('lockScreen');
  if(el){
    $('lockKind').textContent=appLockLabel();
    el.classList.add('open');
  }
  /* The app underneath must not be scrollable behind the cover. */
  if(typeof setBodyScrollLock==='function') setBodyScrollLock(true);
}

async function tryUnlock(){
  if(!_lockOpen||_lockBusy) return;
  const p=appLockPlugin();
  if(!p){ finishUnlock(); return; }
  _lockBusy=true;
  try{
    const r=await p.authenticate({reason:'Unlock your lists'});
    if(r&&r.ok) finishUnlock();
  }catch(e){ console.warn('[lock] failed',e); }
  finally{ _lockBusy=false; }
}

function finishUnlock(){
  _lockOpen=false;
  const el=$('lockScreen');
  if(el) el.classList.remove('open');
  if(typeof setBodyScrollLock==='function') setBodyScrollLock(false);
}

/* Called by auth.js's existing visibilitychange handler — see the
   second warning at the top for why the hiding half is the one that
   matters. */
function appLockOnHide(){
  if(!_lockAvailable||!appLockOn()) return;
  /* Always covers, even for a two-second glance at a notification:
     the switcher snapshot is taken now and cannot be taken back. The
     grace window below decides whether returning COSTS anything, not
     whether the cover goes up. */
  _lockLeftAt=Date.now();
  lockNow();
}

function appLockOnShow(){
  if(!_lockOpen) return;
  /* Straight back from a glance: lift the cover without asking. The
     privacy this feature is for is somebody else holding the phone,
     and they did not have it for four seconds. */
  if(Date.now()-_lockLeftAt<APPLOCK_GRACE_MS){ finishUnlock(); return; }
  tryUnlock();
}

/* ---- The setting ---- */

function renderAppLockRow(){
  const row=$('meLockRow');
  if(!row) return;
  row.style.display=_lockAvailable?'':'none';
  const val=$('meLockValue');
  if(val) val.textContent=appLockOn()?'On':'Off';
}

/* A menu rather than a switch, so the row can name what it will
   actually use — "Face ID" reads as a promise the device can keep,
   where a bare toggle says nothing about what unlocks it. */
function openAppLockMenu(){
  showActionSheet({
    title:'Lock '+APP_NAME,
    message:'Ask for '+appLockLabel()+' when the app has been in the background.',
    items:[
      {label:'On', checked:appLockOn(), onSelect:()=>setAppLock(true)},
      {label:'Off', checked:!appLockOn(), onSelect:()=>setAppLock(false)},
    ],
  });
}

async function setAppLock(on){
  /* ⚠️ TURNING IT ON PROMPTS FIRST. Somebody whose Face ID is not
     working would otherwise discover it at the moment they are
     already locked out. */
  if(on){
    const p=appLockPlugin();
    if(p){
      try{
        const r=await p.authenticate({reason:'Turn on the lock'});
        if(!r||!r.ok) return;
      }catch(e){ return; }
    }
  }
  try{ localStorage.setItem(APPLOCK_KEY,on?'1':'0'); }catch(e){}
  renderAppLockRow();
}
