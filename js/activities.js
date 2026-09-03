/* ==============================================================
   ACTIVITIES — the add / complete / edit / delete flows.

   Two speeds, deliberately:
     - Quick:  type a name in the composer and press return;
               tap the circle to complete. No sheet either way.
     - Full:   the activity sheet, for when details matter.
   ============================================================== */

/* ==============================================================
   QUICK ADD  (composer → insert with just a name)
   ============================================================== */
/* The composer is a way to START an activity, not a way to file one.

   Nothing anywhere in the app inserts an activity without showing this
   sheet first. That is a deliberate reversal: the composer used to
   insert on Return with only a name, which was the fastest path in the
   app and also the one that produced its worst rows — no priority, no
   real target date, no location, so the thing never surfaced in Up Next
   and never appeared on the map. An idea captured into a hole is not
   captured.

   Nothing on the sheet is required beyond the name, so this still costs
   one extra tap (Save) rather than any actual filling-in — but the
   fields are in front of the user at the one moment they are thinking
   about the thing, which is the only moment they will ever bother.

   The duplicate check lives in saveActivity(), so there is none here —
   checking twice would ask the same question on the way in and on the
   way out. */
function quickAddActivity(){
  const input=$('composerInput');
  if(!input)return;
  const name=input.value.trim();
  if(!name){shakeEl(input);return;}
  /* Cleared before the sheet opens: the name lives in the sheet from
     here on, and leaving a copy behind means it can be filed twice. */
  input.value='';
  onComposerInput();
  startNewActivity(name);
}

/* ==============================================================
   ONE QUESTION BEFORE THE SHEET

   An activity arrives two ways round: something you mean to do, and
   something you have just done and want on the record. The second had
   no path at all — you had to create the plan and immediately complete
   it, which is two sheets and a fiction in between. A helicopter ride
   taken on a whim is exactly the thing this app is for, and it was the
   thing it was worst at.

   So every *human* way in asks first. Deliberately not inside
   openNewActivity() itself: a link import (handOffSingle) and the bulk
   sheet land there too, and both are plans by construction, so the
   question would have only one answer.

   New Activity is first because it is the overwhelmingly common
   answer, and this costs the fast path a tap — the composers were
   tuned so capture costs one extra tap and it is now two. Keeping the
   common answer under the thumb is what makes that bearable.
   ============================================================== */
function startNewActivity(prefillName){
  showActionSheet({
    message:'Is this something you want to do, or something you’ve already done?',
    items:[
      {label:'New Activity',       icon:'plus',
       onSelect:()=>openNewActivity(prefillName)},
      {label:'Completed Activity', icon:'check-circle',
       onSelect:()=>openCompDraft(prefillName)},
    ],
  });
}

/* ==============================================================
   ONE-TAP COMPLETE
   Toggling only writes date_completed, so un-completing never
   destroys the notes and photos attached to a past completion —
   re-completing brings them straight back.
   ============================================================== */
async function toggleComplete(id,isDone){
  /* Completing asks for the date first — the activity is not marked
     accomplished until that sheet is saved, so cancelling leaves it
     alone rather than filing it under a guess. Un-completing is still
     immediate: there is nothing to ask.

     The source is deliberately not hardcoded here. This is reachable
     from the activity sheet, which opens over *any* screen, so pinning
     it to 'detail' redrew the collection page while the user was
     looking at Up Next. */
  if(!isDone){ openCompletedDate(id); return; }
  const a=await fetchActivity(id);
  const{error}=await dbUpdate('Activities',{date_completed:null},{id});
  if(error){
    console.error('toggleComplete:',error);
    showToast(error.message||'Couldn’t update that.');
    return;
  }
  await updateCollectionStats((a&&a.listId)||curListId);
  await refreshAfterChange();
}

/* ==============================================================
   EDITING IN PLACE

   A pending activity's fields are changed by tapping them on its own
   detail sheet -- the name, the list, the target date, the location,
   the priority and the difficulty -- rather than by opening a separate
   Edit form and hunting for the row that is wrong.

   The argument is the one the difficulty chip already made and the one
   the completion sheet made before it: the thing that displays a value
   is the obvious place to change it, and a whole form is the wrong
   weight for "that name has a typo". "Edit details" still exists and
   still opens the full sheet; this is the fast path, not a replacement.

   ⚠️ THESE WRITE IMMEDIATELY, WHICH THE COMPLETION SHEET DELIBERATELY
   DOES NOT. That is not a contradiction, and the line is worth stating
   because the next person will read it as one:

     - STAGED is right when the thing does not exist yet (the new
       activity sheet -- Cancel means "never mind, do not create it"),
       or when several fields change together as one event (completing
       something: the date, the photos and the note are one act).
     - IMMEDIATE is right for one field on a row that already exists,
       because the picker itself carries the Cancel. Choosing "High"
       from a menu is not something you arrive at by accident, and
       there is no half-filled state to lose.

   Every one of these ends the same way: dbUpdate (so it queues offline
   like any other write), then repaint the activity sheet, then
   refreshAfterChange() for the screen behind it. The order matters --
   the sheet the user is looking at should change first. */

/* role="button" is not a button: it gets no keyboard activation for
   free. Both reference rows on this sheet use it -- see the note on
   .ad-place in detail.css for why they are divs and not <button>s. */
function onRowKey(e){
  if(e.key!=='Enter'&&e.key!==' ') return;
  e.preventDefault();
  e.currentTarget.click();
}

/* Shared by all of them. Returns false when the write failed, so a
   caller can leave its own sheet open rather than closing over an
   error the user never saw. */
async function patchActivity(id,fields){
  const{error}=await dbUpdate('Activities',fields,{id});
  if(error){
    console.error('patchActivity:',error,fields);
    showToast(error.message||'Couldn’t save that.');
    return false;
  }
  /* ⚠️ REPAINT THE HEAD, NOT THE SHEET. openActDetail() awaits a notes
     fetch before it paints and then replaces every node in the body --
     so changing a priority left the old values on screen for a round
     trip, then blanked the media grid and the notes log and rebuilt
     them. Every one of these edits touches only the plate, the chips or
     the Where row, so only those are redrawn; the photos and the log
     are never even touched. Falls back to the full render when the
     sheet is showing something else (or nothing). */
  if(!await repaintActDetailHead(id)) await openActDetail(id);
  await refreshAfterChange();
  return true;
}

/* Redraws #adHead in place. Returns false when the detail sheet is not
   open on this activity, so the caller can fall back. */
async function repaintActDetailHead(id){
  const box=$('adHead');
  if(!box||!$('actDetailSheet').classList.contains('open')) return false;
  const a=await fetchActivity(id);
  if(!a||a.completed) return false;
  const lists=(await fetchCollections()).filter(c=>(a.listIds||[]).includes(c.id));
  const canMove=lists.length>0&&(await fetchCollections()).length>1;
  setHTML(box,actDetailHeadHTML(a,lists,dateInfo(a),canMove));
  /* The location field is rebuilt with it, so the text/coordinate
     contract has to be re-established exactly as openActDetail() does. */
  const adLoc=$('adLoc');
  if(adLoc){ locGeoMark(adLoc); locSetHome('adLoc',!!a.locationIsHome); }
  _titleEditFor=null;_placeEditFor=null;
  return true;
}

/* ---- the name, edited where it is written ------------------------ */

/* A sheet to change one line of text was the wrong weight -- it covered
   the thing being renamed, and the name is right there. Tapping the
   title turns it into a field in place, at the same 29px serif, so
   nothing moves when the keyboard arrives.

   A <textarea> rather than an <input> because .ad-title WRAPS: a name
   can run to three lines on a 320px screen and an input would put it on
   one scrolling line. Enter still commits -- a name is one line
   semantically even when it is drawn as three. */

let _titleEditFor=null;      /* the activity being renamed */
let _titleWas='';            /* what to put back on Escape */
let _titleBusy=false;        /* Enter commits, which blurs, which would commit again */

function startTitleEdit(id){
  if(_titleEditFor) return;
  const btn=$('adTitleBtn'),box=$('adTitleEdit');
  if(!btn||!box) return;
  _titleEditFor=id;
  _titleWas=btn.textContent;
  box.value=_titleWas;
  btn.hidden=true;box.hidden=false;
  growTitleEdit();
  box.focus();
  const n=box.value.length;
  try{ box.setSelectionRange(n,n); }catch(e){}
}

/* The field is its own height. Reset first, or it can only ever grow. */
function growTitleEdit(){
  const box=$('adTitleEdit');
  if(!box) return;
  box.style.height='auto';
  box.style.height=box.scrollHeight+'px';
}

function onTitleEditKey(e){
  if(e.key==='Enter'){ e.preventDefault(); e.currentTarget.blur(); }
  else if(e.key==='Escape'){ e.preventDefault(); cancelTitleEdit(); }
}

function cancelTitleEdit(){
  const btn=$('adTitleBtn'),box=$('adTitleEdit');
  _titleEditFor=null;
  if(box){ box.hidden=true;box.value=_titleWas; }
  if(btn) btn.hidden=false;
}

async function commitTitleEdit(){
  if(!_titleEditFor||_titleBusy) return;
  const id=_titleEditFor,box=$('adTitleEdit');
  const name=(box?box.value:'').trim();
  /* An empty name is the one value this field cannot take -- it is what
     every row, card, pin and chip draws the activity as. Put the old one
     back rather than refusing and holding the keyboard open. */
  if(!name||name===_titleWas.trim()){ cancelTitleEdit(); return; }
  _titleBusy=true;
  _titleEditFor=null;
  await patchActivity(id,{name});
  _titleBusy=false;
}

/* ---- where it is, edited where it is written --------------------- */

/* Same argument as the title, with one extra requirement: the dropdown
   has to come with it. The row's static text is swapped for a .loc-wrap
   holding the field, the hidden lat/lng and the results box -- the same
   shape every other location field in the app uses, because
   locFieldsFor() finds the coordinates by looking inside .loc-wrap.

   ⚠️ The results are picked with onmousedown, not onclick (see
   locItemHTML). That is what makes commit-on-blur safe here: the pick
   lands BEFORE the blur, so the value being committed is the one that
   was tapped. */

let _placeEditFor=null;
let _placeWas=null;          /* {text,lat,lng,home} to restore on Escape */
let _placeBusy=false;

function startPlaceEdit(id){
  if(_placeEditFor) return;
  const row=$('adPlaceRow'),stat=$('adPlaceStatic'),wrap=$('adPlaceEdit'),el=$('adLoc');
  if(!row||!el) return;
  _placeEditFor=id;
  _placeWas={text:el.value,lat:$('adLocLat').value,lng:$('adLocLng').value,
             home:el.dataset.isHome==='1'};
  row.classList.add('editing');
  stat.hidden=true;wrap.hidden=false;
  el.focus();
  const n=el.value.length;
  try{ el.setSelectionRange(n,n); }catch(e){}
  /* Opens on the shortcuts (Home, Current location) with an empty field,
     which is the whole reason those exist. */
  locSearch(el,'adLocResults');
}

function onPlaceEditKey(e){
  if(e.key==='Enter'){ e.preventDefault(); e.currentTarget.blur(); }
  else if(e.key==='Escape'){ e.preventDefault(); cancelPlaceEdit(); }
}

function endPlaceEdit(){
  const row=$('adPlaceRow'),stat=$('adPlaceStatic'),wrap=$('adPlaceEdit');
  _placeEditFor=null;
  locClose($('adLocResults'));
  if(row) row.classList.remove('editing');
  if(stat) stat.hidden=false;
  if(wrap) wrap.hidden=true;
}

function cancelPlaceEdit(){
  const el=$('adLoc');
  if(el&&_placeWas){
    el.value=_placeWas.text;
    $('adLocLat').value=_placeWas.lat;
    $('adLocLng').value=_placeWas.lng;
    locGeoMark(el);
    locSetHome('adLoc',_placeWas.home);
  }
  endPlaceEdit();
}

async function commitPlaceEdit(){
  if(!_placeEditFor||_placeBusy) return;
  const id=_placeEditFor,el=$('adLoc');
  const typed=el.value.trim();

  /* Unchanged: no write, no round trip, no repaint. */
  if(_placeWas&&typed===_placeWas.text.trim()){ endPlaceEdit(); return; }

  _placeBusy=true;
  _placeEditFor=null;

  if(!typed){
    /* Cleared on purpose. Not the same as failing to resolve -- the user
       has said this has no place, and it drops off the map as asked. */
    endPlaceEdit();
    await patchActivity(id,{location:null,location_lat:null,location_lng:null,
      ...(homeFlagReady()?{location_is_home:false}:{})});
    _placeBusy=false;
    return;
  }

  /* Turns typed text into coordinates when the two have drifted apart.
     Offline it accepts the text as-is -- the same exemption
     requireLocation() makes, and for the same reason. */
  const res=await resolveLocationField('adLoc');
  if(res&&res.ok===false&&navigator.onLine){
    /* Keep the typed text: it is what they meant, and only the pin is
       missing. Saying so and moving on beats holding the field open. */
    showToast('Saved, but we couldn’t find that place on the map.');
  }

  const lat=$('adLocLat').value,lng=$('adLocLng').value;
  const fields={
    location:el.value.trim()||null,
    location_lat:lat===''?null:Number(lat),
    location_lng:lng===''?null:Number(lng),
  };
  if(homeFlagReady()) fields.location_is_home=locIsHome('adLoc');
  endPlaceEdit();
  await patchActivity(id,fields);
  _placeBusy=false;
}

/* ---- which list it is in ----------------------------------------- */

async function openActivityListPicker(id){
  const a=await fetchActivity(id);
  if(!a) return;
  const lists=await fetchCollections();
  /* Nowhere to move it to. The eyebrow is still drawn, just not as a
     control -- see adListHTML(). */
  if(lists.length<2) return;
  openListPicker({
    title:'Move to List',
    subtitle:a.name||'',
    currentId:a.listId,
    onPick:async(cid)=>{
      if(!cid||cid===a.listId) return;
      const cols=listFieldsFor([cid]);
      if(!cols) return;
      const from=a.listId;
      if(!await patchActivity(id,cols)) return;
      /* Both ends changed, and neither count is read from the row we
         just wrote. */
      updateCollectionStats(from);
      updateCollectionStats(cid);
    },
  });
}

/* ---- priority ----------------------------------------------------- */

/* The same action sheet the new-activity sheet opens
   (openNewPriorityMenu), with patchActivity() in place of staging.
   Both draw all three hues through the items' `tone`, which is what
   the swatched .seg-pri control used to be for. */
async function openPriorityMenu(id){
  const a=await fetchActivity(id);
  if(!a||a.completed) return;
  const cur=a.priority||'medium';
  showActionSheet({
    title:'Priority',
    items:['high','medium','low'].map(p=>({
      label:cap(p),
      checked:cur===p,
      /* The scale the rails, capsules and map pins already draw. */
      tone:p,
      onSelect:()=>{ if(p!==cur) patchActivity(id,{priority:p}); },
    })),
  });
}

/* ---- the target date ---------------------------------------------- */

let targetingId=null;

/* The five bands, in the order the old select offered them. */
const TARGET_BANDS=[
  {value:'This Month',   label:'This month'},
  {value:'This Year',    label:'This year'},
  {value:'Next Year',    label:'Next year'},
  {value:'In 2-4 Years', label:'2\u20134 years'},
  {value:'In 5+ Years',  label:'5+ years'},
];

/* ==============================================================
   PICKING A TARGET DATE

   A menu, not a form. Six choices and no free text, which is exactly
   what an action sheet is for -- and it removes a whole class of bug
   the sheet had to defend against: there is no Done here, so nothing is
   written unless something is chosen, and a legacy band on an old row
   can no longer be silently rewritten by opening the picker and
   confirming. openTargetSheet() survives underneath as the fallback for
   a browser with no showPicker().
   ============================================================== */
async function openTargetMenu(id){
  const a=await fetchActivity(id);
  if(!a) return;
  const stored=a.targetDate||'';
  /* A stored date that is exactly what a band resolves to today reads
     back as that band -- the same reverse lookup the sheet used. */
  const band=stored
    ? (isCustomDate(stored)
        ? (typeof bandForStored==='function'?bandForStored(stored):'')
        : stored)
    : '';
  const specific=!!stored&&isCustomDate(stored)&&!band;

  const items=TARGET_BANDS.map(b=>({
    label:b.label,
    checked:band===b.value,
    onSelect:()=>{ if(band!==b.value) patchActivity(id,{target_date:resolveTargetDate(b.value)||null}); },
  }));
  /* The row shows the date once one is set, rather than saying
     "Specific date" over the top of the answer it already has. */
  items.push({
    label:specific?fmtDate(stored,true):'Specific date\u2026',
    checked:specific,
    onSelect:()=>openTargetDatePicker(id,specific?stored:''),
  });
  showActionSheet({title:'Target Date',items});
}

/* The app's own calendar, opened straight from the menu row. It is not
   <input type="date">: that hands you a different widget on every
   platform, anchored to a field rather than the screen. See
   showCalendar() in modals.js. */
function openTargetDatePicker(id,cur){
  showCalendar({
    title:'Target Date',
    value:cur||'',
    onPick:iso=>patchActivity(id,{target_date:iso}),
  });
}

async function openTargetSheet(id){
  const a=await fetchActivity(id);
  if(!a) return;
  targetingId=id;
  const sel=$('tgBand'),date=$('tgDate');

  /* Anything this row carries that the picker does not offer -- the
     retired "Before I Die", or a band from before target-rollover.sql --
     is added back for this one activity. Without it, opening this sheet
     and pressing Done would silently rewrite a value nobody touched.
     The new-activity sheet cannot reach one -- it only ever creates. */
  [...sel.options].forEach(o=>{ if(o.dataset.legacy) o.remove(); });
  const stored=a.targetDate||'';
  const band=stored&&!isCustomDate(stored)?stored:'';
  if(band&&![...sel.options].some(o=>o.value===band)){
    const o=document.createElement('option');
    o.value=band;o.textContent=band;o.dataset.legacy='1';
    sel.insertBefore(o,sel.lastElementChild);
  }

  if(!stored){
    /* No target yet. "This month" is the nearest band and the one a
       person setting a date at all is most likely to mean; nothing is
       written unless they press Done. */
    sel.value='This Month';
    date.value='';
  } else if(isCustomDate(stored)){
    /* A stored date that is EXACTLY what a band resolves to today
       reopens as that band, so an untouched save writes back the
       identical value. bandForStored() is the same reverse lookup the
       edit sheet uses. */
    const b=typeof bandForStored==='function'?bandForStored(stored):'';
    if(b){ sel.value=b;date.value=''; }
    else { sel.value=CUSTOM_DATE;date.value=stored; }
  } else {
    sel.value=band;date.value='';
  }

  onTargetSheetChange();
  openModal('targetSheet');
}

function onTargetSheetChange(){
  const custom=$('tgBand').value===CUSTOM_DATE;
  $('tgDateRow').style.display=custom?'':'none';
  if(custom&&!$('tgDate').value) $('tgDate').value=todayISO();
}

async function saveTargetSheet(){
  const id=targetingId,v=$('tgBand').value;
  /* Resolved on the way IN, never on the way out -- a band is a
     relative label and target_date is an absolute field. See
     A BAND IS RESOLVED ON THE WAY IN in CLAUDE.md. */
  const target=v===CUSTOM_DATE?($('tgDate').value||null):(resolveTargetDate(v)||null);
  if(v===CUSTOM_DATE&&!target){ shakeEl($('tgDate')); return; }
  closeModal('targetSheet');
  await patchActivity(id,{target_date:target});
}

/* ==============================================================
   DISAGREEING WITH THE RATING

   Easy / Medium / Hard is inferred at capture and was, until this,
   unarguable. Two reasons that was worse than an ordinary missing
   control:

   1. The rating decides membership of the three derived lists (see
      THREE LISTS NOBODY EDITS in CLAUDE.md), so a wrong one files an
      activity somewhere the user will not look for it and there was no
      way to move it.

   2. The user's existing ratings are sent back to the model as
      examples of where this person's lines fall. Every one of them was
      the model's own past output, so a lean reinforced itself with
      nothing anywhere able to break the cycle. A correction is the
      only new information in that loop.

   THE CHIP IS THE CONTROL, exactly as the profile photo on the You tab
   is: it is the one thing on that row that displays a rating, so there
   is nothing else a tap on it could plausibly mean, and a "Change
   difficulty" row underneath would be the caption this app does not
   write. The chevron is what makes that legible without one.

   ⚠️ IT IS DRAWN EVEN WHEN THERE IS NO RATING, which is a deliberate
   departure from the rule that a null difficulty draws nothing. That
   rule exists so an un-judged row is never labelled with a tier it was
   never given, and this keeps it -- the chip reads "Not rated", which
   states no tier. The rule as written would have hidden the control on
   precisely the rows that most need it: everything captured before the
   feature existed is un-rated, and is the bulk of most libraries.

   Only on a PENDING activity. A completed one has no next, which is
   the same reason its sheet shows no priority and offers no edit. */
async function openDifficultyMenu(id){
  const a=await fetchActivity(id);
  if(!a||a.completed) return;
  const cur=a.difficulty||'';
  /* ⚠️ DIFF_ORDER is a rank MAP, not a list -- {easy:0,medium:1,hard:2}.
     Reading it in rank order rather than writing the three out again
     means the picker cannot drift from the sort. */
  const tiers=Object.keys(DIFF_ORDER).sort((x,y)=>DIFF_ORDER[x]-DIFF_ORDER[y]);
  const items=tiers.map(tier=>({
    label:DIFF_LABELS[tier],
    checked:cur===tier,
    /* The same hues the three list buttons on the Lists tab use.
       Namespaced 'd-*' -- priority already owns as-t-medium, and a
       shared class is why Medium here drew as priority's violet. */
    tone:'d-'+tier,
    onSelect:()=>setActivityDifficulty(id,tier),
  }));
  /* ⚠️ THERE IS DELIBERATELY NO "CLEAR RATING". Un-rated is not an
     answer anybody wants to give -- it is what a row looks like before
     anyone has judged it, and it costs the activity its place in the
     three derived lists and sorts it last under Difficulty. Every
     reason to open this menu is a reason to pick one of the three. */
  /* ⚠️ No `message`. It said where the rating came from, which is help
     text, and the rule against it is not a style preference -- see the
     two non-negotiable rules at the top of CLAUDE.md. */
  showActionSheet({title:'Difficulty',items});
}

/* Writes the tier AND the flag saying a person chose it. The flag is
   what stops maybeGuessLocation() overwriting the answer on the next
   edit, and what puts this row at the head of its tier in
   difficultyExamples() -- see THE CORRECTION HAS TO OUTRANK THE GUESS
   in js/location.js. Without the migration the tier is still written
   and still works for the session; only the memory of who chose it is
   lost, which is the same degradation every optional column here
   makes. */
async function setActivityDifficulty(id,tier){
  if(!difficultyReady()){
    showToast('Ratings aren\u2019t set up on this project yet.');
    return;
  }
  const fields={difficulty:tier};
  /* Reaching this at all means a person chose the tier -- the menu
     offers nothing else. */
  if(difficultyManualReady()) fields.difficulty_manual=true;
  const{error}=await dbUpdate('Activities',fields,{id});
  if(error){
    console.error('setActivityDifficulty:',error);
    showToast(error.message||'Couldn\u2019t update that.');
    return;
  }
  /* The sheet is still open on the old value. Repaint it before the
     screen behind it, so the chip the user just tapped is the first
     thing that changes. */
  await openActDetail(id);
  await refreshAfterChange();
}

/* ==============================================================
   COMPLETING SOMETHING

   One sheet does the whole job, and every field is on it: the name,
   the date, where it happened, the photos and video, and how it went.

   It used to be two sheets. A date-only sheet completed the activity,
   and attaching anything to it meant closing that, reopening the
   activity, and finding "Add photos & notes" three taps down. The
   moment you have the photos is the moment you tick the thing off, so
   they belong in the same sheet.

   The photos and notes then spent a while behind a disclosure on this
   sheet, which was the same mistake one level in — the collapsed half
   held the single thing people most want to attach, and a collapsed
   field is one most people never open. It is all on screen now. That
   costs the two-tap flow nothing: check, then Done, still works
   without touching anything in between.

   Nothing is written until Save, so an accidental tap still costs a
   Cancel rather than a wrong date to find later.
   ============================================================== */
/* compNew   — this save is the moment it becomes accomplished.
   compDraft — there is no row yet; Save inserts one.
   They are separate because a draft is both new AND needs its name
   editable, and compNew alone used to decide the name's shape too. */
let compId=null,compSrc=null,compList=null,compNew=false,compDraft=false;
/* The list the open activity was in when the sheet opened. Only used to
   tell "the user moved it" from "the user never touched that row", so an
   untouched edit does not rewrite collection_id at all. Same guard
   commitSaveActivity() uses. */
let compListsBefore=[];

async function openComp(id,source){
  const a=await fetchActivity(id);
  if(!a)return;
  compId=id;
  compSrc=source||curPage;
  compList=a.listId;
  compNew=!a.completed;
  compDraft=false;
  upMedia=[...(a.media||[])];
  /* Seeded from the row so the Lists row can move it. compListsBefore
     is what confirmComplete() compares against to decide whether the
     list columns are written at all. */
  setTargetLists([a.listId]);
  compListsBefore=[...targetListIds];

  $('compName').value=a.name;
  growCompNameField();
  /* Defaults to the stored date, or today for anything completed
     before the app recorded one. */
  $('compDate').value=a.completedDate||todayISO();
  $('compDate').max=todayISO();          /* you cannot have done it yet */
  $('compLoc').value=a.location||'';
  $('compLocLat').value=a.locationLat||'';
  $('compLocLng').value=a.locationLng||'';
  /* Stored location and stored coordinates are resolved by
     construction; mark them so re-saving does not re-geocode. */
  if(a.location&&a.locationLat!=null) locGeoMark($('compLoc')); else delete $('compLoc').dataset.geoFor;
  locSetHome('compLoc',a.locationIsHome);
  $('compNotes').value=a.completionNotes||'';
  /* Clear any chip left over from the last activity completed this
     session, and un-stick a dismissal so it can be offered again for
     this one. See suggestLocationFromPhoto() in js/media.js. */
  resetLocationSuggestion();
  renderThumbs();
  renderCompListRow();

  compShowPane('main');
  /* Said twice on purpose, in the two places somebody looks: the header
     names the sheet, the dock button names what pressing it does. */
  $('compSheetTitle').textContent=compNew?'Mark as Accomplished':'Edit';
  updateCompSaveButton();
  openModal('compSheet');
  /* ⚠️ Again, on screen: scrollHeight is 0 while the overlay is hidden,
     so the call above cannot size a name that wraps. */
  growCompNameField();
}

/* ==============================================================
   LOGGING SOMETHING ALREADY DONE

   The same sheet with no row behind it. It is the right form already —
   name, date, place, photos, how it went — and everything the sheet
   enforces still applies, the mandatory photo above all: something
   worth adding after the fact is something you have a picture of.

   The one field it has to grow is the list. An activity in no list is
   in the database, on the map, and reachable from nowhere.
   ============================================================== */
async function openCompDraft(prefillName){
  compId=null;
  compSrc=curPage;
  compList=curListId||null;
  compNew=true;                 /* it is being accomplished right now */
  compDraft=true;
  upMedia=[];

  setTargetLists(curListId?[curListId]:[]);
  compListsBefore=[];

  $('compName').value=prefillName||'';
  growCompNameField();
  $('compDate').value=todayISO();
  $('compDate').max=todayISO();
  $('compLoc').value='';$('compLocLat').value='';$('compLocLng').value='';
  $('compNotes').value='';
  resetLocationSuggestion();
  renderThumbs();
  await renderCompListRow();

  compShowPane('main');
  $('compSheetTitle').textContent='Mark as Accomplished';
  updateCompSaveButton();
  openModal('compSheet');
  growCompNameField();
  /* After the sheet has finished sliding in, as everywhere else — a
     field focused mid-animation drags the keyboard up against a sheet
     that is still moving. */
  if(!prefillName) setTimeout(()=>$('compName').focus(),320);
}

/* Shares targetListIds with the activity sheet: the two are never open
   at once, and sharing it means listFieldsFor() works unchanged. */
async function renderCompListRow(){
  const row=$('compListBtn');
  if(!row)return;

  const lists=await fetchCollections();
  /* No lists at all is handled at Save, the same way the activity sheet
     handles it — there is nothing useful to draw here. */
  if(!lists.length){row.style.display='none';return;}
  row.style.display='';

  const known=new Set(lists.map(l=>l.id));
  setTargetLists(targetListIds.filter(id=>known.has(id)));
  /* Nothing is filed into a list nobody chose: filing it into whichever
     one happens to sort first is a silent, wrong answer the user never
     gave, and the one they wanted is one tap away. The row reads
     "Choose" and confirmComplete() refuses until it is answered. */

  /* "Choose List" rather than "Choose": the eyebrow has no label beside
     it any more — it IS the value — so on its own a bare verb names
     nothing. Same argument the new-activity sheet's eyebrow makes. */
  renderActListValue(lists,'compListName','Choose List');

  row.onclick=()=>openListPicker({
    title:'Add to List',
    currentId:targetListId,
    onPick:picked=>{
      setTargetLists([picked]);
      if(!targetListIds.length) setTargetLists([lists[0].id]);
      renderActListValue(lists,'compListName','Choose List');
      updateCompSaveButton();
    },
  });
}

/* ==============================================================
   MEDIA IS REQUIRED TO MARK SOMETHING ACCOMPLISHED

   A completion with nothing attached to it is a date. The photo or
   the clip is the thing you come back for, and it is also what gives
   the activity a cover, a grid card and a map pin — so the one moment
   the user certainly has it is the one moment to ask.

   **Only on the way in.** `compNew` gates it, so an activity completed
   before this rule existed — or one whose media was all removed
   afterwards — can still be edited and saved. Enforcing it on the edit
   pass would strand those rows: their owner could not save a
   correction to the date or the notes without first finding a photo of
   something they did years ago.

   Called from renderThumbs() (js/media.js), which every change to
   upMedia ends in, so the hint and the qualifier cannot drift out of
   step with the tiles.
   ============================================================== */
function updateMediaRequirement(){
  renderCompMediaCard();
  updateCompSaveButton();
}

/* ==============================================================
   WHAT STILL BLOCKS THE SAVE

   The same machinery NEW_REQUIRED drives on the new-activity sheet,
   and for the same reason: a requirement discovered by pressing the
   button you thought would finish is a dead end, not a rule. It
   replaces the paragraph that used to sit under the media card —
   see the two non-negotiable rules at the top of CLAUDE.md.

   ⚠️ THE ORDER IS READING ORDER, not the order the old guards
   happened to check in: the button names the FIRST outstanding field,
   so an order that did not match the layout would send somebody down
   the sheet past two blank ones to a third.

   `el` is a getter because the table is built at parse time, before
   any of the sheet's markup has been touched. `when` is what makes
   one table serve three modes — media is asked for on the way in
   only, and a place only on a draft, exactly as confirmComplete()
   enforces. Anything with no `when` is asked for always.
   ============================================================== */
const COMP_REQUIRED=[
  {key:'list', label:'Pick a list',
   el:()=>$('compListBtn'),
   when:()=>compDraft,
   filled:()=>targetListIds.length>0},
  {key:'name', label:'Name it', focus:true,
   el:()=>$('compName'),
   filled:()=>!!($('compName')||{}).value?.trim()},
  {key:'date', label:'Set a date',
   el:()=>$('compDateRow'),
   filled:()=>!!($('compDate')||{}).value},
  {key:'where',label:'Add a place', focusId:'compLoc',
   el:()=>$('compPlaceRow'),
   when:()=>compDraft,
   filled:()=>!!($('compLoc')||{}).value?.trim()},
  /* An upload still in flight is a different answer from none — the
     user has already done the thing being asked for — so it counts as
     filled and confirmComplete() holds them with its own message. */
  {key:'media',label:'Add a photo or video',
   el:()=>$('compMediaSec'),
   when:()=>compNew,
   filled:()=>upMedia.length>0||_mediaPending},
];

function compRequired(){ return COMP_REQUIRED.filter(f=>!f.when||f.when()); }
function firstMissingComp(){ return compRequired().find(f=>!f.filled())||null; }

/* The rail marks what is required IN THIS MODE, so it is painted rather
   than written into the markup: a place is asked for on a draft and not
   on an edit, and a rail on a field nothing is waiting for is a lie.
   The plate carries the list AND the name, so it is railed if either
   is being asked for. */
function paintCompRails(){
  const on=new Set(compRequired().map(f=>f.key));
  const set=(id,yes)=>{const el=$(id); if(el) el.classList.toggle('ad-req',yes);};
  set('compDateRow', on.has('date'));
  set('compPlaceRow',on.has('where'));
  set('compMediaSec',on.has('media'));
  const plate=document.querySelector('#compPaneMain .ad-plate');
  if(plate) plate.classList.toggle('ad-req',on.has('name')||on.has('list'));
}

/* The dock button carries the answer, because it is the control the
   user is already reaching for. Never `disabled`: a disabled button
   cannot be pressed, and pressing it is how you ask WHICH field. */
function updateCompSaveButton(){
  const btn=$('compSaveBtn');
  if(!btn)return;
  const miss=firstMissingComp();
  btn.textContent=miss?miss.label:(compDraft?'Add':compNew?'Done':'Save');
  btn.classList.toggle('is-blocked',!!miss);
  paintCompRails();
}

/* ==============================================================
   THE MEDIA CARD AND ITS PAGE

   The card names the cover and counts the rest, exactly as the Links
   card on the activity sheet does. Empty, it has no page worth
   opening, so it opens the picker instead — one tap either way.
   ============================================================== */
function renderCompMediaCard(){
  const thumb=$('compMediaThumb'),sum=$('compMediaSummary'),chev=$('compMediaChev');
  if(!sum)return;
  const n=upMedia.length,cover=coverIndex();
  if(thumb) thumb.innerHTML=n&&upMedia[cover]?mediaTileHTML(upMedia[cover]):icon('camera');
  if(thumb) thumb.classList.toggle('has-media',!!n);
  sum.textContent=!n?'Add a photo or video'
    :n===1?'1 item':`Cover +${n-1} more`;
  if(chev) chev.innerHTML=icon(n?'chevron-right':'plus');
}

/* Nothing attached yet means the page would be an empty grid and an Add
   button, which is the picker with a step in front of it. */
function openCompMedia(){
  if(!upMedia.length&&!_mediaPending){ $('photoInput').click(); return; }
  compShowPane('media');
}

function compShowPane(which){
  const panes={main:'compPaneMain',media:'compPaneMedia'};
  Object.keys(panes).forEach(k=>{
    const el=$(panes[k]); if(el) el.classList.toggle('active',k===which);
  });
  /* One dock view per page, the same swap adShowPane() makes. The
     sheet has no bar at all now: a page's Back is the .ad-navbar in
     the page itself, so nothing can be ambiguous about which header
     Cancel and Save belong to — they are not in a header. */
  const docks={main:'compDockMain',media:'compDockMedia'};
  Object.keys(docks).forEach(k=>{
    const el=$(docks[k]); if(el) el.hidden=(k!==which);
  });
  /* And one header at a time, exactly as newSheetPane() does it: the
     title row on the main page, the media page's own .ad-navbar on the
     other. Two stacked headers is the confusion the bar swap this
     replaced was written to avoid, and it still applies. */
  const head=$('compSheetHead'),modal=document.querySelector('#compSheet .modal');
  if(head) head.hidden=which!=='main';
  if(modal) modal.classList.toggle('barless',which!=='main');
  const body=document.querySelector('#compSheet .sheet-body');
  if(body) body.scrollTop=0;
}

/* The same auto-grow the other two sheets' names use — .ad-title wraps,
   and a <textarea> left at one row would scroll a three-line name. Kept
   separate from growNameField() because that one also drives the
   new-activity sheet's required-field button. */
function growCompNameField(){
  const el=$('compName');
  if(!el)return;
  el.style.height='auto';
  el.style.height=el.scrollHeight+'px';
  /* This is the name field's `input` handler, so it is also where the
     dock button learns the name has been typed. */
  updateCompSaveButton();
}

/* ⚠️ THE X GOES BACK, IT DOES NOT DROP YOU ON THE PAGE BEHIND.

   Registering a return rather than calling openActDetail() here keeps
   one path out of this sheet: openCompFrom() may already have
   registered exactly this, in which case leave it alone or the sheet
   opens twice. A draft has no activity to go back to. */
function compCancel(){
  if(compId&&!compDraft&&!sheetHasReturn('compSheet'))
    onSheetClose('compSheet',()=>openActDetail(compId));
  closeModal('compSheet');
}

/* The whole row opens the picker: on desktop the native calendar glyph
   is the only part of a date input a click opens it from, and that
   glyph is hidden here because the row already leads with one. */
function openCompDatePicker(){
  const el=$('compDate'); if(!el)return;
  el.focus();
  if(el.showPicker){ try{ el.showPicker(); }catch(e){} }
}

/* The name the check button and the date pill call. Completing and
   correcting a date are the same sheet now. */
/* The check has been pressed, from a row or from the activity sheet.
   Both toggleComplete() and home.js's toggleCompleteFrom() funnel
   here, so this is the one place the touch can be acknowledged — and
   deliberately not openComp() itself, which openCompFrom() also
   reaches when *editing* something already finished. Light: this
   acknowledges the press, and hapticSuccess() announces the result
   once the sheet is actually saved. See js/haptics.js. */
function openCompletedDate(id,source){
  hapticTap();
  return openComp(id,source);
}

/* Opened *from* the activity sheet, which is the only place both the
   Edit button and the date pill live. Registering the return before
   opening means every way out of the edit sheet — Save, Cancel, the
   scrim, Escape, a swipe down — lands you back where you started rather
   than on the bare page behind it. */
/* The detail sheet is deliberately LEFT OPEN underneath: closing it
   first meant Save and Cancel both slid this sheet away over a bare
   page, with the detail sheet sliding back a beat later. #compSheet
   sits at a higher z-index so it covers it, and the return re-renders
   it in place. */
function openCompFrom(id){
  onSheetClose('compSheet',()=>openActDetail(id));
  return openComp(id);
}

/* ⚠️ SHAKE, NOT NUDGE, and that is the one place this departs from the
   new-activity sheet. There the button says what is missing before it
   is ever pressed, so the pointer is a +/-2px nudge about a sheet where
   nothing has gone wrong. Here the user asked to mark something
   accomplished and was refused — see shakeEl() vs nudgeEl() in
   utils.js. It scrolls first and shakes 160ms later, or on a short
   phone the movement happens off-screen and the button appears dead. */
function shakeMissingComp(miss){
  const el=miss.el();
  if(!el)return;
  el.scrollIntoView({block:'center',behavior:'smooth'});
  setTimeout(()=>{
    shakeEl(el);
    /* Only the typed fields take focus: opening the keyboard for a
       control whose answer is a picker would cover the picker. */
    if(miss.focus) el.focus();
    else if(miss.focusId) ($(miss.focusId)||{focus(){}}).focus();
  },160);
}

async function confirmComplete(){
  if(!compId&&!compDraft)return;
  /* ⚠️ ONE TABLE ANSWERS THIS, exactly as NEW_REQUIRED does on the
     other sheet: the button's label, the shake and the save all have to
     agree about what is outstanding and in what order. */
  const miss=firstMissingComp();
  if(miss){ shakeMissingComp(miss); return; }
  const name=$('compName').value.trim();
  /* An upload still running counts as filled above, so it lands here —
     the user has already done the thing being asked for and the only
     honest answer is to wait. */
  if(compNew&&!upMedia.length&&_mediaPending){
    showToast('Still adding that — one moment.'); return;
  }
  /* A draft is a brand-new activity, so it meets the location
     requirement like every other add. An edit of something already
     completed is exempt — see A LOCATION IS REQUIRED in location.js
     for why the edit pass is not the place to enforce a new rule. */
  if(compDraft&&!await requireLocation('compLoc',null,$('compSaveBtn'))) return;

  const fields={
    name,
    date_completed:$('compDate').value||todayISO(),
    location:$('compLoc').value.trim()||null,
    location_lat:parseFloat($('compLocLat').value)||null,
    location_lng:parseFloat($('compLocLng').value)||null,
    experience_notes:$('compNotes').value.trim()||null,
    photos:denormMedia(upMedia),
    ...homeFieldsFor('compLoc'),
  };

  /* A draft is an add, so it goes through the same gate every other add
     path does. Read off the sheet first, as saveActivity() does: the
     check can open a sheet on top of this one, and a value captured on
     the far side of that would come from a form the user has moved on
     from. */
  if(compDraft){
    dupeGuard({name,location:fields.location||''},()=>commitCompDraft(fields));
    return;
  }

  /* The Lists row can move the activity from here, which matters most
     for a completed one — the activity sheet hides "Edit details" once
     something is done, so this is the only way to refile it. Written
     only when the set actually changed, for the reason on
     compListsBefore. */
  const wasIn=compListsBefore.length?compListsBefore:[compList].filter(Boolean);
  const nowIn=targetListIds.length?targetListIds:wasIn;
  const cols=listFieldsFor(nowIn);
  const moved=cols&&(wasIn.length!==nowIn.length||wasIn.some((id,i)=>id!==nowIn[i]));
  if(moved) Object.assign(fields,cols);

  const btn=$('compSaveBtn');btn.disabled=true;
  const{error,offline}=await dbUpdate('Activities',fields,{id:compId});
  btn.disabled=false;
  if(error){
    console.error('confirmComplete:',error);
    showToast(error.message||'Couldn’t save.');
    return;
  }
  const wasNew=compNew,src=compSrc;
  const finishedId=compId;
  /* Whether closing this sheet already puts something back on screen.
     openCompFrom() registers a return to the activity sheet, so when
     the completion was started from there, dismissing lands back on it
     and the reveal below would be a second copy of the same sheet. */
  const returns=sheetHasReturn('compSheet');
  closeModal('compSheet');
  compId=null;
  /* Both ends: a list gained needs recounting and so does one it was
     taken out of. */
  new Set([...wasIn,...nowIn,curListId].filter(Boolean)).forEach(id=>updateCollectionStats(id));
  if(wasNew){ confetti(); hapticSuccess(); showToast(offline?'Accomplished — will sync later':'Accomplished'); }
  else showToast(offline?'Saved — will sync later':'Saved');
  refreshAfterChange(src);

  /* THE MOMENT SOMETHING IS ACCOMPLISHED, SHOW WHAT WAS ACCOMPLISHED.
     Completing used to close the sheet and leave you on the list you
     started from, so the record you had just written -- the photos, the
     date, how it went -- was somewhere you then had to go and find. It
     is the one thing you want to look at, for the same reason
     revealNewActivity() exists on the add path.

     Only on a NEW completion: editing a record you are already looking
     at should stay where it is. And only when nothing else is already
     coming back, or the two would stack. The delay is the sheet's
     dismissal animation, the same 240ms dupeOpenExisting() waits. */
  if(wasNew&&finishedId&&!returns){
    setTimeout(()=>openActDetail(finishedId),240);
  }
}

/* The insert half of confirmComplete(). The id is minted client-side by
   dbInsert/stampRow, so this queues and replays like any other write —
   a helicopter ride logged on the flight home syncs when you land. */
async function commitCompDraft(fields){
  const lists=targetListIds.length?targetListIds:(curListId?[curListId]:[]);
  const cols=listFieldsFor(lists);
  if(!cols){showToast('Create a list first');return;}

  const btn=$('compSaveBtn');btn.disabled=true;
  /* Nothing about a plan applies to something already done: there is no
     target left to reach, and priority is about what to do next — the
     app draws neither on a completed activity. They are written as the
     column defaults rather than left out so the row matches every other
     one in the table. */
  const row=Object.assign({target_date:null,priority:'medium',links:[]},fields,cols);
  const{error,offline,rows}=await dbInsert('Activities',row);
  btn.disabled=false;
  if(error){
    console.error('commitCompDraft:',error);
    showToast(error.message||'Couldn’t save.');
    return;
  }
  const src=compSrc;
  closeModal('compSheet');
  compDraft=false;compId=null;
  lists.forEach(id=>updateCollectionStats(id));
  confetti();
  hapticSuccess();
  showToast(offline?'Accomplished — will sync later':'Accomplished');
  const newId=rows&&rows[0]&&rows[0].id;
  if(!revealNewActivity(lists[0],newId)) refreshAfterChange(src);
}

/* Where an add lands. Saving used to close the sheet and leave you on
   whatever screen you typed the name into — usually Home, which does
   not show the row you just wrote, so the one thing you wanted to see
   was the one thing you had to go and find. So an add ends on the list
   it was filed in, with the activity's own sheet open on top of it.
   Returns false when it has nothing to open, so the caller can fall
   back to the ordinary redraw. */
function revealNewActivity(listId,id){
  if(!listId||!id) return false;
  nav('detail',listId);
  /* Not onSheetClose(): closeModal() has already fired this sheet's
     return. The delay is the sheet's dismissal animation. */
  setTimeout(()=>openActDetail(id),240);
  return true;
}

/* ==============================================================
   THE NEW ACTIVITY SHEET

   ⚠️ IT ONLY CREATES. There was an Edit mode on this same sheet, and a
   pencil on every pending activity that opened it. Both are gone: the
   name, the list, the target, the priority, the difficulty, the
   location and the reminder are all changed by tapping them on the
   activity's own detail sheet, so a second form holding the same seven
   values was a second place for them to disagree — and it covered the
   thing being edited while you edited it. openEditAct() and
   openEditActFrom() went with it, and with them every `editingActId`
   branch in this file.

   ⚠️ AND IT IS THE DETAIL SHEET'S SHAPE, DELIBERATELY. The same plate
   (list eyebrow, serif name, target block), the same chip row, the
   same tinted Where card, built from the same .ad-* classes in
   detail.css. What you are filling in is what you will be looking at a
   moment later — revealNewActivity() opens exactly that sheet on the
   far side of Add — so the two must not read as different screens, and
   the controls are learned once.

   The one difference that matters is invisible: every control here
   STAGES into a hidden input, because there is no row yet and Cancel
   has to mean "never mind". The detail sheet's editors write
   immediately, which is right there and wrong here — see EDITING A
   PENDING ACTIVITY IN PLACE in CLAUDE.md for where that line falls.

   Two fields it deliberately does NOT have:

     - Notes. "Why is this on your list?" is the wrong question at the
       moment of capture: the answer is the activity's name. What you
       thought about it afterwards has a place already — the log on the
       activity, and "How it went" on the completion sheet.
     - Links. A reference is something you find after the fact, which is
       exactly when a field at the moment of capture is empty. They are
       a page on the activity itself — see THE LINKS PAGE below.
   ============================================================== */
/* Which list the new activity will be filed in. Inside a collection
   that is that collection; opened from Home it is whatever the user
   picks in the plate's list eyebrow.

   Still an array holding at most one id, and deliberately so: an
   activity used to be able to sit in several lists at once, and the
   shape is what lets every caller that walked the set carry on
   unchanged now that the set is always one long. setTargetLists()
   is the only writer, and it is where the cap lives — so there is
   exactly one line to change if that decision is ever revisited. */
let targetListIds=[],targetListId=null;

function setTargetLists(ids){
  targetListIds=(ids||[]).filter(Boolean).slice(0,1);
  targetListId=targetListIds[0]||null;
  /* The only writer of the list, so the only place the Add button can
     learn that one has been picked. */
  updateNewSaveButton();
}

async function openNewActivity(prefillName){
  aLinks=[];
  setTargetLists(curListId?[curListId]:[]);
  await renderActListPicker();
  $('aName').value=prefillName||'';
  growNameField();
  $('aLoc').value='';$('aLocLat').value='';$('aLocLng').value='';
  delete $('aLoc').dataset.geoFor;   /* nothing here belongs to the last activity */
  locSetHome('aLoc',false);
  resetLocationGuess(true);
  /* Both blank, and both asked for — see NEW_REQUIRED. */
  setTargetChoice('','');
  setPriorityChoice('');
  /* Nothing has judged this name yet; maybeGuessLocation() fills it in
     behind the sheet if the backend answers. */
  setDifficultyChoice('',false);
  /* The notes log belongs to the activity, so the field here is only
     ever "write the first entry" — it never shows what is already
     there. See notes.js. */
  resetActivityNoteField();
  renderNewNoteCard();
  renderNewLinks();
  newSheetPane('main');
  /* A reminder sheet dismissed by the scrim never reaches Done, so a
     stale _remindFor could still be pointing at whatever activity was
     last open on the detail sheet — and this sheet's Remind chip opens
     the same #remindSheet. Without this, Done there would write a
     reminder onto that other activity. */
  if(typeof resetRemindFor==='function') resetRemindFor();
  setRemindField(null,'');
  /* The dock has to be honest before the sheet has finished sliding
     in — it opens on "Pick a list" or "Name it", never on "Add". */
  updateNewSaveButton();
  openModal('actSheet');
  /* A name that arrived from a composer was never typed into this
     field, so `change` will not fire for it — and that is the most
     common way an activity is created. Ask now instead. Deliberately
     not awaited: the sheet is usable while the answer is in flight,
     and the fill lands in an empty field if it lands at all. */
  if(prefillName) maybeGuessLocation();
  setTimeout(()=>{$('aName').focus();growNameField();},320);
}

/* ---- the name -----------------------------------------------------
   The same <textarea> the detail sheet renames into, for the same
   reason: .ad-title wraps, and an <input> would put a three-line name
   on one scrolling line. Height comes from scrollHeight, exactly as
   growTitleEdit() does — the two are not shared because that one also
   drives the commit-on-blur state machine, which has nothing to do
   with a field that only stages. */
function growNameField(){
  const el=$('aName');
  if(!el)return;
  el.style.height='auto';
  el.style.height=el.scrollHeight+'px';
  /* This is the name field's `input` handler, so it is also where the
     Add button learns the name has been typed. */
  updateNewSaveButton();
}
/* Enter dismisses rather than adding a newline: a name is one line
   semantically however many it is drawn on. */
function onNameFieldKey(e){
  if(e.key==='Enter'){ e.preventDefault(); e.target.blur(); }
}

/* ==============================================================
   THE NEW SHEET'S THREE PAGES

   Main, Links and Notes, swapped in place — the same thing the detail
   sheet does with .ad-pane, and for the same reason: neither a link nor
   a note is something most people have at the moment of capture, so
   neither may cost the sheet height it would spend empty. A card that
   reads "None" says there is nothing there; a field that vanishes when
   empty says nothing at all.

   ⚠️ EACH PAGE CARRIES ITS OWN .ad-navbar, exactly as the detail
   sheet's do — this sheet has no sheet bar either now that Cancel and
   Add ride the dock. So a page's Back is in the markup beside the page
   it backs out of, and there is no one button being Cancel and Back at
   the same time. Anything that adds a page here writes its own Back
   bar with it. Back rather than Cancel on a page is not a lost escape
   hatch: the dock's Cancel, the scrim, Escape and a swipe down all
   still dismiss the whole sheet from anywhere.
   ============================================================== */
const NEW_PANES={main:'aPaneMain',links:'aPaneLinks',notes:'aPaneNotes'};

function newSheetPane(which){
  Object.keys(NEW_PANES).forEach(k=>{
    const el=$(NEW_PANES[k]);
    if(el) el.classList.toggle('active',k===which);
  });
  /* One header at a time: the title row names the sheet on the main
     page, and a sub-page's own .ad-navbar replaces it rather than
     stacking under it. `barless` gives the body back the top room the
     bar was holding, so the grabber does not sit on the Back button. */
  const head=$('actSheetHead'),modal=document.querySelector('#actSheet .modal');
  if(head) head.hidden=which!=='main';
  if(modal) modal.classList.toggle('barless',which!=='main');
  const body=$('actSheetBody');
  if(body) body.scrollTop=0;
  if(which==='notes') setTimeout(()=>{const n=$('aNotes');if(n)n.focus();},60);
  if(which==='links') setTimeout(()=>{const n=$('aLinkNew');if(n)n.focus();},60);
}

/* ---- links, staged ------------------------------------------------
   `aLinks` is the array saveActivity() sends, so there is nothing to
   commit: these edit the value that is about to be written. The page
   is otherwise the activity sheet's own — same rows, same composer,
   same normalisation — with saveActLinks() left out of it. */
function openNewLinks(){ renderNewLinks(); newSheetPane('links'); }

function newLinkSummary(){
  if(!aLinks.length) return 'None';
  const first=aLinks[0].replace(/^https?:\/\//,'');
  return aLinks.length>1?`${first} +${aLinks.length-1} more`:first;
}

function renderNewLinks(){
  const sum=$('aLinkSummary');
  if(sum){ sum.textContent=newLinkSummary(); sum.classList.toggle('has',!!aLinks.length); }
  const box=$('aLinksList');
  if(!box)return;
  box.innerHTML=aLinks.length
    ? aLinks.map((l,i)=>`<div class="link-row">
        <a href="${esc(l)}" target="_blank" rel="noopener">
          ${icon('link','ic-sm')}<span>${esc(l.replace(/^https?:\/\//,''))}</span></a>
        <button class="link-del" onclick="removeNewLink(${i})"
          aria-label="Remove link">${icon('x','ic-xs')}</button>
      </div>`).join('')
    : `<div class="note-empty"><p>No links yet</p></div>`;
}

function onNewLinkKey(e){ if(e.key==='Enter'){e.preventDefault();addNewLink();} }

function addNewLink(){
  const f=$('aLinkNew');if(!f)return;
  let v=f.value.trim();
  if(!v)return;
  /* Same normalisation as addActLink(), so a link typed here and one
     typed on the activity are stored identically. */
  if(!/^https?:\/\//i.test(v)) v='https://'+v;
  if(!aLinks.includes(v)) aLinks.push(v);
  f.value='';
  renderNewLinks();
}

function removeNewLink(i){ aLinks.splice(i,1); renderNewLinks(); }

/* ---- the first note, staged ----------------------------------------
   One field, not a log: what is written here becomes the log's FIRST
   ENTRY, and the log itself is append-only and lives on an activity
   that does not exist yet. flushActivityNoteField() files it once it
   does — after the insert, never as part of it. */
function openNewNotes(){ newSheetPane('notes'); }

/* ⚠️ THE SAME BLOCK paintActivityNotes() DRAWS ON THE ACTIVITY SHEET,
   over one staged entry instead of a fetched log — same .ad-nsec, same
   head, same .note-card, same .note-empty. It was briefly a tinted
   .ad-place row with a disc, invented here rather than taken from
   there, which made the one thing on this sheet that also exists on
   that one look like a different feature.

   The attribution is honest rather than decorative: this note will be
   filed by the signed-in user, today, the moment the activity saves. */
function renderNewNoteCard(){
  const box=$('aNotesRow');
  if(!box)return;
  const t=(($('aNotes')||{}).value||'').trim();
  /* ⚠️ author_id MUST BE TRUTHY. noteWho() and noteAvatarHTML() read a
     falsy one as "the account that wrote this has been deleted" and
     render the entry greyed, over the name "Deleted account" — which on
     a note the user is in the middle of typing is exactly the quiet
     kind of wrong this app tries not to ship. The sheet cannot be open
     without a signed-in user, so the fallback is belt to that brace. */
  const n={author_id:(currentUser&&currentUser.id)||'self',
           author_name:(userProfile&&(userProfile.display_name||userProfile.username))||'You',
           body:t,created_at:new Date().toISOString()};
  box.innerHTML=`
    <div class="ad-nsec-h">
      <p class="h">Notes</p>
      <span class="ad-nsec-more">${t?'1 note':'Add'} ${icon('chevron-right','ic-xs')}</span>
    </div>
    ${t
      ? `<div class="note-card">
           <p class="m">${noteAvatarHTML(n,targetListId)}<span>${esc(noteWho(n))} &middot; ${esc(msgDayLabel(n.created_at))}</span></p>
           <p class="t">${esc(t)}</p></div>`
      : '<div class="note-empty"><p>No notes yet</p></div>'}`;
}

/* ==============================================================
   THE STAGED EDITORS

   One per control on the plate and the chip row, and each is the
   detail sheet's menu with the write taken out of it: the same action
   sheet, the same labels, the same tones — landing in a hidden input
   instead of in the database, because there is no row yet and Cancel
   has to mean "never mind".

   ⚠️ EACH VALUE HAS EXACTLY ONE WRITER, and every one of them repaints
   its own control. That is the same rule setPriorityChoice() has
   always carried: a caller that sets the input directly leaves the
   chip saying something else, and the two only disagree on screen.
   ============================================================== */

/* The list, as the plate's eyebrow. */
async function renderActListPicker(){
  const btn=$('actListBtn');
  if(!btn)return;
  const lists=await fetchCollections();
  /* Nowhere to file it. Save says so; a control offering no choices
     would not. */
  if(!lists.length){btn.style.display='none';return;}
  btn.style.display='';

  /* Anything the activity was in that this user can no longer see — a
     shared list they left — is dropped rather than shown as a blank
     row, and would otherwise be written straight back on Save. */
  const known=new Set(lists.map(l=>l.id));
  setTargetLists(targetListIds.filter(id=>known.has(id)));
  /* A new activity created from outside a collection deliberately does
     NOT fall back to the first list: filing it into whichever one sorts
     first is a silent, wrong answer the user never gave, and the one
     they wanted is one tap away. The eyebrow reads "Choose" and
     saveActivity() refuses until it is answered. */

  renderActListValue(lists,null,'Choose List');
  btn.onclick=()=>openListPicker({
    title:'Add to List',
    currentId:targetListId,
    onPick:picked=>{
      setTargetLists([picked]);
      renderActListValue(lists,null,'Choose List');
    },
  });
}

/* The chosen list's name, or the prompt when there isn't one yet.

   ⚠️ THE PROMPT DIFFERS BETWEEN THE TWO CALLERS, and that is why it is
   an argument. The new-activity sheet's eyebrow has no label beside it
   — it IS the value — so on its own "Choose" names nothing and reads
   as a stray verb above the title. The completion sheet's row has a
   "List" label to its left, where "Choose List" would say list twice.

   Shared with the completion sheet's draft mode, which passes its own
   element id: the two must not drift into two different words for the
   same state. */
function renderActListValue(lists,elId,empty){
  const el=$(elId||'actListName');
  if(!el)return;
  const home=lists.find(l=>l.id===targetListId);
  el.textContent=home?home.name:(empty||'Choose');
}

/* Target dates offered to new activities. Retired values ("Someday",
   "No date") live only in existing rows, and there is nothing here that
   can reach one now that this sheet cannot open an activity that
   already exists. */
const DEFAULT_TARGET_DATE='This Year';
const CUSTOM_DATE='__custom__';   /* sentinel; never stored */

/* ⚠️ THE ONLY WRITER OF #aDate / #aDateCustom. `band` is a band string
   or CUSTOM_DATE; `iso` is the date behind the sentinel. The chip is
   painted from dateInfo() over the value that will actually be STORED,
   so it reads exactly as the activity will read a moment after Add —
   which is the whole argument for this sheet looking like that one. */
function setTargetChoice(band,iso){
  /* ⚠️ '' IS A REAL VALUE and must not fall back to DEFAULT_TARGET_DATE.
     The sheet used to open on "This Year", which is a deadline nobody
     set sitting in a control that looked answered — and a target date
     is not a decoration: it is what Up Next ranks on and what every
     deadline badge in the app reads. Same argument as the priority
     default, same fix. The chip renders "—" for an unset one, which is
     what dateInfo()/countdownParts() already produce for no date. */
  $('aDate').value=band===''?'':(band||DEFAULT_TARGET_DATE);
  $('aDateCustom').value=iso||'';
  const el=$('aTargetValue'),btn=$('aTargetBtn');
  if(!el||!btn)return;
  const di=dateInfo({targetDate:readTargetDate(),completed:false});
  const cd=countdownParts(di);
  el.textContent=cd.open?cd.big:`${cd.big} ${cd.unit}`;
  /* Overdue and urgent only — the same two states the detail sheet
     tints, and no others, because any third would be a fourth colour
     scale on a row already carrying three. */
  btn.classList.toggle('is-due',di.cls==='overdue'||di.cls==='urgent');
  updateNewSaveButton();
}

/* The detail sheet's target menu with patchActivity() swapped for
   setTargetChoice(). TARGET_BANDS is shared, so the two pickers cannot
   offer different bands. */
function openNewTargetMenu(){
  const band=$('aDate').value,stored=$('aDateCustom').value;
  const specific=band===CUSTOM_DATE&&!!stored;
  const items=TARGET_BANDS.map(b=>({
    label:b.label,
    checked:band===b.value,
    onSelect:()=>setTargetChoice(b.value,''),
  }));
  items.push({
    label:specific?fmtDate(stored,true):'Specific date…',
    checked:specific,
    onSelect:()=>showCalendar({
      title:'Target Date',
      value:stored||'',
      onPick:iso=>setTargetChoice(CUSTOM_DATE,iso),
    }),
  });
  showActionSheet({title:'Target Date',items});
}

/* ⚠️ Resolved on the way IN, never on the way out — a band is a
   relative label and target_date is an absolute field. See
   MAKING A BAND HOLD STILL in utils.js — so nothing downstream has to
   know it was ever a band. */
function readTargetDate(){
  const v=$('aDate').value;
  if(v!==CUSTOM_DATE) return resolveTargetDate(v)||null;
  return $('aDateCustom').value||null;
}

/* ==============================================================
   PRIORITY AND DIFFICULTY, STAGED

   Both were a different shape here from the one they take on the
   detail sheet — priority a row of three swatched buttons, difficulty
   a hidden input with no control at all — and that was the whole of
   why the two sheets read as different screens. They are the same
   chips now, opening the same action sheets.

   The swatched .seg-pri control went with it. Its argument was that a
   native <select> cannot show what each level looks like and the
   colour is what you read priority by — which is true, and is answered
   better by the chip itself, which IS tinted by the value it holds.
   The menu shows all three in their own hues (`tone`), so nothing is
   lost at the moment of choosing either.
   ============================================================== */

/* ⚠️ THE ONLY WRITER OF #aPri. */
function setPriorityChoice(p){
  /* ⚠️ '' IS A REAL VALUE HERE and must not fall back to 'medium'.
     Priority is required now, so an unanswered one has to read as
     unanswered — defaulting it is exactly what made every hurried
     capture claim a priority nobody had chosen. */
  const v=PRIORITY_RANK[p]!==undefined?p:'';
  $('aPri').value=v;
  const chip=$('aPriChip'),val=$('aPriValue');
  if(!chip||!val)return;
  /* ⚠️ classList, NOT className. This used to rebuild the whole
     attribute, which now silently drops `ad-req` — the class carrying
     the red rail that says this field is outstanding. Touch only the
     three hue classes this function actually owns. */
  chip.classList.remove('c-high','c-medium','c-low','c-none');
  chip.classList.add(v?'c-'+v:'c-none');
  val.textContent=v?cap(v):'None';
  updateNewSaveButton();
}

function openNewPriorityMenu(){
  /* No `||'medium'`: with nothing chosen, nothing is ticked. */
  const cur=$('aPri').value;
  showActionSheet({
    title:'Priority',
    items:['high','medium','low'].map(p=>({
      label:cap(p),
      checked:cur===p,
      /* The scale the rails, capsules and map pins already draw. */
      tone:p,
      onSelect:()=>setPriorityChoice(p),
    })),
  });
}

/* ⚠️ THE ONLY WRITER OF #aDiff, and maybeGuessLocation() goes through
   it too — writing the input directly left the chip showing "Not
   rated" over a rating the model had already returned.

   `manual` records who decided, exactly as difficulty_manual does on an
   existing row: the guess passes false, the menu passes true. */
function setDifficultyChoice(tier,manual){
  const v=DIFF_ORDER[tier]!==undefined?tier:'';
  $('aDiff').value=v;
  $('aDiffManual').value=v&&manual?'1':'';
  const chip=$('aDiffChip'),val=$('aDiffValue');
  if(!chip||!val)return;
  chip.className=`ad-chip ad-chip-btn c-d-${v||'none'}`;
  val.textContent=DIFF_LABELS[v]||'None';
}

/* The rating is inferred and has to be arguable — see DISAGREEING WITH
   THE RATING above, which is the same argument one sheet earlier.
   Hidden entirely without the column: a control writing a field the
   table does not have would fail the whole insert. */
function openNewDifficultyMenu(){
  if(!difficultyReady()){
    showToast('Ratings aren’t set up on this project yet.');
    return;
  }
  const cur=$('aDiff').value||'';
  const tiers=Object.keys(DIFF_ORDER).sort((x,y)=>DIFF_ORDER[x]-DIFF_ORDER[y]);
  showActionSheet({
    title:'Difficulty',
    items:tiers.map(tier=>({
      label:DIFF_LABELS[tier],
      checked:cur===tier,
      /* Namespaced -- see openDifficultyMenu(). */
      tone:'d-'+tier,
      onSelect:()=>setDifficultyChoice(tier,true),
    })),
  });
}

/* The reminder chip only exists once the remind_at column does. */
function setRemindField(value,note){
  const chip=$('aRemindChip');
  if(!chip)return;
  if(!remindersReady()){chip.style.display='none';return;}
  chip.style.display='';
  $('aRemind').value=value||'';
  $('aRemindNote').value=note||'';
  updateRemindRow();
}

/* The Home flag, ready to merge into a write — or nothing at all
   without the column, since sending one the table does not have
   fails the whole insert. Same shape as listFieldsFor(), which lives
   in js/api.js beside the mapper that reads the column back. */
function homeFieldsFor(inputId){
  return homeFlagReady()?{location_is_home:locIsHome(inputId)}:{};
}

/* ⚠️ IT ONLY EVER INSERTS. There is no edit mode on this sheet any
   more — see the note on #actSheet in index.html — so there is no
   `editingActId` to branch on, no old row to read back before the
   write, and no "did the list change" comparison to make. */
/* ==============================================================
   WHAT THE NEW-ACTIVITY SHEET STILL NEEDS

   Four things block the save, and until this the sheet said so
   nowhere: you pressed Add and were shaken at. Three pieces answer it
   now and all three read this ONE table, in this order, so they cannot
   disagree about what is missing or which one to mention first:

     - the red rail beside each of them (.ad-req, in detail.css),
       which is static markup and says "these four";
     - the Add button, which NAMES the first one outstanding;
     - the nudge, which points at it when the button is pressed.

   ⚠️ THE ORDER IS READING ORDER, not the order the old code happened
   to check in — list, name, priority, place, top to bottom down the
   sheet. The button names the FIRST unanswered one, so an order that
   did not match the layout would send somebody down the sheet past
   two blank fields to a third.

   `el` is a getter rather than an element because the sheet's markup
   outlives any one opening but this table is built once, at parse
   time, when none of it exists yet. */
const NEW_REQUIRED=[
  {key:'list',  label:'Pick a list',
   el:()=>$('actListBtn'),
   filled:()=>targetListIds.length>0},
  {key:'name',  label:'Name it',
   el:()=>$('aName'),   focus:true,
   filled:()=>!!($('aName')||{}).value?.trim()},
  /* The target sits in the plate beside the name, so it is asked for
     between the two. Required and no longer defaulted — see
     setTargetChoice(). readTargetDate() collapses the band and the
     custom-date pair into the single value that gets stored, so it is
     also the right thing to test: a "Specific date" with no date behind
     it reads as unanswered here, which it is. */
  {key:'target',label:'Set a target date',
   el:()=>$('aTargetBtn'),
   filled:()=>!!readTargetDate()},
  /* Priority is required and no longer defaulted — see the note on
     #aPriChip in index.html. */
  {key:'pri',   label:'Set a priority',
   el:()=>$('aPriChip'),
   filled:()=>!!($('aPri')||{}).value},
  {key:'where', label:'Add a place',
   el:()=>$('aPlaceRow'), focusId:'aLoc',
   filled:()=>!!($('aLoc')||{}).value?.trim()},
];

function firstMissingRequired(){
  return NEW_REQUIRED.find(f=>!f.filled())||null;
}

/* The Add button carries the answer, because it is the control the
   user is already reaching for. Called from every writer of the four
   values — the list picker, the name field, the priority menu and the
   location field — rather than on a timer. */
function updateNewSaveButton(){
  const btn=$('actSaveBtn');
  if(!btn)return;
  const miss=firstMissingRequired();
  btn.textContent=miss?miss.label:'Add';
  btn.classList.toggle('is-blocked',!!miss);
}

/* ⚠️ NUDGE, NOT SHAKE. shakeEl() is +/-6px and means "refused"; this
   is +/-2px and means "that one, there". Nothing has gone wrong — the
   user pressed a button that already told them what was missing, and
   this only says where it is. See nudgeEl() in utils.js.

   It scrolls first and nudges after a beat, or the movement happens
   off-screen on a short phone and the button appears to do nothing. */
function nudgeMissingField(miss){
  const el=miss.el();
  if(!el)return;
  el.scrollIntoView({block:'center',behavior:'smooth'});
  setTimeout(()=>{
    nudgeEl(el);
    /* Only the two typed fields take focus. Opening the keyboard for a
       control whose answer is a menu would cover the menu. */
    if(miss.focus) el.focus();
    else if(miss.focusId) ($(miss.focusId)||{focus(){}}).focus();
  },160);
}

async function saveActivity(){
  /* ⚠️ ONE TABLE ANSWERS THIS, not four hand-rolled guards. The Add
     button's label, the nudge and the save all have to agree about
     what is outstanding and in what order, and they used to be three
     separate lists of ifs — which is how the button could read "Add"
     on a sheet that was about to refuse. See NEW_REQUIRED. */
  const miss=firstMissingRequired();
  if(miss){ nudgeMissingField(miss); return; }
  const name=$('aName').value.trim();
  /* "Specific date" with no date is not a choice. openNewTargetMenu()
     cannot produce one — the calendar answers before it writes — but a
     value the sheet cannot save must still not reach the insert. It is
     not in NEW_REQUIRED because it is not a field anybody left blank:
     it is an impossible state, not an unanswered one. */
  if($('aDate').value===CUSTOM_DATE&&!$('aDateCustom').value){
    shakeEl($('aTargetBtn'));return;
  }
  /* The place is non-empty by now — NEW_REQUIRED checked it — but this
     is also what turns the typed text into coordinates, so it still
     runs and the fields below are read AFTER it. See A LOCATION IS
     REQUIRED in js/location.js. */
  if(!await requireLocation('aLoc','aLocError',$('actSaveBtn'))) return;
  const fields={
    name,
    location:$('aLoc').value.trim()||null,
    location_lat:parseFloat($('aLocLat').value)||null,
    location_lng:parseFloat($('aLocLng').value)||null,
    target_date:readTargetDate(),
    priority:$('aPri').value,
    links:aLinks,
    /* Whether this location IS home, so changing the home address
       later moves it. See "THIS ACTIVITY IS AT HOME" in api.js. */
    ...homeFieldsFor('aLoc'),
  };
  /* Same rule as remind_at below: only send the column if the database
     has it. An empty value is sent as null rather than '', so a name
     the model declined to judge is stored as "not rated" and not as a
     fourth tier. */
  if(difficultyReady()) fields.difficulty=$('aDiff').value||null;
  /* Who chose the tier, when the column exists to remember it. The
     guess leaves this empty; the chip's menu sets it, and that is what
     puts the row at the head of its tier in difficultyExamples() —
     see THE CORRECTION HAS TO OUTRANK THE GUESS in js/location.js. */
  if(difficultyReady()&&difficultyManualReady())
    fields.difficulty_manual=!!($('aDiff').value&&$('aDiffManual').value);
  /* Only send the column if the database actually has it, or every
     insert fails for people who have not run the migration. */
  if(remindersReady()){
    fields.remind_at=$('aRemind').value||null;
    /* A note with no date has nothing to fire it, so drop it too. */
    fields.reminder_note=fields.remind_at?($('aRemindNote').value.trim()||null):null;
  }

  /* The fields are read off the sheet before the duplicate check, not
     after: the check can open a sheet on top of this one, and a value
     captured on the far side of that would be read from a form the
     user may have moved on from. */
  dupeGuard({name,location:fields.location||''},()=>commitSaveActivity(fields));
}

async function commitSaveActivity(fields){
  const btn=$('actSaveBtn');btn.disabled=true;
  try{
    const cols=listFieldsFor(targetListIds);
    if(!cols){showToast('Create a list first');return;}
    Object.assign(fields,cols);
    const r=await dbInsert('Activities',fields);
    if(r.error)throw r.error;
    /* The id was minted client-side by stampRow(), so the note can be
       filed against it immediately — even offline, where the activity
       itself is still sitting in the write queue. */
    const noteFor=r.rows&&r.rows[0]&&r.rows[0].id;
    targetListIds.forEach(id=>updateCollectionStats(id));
    /* After the activity, never as part of it: they are separate rows
       in separate tables, and a note that fails must not take the
       activity down with it. Not awaited — nothing on screen is
       waiting for it. */
    if(noteFor) flushActivityNoteField(noteFor);
    closeModal('actSheet');
    if(r.offline) showToast('Saved — will sync when you’re back online');
    /* An add lands on its list with the activity's own sheet open —
       see revealNewActivity(). */
    if(revealNewActivity(targetListIds[0],noteFor)) return;
    /* Whatever screen is actually showing owns the row that changed. */
    refreshAfterChange();
  }catch(err){
    console.error('saveActivity:',err);
    showToast(err.message||'Couldn’t save.');
  }finally{ btn.disabled=false; }
}

async function delActivity(id){
  const a=await fetchActivity(id);
  const{error}=await dbDelete('Activities',{id});
  if(error){
    console.error('delActivity:',error);
    showToast(error.message||'Couldn’t delete.');
    return;
  }
  await updateCollectionStats((a&&a.listId)||curListId);
  refreshAfterChange();
  showToast('Deleted');
}

/* ==============================================================
   ACTIVITY DETAIL SHEET
   ============================================================== */
/* Tiles the media grid will draw before it folds the rest behind a
   "+N" tile — two rows of three. */
const AD_GRID_MAX=6;

/* The completed sheet's photo stage: one container that fades between
   the media on its own. The interval stops itself once the stage has
   left the DOM, so nothing has to be torn down by hand. */
let adStageTimer=null;
function adStageIndex(){
  const st=document.querySelector('.ad-stage');if(!st)return 0;
  return [...st.querySelectorAll('.ad-slide')].findIndex(s=>s.classList.contains('on'))||0;
}
function startAdStage(){
  clearInterval(adStageTimer);adStageTimer=null;
  const st=document.querySelector('.ad-stage');if(!st)return;
  const sl=st.querySelectorAll('.ad-slide'),dots=st.querySelectorAll('.ad-dots i');
  if(sl.length<2)return;
  let n=0;
  adStageTimer=setInterval(()=>{
    if(!document.body.contains(st)){clearInterval(adStageTimer);adStageTimer=null;return;}
    sl[n].classList.remove('on');dots[n]&&dots[n].classList.remove('on');
    n=(n+1)%sl.length;
    sl[n].classList.add('on');dots[n]&&dots[n].classList.add('on');
  },3500);
}

/* The countdown block on a pending activity's plate. dateInfo() gives
   one string; the plate wants it split into a numeral and its unit, so
   "18 days left" reads as 18 over DAYS. Anything that is not a count —
   a specific date, "Someday", an open band — falls through as one
   `.open` label at the same size, because a smaller mono fallback made
   the two read as different kinds of thing. */
/* dateInfo()'s label, split into something short enough for the plate.
   "18 days left" -> {big:'18', unit:'days'}; anything that is not a
   count ("Dec 31", "Overdue", "Someday") comes back whole with
   open:true and is rendered as-is. */
function countdownParts(di){
  const m=/^(\d+\+?)\s+(\w+)/.exec(di.label||'');
  if(m) return{big:m[1],unit:m[2],open:false};
  return{big:di.label||'\u2014',unit:'target',open:true};
}

/* ==============================================================
   THE HEAD OF A PENDING ACTIVITY'S SHEET

   The plate, the chips and the Where row -- which is exactly the set of
   things the in-place editors change, and nothing else.

   ⚠️ IT IS SPLIT OUT SO AN EDIT DOES NOT REBUILD THE WHOLE SHEET.
   patchActivity() used to re-run openActDetail(), which awaits a notes
   fetch (a real round trip) before it paints and then replaces every
   node in the body -- so changing a priority blanked the media grid and
   the notes log for a moment and snapped them back. Repainting only
   this block leaves the photos and the log untouched in the DOM, and
   costs no network at all. */
function actDetailHeadHTML(a,lists,di,canMove){
  let h='';
  /* Everything this block draws is derived here rather than passed in,
     so the repaint path and the first paint cannot drift apart. */
  const cd=countdownParts(di);
  const pri=a.priority||'medium';
  const diff=diffLabel(a);
  /* ⚠️ THE TARGET SITS BESIDE THE TITLE. The placement is right; the
       FORMATTING is what kept looking wrong, and three attempts failed
       for three separate reasons:

         - a 34px numeral made "Dec 31" nearly as wide as the title and
           drove it onto four lines;
         - sizing the value to its length (32/21/15px) meant the block
           changed size between activities, which reads as sloppy;
         - a box around it wrapped the WIDER of its two lines, and
           "TARGET" is wider than "Dec 31" once mono tracking counts, so
           the value sat off-centre in a lopsided pill.

       All three go away with one decision: the value is ONE SHORT LINE
       AT ONE FIXED SIZE, label above it, the block right-aligned to the
       card's own padding. See .ad-target in detail.css. */
    const tgVal=cd.open?cd.big:`${cd.big} ${cd.unit}`;
    /* Only the two actionable states are tinted; any other band would be
       a fourth colour scale on a sheet already carrying three. */
    const tgDue=(di.cls==='overdue'||di.cls==='urgent')?' is-due':'';
    
    h+=`<div class="ad-plate">
      <div class="ad-plate-main">
        ${lists.length?(canMove
          ? `<button class="t-eyebrow ad-eyebrow-btn" onclick="openActivityListPicker('${esc(a.id)}')" aria-label="In ${esc(lists[0].name)}. Move to another list."><span>${esc(lists[0].name)}</span>${icon('chevron-right','ic-eyebrow')}</button>`
          : `<p class="t-eyebrow">${esc(lists[0].name)}</p>`):''}
        <button class="ad-title ad-title-btn" id="adTitleBtn" onclick="startTitleEdit('${esc(a.id)}')" aria-label="Rename ${esc(a.name)}">${esc(a.name)}</button>
        <textarea class="ad-title ad-title-edit" id="adTitleEdit" hidden rows="1" maxlength="100"
          aria-label="Name" autocapitalize="sentences" enterkeyhint="done" spellcheck="false"
          oninput="growTitleEdit()" onkeydown="onTitleEditKey(event)" onblur="commitTitleEdit()"></textarea>
      </div>
      <button class="ad-target${tgDue}" onclick="openTargetMenu('${esc(a.id)}')"
        aria-label="Target: ${esc(di.label||'none set')}. Change it.">
        <span class="ad-target-k">Target${icon('chevron-right')}</span>
        <b>${esc(tgVal)}</b>
      </button></div>`;
    h+=`<div class="ad-chips">
      <button class="ad-chip ad-chip-btn c-${pri}" onclick="openPriorityMenu('${esc(a.id)}')" aria-label="Priority: ${esc(cap(pri))}. Change it."><small>Priority</small><span class="ad-chip-v"><span class="ad-chip-t">${esc(cap(pri))}</span>${icon('chevron-right')}</span></button>
      <button class="ad-chip ad-chip-btn c-d-${esc(a.difficulty||'none')}" onclick="openDifficultyMenu('${esc(a.id)}')" aria-label="Difficulty: ${esc(diff||'none set')}. Change it."><small>Difficulty</small><span class="ad-chip-v"><span class="ad-chip-t">${esc(diff||'None')}</span>${icon('chevron-right')}</span></button>
      ${remindersReady()
        ? `<button class="ad-chip ad-chip-btn c-remind" onclick="openRemindFor('${esc(a.id)}')" aria-label="Reminder: ${a.remindAt?esc(fmtDate(a.remindAt,true)):'none set'}. Change it."><small>Remind</small><span class="ad-chip-v"><span class="ad-chip-t">${a.remindAt?esc(fmtDateNumeric(a.remindAt)):'None'}</span>${icon('chevron-right')}</span></button>`
        : `<span class="ad-chip c-remind"><small>Remind</small>${a.remindAt?esc(fmtDateNumeric(a.remindAt)):'None'}</span>`}
    </div>`;
    /* Drawn even with nothing in it, and that is the same argument the
       difficulty chip makes: an activity with no location never appears
       on the map, so the rows that need this control most are exactly
       the ones that used to hide it. It also had a chevron and no
       handler before now -- it has been advertising a tap it did not
       accept. */
    h+=`<div class="ad-place c-where${a.location?'':' is-empty'}" id="adPlaceRow" role="button" tabindex="0"
        onclick="startPlaceEdit('${esc(a.id)}')" onkeydown="onRowKey(event)"
        aria-label="${a.location?`Location: ${esc(a.location)}. Change it.`:'Add a location'}">
        <span class="ad-place-disc">${icon('pin')}</span>
        <span class="ad-place-body">
          <span class="ad-place-k">Where</span>
          <span class="ad-place-v" id="adPlaceStatic">${a.location?esc(a.location):'Add a place'}</span>
          <!-- ⚠️ .loc-wrap is required, not decorative: locFieldsFor()
               finds the coordinates by querying inside it, and
               .loc-results positions against it. -->
          <span class="loc-wrap ad-place-edit" id="adPlaceEdit" hidden>
            <input id="adLoc" type="text" maxlength="200" autocomplete="off"
              placeholder="Search for a place" enterkeyhint="done" aria-label="Location"
              value="${esc(a.location||'')}"
              oninput="locInvalidateIfChanged(this);locSearch(this,'adLocResults')"
              onkeydown="onPlaceEditKey(event)" onblur="commitPlaceEdit()" />
            <input type="hidden" id="adLocLat" value="${a.locationLat==null?'':esc(a.locationLat)}" />
            <input type="hidden" id="adLocLng" value="${a.locationLng==null?'':esc(a.locationLng)}" />
            <div class="loc-results" id="adLocResults"></div>
          </span>
        </span>
        <span class="ad-place-chev">${icon('chevron-right')}</span></div>`;
  return h;
}

async function openActDetail(id){
  const a=await fetchActivity(id);if(!a)return;
  /* Pending activities carry the notes log inline. It used to be
     fetched behind the open sheet, which meant the section appeared a
     beat after everything else and shoved the sheet's contents around
     as it landed. The fetch starts here instead, in parallel with the
     collections read, and is awaited before anything is painted — so
     the sheet opens once, complete. */
  /* Awaited, not read synchronously — see notesReadyAsync(). */
  const inlineNotes=!a.completed&&await notesReadyAsync();
  const notesP=inlineNotes?fetchNotes(a.id):null;
  const di=dateInfo(a);
  /* Only the lists this user can see. An activity shared into one of
     theirs is homed in someone else's, and naming a list they have no
     access to would be both meaningless and a small disclosure. */
  const lists=(await fetchCollections()).filter(c=>(a.listIds||[]).includes(c.id));
  const media=a.media||[];
  /* The lightbox walks the full media list, so a video opens in place
     rather than being skipped over. */
  const mediaArg=JSON.stringify(media).replace(/"/g,'&quot;');

  /* The name, then the badges, then the photos. The title leads because
     it is what the sheet is about; the state and the date read as the
     caption under it, and they still sit directly above the media rather
     than being separated from it by anything else.

     Both states carry the same pair of full-width badges — state and
     date when it is done, priority and deadline when it is not — and
     the name is centred over them on a completed activity, where the
     sheet is a record rather than a plan. */
  /* Pending activities split the sheet in two: Details and Notes.
     The notes log needs room to be worked in, and it was competing
     with the photos and the action buttons for the same screen. A
     completed activity has no notes tab at all — the record is the
     photos and "How it went". The bar sits above the title, and the
     Notes pane carries neither title nor badges. */

  let h='';
  /* The pending sheet is one scrolling pane plus a notes page that
     replaces it — no tab bar. The notes section on the details pane
     is a preview and is entirely a button; tapping it opens the page,
     which is where the composer lives. */
  /* Pending activities are a stack of pages inside one sheet: the
     details, the notes log, and the links. The wrapper therefore opens
     for every pending activity, not only when the notes migration is
     in place — links are a page regardless. */
  const panes=!a.completed;
  if(panes) h+=`<div class="ad-pane active" id="adPaneDetails">`;
  /* A completed activity's actions are docked at the foot of the sheet
     in one row, the same shape the pending sheet uses — so the record
     itself (title, photos and words) starts at the top. */
  /* No tab bar on a pending activity. The B-13 layout puts the notes
     log inline, directly under the reference cards — see "PENDING
     ACTIVITY SHEET" in detail.css. */
  if(a.completed){
    h+=`<div class="ad-head">
      <div class="ad-title centered">${esc(a.name)}</div>
      <div class="ad-badges">
        <button class="badge ad-datebtn" onclick="openCompFrom('${a.id}')">
          ${icon('calendar','ic-xs')}${esc(a.completedDate?fmtDate(a.completedDate,true):'Set date')}
        </button>
        ${a.location?`<span class="badge ad-locbadge">${icon('pin','ic-xs')}<span>${esc(a.location)}</span></span>`:''}
      </div></div>`;
  } else {
    /* Pending: the plate, then the plan as chips, then a card per
       reference field. See "PENDING ACTIVITY SHEET" in detail.css. */
    const target=a.targetDate
      ? (isCustomDate(a.targetDate)?fmtDate(a.targetDate,true):a.targetDate)
      : '';
    const canMove=lists.length>0&&(await fetchCollections()).length>1;
    h+=`<div id="adHead">`+actDetailHeadHTML(a,lists,di,canMove)+`</div>`;
    /* ONE Links card, whatever the count. A card per link turned an
       activity with four references into four near-identical blocks
       pushing everything else down the sheet — and none of them was
       editable. The card names the first link, counts the rest, and is
       a button onto the Links page, exactly as the notes preview is.
       Empty reads "None": a field that vanishes when empty leaves the
       sheet saying nothing about whether it was ever filled in. */
    adLinks=[...(a.links||[])];adLinksFor=a.id;
    h+=`<div class="ad-place c-link" id="adLinkCard" role="button" tabindex="0"
      onclick="openActLinks()">
      <span class="ad-place-disc">${icon('link')}</span>
      <div class="ad-place-body">
        <span class="ad-place-k">Links</span>
        <div class="ad-place-v" id="adLinkSummary">${esc(adLinkSummary())}</div>
      </div>
      <span class="ad-place-chev">${icon('chevron-right')}</span></div>`;
    /* The log, inline, below the reference cards. Rendered from notes
       already in hand — see the fetch at the top of this function. */
    if(inlineNotes) h+=`<div class="ad-nsec" id="adNotes" data-for="${esc(a.id)}"
      role="button" tabindex="0" onclick="openActNotes()"></div>`;
  }

  h+=`<div class="ad-head">`;

  /* MEDIA IS SHOWN ONLY WHILE THE ACTIVITY IS ACCOMPLISHED.

     Marking something not-done writes only `date_completed` — the
     media stays on the row untouched (see ONE-TAP COMPLETE above) and
     openComp() reads it straight back into `upMedia`, so completing it
     again brings every photo and video back exactly as it was. It is
     hidden here rather than deleted because the pending sheet is a
     plan: a record of having done the thing has no place on it. */
  if(a.completed&&media.length){
    /* One large stage that fades between the media on its own, and
       opens the lightbox when tapped. */
    h+=`<div class="ad-stage" onclick="openLB(${mediaArg},adStageIndex())">
      ${media.map((m,i)=>`<div class="ad-slide${i?'':' on'}">${mediaTileHTML(m)}</div>`).join('')}
      ${media.length>1?`<div class="ad-dots">${media.map((_,i)=>
        `<i class="${i?'':'on'}"></i>`).join('')}</div>`:''}
    </div>`;
  } else if(a.completed&&media.length===1){
    h+=`<div class="ad-hero-wrap" onclick="openLB(${mediaArg},0)">
      ${mediaTileHTML(media[0],'ad-hero')}</div>`;
  } else if(a.completed&&media.length>1){
    /* Past six the grid runs several rows deep and pushes the notes and
       the actions off the bottom of the sheet, so it is capped at two
       rows: five tiles and a "+N" tile. The extra tile opens the
       lightbox at the first item it is hiding, and the lightbox walks
       the whole list — so nothing is unreachable, it is only folded. */
    const over=media.length>AD_GRID_MAX;
    const shown=over?media.slice(0,AD_GRID_MAX-1):media;
    h+=`<div class="ad-photos">${shown.map((m,i)=>
      `<div class="ad-photo-cell" onclick="openLB(${mediaArg},${i})">${mediaTileHTML(m)}</div>`).join('')}
      ${over?`<button class="ad-photo-cell ad-photo-more"
        onclick="openLB(${mediaArg},${AD_GRID_MAX-1})"
        aria-label="Show all ${media.length} items">
        ${icon('plus','ic-sm')}<span>${media.length-(AD_GRID_MAX-1)}</span>
      </button>`:''}</div>`;
  }
  h+=`</div>`;

  /* What you wrote when you finished it reads with the photos, so it
     sits directly under them — above the location and the notes-from-
     before, which are reference rather than the story. */
  const mediaCount=(()=>{const ph=media.filter(m=>m.type!=='video').length,
    vd=media.length-ph,parts=[];
    if(ph)parts.push(ph+(ph===1?' photo':' photos'));
    if(vd)parts.push(vd+(vd===1?' video':' videos'));
    return parts.join(', ');})();
  if(a.completed&&a.completionNotes){
    h+=`<div class="ad-section ad-note-sec"><div class="ad-section-label ad-note-head">How it went${
      mediaCount?`<span class="ad-count">${mediaCount}</span>`:''}</div>
      <div class="ad-note prose">${esc(a.completionNotes)}</div></div>`;
  }
  /* The notes log. A placeholder now and filled in behind the sheet by
     renderActivityNotes(), because it is a round trip and nothing else
     on this sheet should wait for it — the photos and the buttons are
     what the sheet is about.

     It sits directly under the media rather than down with location
     and links: on a shared list this is the working state of the plan,
     which is the reason somebody opened the activity at all. Reference
     fields go below it. */

  /* Which lists it is in, but only once that is news. At one list the
     answer is the screen you came from, and a section restating it on
     every activity in the app would be noise on the overwhelming
     majority of them. At two or more it is the only place the app says
     so, and it is what makes the feature visible at all. */
  /* Location and links are the two tinted cards up on the plate for a
     pending activity, so only a completed one repeats them here. */
  if(a.completed&&a.links&&a.links.length){
    h+=`<div class="ad-section"><div class="ad-section-label">Links</div>
      <div class="group ad-links" style="margin:0">${a.links.map(l=>
        `<a class="ad-link" href="${esc(l)}" target="_blank" rel="noopener">
           ${icon('link','ic-sm')}<span>${esc(l.replace(/^https?:\/\//,''))}</span>
         </a>`).join('')}</div></div>`;
  }

  /* Every action lives in the dock at the foot of the sheet, or in the
     bar at the top of a completed one — nothing is left in the flow.
     There used to be a "remove from this list" button here, for an
     activity that was also in other lists; it went with multi-list. */

  /* The notes page and the links page. Same scroller, swapped in by
     openActNotes()/openActLinks(); each has its own back bar, and each
     composer rides the dock. */
  if(panes){
    h+=`</div>`;
    if(inlineNotes) h+=`<div class="ad-pane" id="adPaneNotes">
      <div class="ad-navbar">
        <button class="ad-back" onclick="adShowPane('details')">${icon('chevron-left','ic-sm')}Back</button>
        <span class="ad-navtitle">Notes</span>
      </div>
      <div class="ad-notes-pane" id="adNotesFull"></div>
    </div>`;
    h+=`<div class="ad-pane" id="adPaneLinks">
      <div class="ad-navbar">
        <button class="ad-back" onclick="adShowPane('details')">${icon('chevron-left','ic-sm')}Back</button>
        <span class="ad-navtitle">Links</span>
      </div>
      <div class="ad-links-pane" id="adLinksFull"></div>
    </div>`;
  }

  $('actDetailBody').innerHTML=h;

  /* The location field is rendered with its coordinates already in it,
     so the pair is in step before anybody types. Without the mark,
     dataset.geoFor is empty and a commit would re-geocode a value that
     was never touched -- a wasted round trip on every edit. The Home
     flag rides along for the same reason: an edit that never touches
     the location must not sever the link. */
  const adLoc=$('adLoc');
  if(adLoc){ locGeoMark(adLoc); locSetHome('adLoc',!!a.locationIsHome); }
  _titleEditFor=null; _placeEditFor=null;
  /* A reminder sheet dismissed by the scrim never reaches Done, and a
     stale id would send the next reminder to the previous activity. */
  if(typeof resetRemindFor==='function') resetRemindFor();

  /* The dock is a sibling of the scroller, not part of it, so it is
     pinned to the foot of the sheet and inset by the same gutters as
     everything above it. Both states get one: edit / not-done /
     delete when it is completed, and delete / mark-accomplished
     otherwise.

     ⚠️ THERE IS NO PENCIL ON A PENDING ACTIVITY, and there is no edit
     sheet behind it any more. Every field it used to hold — the name,
     the list, the target, the priority, the location, the reminder —
     is edited by tapping it on the plate and the chips above. A form
     restating the same six values was a second place for them to
     disagree, and it covered the thing being edited while you edited
     it. A COMPLETED activity keeps its pencil: that one opens the
     completion sheet, which is a different sheet holding the record
     (photos, "how it went") rather than the plan. */
  const dock=$('actDetailDock');
  dock.hidden=false;
  dock.innerHTML=a.completed?`
    <div class="ad-dock-view">
      <button class="ad-dock-disc red" aria-label="Delete"
        onclick="confirmDeleteActivity('${a.id}','${esc(a.name).replace(/'/g,'&#39;')}')">
        ${icon('trash')}</button>
      <button class="ad-dock-disc" aria-label="Mark as not done"
        onclick="closeModal('actDetailSheet');toggleComplete('${a.id}',true)">${icon('undo')}</button>
      <button class="btn btn-filled btn-block" onclick="openCompFrom('${a.id}')">
        ${icon('pencil')}Edit
      </button>
    </div>`:`
    <div class="ad-dock-view" id="adDockActions">
      <button class="ad-dock-disc red" aria-label="Delete"
        onclick="confirmDeleteActivity('${a.id}','${esc(a.name).replace(/'/g,'&#39;')}')">
        ${icon('trash')}</button>
      <button class="btn btn-green btn-block"
              onclick="closeModal('actDetailSheet');toggleComplete('${a.id}',false)">
        ${icon('check')}Mark accomplished
      </button>
    </div>
    ${panes?`<div class="ad-dock-view" id="adDockLink" hidden>
      <div class="note-add">
        <input id="adLinkInput" type="url" inputmode="url" autocomplete="off"
          autocapitalize="off" spellcheck="false" placeholder="Paste a URL"
          onkeydown="onLinkKey(event)" />
        <button class="note-add-go show" onclick="addActLink()"
          aria-label="Add link">${icon('plus','ic-sm')}</button>
      </div></div>`:''}
    ${inlineNotes?`<div class="ad-dock-view" id="adDockNote" hidden>
      <div class="note-add">
        <textarea id="adNoteInput" rows="1" maxlength="1000"
          placeholder="Add a note…" autocapitalize="sentences"
          oninput="onNoteInput()" onkeydown="onNoteKey(event)"></textarea>
        <button class="note-add-go" id="adNoteGo" onclick="submitActivityNote('${esc(a.id)}')"
          aria-label="Add note">${icon('plus','ic-sm')}</button>
      </div></div>`:''}`;

  /* Painted before the sheet is shown, so nothing moves once it is
     open. The avatars still land behind it — a face arriving a moment
     after the words changes no layout. */
  if(inlineNotes){
    /* The avatars are awaited HERE too, not repainted behind the open
       sheet. Painting twice re-wrote the section's innerHTML a beat
       after it was on screen, which is the flash this was supposed to
       have fixed. The map is cached per collection, so only the first
       activity opened in a list pays for it at all. */
    const cid=noteCollectionId(a.id);
    const [notes]=await Promise.all([notesP,cid?loadConversationAvatars(cid):null]);
    paintActivityNotes(a.id,notes,cid);
  }

  openModal('actDetailSheet');
  /* After openModal, not before: the sheet has to be on screen before
     the address bar claims it is. See ROUTE_SHEET in router.js — this
     replaces the current entry rather than pushing one, so Back still
     closes the sheet in a single press. */
  routeSheetSync(a.id);
  startAdStage();
}

/* The notes page replaces the details pane rather than sitting beside
   it: the log needs the whole sheet to be worked in, and the dock
   swaps the action bar for the composer so there is only ever one
   thing at the foot of the sheet. */
function openActNotes(){ adShowPane('notes'); }
function closeActNotes(){ adShowPane('details'); }
function openActLinks(){ renderActLinks(); adShowPane('links'); }

/* One switch for all three pages, so a page added later cannot forget
   to hide somebody else's dock. */
function adShowPane(which){
  const panes={details:'adPaneDetails',notes:'adPaneNotes',links:'adPaneLinks'};
  Object.keys(panes).forEach(k=>{
    const el=$(panes[k]); if(el) el.classList.toggle('active',k===which);
  });
  const docks={details:'adDockActions',notes:'adDockNote',links:'adDockLink'};
  Object.keys(docks).forEach(k=>{
    const el=$(docks[k]); if(el) el.hidden=(k!==which);
  });
  const body=$('actDetailBody');
  if(body) body.scrollTop=0;
}

/* ==============================================================
   THE LINKS PAGE

   Links used to be a chip field on the create/edit sheet, which meant
   they could only be added at the moment of capture — exactly when
   nobody has them — and a reference added later cost a full edit pass.
   They are a page on the activity itself now, written one at a time
   like notes, and the write is a single `links` column update rather
   than anything the edit sheet has to know about.
   ============================================================== */
let adLinks=[],adLinksFor=null;

/* What the card on the details page says. One link named, the rest
   counted — the same trade the Lists row makes. */
function adLinkSummary(){
  if(!adLinks.length) return 'None';
  const first=adLinks[0].replace(/^https?:\/\//,'');
  return adLinks.length>1?`${first} +${adLinks.length-1} more`:first;
}

function renderActLinks(){
  const box=$('adLinksFull');
  if(!box)return;
  box.innerHTML=adLinks.length
    ? adLinks.map((l,i)=>`<div class="link-row">
        <a href="${esc(l)}" target="_blank" rel="noopener">
          ${icon('link','ic-sm')}<span>${esc(l.replace(/^https?:\/\//,''))}</span></a>
        <button class="link-del" onclick="removeActLink(${i})"
          aria-label="Remove link">${icon('x','ic-xs')}</button>
      </div>`).join('')
    : `<div class="note-empty"><p>No links yet</p></div>`;
  const sum=$('adLinkSummary');
  if(sum) sum.textContent=adLinkSummary();
}

function onLinkKey(e){ if(e.key==='Enter'){e.preventDefault();addActLink();} }

function addActLink(){
  const f=$('adLinkInput');if(!f)return;
  let v=f.value.trim();
  if(!v)return;
  if(!/^https?:\/\//i.test(v)) v='https://'+v;
  if(!adLinks.includes(v)) adLinks.push(v);
  f.value='';
  renderActLinks();
  saveActLinks();
}

function removeActLink(i){
  adLinks.splice(i,1);
  renderActLinks();
  saveActLinks();
}

/* Written straight through — the page has no Save, the way the notes
   log has none. Not awaited by anything on screen; a failure puts the
   stored value back so the page cannot claim a link it does not have. */
async function saveActLinks(){
  if(!adLinksFor)return;
  const id=adLinksFor,next=[...adLinks];
  const r=await dbUpdate('Activities',{links:next},{id});
  if(r.error){
    showToast('Couldn’t save that link');
    const a=await fetchActivity(id);
    if(a&&adLinksFor===id){adLinks=[...(a.links||[])];renderActLinks();}
    return;
  }
  refreshAfterChange();
}



/* ==============================================================
   COLLECTION OVERFLOW MENU  (the ⋯ in the nav bar)
   Holds everything the old hero row spelled out as five buttons.
   ============================================================== */
async function openCollectionMenu(){
  const l=await fetchCollection(curListId);
  const mine=ownsCollection(l);

  const items=[
    {label:'List',  icon:'rows',        checked:curView==='list', onSelect:()=>setView('list')},
    {label:'Grid',  icon:'square-grid', checked:curView==='grid', onSelect:()=>setView('grid')},
    {label:'Map',   icon:'map',         checked:curView==='map',  onSelect:()=>setView('map')},
    {label:'Edit List',        icon:'pencil', onSelect:openEditList},
  ];

  /* The conversation is reachable from here as well as from the
     Messages tab, because those are the two places people look for it:
     the hub when they are catching up, the list when they are already
     looking at the thing being discussed. Only shown where there is
     actually a conversation — a list nobody else is in has nobody to
     talk to. See js/messages.js. */
  if(listHasConversation(curListId)){
    items.splice(3,0,{label:'Messages',icon:'message',
      onSelect:()=>openConversationForList(curListId)});
  }
  /* Sharing only appears once the backend supports it — the same rule
     the reminder row follows. See js/sharing.js. */
  if(sharingReady()){
    items.push({label:mine?'Share List':'Sharing',icon:'share',onSelect:openShareList});
  }
  /* A list you joined is not yours to delete. Leaving is the member's
     equivalent and destroys nothing, so it is not marked destructive
     in the same breath as Delete — it is reversible with the link. */
  items.push(mine
    ? {label:'Delete List',icon:'trash',role:'destructive',onSelect:confirmDeleteCollection}
    : {label:'Leave List', icon:'signout',role:'destructive',onSelect:confirmLeaveList});

  showActionSheet({items});
}

function setFilter(f){
  curFilter=f;
  /* Both the lit segment and the sort label live in the control row,
     which renderDetail() now builds once per collection — so the two
     things that change without it are updated in one place. */
  syncDetailControls();
  /* On the map, just re-filter the markers — a full re-render would
     zoom the map back out from under the user. */
  if(curView==='map'&&actMap){updateMapMarkers();return;}
  renderActivitiesList();
}
function setView(v){
  curView=v;
  if(v!=='map') destroyDetailMap();
  renderActivitiesList();
}

/* ==============================================================
   SORT ORDER  (the control beside the filter on a collection screen)
   ============================================================== */
function openSortMenu(){
  const active=normSortKey(curSort);
  showActionSheet({
    title:'Sort By',
    /* Distance is dropped rather than disabled when there is no Home to
       measure from. An order that cannot be applied is not a choice,
       and the sheet has no room to explain itself — see the no-help-text
       rule. Setting a Home in the You tab brings it back. */
    items:Object.entries(ACT_SORTS)
      .filter(([key])=>key!=='nearby'||distanceReady())
      .map(([key,s])=>({
        label:s.label,
        checked:active===key,
        onSelect:()=>setSort(key),
      })),
  });
}
function setSort(key){
  if(!ACT_SORTS[key]) return;
  curSort=key;
  /* The button carries the current order as its label, so it has to be
     redrawn — but only it. Rebuilding the whole control block would
     take the search field with it and drop focus mid-typing, which is
     the entire reason renderDetail() and renderActivitiesList() are
     separate in the first place. */
  syncDetailControls();
  /* Order means nothing to a map, so there is nothing to redraw there —
     and a re-render would zoom it back out from under the user, the
     same trap setFilter() sidesteps. */
  if(curView==='map') return;
  renderActivitiesList();
}
