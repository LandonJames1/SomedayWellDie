/* ==============================================================
   REMINDERS — "nudge me about this on a date".

   The motivating case: a campsite whose reservations open months
   before the trip. The activity's *target* is the trip; the reminder
   is the day you have to act.

   THREE DELIVERY PATHS — deliberately, in order of reliability.

   A web app cannot wake itself up: Notification Triggers never shipped
   past an experiment, so nothing in the browser can schedule a banner
   for a future date. Hence:

   1. The Home banner. Always works, needs no permission, no backend and
      no install. This is the floor.
   2. A local notification when the app is opened or foregrounded on or
      after the date. Needs permission only.
   3. Real background push, delivered on the day even with the app
      closed. Needs the backend in supabase/ deployed, VAPID_PUBLIC_KEY
      set in config.js, permission granted, and — on iOS — the PWA
      installed to the home screen.

   All three coexist because each has a different failure mode. Building
   on (3) alone would mean a reminder that silently never arrives for
   anyone who skipped one of its four prerequisites.
   ============================================================== */

/* Reminders already announced, so re-opening the app doesn't re-ping.
   Keyed by activity + date, so moving a reminder re-arms it. */
const NOTIFIED_KEY='bl_notified_reminders';

function notifiedSet(){
  try{ return new Set(JSON.parse(localStorage.getItem(NOTIFIED_KEY))||[]); }
  catch(e){ return new Set(); }
}
function markNotified(keys){
  try{
    const s=notifiedSet();
    keys.forEach(k=>s.add(k));
    /* Keep the list from growing without bound. */
    localStorage.setItem(NOTIFIED_KEY,JSON.stringify([...s].slice(-200)));
  }catch(e){}
}

/* Unfinished activities whose reminder date has arrived. */
function dueReminders(acts){
  const today=todayISO();
  return acts.filter(a=>!a.completed&&a.remindAt&&a.remindAt<=today)
    .sort((a,b)=>a.remindAt.localeCompare(b.remindAt));
}

/* ==============================================================
   THE REMINDER SHEET

   Opened from the Remind me row in the activity sheet, on top of it.

   It only *stages*: Done copies the two fields into the hidden inputs
   the activity sheet already carries, and nothing reaches the database
   until the activity itself is saved. That is what lets Cancel on
   either sheet leave everything exactly as it was — and it is why the
   row label is read back from those hidden inputs rather than from any
   state of its own.

   The row was a date field plus a textarea sitting at the bottom of
   "More options". Two controls for one optional idea made the
   disclosure look like the main event, and neither of them said whether
   a reminder was actually set without reading the date.
   ============================================================== */

/* The chip's value. MM/DD/YY, not a spelled month and not the word
   "Scheduled": the chip is ~92px wide on a 320px screen, a date there
   is scanned rather than read, and this is the same reading the
   detail sheet's Remind chip gives — the two say the same thing about
   the same reminder. Everywhere the date is prose, fmtDate() is still
   the one to use. */
function updateRemindRow(){
  const val=$('aRemind');
  const label=$('aRemindValue');
  if(!val||!label)return;
  const set=!!val.value;
  label.textContent=set?fmtDateNumeric(val.value):'None';
  label.classList.toggle('is-set',set);
}

/* ==============================================================
   COUNTING BACK FROM THE TARGET

   "1 month before" is the way people actually think about this — the
   permit window, not a date they have to work out themselves.

   **These are offered only when the activity has a specific target
   date.** That restriction is the whole design. A preset band resolves
   to the end of its window: "This year" is 31 December. Counting back a
   week from that would file a reminder on Christmas Eve — for every
   activity set to "This year", all firing on the same day, none of them
   on a date the user chose or would connect to the thing. The offsets
   need a real date to be relative to, so without one they are not shown
   and the sheet says why.

   Only the *resolved* date is stored, in `remind_at`, so nothing about
   the schema changes and the delivery paths in this file need no idea
   this feature exists. Reopening the sheet infers which offset was used
   by matching the stored date back against the target — so a relative
   choice still reads as relative next time, without a column to hold it.
   ============================================================== */
/* Four, not six. 2 weeks and 3 months were removed: a menu you have to
   read is worse than one you can take in, and neither was a distinct
   enough answer from its neighbours to earn a row.
   ⚠️ Only the RESOLVED date is stored, so dropping an offset changes no
   data -- a reminder previously set as "2 weeks before" keeps its date
   and simply reads back as a specific one. */
const REMIND_OFFSETS=[
  {id:'1w', label:'1 week before',   days:7},
  {id:'1m', label:'1 month before',  months:1},
  {id:'6m', label:'6 months before', months:6},
  {id:'1y', label:'1 year before',   years:1},
];

/* target ISO date minus one offset, as an ISO date. */
function remindOffsetDate(targetISO,id){
  const o=REMIND_OFFSETS.find(x=>x.id===id);
  if(!o||!isCustomDate(targetISO))return '';
  const d=new Date(targetISO+'T00:00:00');
  if(o.days)   d.setDate(d.getDate()-o.days);
  if(o.months) d.setMonth(d.getMonth()-o.months);
  if(o.years)  d.setFullYear(d.getFullYear()-o.years);
  const p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}

/* The target the activity sheet currently holds — which is the staged
   value, not what is in the database, so choosing a date and setting a
   relative reminder in the same visit works. */
/* ==============================================================
   SETTING A REMINDER FROM THE ACTIVITY DETAIL SHEET

   The sheet was built to STAGE: it writes into the activity sheet's
   hidden #aRemind/#aRemindNote inputs and nothing reaches the database
   until that sheet is saved. That is right while an activity is being
   created, and wrong for the Remind chip on a row that already exists
   -- the same split every other in-place editor makes (see EDITING IN
   PLACE in activities.js).

   So the sheet gains a second mode rather than a second copy.
   _remindFor holds the activity id when it was opened from the chip;
   Done and Remove then write straight through and clear it. The hidden
   inputs are still the transport in both modes, so there is one set of
   fields to keep in step and one inferRemindMode() to trust.

   ⚠️ _remindTargetFor exists because currentTargetDate() reads the
   NEW-ACTIVITY sheet's date select, which on the detail sheet holds
   whatever the last edit happened to leave there. The relative offsets
   ("1 month before") are computed from it, so without the override they
   would count back from the wrong activity's target. */
let _remindFor=null;
let _remindTargetFor='';

/* ==============================================================
   THE REMINDER, AS A MENU AND THEN A QUESTION

   Two things have to be answered -- WHEN, and an optional note that
   rides along in the push -- and they are asked one at a time rather
   than on one form. When is a closed list, so it is an action sheet.
   The note is one short answer, so it is showPrompt(): the iOS alert
   with a field in it, asked only AFTER a date exists, because a note
   with nothing to fire it is not a reminder.

   The full #remindSheet is still what the NEW-ACTIVITY sheet uses --
   staging is right while the activity does not exist yet. This is the
   in-place path for a row that does. Both write through the same hidden
   inputs and the same inferRemindMode(), so they cannot disagree. */
async function openRemindFor(id){
  const a=await fetchActivity(id);
  if(!a||a.completed) return;
  _remindFor=id;
  _remindTargetFor=a.targetDate||'';
  const stored=a.remindAt||'';
  const note=a.remindNote||'';
  /* ⚠️ Seeded even though the menu below does not read them. The
     no-showPicker fallback in pickRemindDate() opens the full
     #remindSheet, which builds itself entirely from these two inputs --
     without this it would open showing the PREVIOUS activity's
     reminder. */
  $('aRemind').value=stored;
  $('aRemindNote').value=note;
  const relative=isCustomDate(_remindTargetFor);
  const mode=inferRemindMode(stored,_remindTargetFor);

  const items=[];
  /* Offsets only when there is a specific target to count back from.
     Against a band they would all resolve to the end of its window --
     "1 week before" on everything set to This Year fires on Christmas
     Eve. See the note on REMIND_OFFSETS. */
  if(relative) REMIND_OFFSETS.forEach(o=>items.push({
    label:o.label,
    checked:mode===o.id,
    onSelect:()=>askRemindNote(id,remindOffsetDate(_remindTargetFor,o.id),note),
  }));
  items.push({
    label:(stored&&mode==='date')?fmtDate(stored,true):'On a specific date\u2026',
    checked:!!stored&&mode==='date',
    onSelect:()=>pickRemindDate(id,stored,note),
  });
  if(stored) items.push({
    label:'Remove reminder',
    role:'destructive',
    /* Its own card, the way iOS separates a destructive action from the
       choices above it -- red text alone read as one more option. */
    separated:true,
    onSelect:()=>{ resetRemindFor(); patchActivity(id,{remind_at:null,reminder_note:null}); },
  });

  showActionSheet({title:'Remind Me',items});
}

function pickRemindDate(id,stored,note){
  showCalendar({
    title:'Remind Me On',
    value:stored||'',
    onPick:iso=>askRemindNote(id,iso,note),
  });
}

/* Asked after the date, never before it. Cancel keeps the date and
   whatever note was already there -- it means "no note now", not "undo
   the reminder". */
function askRemindNote(id,when,note){
  if(typeof showPrompt!=='function'){ commitRemind(id,when,note); return; }
  showPrompt({
    title:'Reminder Note',
    /* Optional, and said in the two places a label may say it: the
       placeholder, and the button you leave by. */
    placeholder:'Optional \u2014 e.g. book the permit',
    cancelLabel:'Skip',
    value:note||'',
    maxLength:200,
    onSave:v=>commitRemind(id,when,v),
    /* Dismissing keeps the date and whatever note was already there --
       it means "no note now", not "forget the reminder". */
    onCancel:()=>commitRemind(id,when,note),
  });
}

function commitRemind(id,when,note){
  resetRemindFor();
  if(typeof patchActivity!=='function') return;
  patchActivity(id,{remind_at:when||null,reminder_note:(note||'').trim()||null});
}

/* Called by openActDetail() on every render: a sheet dismissed by the
   scrim or a swipe never reaches Done, and a stale id here would send
   the NEXT reminder to the previous activity. */
function resetRemindFor(){ _remindFor=null;_remindTargetFor=''; }

async function commitRemindFor(remindAt,note){
  const id=_remindFor;
  resetRemindFor();
  closeModal('remindSheet');
  if(typeof patchActivity!=='function') return;
  await patchActivity(id,{remind_at:remindAt||null,reminder_note:note||null});
}

function currentTargetDate(){
  if(_remindFor) return _remindTargetFor;
  try{ return readTargetDate()||''; }catch(e){ return ''; }
}

/* Which offset a stored date corresponds to, or '' if it is just a date. */
function inferRemindMode(stored,target){
  if(!stored||!isCustomDate(target))return 'date';
  const hit=REMIND_OFFSETS.find(o=>remindOffsetDate(target,o.id)===stored);
  return hit?hit.id:'date';
}

function openRemindSheet(){
  const target=currentTargetDate();
  const relative=isCustomDate(target);
  const stored=$('aRemind').value||'';

  /* Rebuild the menu each time: whether the offsets belong there depends
     on a target date the user may have just changed. */
  const sel=$('rmMode');
  sel.innerHTML='<option value="date">On a specific date\u2026</option>'+
    (relative?REMIND_OFFSETS.map(o=>
      `<option value="${o.id}">${esc(o.label)}</option>`).join(''):'');
  $('rmNoRelative').style.display=relative?'none':'';

  sel.value=inferRemindMode(stored,target);
  $('rmDate').value=stored;
  $('rmNote').value=$('aRemindNote').value||'';
  /* Nothing to remove until there is something set. */
  $('rmClearWrap').style.display=stored?'':'none';
  onRemindModeChange();
  updateRemindAudience();
  openModal('remindSheet');
}

/* ==============================================================
   WHO A REMINDER ACTUALLY REACHES

   There is one remind_at per activity, not one per person, so a
   reminder set on a shared list is the list's reminder: the sweep in
   supabase/functions/send-reminders notifies the owner and every
   member, and the Home banner shows up for all of them too.

   That is the right behaviour — "book the campsite" is not a private
   thought when three people are going — but it is a surprising one to
   find out about afterwards, and the sheet gives no other clue. So say
   it, on shared lists only, where it is not obvious.

   Deliberately not said: which of them will get a *push*. That depends
   on each person's notification permission and whether they have
   installed the app, none of which this client can see, and guessing
   at it would be worse than the general statement.
   ============================================================== */
async function updateRemindAudience(){
  const el=$('rmShared');
  if(!el)return;
  el.style.display='none';
  if(!sharingReady())return;

  /* The activity being edited may not be filed yet — a new one takes
     its destination from the sheet's List row. */
  const listId=(_remindFor
    ? (cachedActivities().find(x=>x.id===_remindFor)||{}).listId
    : null)||targetListId||curListId;
  if(!listId)return;
  const list=cachedCollections().find(c=>c.id===listId);
  if(!list)return;

  /* Two ways a list is shared, and the note belongs on both: one you
     joined, and one you own and invited someone into. isSharedWithMe()
     answers the first off the row itself; the second needs the
     membership set, which is cached after the first Lists render. */
  const shared=isSharedWithMe(list)||(await sharedCollectionIds()).has(listId);
  /* The membership set can be a real await, and the sheet may have
     been closed and reopened against a different list by the time it
     lands. Re-check rather than writing a stale answer into it. */
  if(!shared||(targetListId||curListId)!==listId)return;

  el.textContent=`Everyone on “${list.name}” gets this reminder.`;
  el.style.display='';
}

/* Show the date field for an explicit date, or what the chosen offset
   works out to. */
function onRemindModeChange(){
  const mode=$('rmMode').value;
  const target=currentTargetDate();
  const isDate=mode==='date';
  $('rmDateRow').style.display=isDate?'':'none';
  const note=$('rmResolved');
  if(isDate){ note.style.display='none'; return; }

  const d=remindOffsetDate(target,mode);
  note.style.display='';
  if(!d){ note.textContent=''; note.style.display='none'; return; }
  /* Say the date out loud. A relative choice that silently resolves to
     something already past is the surprise worth heading off. */
  note.textContent=daysUntil(d)<0
    ? `That works out to ${fmtDate(d)} — already past, so this will show up straight away.`
    : `That works out to ${fmtDate(d)}.`;
}

function saveRemindSheet(){
  const mode=$('rmMode').value;
  const d=mode==='date'
    ? $('rmDate').value
    : remindOffsetDate(currentTargetDate(),mode);
  if(!d){
    /* Done with no date is the same as not wanting one. */
    clearRemindSheet();
    return;
  }
  $('aRemind').value=d;
  /* A note with no date has nothing to fire it — mirrors saveActivity(). */
  $('aRemindNote').value=$('rmNote').value.trim();
  updateRemindRow();
  if(_remindFor){ commitRemindFor(d,$('rmNote').value.trim()); return; }
  closeModal('remindSheet');
}

function clearRemindSheet(){
  $('aRemind').value='';
  $('aRemindNote').value='';
  updateRemindRow();
  if(_remindFor){ commitRemindFor('',''); return; }
  closeModal('remindSheet');
}

/* ==============================================================
   THE HOME BANNER — the part that always works
   ============================================================== */
function renderHomeReminders(acts,lists){
  const sec=$('homeRemindersSection');
  if(!sec)return;
  const due=remindersReady()?dueReminders(acts):[];
  if(!due.length){sec.style.display='none';return;}
  sec.style.display='';

  $('homeReminders').innerHTML=due.map(a=>{
    const chip=activityListLabel(a,lists);
    const when=a.remindAt===todayISO()?'Today':fmtDate(a.remindAt);
    return `<div class="rem-row" onclick="openActDetail('${a.id}')">
      <span class="rem-icon">${icon('clock')}</span>
      <button class="rem-main">
        <span class="rem-name">${esc(a.name)}</span>
        ${a.remindNote?`<span class="rem-note">${esc(a.remindNote)}</span>`:''}
        <span class="rem-meta">${esc(when)}${chip?' · '+esc(chip):''}</span>
      </button>
      <button class="rem-dismiss" onclick="event.stopPropagation();clearReminder('${a.id}')"
              aria-label="Dismiss reminder">${icon('x')}</button>
    </div>`;
  }).join('');
}

async function clearReminder(id){
  const{error}=await dbUpdate('Activities',{remind_at:null},{id});
  if(error){
    console.error('clearReminder:',error);
    showToast(error.message||'Couldn’t clear that.');
    return;
  }
  showToast('Reminder cleared');
  refreshAfterChange();
}

/* ==============================================================
   NOTIFICATIONS — the bonus layer
   ============================================================== */
/* Two transports behind one question. In a browser this is Web Push
   through the service worker; in the native shell there is neither a
   service worker nor a Notification API, and the answer comes from
   APNs instead (js/nativepush.js). Every caller below asks these two
   functions and never looks at Notification directly, so the branch
   is made once. */
function notificationsSupported(){
  if(nativePushAvailable()) return true;
  return 'Notification' in window && 'serviceWorker' in navigator;
}
function notificationState(){
  if(nativePushAvailable()) return nativePushState();
  if(!notificationsSupported()) return 'unsupported';
  return Notification.permission;          /* default | granted | denied */
}

async function requestNotifications(){
  if(!notificationsSupported()){
    showToast('This browser can’t show notifications');
    return;
  }
  /* ---- The native app ----
     iOS asks once and never again: a declined prompt can only be
     changed in Settings, so there is nothing to re-ask and saying so
     is the only useful answer. */
  if(nativePushAvailable()){
    const state=await refreshNativePushState();
    if(state==='denied'){
      showToast('Turn on notifications for this app in Settings');
      if(curPage==='me') renderMe();
      return;
    }
    const ok=await requestNativePush();
    showToast(ok?'Reminders on':'Reminders not enabled');
    if(curPage==='me') renderMe();
    return;
  }
  if(Notification.permission==='denied'){
    showToast('Notifications are blocked in your browser settings');
    return;
  }
  /* On iOS, Notification.requestPermission only resolves for a PWA
     installed to the home screen. Say so rather than appearing to hang. */
  if(isIOS()&&!isStandalone()){
    showToast('Add to Home Screen first, then enable reminders');
    pwaShowInstallHelp();
    return;
  }
  const res=await Notification.requestPermission();
  if(res==='granted'){
    await subscribeToPush();
    showToast('Reminders on');
    checkDueReminders();
  }
  if(curPage==='me') renderMe();
}

/* ==============================================================
   WEB PUSH SUBSCRIPTION

   Registers this device with the browser's push service and stores the
   resulting endpoint so the Edge Function can reach it. Safe to call
   repeatedly — the endpoint is the primary key on the server side, so
   re-subscribing updates in place.
   ============================================================== */
function pushConfigured(){
  return typeof VAPID_PUBLIC_KEY==='string' && VAPID_PUBLIC_KEY.length>20;
}

/* VAPID keys are base64url; PushManager wants raw bytes. */
function urlBase64ToUint8Array(base64){
  const padded=(base64+'='.repeat((4-base64.length%4)%4)).replace(/-/g,'+').replace(/_/g,'/');
  const raw=atob(padded);
  return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));
}

async function subscribeToPush(){
  /* The native shell has no PushManager to subscribe to. It registers
     with APNs and stores a device token in the same table instead, so
     both send-reminders and send-message-push reach it from the one
     query they already make. */
  if(nativePushAvailable()) return registerNativePush();
  if(!pushConfigured()){
    console.info('[reminders] VAPID_PUBLIC_KEY not set — background push disabled, '+
      'falling back to the Home banner. See supabase/README.md.');
    return false;
  }
  if(!('PushManager' in window)) return false;
  try{
    const reg=await navigator.serviceWorker.ready;
    let sub=await reg.pushManager.getSubscription();
    if(!sub){
      sub=await reg.pushManager.subscribe({
        userVisibleOnly:true,
        applicationServerKey:urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    const raw=sub.toJSON();
    const{error}=await sb.from('push_subscriptions').upsert({
      user_id:currentUser.id,
      endpoint:raw.endpoint,
      p256dh:raw.keys.p256dh,
      auth:raw.keys.auth,
      user_agent:navigator.userAgent.slice(0,300),
    },{onConflict:'endpoint'});
    if(error){console.error('[reminders] could not store subscription:',error);return false;}
    return true;
  }catch(e){
    console.warn('[reminders] push subscribe failed:',e);
    return false;
  }
}

/* Drop this device's subscription — used on sign-out so a shared phone
   does not keep pushing the previous account's reminders. */
async function unsubscribeFromPush(){
  if(nativePushAvailable()) return unregisterNativePush();
  try{
    const reg=await navigator.serviceWorker.ready;
    const sub=await reg.pushManager.getSubscription();
    if(!sub)return;
    const endpoint=sub.endpoint;
    await sub.unsubscribe();
    await sb.from('push_subscriptions').delete().eq('endpoint',endpoint);
  }catch(e){ /* best effort */ }
}

/* Fire a local notification for anything newly due. Called on launch
   and whenever the app comes back to the foreground — the only two
   moments a web app is actually running. */
async function checkDueReminders(){
  if(!remindersReady()||!currentUser) return;
  if(notificationState()!=='granted') return;

  let acts=[];
  try{ acts=await fetchAllActivities(); }catch(e){ return; }
  const due=dueReminders(acts);
  if(!due.length) return;

  const seen=notifiedSet();
  const fresh=due.filter(a=>!seen.has(a.id+'@'+a.remindAt));
  if(!fresh.length) return;

  /* ---- The middle tier does not exist natively, and does not need to ----
     This is tier 2 of the three in the header: a local notification
     fired because the app happened to be opened on or after the day.
     It exists for browsers that can show a notification but cannot
     receive a push. The native app CAN receive one — send-reminders
     delivers over APNs whether or not the app is running — so the
     banner it would draw here is one the user has already had. The
     Home banner (tier 1) is unaffected and still renders.

     It is also mechanically impossible: showNotification lives on the
     service worker registration, and WKWebView gives the capacitor://
     scheme no service worker at all. */
  if(nativePushAvailable()||!('serviceWorker' in navigator)) return;

  try{
    const reg=await navigator.serviceWorker.ready;
    /* One notification for one, a summary for several — a burst of
       separate banners after a week away is hostile. */
    if(fresh.length===1){
      const a=fresh[0];
      await reg.showNotification(a.name,{
        /* The note is the actionable part; the name is the title. */
        body:a.remindNote||'Reminder', tag:'bl-reminder-'+a.id,
        icon:'icons/icon-192.png', badge:'icons/favicon-32.png',
        data:{url:'./index.html'},
      });
    } else {
      await reg.showNotification(`${fresh.length} reminders`,{
        body:fresh.slice(0,3).map(a=>a.name).join(', ')+(fresh.length>3?'…':''),
        tag:'bl-reminders', icon:'icons/icon-192.png', badge:'icons/favicon-32.png',
        data:{url:'./index.html'},
      });
    }
    markNotified(fresh.map(a=>a.id+'@'+a.remindAt));
  }catch(e){ console.warn('[reminders] could not show notification:',e); }
}

/* The app is only ever running in the foreground, so these are the two
   moments a reminder can possibly be noticed. */
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible') checkDueReminders();
});
