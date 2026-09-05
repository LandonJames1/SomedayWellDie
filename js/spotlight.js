/* ==============================================================
   SPOTLIGHT — your activities in the phone's own search.

   Pull down on the home screen, type a word, and the activity
   comes up. Tapping it opens its sheet. See SpotlightIndex.swift.

   Native only, and a silent no-op in a browser: the plugin is
   reached through Capacitor.Plugins with no import, exactly as
   js/widget.js and js/haptics.js are. Nothing in the web app
   changes.

   ⚠️ THE WHOLE SET IS REPUBLISHED, NOT PATCHED. A search index
   lives on the device and outlives the process, so a deleted
   activity, a list you left and a signed-out account must all take
   their rows out of it — and tracking each of those separately is
   three chances to leak somebody's data into a search field. The
   native side deletes the domain and re-adds, which is one disk
   write off the critical path, so the honest version is also the
   affordable one.
   ============================================================== */

/* The bridge carries this as one message, so it is bounded. Four
   hundred is far past any real library and still a small payload;
   past it, the oldest are dropped rather than the newest. */
const SPOTLIGHT_MAX = 400;

function spotlightPlugin(){
  return (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.SpotlightIndex) || null;
}

let _spotlightLast=null;

/* The line under the title. dateInfo() already decides what a
   deadline reads as — including "Accomplished" once something is
   done — so this is the same string the app's own rows show rather
   than a second opinion about it. */
function spotlightDetail(a,lists){
  const list=activityListLabel(a,lists);
  const when=(dateInfo(a)||{}).label||'';
  return [list,when].filter(Boolean).join(' · ');
}

/* ⚠️ KEYWORDS ARE THE LEVER, NOT THE TITLE. Spotlight matches a title
   largely from its start, so "Make a custom deck of cards" only came up
   for someone who typed most of it — which made the whole feature look
   broken. Keywords are matched per word and much more loosely, so every
   meaningful word of the name goes in as its own keyword and "cards"
   finds it.

   ⚠️ AND THE WORDS COME FROM fuzzyTokens(), the app's own tokenizer,
   rather than a split on spaces: it already folds accents, closes up
   apostrophes, expands the abbreviation table (mt → mount) and DROPS
   LEADING VERBS — so "Go skydiving in Interlaken" contributes
   "skydiving" and "interlaken" rather than wasting its first keyword on
   "go". That is the same reading the in-app search uses, so the two
   cannot disagree about what a name is about.

   Whole multi-word phrases go in beside the single words, because a
   list called "Boyz Summa" should also match typed as one thing. */
function spotlightKeywords(a,lists){
  const list=activityListLabel(a,lists);
  const words=new Set();
  const add=v=>{
    if(!v) return;
    /* The phrase as written, for a two-word list or place name. */
    const phrase=String(v).trim();
    if(phrase.length>1) words.add(phrase);
    /* Then its meaningful parts. Single characters are noise. */
    (typeof fuzzyTokens==='function'?fuzzyTokens(phrase):phrase.toLowerCase().split(/\s+/))
      .forEach(t=>{ if(t&&t.length>1) words.add(t); });
  };
  add(a.name); add(list); add(a.location);
  return Array.from(words);
}

function spotlightPayload(acts,lists){
  return acts.slice(0,SPOTLIGHT_MAX).map(a=>{
    const list=activityListLabel(a,lists);
    return {
      id:String(a.id||''),
      name:String(a.name||''),
      detail:spotlightDetail(a,lists),
      keywords:spotlightKeywords(a,lists),
      /* The free-text body Spotlight indexes in full, which is what
         makes a word from the middle of a place name findable. */
      text:[a.name,list,a.location,(dateInfo(a)||{}).label].filter(Boolean).join(' '),
      /* ⚠️ A HINT, NOT AN ORDER. Spotlight weighs this against its own
         relevance, and it is the only say the app gets in whether an
         unfinished activity outranks one from three years ago. Lower
         is better, so pending leads. */
      rank:a.completed?40:10,
    };
  }).filter(i=>i.id&&i.name);
}

async function publishSpotlight(acts,lists){
  const p=spotlightPlugin();
  if(!p) return;
  try{
    const items=spotlightPayload(acts,lists);
    const sig=JSON.stringify(items);
    if(sig===_spotlightLast) return;
    _spotlightLast=sig;
    const r=await p.index({items:items});
    console.info('[spotlight] sent',items.length,'— indexed',(r&&r.count)||0);
  }catch(e){ console.warn('[spotlight] index failed',e); }
}

/* From resetAccountState(). The index is on the device, so it must
   not survive the account that filled it — the same rule the widget
   follows, and the more important of the two: this one is reachable
   from the home screen without opening the app at all. */
async function clearSpotlight(){
  _spotlightLast=null;
  const p=spotlightPlugin();
  if(!p) return;
  try{ await p.clear(); }catch(e){}
}
