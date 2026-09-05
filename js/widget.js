/* ==============================================================
   THE HOME SCREEN WIDGET, from the web side.

   The widget cannot read anything the app knows — the session, the
   RLS scope and the offline snapshot are all in here — so it owns
   no data and this file posts it. See WidgetBridge.swift.

   It is a NATIVE-ONLY feature and everything here is a silent no-op
   in a browser, the same way js/haptics.js is: the plugin is reached
   through Capacitor.Plugins with no import, so without the shell
   there is nothing to call.

   ⚠️ IT PUBLISHES THE SAME NUMBERS HOME DRAWS, FROM THE SAME PLACE.
   publishWidget() is called at the end of renderHome() with the
   arrays that screen has already fetched, so the widget cannot
   disagree with the app about what is next — which is the whole
   reason the ordering is not re-derived natively.
   ============================================================== */

const WIDGET_ROWS = 4;

function widgetPlugin(){
  return (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.WidgetBridge) || null;
}
function widgetAvailable(){ return !!widgetPlugin(); }

/* The last payload written, so an unchanged Home does not spend a
   bridge call and a timeline reload on saying the same thing. Same
   argument as setHTML() declining to repaint identical markup —
   renderHome() runs on every visit to the tab. */
let _widgetLast=null;

/* ⚠️ ONLY overdue and urgent set `urgent`, because those are the only
   two bands dateInfo() tints on the web side. Widening it here would
   make the widget's reading of "pressing" differ from the app's. */
function widgetUrgent(info){
  return info.cls==='overdue'||info.cls==='urgent';
}

/* How many bands the widget shows at once. */
const WIDGET_KPIS = 2;

/* ⚠️ THE KPIS ARE THE NEAREST BANDS THAT HAVE ANYTHING IN THEM, not
   fixed windows. "How many this month" is the wrong number on a
   library whose next deadline is in October — it reads as zero work
   when there is plenty — so this walks the app's own band order and
   takes the first two with rows in them: Overdue, then This month,
   This year, Next year, 2–4 years, 5+ years. So it reads "4 Overdue"
   over "10 This month" for one person and "10 This month" over
   "6 This year" for the next, which is the pair each of them actually
   has to answer for.

   Overdue leads, and is not something the widget invents: it is band
   `order: 0` in targetBand(), and it is the group Up Next puts at the
   top of the same list. Showing "1 THIS MONTH" while four things are
   overdue would be a quieter number than the truth.

   Someday and No date are skipped — neither is scheduled, which is
   what the numbers claim to be counting. With nothing dated at all it
   falls back to a single plain pending count, which is the only honest
   reading left. */
function widgetKpis(pending){
  const byOrder=new Map();
  for(const a of pending){
    const b=targetBand(a);
    if(!b||b.order>5) continue;
    const cur=byOrder.get(b.order)||{label:b.label,count:0};
    cur.count++;
    byOrder.set(b.order,cur);
  }
  const nearest=Array.from(byOrder.keys()).sort((x,y)=>x-y).slice(0,WIDGET_KPIS);
  if(!nearest.length) return [{count:pending.length,label:'To go'}];
  return nearest.map(o=>({count:byOrder.get(o).count,label:byOrder.get(o).label}));
}

function widgetPayload(acts,lists){
  const pending=acts.filter(a=>!a.completed);
  const next=sortUpNext(pending).slice(0,WIDGET_ROWS).map(a=>{
    const info=dateInfo(a);
    return {
      name:String(a.name||''),
      /* Already formatted here rather than in Swift: dateInfo() is
         where every band, every countdown and the em dash for "no
         date" are decided, and a second implementation of that in
         the widget is a second thing to keep in step. */
      when:info.label||'',
      urgent:widgetUrgent(info),
      list:activityListLabel(a,lists)||'',
    };
  });
  const kpis=widgetKpis(pending);
  return {
    total:acts.length,
    done:acts.length-pending.length,
    kpis:kpis,
    /* The single-KPI shape this replaced, still sent so a widget
       binary from before the change keeps drawing a number rather than
       falling back to zero. It costs two short fields. */
    kpiCount:kpis[0]?kpis[0].count:0,
    kpiLabel:kpis[0]?kpis[0].label:'',
    next:next,
  };
}

async function publishWidget(acts,lists){
  const p=widgetPlugin();
  if(!p) return;
  try{
    const json=JSON.stringify(widgetPayload(acts,lists));
    if(json===_widgetLast) return;
    _widgetLast=json;
    const r=await p.publish({json:json});
    /* One line, once per actual change, naming what crossed. A widget
       showing its placeholder and no line here means the plugin never
       ran; a line saying stored:0 means the App Group is not shared. */
    const sent=widgetPayload(acts,lists);
    console.info('[widget] published',sent.next.length,'rows,',
                 sent.kpis.map(k=>k.count+' '+k.label).join(' / '),
                 '— stored',(r&&r.stored)||0,'bytes');
  }catch(e){ console.warn('[widget] publish failed',e); }
}

/* ⚠️ THE WIDGET AND THE SPOTLIGHT INDEX WENT STALE OFF THE HOME TAB.
   Both were published from renderHome() and nowhere else, so completing
   something from a collection, from Up Next or from the map left the
   home screen showing the old three until you happened to visit Home —
   which reads exactly as "the widget is wrong".

   refreshAfterChange() is where every mutation in the app already
   lands, so this hangs off that. It reads the in-memory cache
   SYNCHRONOUSLY — the same read dupeGuard() and Home's composer make —
   so it costs no round trip, and a cold cache simply does nothing
   rather than fetching on a path nothing is waiting for. Both
   publishers dedupe against what they last wrote, so an unchanged
   library spends no bridge call. */
function syncNativeIndexes(){
  if(typeof cacheWarm!=='function'||!cacheWarm()) return;
  const lists=cachedCollections(), acts=cachedActivities();
  publishWidget(acts,lists);
  if(typeof publishSpotlight==='function') publishSpotlight(acts,lists);
}

/* Called from resetAccountState(). A widget sits on a home screen
   the next person to pick up the phone can see, so it must not
   outlive the session that filled it — the same rule every other
   per-account cache follows. */
async function clearWidget(){
  _widgetLast=null;
  const p=widgetPlugin();
  if(!p) return;
  try{ await p.clear(); }catch(e){}
}
