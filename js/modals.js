/* ==============================================================
   MODALS — sheet open/close, the action sheet used for overflow
   menus and destructive confirms, the photo lightbox, and the
   toast.

   iOS confirms destructive actions with an action sheet rather
   than a dialog, so showConfirm() below builds one instead of
   the old fixed confirmation modal.
   ============================================================== */

function openModal(id){
  const el=$(id);
  /* A sheet keeps its scrollTop between openings, so once you have
     scrolled one down — to reach the buttons at the bottom of the
     activity sheet, say — every later opening starts there and whatever
     is at the top is silently missing. That is why the activity sheet
     looked like it had no title: it was scrolled past it, and the
     grabber is position:absolute so the sheet still looked like it was
     at the top. Reset before showing. */
  el.querySelectorAll('.sheet-body').forEach(b=>{b.scrollTop=0;});
  el.classList.add('open');
  setBodyScrollLock(true);
}
function closeModal(id){
  /* ⚠️ #promptSheet is a .modal-overlay, so the scrim click and the
     Escape handler both land here rather than in closePrompt() -- and
     its cancel path has to run whichever way it was dismissed, or a
     date chosen a moment ago is silently thrown away. Same argument as
     the sheet-return registry below: register the behaviour once, not
     on the Cancel button. */
  if(id==='promptSheet'){ closePrompt(); return; }
  $(id).classList.remove('open');
  releasePickerRoom(null);
  setBodyScrollLock(false);
  afterSheetClosed(id);
}

/* ==============================================================
   GOING BACK TO THE SHEET YOU CAME FROM

   A sheet opened from another sheet should return to it when it is
   done, however it was dismissed — Save, Cancel, the scrim, Escape, or
   a swipe down. Registering the return here rather than on the Save
   button is what makes all five paths behave the same; hanging it off
   Save alone meant Cancel dropped you on the bare page.

   Every dismissal therefore has to go through closeModal() or call
   afterSheetClosed() itself — see the swipe handler in gestures.js.
   Returns fire once and are then forgotten, so a sheet reopened by
   hand does not inherit the last one's.
   ============================================================== */
const _sheetReturns={};

function onSheetClose(id,fn){ _sheetReturns[id]=fn; }

/* Whether dismissing this sheet will put something else back on screen.
   Asked by a Save handler that wants to reveal something afterwards:
   with a return already registered, revealing would stack a second
   sheet on top of the one coming back. */
function sheetHasReturn(id){ return typeof _sheetReturns[id]==='function'; }

function afterSheetClosed(id){
  /* The activity sheet is the one overlay with a URL, so it is the one
     that has to give it back. This runs before the return below,
     because a sheet that reopens another sheet will write its own
     route on the way in. */
  if(id==='actDetailSheet') routeSheetClear();
  const fn=_sheetReturns[id];
  if(!fn)return;
  delete _sheetReturns[id];
  /* Immediately: the returning sheet has to be on screen while the one
     being dismissed slides away. A delay left the bare page showing for
     a quarter second, which read as everything disappearing. */
  fn();
}

/* Leaving the screen entirely cancels any pending return — a tab tap
   must not resurrect a sheet on the page it just left. */
function clearSheetReturns(){
  Object.keys(_sheetReturns).forEach(k=>delete _sheetReturns[k]);
}

/* Tapping the dimmed area behind a sheet dismisses it. */
document.querySelectorAll('.modal-overlay').forEach(o=>{
  o.addEventListener('click',e=>{
    if(e.target===o) closeModal(o.id);
  });
});

document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    if($('lightbox').classList.contains('open')){closeLightbox();return;}
    if($('actionSheet').classList.contains('open')){closeActionSheet();return;}
    document.querySelectorAll('.modal-overlay.open').forEach(m=>closeModal(m.id));
  }
  if($('lightbox').classList.contains('open')){
    if(e.key==='ArrowLeft') lbStep(-1);
    if(e.key==='ArrowRight') lbStep(1);
  }
});

/* ==============================================================
   ROOM FOR A DATE PICKER

   A native date picker opens as a panel anchored to its field, and the
   browser will happily run it off the bottom of the window. Every date
   field in this app lives in a bottom-anchored sheet, which is the
   worst case for it: the reminder sheet is short, so its field sits low
   and the calendar had nowhere to go.

   The picker's own placement is the browser's business and cannot be
   set from here. What can be controlled is how much room the field has
   underneath it — so when a date field is focused with less than a
   picker's height below it, the sheet is given that much extra
   scrollable space and scrolled by the same amount, lifting the field
   up the screen. The space is a ::after spacer rather than padding, so
   nothing has to know the sheet's real padding to undo it.

   It only fires when the room is genuinely missing, and is released as
   soon as the field is done with.

   ============================================================== */
const PICKER_ROOM=310;

function ensurePickerRoom(el){
  const body=el.closest('.sheet-body');
  if(!body)return;
  releasePickerRoom(body);
  /* Measure after the release, or a previous spacer skews the result. */
  requestAnimationFrame(()=>{
    const gap=window.innerHeight-el.getBoundingClientRect().bottom;
    if(gap>=PICKER_ROOM)return;
    /* Clamped, because the sheet may still be sliding in — it is
       tappable before it has settled, so a field focused mid-animation
       measures from wherever the sheet had got to and would otherwise
       ask for a spacer the size of the whole screen. */
    const need=Math.min(PICKER_ROOM,Math.ceil(PICKER_ROOM-gap));
    body.style.setProperty('--picker-room',need+'px');
    body.classList.add('has-picker-room');
    /* The sheet may grow to its max-height first, which moves the field
       up on its own; scroll by whatever is still missing. */
    requestAnimationFrame(()=>{
      const left=PICKER_ROOM-(window.innerHeight-el.getBoundingClientRect().bottom);
      if(left>0) body.scrollTop+=left;
    });
  });
}

function releasePickerRoom(body){
  const targets=body?[body]:[...document.querySelectorAll('.sheet-body.has-picker-room')];
  targets.forEach(b=>{
    b.classList.remove('has-picker-room');
    b.style.removeProperty('--picker-room');
  });
}

document.addEventListener('focusin',e=>{
  const el=e.target;
  if(el.tagName==='INPUT'&&el.type==='date') ensurePickerRoom(el);
},true);
document.addEventListener('focusout',e=>{
  const el=e.target;
  if(el.tagName==='INPUT'&&el.type==='date'){
    /* Let the picker's own dismissal settle before the sheet moves. */
    setTimeout(()=>{ if(document.activeElement!==el) releasePickerRoom(null); },120);
  }
},true);

/* ==============================================================
   ACTION SHEET

   showActionSheet({title, message, items:[{label, icon, role,
   checked, onSelect}], cancelLabel})

   role: 'destructive' tints it red; 'cancel' is added automatically.
   Handlers are held in a module-level array rather than inlined as
   strings, so items can close over real values.
   ============================================================== */
let _asHandlers=[];

function showActionSheet(opts){
  const el=$('actionSheet');
  const items=opts.items||[];
  _asHandlers=items.map(i=>i.onSelect);

  let head='';
  if(opts.title||opts.message){
    head=`<div class="as-heading">${opts.title?`<strong>${esc(opts.title)}</strong>`:''}${opts.message?esc(opts.message):''}</div>`;
  }
  /* An item marked `separated` is lifted out of the main card into one
     of its own, above Cancel. That is how iOS sets a destructive action
     apart, and it is the difference between "one more choice, in red"
     and "this one is not like the others". */
  const inMain=[],apart=[];
  const body=items.map((i,idx)=>{
    const cls=['as-item'];
    if(i.role==='destructive') cls.push('destructive');
    /* A checkable item reserves a leading checkmark slot so the labels
       stay aligned whether or not they are selected. */
    const check=i.checked!==undefined?`<span class="as-check">${icon('check','ic-sm')}</span>`:'';
    /* An optional hue for the label. Used where the value being chosen
       is part of a colour scale the rest of the app already draws --
       priority's rails and capsules, the three difficulty lists -- so
       the menu is not the one place that scale goes missing. Tones are
       defined in modals.css; an unknown one simply does nothing. */
    if(i.tone) cls.push('as-t-'+i.tone);
    const html=`<button class="${cls.join(' ')}"${i.checked!==undefined?` aria-checked="${!!i.checked}"`:''} onclick="_asPick(${idx})">${check}${i.icon?icon(i.icon,'ic-sm'):''}<span>${esc(i.label)}</span></button>`;
    (i.separated?apart:inMain).push(html);
    return html;
  });

  el.querySelector('.as-panel').innerHTML=
    `<div class="as-group">${head}${inMain.join('')}</div>`+
    (apart.length?`<div class="as-group">${apart.join('')}</div>`:'')+
    `<div class="as-group"><button class="as-item cancel" onclick="closeActionSheet()">${esc(opts.cancelLabel||'Cancel')}</button></div>`;

  el.classList.add('open');
  setBodyScrollLock(true);
}
function _asPick(idx){
  const fn=_asHandlers[idx];
  closeActionSheet();
  /* Let the dismissal animation start before the handler runs, so a
     handler that opens another sheet does not fight this one.

     (An `immediate` escape hatch lived here while the date rows opened
     input.showPicker(), which is gated on transient user activation and
     therefore cannot survive this timeout. showCalendar() is our own
     markup and has no such rule, so the hatch went with it. Anything
     that reaches for a user-activation-gated API from a menu row will
     need it back.) */
  if(fn) setTimeout(fn,180);
}
/* ==============================================================
   A ONE-FIELD PROMPT

   The iOS alert with a text field in it, which is the shape the system
   uses for exactly this: one short answer, asked in place, without
   sending anybody to a form. An action sheet cannot hold a field --
   that is the whole reason this exists beside it.

   CENTRED, not bottom-anchored, and that is the platform convention
   rather than a preference: a sheet is a place you go, an alert is a
   question you answer. Everything else -- the grouped card, the
   hairlines, the two-button footer -- is the action sheet's own styling
   reused, so the two read as one family.

   Deliberately one field and no more. Anything needing two is a sheet.
   ============================================================== */
let _promptOnSave=null;
let _promptOnCancel=null;

function showPrompt(opts){
  opts=opts||{};
  const el=$('promptSheet');
  _promptOnSave=opts.onSave||null;
  _promptOnCancel=opts.onCancel||null;
  el.querySelector('.pr-title').textContent=opts.title||'';
  const inp=$('promptInput');
  inp.value=opts.value||'';
  inp.placeholder=opts.placeholder||'';
  /* A hard stop rather than a warning: the field simply refuses the
     201st character, which is the honest version of a limit and costs
     no counter to explain. */
  inp.maxLength=opts.maxLength||200;
  growPromptInput();
  $('promptSave').textContent=opts.confirmLabel||'Save';
  /* "Skip" rather than "Cancel" wherever the answer is optional: it is
     the one word that says you may go on without filling this in, and
     it costs no help text to say it. */
  $('promptCancel').textContent=opts.cancelLabel||'Cancel';
  el.classList.add('open');
  setBodyScrollLock(true);
  /* After the entry animation, or iOS focuses a box that is still
     sliding in and scrolls the page to chase it. */
  setTimeout(()=>{ inp.focus(); const n=inp.value.length;
    try{ inp.setSelectionRange(n,n); }catch(e){} },220);
}

/* Grows to fit, up to a ceiling -- past that it scrolls, or a long note
   would push the buttons off a short screen. Reset to auto first, or it
   can only ever get taller. */
const PROMPT_MAX_H=132;
function growPromptInput(){
  const el=$('promptInput');
  if(!el) return;
  el.style.height='auto';
  el.style.height=Math.min(el.scrollHeight,PROMPT_MAX_H)+'px';
  el.style.overflowY=el.scrollHeight>PROMPT_MAX_H?'auto':'hidden';
}

function onPromptKey(e){
  if(e.key==='Enter'){ e.preventDefault(); savePrompt(); }
  else if(e.key==='Escape'){ e.preventDefault(); closePrompt(); }
}

function savePrompt(){
  const fn=_promptOnSave,v=$('promptInput').value.trim();
  _promptOnCancel=null;          /* saving is not cancelling */
  closePrompt();
  /* Same 180ms the action sheet uses: let this dismiss before a handler
     opens anything on top of it. */
  if(fn) setTimeout(()=>fn(v),180);
}

function closePrompt(){
  const cancel=_promptOnCancel;
  _promptOnSave=null;_promptOnCancel=null;
  $('promptSheet').classList.remove('open');
  setBodyScrollLock(false);
  /* Dismissing the note is "no note", not "undo whatever I just chose",
     so the caller gets a chance to keep the rest of the answer. */
  if(cancel) setTimeout(cancel,180);
}

/* ==============================================================
   THE CALENDAR

   The app's own, not the browser's. <input type="date"> hands you a
   different widget on every platform -- on desktop a dense grey grid
   that anchors to the field and runs off the bottom of the window, and
   it cannot be styled at all. This is one month, in the app's faces and
   colours, centred like the prompt beside it.

   A tap picks and closes. There is no Done: one tap per choice, nothing
   to confirm -- the same argument the list picker makes.

   ⚠️ LOCAL DATES ONLY. new Date(iso) parses a bare "2026-12-31" as UTC,
   so anywhere west of Greenwich it comes back as the 30th. Every date
   here is built from y/m/d parts and formatted with isoLocal().
   ============================================================== */
const CAL_DOW=['S','M','T','W','T','F','S'];
const CAL_MONTHS=['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
let _calOnPick=null,_calY=0,_calM=0,_calSel='';

function showCalendar(opts){
  opts=opts||{};
  _calOnPick=opts.onPick||null;
  _calSel=opts.value||'';
  const base=_calSel?calParse(_calSel):new Date();
  _calY=base.getFullYear();_calM=base.getMonth();
  $('calTitle').textContent=opts.title||'Pick a Date';
  renderCalendar();
  $('calSheet').classList.add('open');
  setBodyScrollLock(true);
}

function calParse(iso){
  const p=String(iso).split('-').map(Number);
  return new Date(p[0],(p[1]||1)-1,p[2]||1);
}

function calStep(n){
  _calM+=n;
  if(_calM<0){ _calM=11;_calY--; }
  else if(_calM>11){ _calM=0;_calY++; }
  renderCalendar();
}

function renderCalendar(){
  const first=new Date(_calY,_calM,1);
  const lead=first.getDay();
  const days=new Date(_calY,_calM+1,0).getDate();
  const today=isoLocal(new Date());

  let cells='';
  /* Trailing days of the previous month, then this month, then enough
     of the next to finish the last week. Six rows always, so the card
     does not change height as you page through the year. */
  const prevDays=new Date(_calY,_calM,0).getDate();
  for(let i=lead-1;i>=0;i--) cells+=calCell(_calY,_calM-1,prevDays-i,true,today);
  for(let d=1;d<=days;d++)   cells+=calCell(_calY,_calM,d,false,today);
  let n=1;
  while((lead+days+n-1)%7!==0||((lead+days+n-1)/7)<6) { cells+=calCell(_calY,_calM+1,n,true,today); n++; }

  $('calMonth').textContent=`${CAL_MONTHS[_calM]} ${_calY}`;
  $('calGrid').innerHTML=
    CAL_DOW.map(d=>`<span class="cal-dow">${d}</span>`).join('')+cells;
}

function calCell(y,m,d,muted,today){
  const dt=new Date(y,m,d);
  const iso=isoLocal(dt);
  const cls=['cal-day'];
  if(muted) cls.push('is-muted');
  if(iso===_calSel) cls.push('is-sel');
  else if(iso===today) cls.push('is-today');
  return `<button class="${cls.join(' ')}" onclick="calPick('${iso}')">${d}</button>`;
}

function calPick(iso){
  const fn=_calOnPick;
  closeCalendar();
  if(fn) setTimeout(()=>fn(iso),180);
}

function closeCalendar(){
  _calOnPick=null;
  $('calSheet').classList.remove('open');
  setBodyScrollLock(false);
}

function closeActionSheet(){
  $('actionSheet').classList.remove('open');
  _asHandlers=[];
  setBodyScrollLock(false);
}
$('actionSheet').addEventListener('click',e=>{
  if(e.target===$('actionSheet')) closeActionSheet();
});

/* Destructive confirmation, iOS-style: the red verb is the action
   sheet's first item, Cancel is the escape. */
function showConfirm({title,message,confirmLabel,onConfirm}){
  showActionSheet({
    title,message,
    items:[{label:confirmLabel||'Delete',role:'destructive',onSelect:onConfirm}],
  });
}

/* ==============================================================
   DELETE ENTRY POINTS
   ============================================================== */
function confirmDeleteCollection(){
  showConfirm({
    title:'Delete Collection',
    message:'This deletes the collection and all of its activities. This cannot be undone.',
    confirmLabel:'Delete Collection',
    onConfirm:()=>delList(curListId),
  });
}
function confirmDeleteActivity(id,name){
  showConfirm({
    title:'Delete Activity',
    message:name?`"${name}" will be permanently deleted.`:'This cannot be undone.',
    confirmLabel:'Delete',
    onConfirm:async()=>{closeModal('actDetailSheet');await delActivity(id);},
  });
}

/* ==============================================================
   LIST PICKER

   One sheet, used everywhere an activity needs to be assigned to a
   collection: the Home composer and the activity sheet's List row.

   Both used showActionSheet(), which stacks a 57px full-width button
   per list — readable at three lists, an unusable tower at twenty. This
   scrolls, shows a cover thumbnail per row so lists are recognisable at
   a glance, and only shows a search field once there are enough lists
   for scanning to be slower than typing.

   Tapping a row picks it and closes; `onPick` gets an id. It is
   single-select and there is nothing to confirm, so there is no Done
   button — a sheet that closes itself must not also offer one. There
   was briefly a multi-select mode here, for when an activity could
   belong to several lists at once; it went with that feature.
   ============================================================== */
let _lpLists=[],_lpOnPick=null,_lpCurrentId=null;

/* openListPicker({subtitle, currentId, title, onPick}) */
async function openListPicker(opts){
  opts=opts||{};
  _lpOnPick=opts.onPick||null;
  _lpCurrentId=opts.currentId||null;

  $('listPickerTitle').textContent=opts.title||'Add to List';
  const sub=$('listPickerSub');
  if(opts.subtitle){sub.textContent=opts.subtitle;sub.style.display='';}
  else sub.style.display='none';

  if(!cacheWarm()) $('listPickerRows').innerHTML='<div class="spinner"></div>';
  openModal('listPickerSheet');

  _lpLists=await fetchCollections();

  /* Search earns its place only when there is enough to search. */
  const needsSearch=_lpLists.length>7;
  $('listPickerSearchWrap').style.display=needsSearch?'':'none';
  $('listPickerSearch').value='';
  renderListPickerRows();
  if(needsSearch) setTimeout(()=>$('listPickerSearch').focus(),340);
}

function renderListPickerRows(){
  const box=$('listPickerRows');
  const el=$('listPickerSearch');
  const term=(el&&$('listPickerSearchWrap').style.display!=='none'?el.value:'').trim().toLowerCase();
  const rows=term?_lpLists.filter(l=>l.name.toLowerCase().includes(term)):_lpLists;

  if(!rows.length){
    box.innerHTML=`<div class="lp-empty">${term?'No lists match that.':'No lists yet.'}</div>`;
    return;
  }
  box.innerHTML=rows.map(l=>
    `<button class="lp-row${l.id===_lpCurrentId?' current':''}" onclick="listPickerPick('${l.id}')">
       <img class="lp-cover" src="${esc(coverFor(l))}" alt="" loading="lazy"/>
       <span class="lp-name">${esc(l.name)}</span>
       <span class="lp-check">${icon('check')}</span>
     </button>`).join('');
}

function listPickerPick(id){
  const fn=_lpOnPick;
  closeModal('listPickerSheet');
  if(fn) setTimeout(()=>fn(id),160);
}

/* "New List" just opens the list sheet. The Home composer deliberately
   does not clear its input until an activity is actually filed, so the
   typed name is still sitting there afterwards and one more return
   files it into the list that was just created. */
function listPickerCreateNew(){
  closeModal('listPickerSheet');
  setTimeout(()=>{ openNewList(); },160);
}

/* ==============================================================
   LIGHTBOX
   ============================================================== */
/* Entries are the normalised media shape from api.js —
   {type,url,poster} — so the same viewer handles photos and video. A
   bare string or array of strings is still accepted, since plenty of
   call sites only ever have photo URLs. */
let lbPhotos=[],lbIdx=0;
function openLB(items,startIdx){
  if(typeof items==='string') items=[items];
  lbPhotos=(items||[]).map(m=>typeof m==='string'?{type:'photo',url:m}:m);
  lbIdx=startIdx||0;
  lbShow();
  $('lightbox').classList.add('open');
  setBodyScrollLock(true);
}
function lbShow(){
  const m=lbPhotos[lbIdx]||{type:'photo',url:''};
  const img=$('lbImg'),vid=$('lbVideo');
  const isVideo=m.type==='video';
  /* Whatever is not showing is emptied, not just hidden: a <video> with
     a src keeps buffering, and an <img> holding a large photo keeps it
     decoded. */
  if(isVideo){
    img.style.display='none';img.src='';
    vid.style.display='';vid.src=m.url;
    if(m.poster) vid.poster=m.poster;
  } else {
    vid.pause();vid.removeAttribute('src');vid.load();
    vid.style.display='none';
    img.style.display='';img.src=m.url;
  }
  $('lbCounter').textContent=lbPhotos.length>1?`${lbIdx+1} of ${lbPhotos.length}`:'';
  $('lbPrev').style.display=lbPhotos.length>1?'flex':'none';
  $('lbNext').style.display=lbPhotos.length>1?'flex':'none';
}
function lbStep(dir){
  if(!lbPhotos.length)return;
  lbIdx=(lbIdx+dir+lbPhotos.length)%lbPhotos.length;
  lbShow();
}
function closeLightbox(){
  $('lightbox').classList.remove('open');
  /* Stop playback on the way out, or the audio keeps going over
     whatever screen is underneath. */
  const vid=$('lbVideo');
  if(vid){vid.pause();vid.removeAttribute('src');vid.load();}
  lbPhotos=[];lbIdx=0;
  setBodyScrollLock(false);
}

/* Swipe between photos — the gesture a phone user reaches for first. */
let lbTouchX=null,lbTouchY=null;
$('lightbox').addEventListener('touchstart',e=>{
  if(e.touches.length!==1){lbTouchX=null;return;}
  lbTouchX=e.touches[0].clientX;lbTouchY=e.touches[0].clientY;
},{passive:true});
$('lightbox').addEventListener('touchend',e=>{
  if(lbTouchX===null||!lbPhotos.length)return;
  const t=e.changedTouches[0];
  const dx=t.clientX-lbTouchX,dy=t.clientY-lbTouchY;
  lbTouchX=null;
  /* Dragging on the video is scrubbing its controls, not a gesture. */
  if(e.target&&e.target.closest&&e.target.closest('#lbVideo'))return;
  /* A mostly-vertical drag closes it — the other half of the gesture
     anyone expects from a full-screen viewer, and the reason the
     sideways one checks which axis won first. */
  if(Math.abs(dy)>70&&Math.abs(dy)>Math.abs(dx)){ closeLightbox(); return; }
  if(Math.abs(dx)<40||Math.abs(dx)<Math.abs(dy))return;
  if(lbPhotos.length>1) lbStep(dx<0?1:-1);
},{passive:true});

/* ==============================================================
   TOAST
   ============================================================== */
let toastTimer=null;
function showToast(msg,actionLabel,onAction){
  const el=$('toast');
  el.innerHTML=`<span>${esc(msg)}</span>`;
  if(actionLabel){
    const b=document.createElement('button');
    b.className='toast-btn';b.textContent=actionLabel;
    b.onclick=()=>{el.classList.remove('show');if(onAction)onAction();};
    el.appendChild(b);
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>el.classList.remove('show'),onAction?15000:2200);
}
