/* ==============================================================
   THE MAP TAB, NATIVELY

   ⚠️ THE WEB MAP IS UNTOUCHED. Everything in map.js still runs
   exactly as it did — MapLibre, the globe, the clusters, the place
   sheet — and that is what a browser gets. This file is a single
   branch at the top of renderGlobalMap(): where the plugin exists,
   MapKit is presented instead and MapLibre is never even fetched,
   which takes ~900KB off a cold launch on the one tab that needed
   it. See NativeMap.swift.

   ⚠️ THE COLLECTION MAP IS DELIBERATELY LEFT ON MAPLIBRE. It is
   embedded inside a scrolling screen rather than being a screen,
   so replacing it would mean a native view living inside the web
   view's layout — the one thing the modal design exists to avoid.
   One seam, and it is a present/dismiss.

   ⚠️ AND THE POINTS COME FROM THE SAME CACHE HOME READS, filtered
   by the same globalMapFilter the web map uses, so the two cannot
   disagree about what is on the map.
   ============================================================== */

function nativeMapPlugin(){
  return (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.NativeMap) || null;
}
function nativeMapAvailable(){ return !!nativeMapPlugin(); }

/* Guards against the map page being re-entered while the modal is
   already up — nav() re-renders on every visit, and a second
   present() would stack two full-screen maps. */
let _nativeMapOpen=false;

function nativeMapPoints(acts,lists){
  return acts.filter(a=>{
    if(a.locationLat==null||a.locationLng==null) return false;
    if(globalMapFilter==='pending') return !a.completed;
    if(globalMapFilter==='completed') return !!a.completed;
    return true;
  }).map(a=>({
    id:String(a.id),
    name:String(a.name||''),
    /* The callout's second line: the list, and the deadline or the
       date it was finished — dateInfo() decides which. */
    detail:[activityListLabel(a,lists),(dateInfo(a)||{}).label].filter(Boolean).join(' · '),
    lat:Number(a.locationLat),
    lng:Number(a.locationLng),
    done:!!a.completed,
    priority:String(a.priority||'medium'),
  }));
}

async function openNativeMap(){
  const p=nativeMapPlugin();
  if(!p||_nativeMapOpen) return;
  _nativeMapOpen=true;
  try{
    const lists=await fetchCollections();
    const acts=await fetchAllActivities(lists);
    const r=await p.present({points:nativeMapPoints(acts,lists)});
    /* Tapping a pin's callout opens that activity's own sheet — the
       same sheet the web map's place sheet opens, and the same one
       #activity/<id> lands on. */
    const id=r&&r.openId;
    if(id&&typeof openActDetail==='function'){ openActDetail(id); return; }
    /* Closed without choosing anything. The map "page" underneath was
       never drawn — it exists only to launch this — so returning to
       the tab the user came from is what closing means here. */
    if(typeof selectTab==='function') selectTab(nativeMapReturnTab());
  }catch(e){
    console.warn('[map] native map failed',e);
    _nativeMapOpen=false;
    return;
  }finally{ _nativeMapOpen=false; }
}

/* Where closing the map goes back to. backTab is what nav() already
   records for a pushed screen; Home is the honest default. */
function nativeMapReturnTab(){
  return (typeof backTab==='string'&&backTab&&backTab!=='map')?backTab:'home';
}
