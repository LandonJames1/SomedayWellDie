/* ==============================================================
   BOOT — paint the static icons, restore the Supabase session, then
   show the app or the auth screen.
   Loaded LAST: every function it touches is already defined.
   ============================================================== */

/* index.html leaves empty placeholder elements where an icon belongs
   rather than inlining a dozen SVG blobs into the markup. Fill them
   in once, here, from the sprite map in js/icons.js. */
function paintStaticIcons(){
  const set=(id,html)=>{const el=$(id);if(el)el.innerHTML=html;};

  /* Tab bar — each tab carries both a stroked and a filled glyph;
     CSS shows whichever matches the selected state. */
  const tab=(id,off,on,label)=>set(id,
    `<span class="ic-off">${icon(off)}</span><span class="ic-on">${icon(on)}</span><span>${label}</span>`);
  tab('tabHome','home','home-fill','Home');
  tab('tabLists','stack','stack-fill','Lists');
  tab('tabMessages','message','message-fill','Chat');
  tab('tabMap','compass','compass-fill','Map');
  tab('tabMe','summit','summit-fill','You');

  set('coverZoneIcon',icon('photo','ic-lg'));
  /* The completion sheet is the detail sheet's shape too, so its list
     eyebrow takes the same .ic-eyebrow chevron the other two do. */
  set('compListChevron',icon('chevron-right','ic-eyebrow'));
  set('compWhereIcon',icon('pin'));
  set('compDateIcon',icon('calendar'));

  set('lbCloseBtn',icon('x'));
  set('calPrev',icon('chevron-left'));
  set('calNext',icon('chevron-right'));
  set('lbPrev',icon('chevron-left'));
  set('lbNext',icon('chevron-right'));

  set('installCloseIcon',icon('x'));
  set('iosCloseIcon',icon('x'));
  set('iosShareGlyph',icon('share'));

  /* The composer's left slot is the screenshot button, not a
     decorative plus — see the note in index.html. */
  set('homeComposerGo',icon('chevron-right'));
  set('convComposerGo',icon('chevron-right'));
  /* The new-activity sheet is the detail sheet's shape, so its glyphs
     are the detail sheet's sizes: .ic-eyebrow on the list eyebrow, and
     the 13px chip chevron that .ad-chip-v styles. */
  set('actListChevron',icon('chevron-right','ic-eyebrow'));
  set('aTargetChevron',icon('chevron-right'));
  set('aPriChevron',icon('chevron-right'));
  set('aDiffChevron',icon('chevron-right'));
  set('aRemindChevron',icon('chevron-right'));
  set('aWhereIcon',icon('pin'));
  set('aLinkIcon',icon('link'));
  set('aLinkChevron',icon('chevron-right'));
  set('aLinkGo',icon('plus','ic-sm'));
  /* The dock's Cancel disc, and the Back bar on each of the sheet's
     two sub-pages — the same glyphs the detail sheet's panes use. */
  set('actCancelBtn',icon('x'));
  set('compCancelBtn',icon('x'));
  set('compMediaBackIcon',icon('chevron-left','ic-sm'));
  set('aLinksBackIcon',icon('chevron-left','ic-sm'));
  set('aNotesBackIcon',icon('chevron-left','ic-sm'));
  set('meNotifyIcon',icon('clock'));
  set('meHomeIcon',icon('home'));
  set('meDiffIcon',icon('target'));
  set('listPickerSearchIcon',icon('search'));
  set('listPickerNewIcon',icon('plus'));
  set('meInstallChevron',icon('chevron-right'));
  /* Addressed by id rather than by "the first .li-blue in #page-me",
     which is what this used to do — the Legal rows added a second one
     and a querySelector that depends on source order is a trap waiting
     for the next row somebody adds. */
  set('meInstallIcon',icon('share'));
  set('meBlockedIcon',icon('circle'));
  set('meBlockedChevron',icon('chevron-right'));
  set('mePrivacyIcon',icon('flag'));
  set('mePrivacyChevron',icon('chevron-right'));
  set('meTermsIcon',icon('rows'));
  set('meTermsChevron',icon('chevron-right'));
}

/* ==============================================================
   SESSION RESTORE

   Signing in should stick. Three things can break that, and each is
   handled here:

   1. The access token has lapsed while the app was closed. getSession()
      normally refreshes it, but if that call fails we retry explicitly
      with refreshSession() before giving up.
   2. The device is offline at launch. A network failure is *not* a
      signed-out user — dumping someone to the login screen because
      their train went into a tunnel is the worst version of this bug.
      With a stored session we go straight into the app and let the
      offline banner explain why data is missing.
   3. The refresh timer stalls while the app is backgrounded. auth.js
      restarts it on foreground.
   ============================================================== */
async function restoreSession(){
  try{
    const{data:{session},error}=await sb.auth.getSession();
    if(error)throw error;
    if(session?.user) return session.user;
  }catch(e){
    console.warn('[auth] getSession failed:',e);
  }

  /* getSession came back empty. If there is no stored session at all the
     user is genuinely signed out; if there is one, the failure was the
     refresh, so try that directly. */
  if(!hasStoredSession()) return null;

  try{
    const{data:{session}}=await sb.auth.refreshSession();
    if(session?.user) return session.user;
  }catch(e){
    console.warn('[auth] refreshSession failed:',e);
  }

  /* Still nothing, but a session is on disk and we are offline: trust it
     rather than signing the user out over a dropped connection. */
  if(!navigator.onLine){
    const stored=readStoredSession();
    if(stored?.user) return stored.user;
  }
  return null;
}

function readStoredSession(){
  try{ return JSON.parse(localStorage.getItem('bucketlist-auth')); }
  catch(e){ return null; }
}
function hasStoredSession(){ return !!readStoredSession(); }

(async()=>{
  paintStaticIcons();
  /* The Chat tab is hidden in the markup and revealed by a probe that
     costs a round trip. Applying the remembered answer here means it
     paints with the other four instead of arriving seconds later; the
     probe still corrects it. See applyMessagesAvailability(). */
  applyMessagesAvailability();
  /* Before the session is restored, not after: a link can be shared in
     — or an invite to a shared list opened — while signed out, and the
     query string has to be captured and stripped before anything else
     can navigate away from it. showApp() picks both back up once there
     is a user. */
  /* A confirmation link is the third thing that can arrive in the query
     string, and it is read FIRST — the two below blank the whole search
     string once they have taken what they came for, which would destroy
     it. This one removes only its own keys and puts the rest back, so
     running it ahead of them costs them nothing. See CONFIRMING AN
     EMAIL ADDRESS in js/auth.js. */
  readEmailConfirmation();
  /* Also before the two below, and for the same reason: readPendingJoin()
     blanks the whole search string once it has taken what it came for,
     and these two remove only their own keys. A message notification
     opened on a link that also carries ?join= must not destroy either. */
  readPushLanding();
  readPendingJoin();

  /* ---- The same three captures, arriving as a Universal Link ----
     A native app is handed its link by the OS rather than finding it
     in location.search, so the readers above see nothing. This
     registers the listener and asks for the launch URL, and feeds
     whatever it finds to those same globals — see js/deeplink.js.

     After them, deliberately. getLaunchUrl() is a promise and cannot
     resolve before this tick, so it always lands second; running it
     first would have readPendingJoin() overwrite the captured code
     with the nothing it finds in the URL. In a browser this is a
     no-op. */
  initDeepLinks();
  /* The offline banner reflects the queue, which may be non-empty from
     a previous session, so it is painted before anything can render. */
  updateSyncUI();
  /* A confirmation link is a session waiting to be claimed, and it is
     tried *before* the stored one. Both orders matter: someone
     confirming on a second device has no stored session to find, and
     someone confirming on the first device has a stale one — for the
     same account, but issued before the address was verified. */
  const confirmed=await consumeEmailConfirmation();
  const user=confirmed||await restoreSession();
  if(user){
    currentUser=user;
    /* A stored session is not proof the account behind it still exists
       — deleting an account only signs out the device that asked, and
       the token stays cryptographically valid until it expires. Started
       here and deliberately NOT awaited: it must not delay the first
       paint, and the things that would be wrong to run against a dead
       session await it themselves. See IS THIS SESSION STILL A REAL
       ACCOUNT? in js/auth.js. */
    ensureSessionLive();
    /* Landing from a confirmation link is a real authentication, and
       the single most likely moment for an invite to be waiting on the
       server for this address — this is quite often the first time the
       new account has been signed in anywhere. showApp() checks this
       via inviteSweepDue(). See js/auth.js. */
    if(confirmed) authJustAuthenticated=true;
    /* A recovery link signs the person in exactly like a confirmation
       one — the difference is that they came here to change something,
       and dropping them straight into the app would leave the old
       password in place with nothing on screen to say the trip through
       their inbox had a second half. showPasswordReset() is the last
       step of the reset, not a gate: the session is already live, so a
       reload from it goes in. See RESETTING A PASSWORD in js/auth.js. */
    if(recoveryLanding){
      showPasswordReset();
      document.body.classList.remove('booting');
      return;
    }
    /* Awaited so the splash holds until Home has actually painted.
       showApp() primes the cache from the disk snapshot before its
       first render (see the note there), which is a few milliseconds
       of IndexedDB rather than a network round trip — but dropping the
       splash before it resolved would show an empty shell for exactly
       that long. Everything slow inside showApp() runs detached, so
       this waits on the paint and nothing else. */
    await showApp();
    /* After the paint, not before: arriving from an email link is
       otherwise indistinguishable from an ordinary launch, and the one
       thing this person wants to know is whether the trip through their
       inbox actually did anything. */
    if(confirmed) showToast('Email confirmed — you’re signed in.');
  } else {
    showAuth();
  }
  document.body.classList.remove('booting');
})();
