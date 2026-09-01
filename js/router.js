/* ==============================================================
   ROUTES — a URL for every screen.

   The app had none. Reloading always landed on Home, a collection
   could not be linked to, and the browser's own Back button did
   nothing at all — so the goBack() chevron was the only way out of a
   pushed screen, and the hardware/gesture back that every phone user
   reaches for first either left the app or sat inert.

   WHY THE HASH AND NOT A PATH. The app is served statically, from
   whatever directory it happens to sit in, with no rewrite rule in
   front of it — so /list/<id> as a real path would 404 on a cold load
   or a refresh, which is the exact moment a route is supposed to
   earn its keep. A hash needs nothing from the server and works from
   a subdirectory, from a file:// checkout and from the PWA's
   start_url alike.

   It also stays out of the way of the three things already read off
   the query string at boot — ?token_hash=, ?conv= and ?join= (see
   main.js, which runs those readers in a fixed order). A path-based
   router would have to be threaded through all three; a hash router
   is orthogonal to them by construction, and pathname+search is
   preserved verbatim on every write below.
   ============================================================== */

/* The route key is what appears in the URL, and it is deliberately NOT
   the internal page id: 'you' and 'chat' are what the tab bar calls
   those screens, while the code keeps the domain word ('me',
   'conversation'). Both name the same thing — see the Screens table in
   CLAUDE.md — and a URL is read by a person. */
const ROUTE_PAGE={
  home:'home', upnext:'upnext', done:'done',
  lists:'lists', list:'detail',
  messages:'messages', chat:'conversation',
  map:'globalmap', you:'me', settings:'settings',
};
/* Which of them address one collection. A conversation is addressed by
   its collection id too — see curConvId in state.js. */
const ROUTE_ID={list:1,chat:1};

/* ==============================================================
   A ROUTE THAT NAMES AN OVERLAY, NOT A SCREEN

   '#activity/<id>' is the odd one out: every other route is a .page
   that nav() can show, and this one is a sheet sitting on top of
   whichever page happens to be underneath. It exists because the
   thing people actually want to send someone is one activity — "look
   at this one" — and the list it happens to be filed in was as close
   as a link could get.

   It is deliberately NOT '#list/<listId>/<actId>'. An activity is
   opened from Home's Up Next, from Accomplished, from the map's place
   sheet and from the composer's search results as readily as from its
   own collection, and none of those screens is a list — so a route
   that had to name one would either be wrong or unavailable on four
   of the five ways in. The id is enough on its own: routeOpenActivity()
   reads the activity's own collection_id back and lands the screen
   behind the sheet on the right list.

   IT REPLACES RATHER THAN PUSHES. Opening a sheet is not a
   navigation — every sheet in the app is dismissed by Back through
   the overlayOpen() branch below, and pushing an entry here would
   make that take two presses. The URL is shareable; the history is
   unchanged. That is the whole of it.
   ============================================================== */
const ROUTE_SHEET={activity:1};
const PAGE_ROUTE={};
Object.keys(ROUTE_PAGE).forEach(k=>{ PAGE_ROUTE[ROUTE_PAGE[k]]=k; });

/* Set while the router itself is writing or applying a route, so nav()
   cannot push an entry for a navigation the history just handed us and
   the listeners cannot re-enter. */
let _routeApplying=false;
/* The session's first write replaces rather than pushes: booting into
   Home should not leave an entry behind it that Back can return to,
   because there is nothing there. */
let _routeStarted=false;
/* A deep link is honoured once. A later showApp() — signing out and
   back in on the same page — starts at Home rather than reopening
   whatever the previous account had in the address bar. */
let _routeEntryRead=false;

function routeHash(page,id){
  const key=PAGE_ROUTE[page];
  if(!key) return '';
  if(!ROUTE_ID[key]) return '#'+key;
  const val=id||(page==='conversation'?curConvId:curListId)||'';
  /* A derived difficulty list's id is 'smart:easy' — encoded, like
     anything else that came out of the database. */
  return val?'#'+key+'/'+encodeURIComponent(val):'#'+key;
}

/* The reverse. Returns null for anything this app does not own, so a
   stray fragment from somewhere else is ignored rather than
   navigating. */
function parseRoute(hash){
  const raw=String(hash||'').replace(/^#/,'').trim();
  if(!raw) return null;
  const cut=raw.indexOf('/');
  const key=(cut<0?raw:raw.slice(0,cut)).toLowerCase();
  const page=ROUTE_PAGE[key];
  if(!page&&!ROUTE_SHEET[key]) return null;
  let id='';
  if(cut>=0){
    const tail=raw.slice(cut+1);
    try{ id=decodeURIComponent(tail); }catch(e){ id=tail; }
  }
  /* An overlay route carries no page of its own — what is underneath
     is decided by the activity, not by the URL. '#activity' with no id
     names nothing, so it is ignored outright rather than opening a
     sheet on whatever was last looked at. */
  if(ROUTE_SHEET[key]) return id?{sheet:key,id}:null;
  /* '#list' with no collection is not a screen. Fall back to the tab
     that owns it rather than opening detail on whatever curListId
     happens to hold. */
  if(ROUTE_ID[key]&&!id) return {page:page==='detail'?'lists':'messages',id:''};
  return {page,id};
}

/* Called by nav() once the new screen is settled. The hash is written
   onto the CURRENT pathname and search, never a rebuilt URL: the query
   string is where an invite or a confirmation token lives while boot is
   still consuming it, and replacing the whole URL here would eat it. */
function routeSync(page,id){
  if(_routeApplying) return;
  const h=routeHash(page,id);
  if(!h) return;
  if(location.hash===h){ _routeStarted=true; return; }
  const url=location.pathname+location.search+h;
  try{
    if(_routeStarted) history.pushState({r:h},'',url);
    else history.replaceState({r:h},'',url);
  }catch(e){ /* A sandboxed frame refuses both; the app still works. */ }
  _routeStarted=true;
}

/* Called when the activity sheet opens and again when it closes.
   Both replace, for the reason in the ROUTE_SHEET block above.

   The clear is a no-op unless the hash is currently a sheet route,
   which is what keeps it safe to call from dismissOverlays(): during
   the Back-with-a-sheet-open path the hash has already moved on, and
   writing the screen route here as well as in the branch below would
   leave two entries deep for one press. */
function routeSheetSync(actId){
  if(_routeApplying||!_routeStarted||!actId) return;
  const h='#activity/'+encodeURIComponent(actId);
  if(location.hash===h) return;
  try{ history.replaceState({r:h},'',location.pathname+location.search+h); }
  catch(e){}
}
function routeSheetClear(){
  if(_routeApplying||!_routeStarted) return;
  const r=parseRoute(location.hash);
  if(!r||!r.sheet) return;
  const h=routeHash(curPage);
  if(!h||location.hash===h) return;
  try{ history.replaceState({r:h},'',location.pathname+location.search+h); }
  catch(e){}
}

/* Landing on '#activity/<id>' cold, or arriving at one through the
   history. The screen behind the sheet is the activity's own
   collection, read off the row rather than off the URL — see the
   ROUTE_SHEET block.

   A dead id costs nothing, the same way a dead collection id does:
   fetchActivity() answers null and we fall back to the tab the sheet
   would have opened over. */
async function routeOpenActivity(id){
  let a=null;
  try{ a=await fetchActivity(id); }catch(e){}
  _routeApplying=true;
  try{ await nav(a&&a.listId?'detail':'lists',a&&a.listId?a.listId:undefined); }
  finally{ _routeApplying=false; }
  /* nav() ran with the router suspended, so routeSync() never got to
     arm this — and without it routeSheetClear() would decline to hand
     the URL back when the sheet is closed, stranding '#activity/<id>'
     in the address bar for the rest of the session. The entry URL is
     already the one we want, so there is nothing to write here. */
  _routeStarted=true;
  if(!a){
    /* Nothing to open, so the URL must stop claiming there is. */
    try{ history.replaceState({r:routeHash(curPage)},'',
      location.pathname+location.search+routeHash(curPage)); }catch(e){}
    return;
  }
  /* Not awaited: the screen behind it is painted, which is what the
     caller is holding for. The sheet lands a beat later. */
  openActDetail(id);
}

/* What the address bar was asking for at launch, or null. Consumed
   once — see _routeEntryRead above. */
function routeEntry(){
  if(_routeEntryRead) return null;
  _routeEntryRead=true;
  const r=parseRoute(location.hash);
  /* Home is the default anyway, and treating it as a deep link would
     only cost showApp() its one meaningful branch. A sheet route is
     always a deep link — there is no default sheet. */
  return r&&r.page!=='home'?r:null;
}

/* Signing out explicitly drops the route. The next person to sign in on
   this device must not land on the previous account's collection —
   renderDetail() would bounce them to Lists, but the URL would have
   named a list that is not theirs, which is worse than a tidy one. */
function routeClear(){
  _routeStarted=false;
  _routeEntryRead=true;
  try{ history.replaceState(null,'',location.pathname+location.search); }
  catch(e){}
}

/* ==============================================================
   COMING BACK

   popstate covers the Back/Forward buttons and the Android and iOS
   back gestures; hashchange covers a hash typed or pasted into the
   address bar, which pushState deliberately does not fire. Both land
   here, and both are idempotent — applying a route we are already on
   does nothing.

   AN OPEN SHEET EATS THE GESTURE. Back with a sheet up should close
   the sheet, which is what it does on every native app, and the
   alternative — navigating the page out from under an open overlay —
   is the same stranded-sheet bug selectTab() calls dismissOverlays()
   to avoid. The route we were on is pushed straight back, so the
   screen stays put and a second Back navigates for real.
   ============================================================== */
function onRouteChange(){
  if(_routeApplying) return;
  if(document.body.classList.contains('booting')) return;
  /* Signed out there is no app to route around, and #authPage is not a
     .page — nav() knows nothing about it. */
  if($('appWrap').style.display==='none') return;

  if(overlayOpen()){
    dismissOverlays();
    _routeApplying=true;
    try{ history.pushState({r:routeHash(curPage)},'',
      location.pathname+location.search+routeHash(curPage)); }catch(e){}
    _routeApplying=false;
    return;
  }

  const r=parseRoute(location.hash)||{page:'home',id:''};
  /* Forward, or a hash pasted in while the app is already up. No sheet
     is open — the branch above would have taken it — so this is the
     one case where an overlay route has to open the overlay. */
  if(r.sheet==='activity'){ routeOpenActivity(r.id); return; }
  const curId=curPage==='conversation'?curConvId:curListId;
  if(r.page===curPage&&(!ROUTE_ID[PAGE_ROUTE[r.page]]||r.id===curId)) return;
  /* Suspended across the nav so it does not push an entry for a
     navigation the history has already recorded. */
  _routeApplying=true;
  try{ nav(r.page,r.id||undefined); }
  finally{ _routeApplying=false; }
}

window.addEventListener('popstate',onRouteChange);
window.addEventListener('hashchange',onRouteChange);
