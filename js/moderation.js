/* ==============================================================
   MODERATION — reporting content, blocking people
   --------------------------------------------------------------
   The app's fourth optional migration, and the only one that is not
   really optional: supabase/moderation.sql exists because Apple's
   Guideline 1.2 requires an app carrying user-generated content to
   offer a way to report it and a way to block the person who wrote
   it. Shared lists and their conversations are that content.

   ---- Why this is a file and not four lines in messages.js ----

   Reporting is not a messages feature. A shared list's *name* is
   user-generated content that other people see, and so is an
   activity in it — the conversation is only the loudest surface.
   openReportSheet() therefore takes a {kind, id} rather than a
   message, and the three callers pass three different kinds.

   ---- Blocking is a display preference, not a permission ----

   A blocked person's messages stop being drawn for you. They are not
   removed from the list, they are not told, and nothing about their
   own view changes — see the header of moderation.sql for why each of
   those is deliberate. The filtering happens here, on the client,
   because the messages remain legitimately readable by a member of
   that list and a select policy that hid them would let the author
   discover the block by watching their own words vanish.

   ---- It degrades like everything else ----

   probeModeration() looks for user_blocks once at sign-in, exactly as
   probeMessages() looks for messages. Without the migration the
   report and block controls do not appear and nothing else changes.
   The console says so once.
   ============================================================== */

/* The fixed reasons a report can carry. Free text is the last one
   rather than the only one: a queue of unstructured paragraphs cannot
   be triaged, and the reporter is usually angry and typing on a
   phone. `id` is what lands in content_reports.reason. */
const REPORT_REASONS=[
  {id:'harassment', label:'Harassment or bullying'},
  {id:'hate',       label:'Hate speech or symbols'},
  {id:'sexual',     label:'Sexual or explicit content'},
  {id:'violence',   label:'Violence or threats'},
  {id:'spam',       label:'Spam or a scam'},
  {id:'other',      label:'Something else'},
];

/* How much of the reported content is snapshotted into the report.
   Enough to judge it by; not a full copy of an arbitrarily long
   message sitting in a table nobody prunes. */
const REPORT_SNAPSHOT_MAX=2000;
/* What the reporter may add. Long enough for the context a moderator
   actually needs ("this is the third one today"), short enough that
   the field is obviously not an essay box. */
const REPORT_DETAIL_MAX=1000;

/* ==============================================================
   IS THIS AVAILABLE AT ALL?
   ============================================================== */
let _modReady=null,_modProbe=null;

function resetModerationProbe(){ _modReady=null;_modProbe=null; }

function probeModeration(){
  if(_modReady!==null) return Promise.resolve(_modReady);
  if(_modProbe) return _modProbe;

  _modProbe=(async()=>{
    try{
      const{error}=await sb.from('user_blocks').select('blocked_id').limit(1);
      _modReady=!error;
      if(error) console.info('[moderation] no user_blocks table — reporting and '+
        'blocking are hidden. Run supabase/moderation.sql. This is required '+
        'for App Store review; see the header of that file.');
    }catch(e){ _modReady=false; }
    _modProbe=null;
    if(_modReady) loadMyBlocks();
    return _modReady;
  })();
  return _modProbe;
}
function moderationReady(){ return _modReady===true; }

/* ==============================================================
   THE BLOCK LIST
   --------------------------------------------------------------
   Held in memory for the session, like every other per-account cache
   in the app, and cleared by resetAccountState(). It is read on every
   message drawn, so it has to be a synchronous Set rather than a
   query — the same argument that keeps dupeGuard() against the cache.

   A cold list means nothing is filtered, which is the right failure:
   drawing a message you meant to hide is recoverable and visible,
   whereas blocking the whole conversation behind a pending request
   would look like the messages were lost.
   ============================================================== */
let _blocks=null;          /* Map: blocked_id -> {id, name, at} */
let _blocksLoading=null;

function resetModerationState(){
  _blocks=null;
  _blocksLoading=null;
  resetModerationProbe();
}

async function loadMyBlocks(force){
  if(!moderationReady()||!currentUser) return _blocks||new Map();
  if(_blocks&&!force) return _blocks;
  if(_blocksLoading&&!force) return _blocksLoading;

  _blocksLoading=(async()=>{
    const{data,error}=await sb.from('user_blocks')
      .select('blocked_id,blocked_name,created_at')
      .eq('blocker_id',currentUser.id);
    if(error){
      console.warn('loadMyBlocks:',error);
      /* Deliberately NOT cached as empty — a failed request must not
         pin "nothing is blocked" for the session. Same rule readRows()
         follows. */
      _blocksLoading=null;
      return _blocks||new Map();
    }
    _blocks=new Map((data||[]).map(r=>[r.blocked_id,
      {id:r.blocked_id,name:r.blocked_name||'',at:r.created_at}]));
    _blocksLoading=null;
    return _blocks;
  })();
  return _blocksLoading;
}

/* Synchronous, and answers false until the list has loaded. */
function isBlocked(uid){ return !!(uid&&_blocks&&_blocks.has(uid)); }
function blockedCount(){ return _blocks?_blocks.size:0; }

/* ==============================================================
   BLOCKING SOMEBODY
   ============================================================== */
function confirmBlockUser(uid,name){
  if(!uid||!moderationReady()) return;
  if(currentUser&&uid===currentUser.id){
    showToast('You can’t block yourself.');
    return;
  }
  const who=name||'this person';
  showConfirm({
    title:'Block '+who+'?',
    /* It says what blocking does AND what it does not do. The second
       half is the part people get wrong: they expect it to remove one
       of you from the list, and discovering otherwise later feels
       like the block silently failed. */
    message:'You won’t see their messages. They aren’t told, and they stay '+
            'in any lists you share — leave the list if you want out of it.',
    confirmLabel:'Block',
    onConfirm:()=>blockUser(uid,name),
  });
}

async function blockUser(uid,name){
  if(!uid||!currentUser) return false;
  const{error}=await sb.from('user_blocks').insert({
    blocker_id:currentUser.id,
    blocked_id:uid,
    blocked_name:(name||'').slice(0,120)||null,
  });
  /* 23505 is the unique violation — already blocked. Not an error
     from where the user is standing: they asked for a state and the
     state is the one they asked for. */
  if(error&&error.code!=='23505'){
    console.error('blockUser:',error);
    showToast(error.message||'Couldn’t block that person.');
    return false;
  }
  if(!_blocks) _blocks=new Map();
  _blocks.set(uid,{id:uid,name:name||'',at:new Date().toISOString()});

  /* The conversation on screen is holding their messages. Repainting
     is what makes the block look like it did something. */
  if(typeof paintConversation==='function') paintConversation();
  if(typeof invalidateConversations==='function') invalidateConversations();
  if(typeof renderMeSafety==='function') renderMeSafety();
  showToast(name?'Blocked '+name:'Blocked');
  return true;
}

async function unblockUser(uid){
  if(!uid||!currentUser) return;
  const{error}=await sb.from('user_blocks').delete()
    .eq('blocker_id',currentUser.id).eq('blocked_id',uid);
  if(error){
    console.error('unblockUser:',error);
    showToast(error.message||'Couldn’t unblock that person.');
    return;
  }
  if(_blocks) _blocks.delete(uid);
  renderBlockedList();
  /* The You tab is the screen behind this sheet, and its row carries
     the count. */
  if(typeof renderMeSafety==='function') renderMeSafety();
  if(typeof paintConversation==='function') paintConversation();
  showToast('Unblocked');
}

/* ==============================================================
   THE BLOCKED PEOPLE SHEET
   --------------------------------------------------------------
   Reachable from You → Safety. Apple asks that a block be
   reversible, which means the list has to be somewhere — and a person
   who blocked somebody in a temper needs to be able to find it
   without going back to the conversation they left.
   ============================================================== */
async function openBlockedList(){
  openModal('blockedSheet');
  $('blockedBody').innerHTML='<div class="spinner"></div>';
  await loadMyBlocks(true);
  renderBlockedList();
}

function renderBlockedList(){
  const el=$('blockedBody');
  if(!el) return;
  const rows=Array.from((_blocks||new Map()).values())
    .sort((a,b)=>String(b.at||'').localeCompare(String(a.at||'')));

  if(!rows.length){
    el.innerHTML=`<div class="empty">${icon('circle')}
      <div class="empty-title">Nobody blocked</div>
    </div>`;
    return;
  }
  el.innerHTML=`<div class="group">`+rows.map(r=>`
    <div class="row has-leading blocked-row">
      <span class="row-leading li-slate">${icon('circle','ic-sm')}</span>
      <span class="row-body"><span class="row-title">${esc(r.name||'Someone')}</span></span>
      <button class="btn btn-tinted btn-sm" onclick="unblockUser('${esc(r.id)}')">Unblock</button>
    </div>`).join('')+`</div>`;
}

/* ==============================================================
   REPORTING
   --------------------------------------------------------------
   One sheet for all three kinds of target. It stages nothing and
   writes on submit, like the completion sheet — but unlike that one
   there is no editing afterwards, so the submit is final and the
   sheet says so.
   ============================================================== */
let _report=null;   /* {kind, id, reportedId, collectionId, snapshot, label} */

/* kind: 'message' | 'collection' | 'activity'. */
function openReportSheet(opts){
  if(!moderationReady()){
    showToast('Reporting isn’t available yet.');
    return;
  }
  _report={
    kind:opts.kind,
    id:opts.id||null,
    reportedId:opts.reportedId||null,
    collectionId:opts.collectionId||null,
    snapshot:(opts.snapshot||'').slice(0,REPORT_SNAPSHOT_MAX),
    label:opts.label||'this content',
    /* Carried only so the block offer afterwards can name them. It is
       never written to the report — content_reports keys on the uid,
       and a display name is a snapshot that would go stale. */
    reportedName:opts.reportedName||'',
  };
  $('reportSubject').textContent=_report.label;
  $('reportDetail').value='';
  $('reportError').textContent='';
  /* Rebuilt on every open so a previous report's choice is never inherited —
     the reason is the one field that must be a deliberate answer. */
  $('reportReasons').innerHTML=REPORT_REASONS.map((r,i)=>`
    <button class="report-reason" data-reason="${esc(r.id)}"
            onclick="pickReportReason('${esc(r.id)}')">
      <span class="report-radio"></span><span>${esc(r.label)}</span>
    </button>`).join('');
  $('reportSubmit').disabled=true;
  _reportReason='';
  openModal('reportSheet');
}

let _reportReason='';
function pickReportReason(id){
  _reportReason=id;
  document.querySelectorAll('#reportReasons .report-reason').forEach(b=>{
    b.classList.toggle('picked',b.dataset.reason===id);
  });
  $('reportSubmit').disabled=false;
  $('reportError').textContent='';
}

async function submitReport(){
  if(!_report||!_reportReason||!currentUser) return;
  const btn=$('reportSubmit');
  btn.disabled=true;
  const label=btn.textContent;
  btn.textContent='…';

  const{error}=await sb.from('content_reports').insert({
    reporter_id:currentUser.id,
    reported_id:_report.reportedId,
    target_kind:_report.kind,
    target_id:_report.id,
    collection_id:_report.collectionId,
    reason:_reportReason,
    detail:($('reportDetail').value||'').trim().slice(0,REPORT_DETAIL_MAX)||null,
    snapshot:_report.snapshot||null,
  });

  btn.textContent=label;
  btn.disabled=false;

  if(error){
    console.error('submitReport:',error);
    $('reportError').textContent=error.message||'Couldn’t send that report.';
    return;
  }

  const reported=_report.reportedId;
  const name=_report.reportedName||'';
  closeModal('reportSheet');
  _report=null;

  /* Offering the block straight afterwards is the whole point of the
     sequence: somebody who has just reported a person almost always
     wants to stop seeing them, and making them go and find a separate
     control for it is the gap that reads as "reporting did nothing".
     A report is answered by a human, eventually; a block is answered
     immediately, which is what they came for. */
  setTimeout(()=>{
    if(reported&&reported!==currentUser.id&&!isBlocked(reported)){
      showActionSheet({
        title:'Report sent',
        message:'We review reports within 24 hours. Do you also want to block this person?',
        items:[{label:name?'Block '+name:'Block them',icon:'circle',role:'destructive',
          onSelect:()=>blockUser(reported,name)}],
        cancelLabel:'No thanks',
      });
    }else{
      showToast('Report sent — we review these within 24 hours.');
    }
  },240);
}

/* ==============================================================
   THE AGREEMENT
   --------------------------------------------------------------
   Written after the profile row exists, and deliberately not awaited
   by anything: a failure here must never be the reason somebody
   cannot finish creating an account. The record is a nicety for
   review; the acceptance itself happened in the UI.
   ============================================================== */
async function recordTermsAcceptance(){
  if(!currentUser) return;
  try{
    await sb.from('Users').update({terms_accepted_at:new Date().toISOString()})
      .eq('id',currentUser.id).is('terms_accepted_at',null);
  }catch(e){ /* The column may not exist yet. Silent by design. */ }
}
