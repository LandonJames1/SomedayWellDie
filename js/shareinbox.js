/* ==============================================================
   SHARING SOMETHING INTO THE APP

   The native share extension stashes what was shared and opens the
   app with somedaywelldie://share; js/deeplink.js routes that here.
   See ShareViewController.swift and ShareInbox.swift.

   ⚠️ THIS IS NOT THE OLD IMPORT FEATURE COMING BACK. That one read
   a link with a model call, produced a filled-in draft and could
   return several activities at once — five platform readers, a
   review sheet and a bulk sheet, all of which are gone (see
   IMPORTING IS GONE in CLAUDE.md). This does one thing: it opens
   the app's own new-activity sheet with the shared text as the name
   and the shared address on the Links page. No model call, no
   parsing, no second form.

   So the app's hard rule still holds unchanged: nothing inserts an
   activity without showing a sheet first.

   Native only. In a browser the plugin does not exist and every
   function here is a no-op, the same as js/widget.js.
   ============================================================== */

function shareInboxPlugin(){
  return (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.ShareInbox) || null;
}

/* Set when a share lands before there is anybody signed in to open a
   sheet for — the same shape as pendingConv/pendingJoin, and consumed
   by showApp() for the same reason. */
let pendingShare=null;

/* ⚠️ Reading the stash CLEARS it, natively. So this must be called
   once per landing and the result held here, never re-read hoping
   the value is still there. */
async function takeSharedInput(){
  const p=shareInboxPlugin();
  if(!p) return null;
  try{
    const r=await p.take();
    if(!r||!r.json) return null;
    const v=JSON.parse(r.json);
    const name=String(v.name||'').trim();
    const url=String(v.url||'').trim();
    if(!name&&!url) return null;
    return {name:name,url:url};
  }catch(e){ console.warn('[share] could not read',e); return null; }
}

/* Called by js/deeplink.js. Signed out, it is held rather than
   dropped: somebody sharing into an app they have not signed into
   yet is exactly the person who must not lose what they sent. */
async function handleSharedInput(){
  const item=await takeSharedInput();
  if(!item) return;
  if(!currentUser){ pendingShare=item; return; }
  openSharedActivity(item);
}

/* Consumed from showApp(), like every other pending landing. */
function flushPendingShare(){
  if(!pendingShare) return;
  const item=pendingShare; pendingShare=null;
  openSharedActivity(item);
}

/* ⚠️ THE LINK IS SET AFTER openNewActivity(), NOT BEFORE.
   That function starts with `aLinks=[]` — it is resetting a sheet
   that may have been left in any state — so anything staged ahead of
   it is discarded. renderNewLinks() then repaints the Links card,
   which is the only thing that reads the array. */
async function openSharedActivity(item){
  /* A shared page gives its title as the name and its address as a
     link; a shared selection gives only text, which is the name. */
  await openNewActivity(item.name||'');
  if(item.url){
    aLinks=[item.url];
    if(typeof renderNewLinks==='function') renderNewLinks();
  }
}
