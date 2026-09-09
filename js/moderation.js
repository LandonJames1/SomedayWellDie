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
/* ⚠️ TWO OF THESE ARE NOT PREFERENCES, THEY ARE OBLIGATIONS, and both
   were missing from the first version of this list.

   `csam` exists because 18 U.S.C. §2258A requires a provider to report
   apparent child sexual abuse material to NCMEC, and you cannot report
   what your own product gave nobody a way to tell you about. It leads
   the list rather than sitting among the others, and openReportSheet()
   marks it, because a report filed under "Something else" is one that
   waits its turn in a queue where this one must not.

   `copyright` exists because the app hosts user-uploaded photographs,
   and the DMCA §512 safe harbour — the thing standing between the
   operator and direct liability for every infringing upload — is
   conditional on there being a notice-and-takedown path. Without a way
   to send a notice there is nothing to be safe within.

   ⚠️ NEITHER IS FINISHED IN CODE ALONE. §2258A needs an ESP
   registration with NCMEC, and §512 needs a designated agent filed
   with the US Copyright Office. See legal/terms.html §12 and the
   header of supabase/moderation.sql. */
const REPORT_REASONS=[
  {id:'csam',       label:'Child sexual exploitation', urgent:true},
  {id:'harassment', label:'Harassment or bullying'},
  {id:'hate',       label:'Hate speech or symbols'},
  {id:'sexual',     label:'Sexual or explicit content'},
  {id:'violence',   label:'Violence or threats'},
  {id:'selfharm',   label:'Self-harm or suicide'},
  {id:'copyright',  label:'Copyright or trademark'},
  {id:'privacy',    label:'Shares my private information'},
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

/* ==============================================================
   WHAT GOES IN THE SNAPSHOT

   ⚠️ A REPORT WHOSE SNAPSHOT IS A NAME IS NOT ACTIONABLE. The column
   exists so a report survives its author deleting the evidence, which
   is the first thing somebody does when reported — and for a message
   the body is the whole of it, so the first version simply passed the
   text. That is wrong for everything else in the app: the content of a
   shared LIST is its activities, and the content most likely to be
   worth reporting is a PHOTO, which had no representation in the
   snapshot at all. A moderator opening such a report saw a list name
   and had to go and find the rows by hand, inside the 24 hours the
   terms commit to.

   So a collection's snapshot carries its name, its description, and a
   line per activity with the media URLs attached — the URLs rather than
   the images, because R2 objects are immutable and keyed randomly, so
   the link keeps resolving after the row is deleted and there is no
   need to copy megabytes into a Postgres column to preserve it.

   ⚠️ IT IS DRAWN FROM THE IN-MEMORY CACHE and never fetches. Reporting
   is a path somebody takes while upset, and the sheet must open now;
   a cold cache yields the name alone, which is exactly what it yielded
   before. REPORT_SNAPSHOT_MAX is what stops a large list writing an
   unbounded blob into a table nobody prunes.
   ============================================================== */
function reportSnapshotForList(l){
  if(!l)return '';
  const lines=['LIST: '+(l.name||'(untitled)')];
  if(l.description) lines.push('DESCRIPTION: '+l.description);
  try{
    const acts=cachedActivities().filter(a=>a.listId===l.id);
    lines.push('ACTIVITIES: '+acts.length);
    for(const a of acts){
      lines.push(reportSnapshotForActivity(a));
      /* Bounded as it is built rather than sliced at the end, so a very
         long list does not cost the work of formatting all of it. */
      if(lines.join('\n').length>REPORT_SNAPSHOT_MAX)break;
    }
  }catch(e){ /* Cold cache. The name alone is still a report. */ }
  return lines.join('\n').slice(0,REPORT_SNAPSHOT_MAX);
}

/* One activity, with everything a moderator has to look at to judge it
   — including the media, which is the point. */
function reportSnapshotForActivity(a){
  if(!a)return '';
  const bits=['- '+(a.name||'(untitled)')];
  if(a.location) bits.push('  at: '+a.location);
  /* ⚠️ completionNotes, NOT `notes`. mapActivity() has no `notes` field
     at all — the append-only log lives in its own table and is reached
     through fetchNotes(). Reading a.notes here silently produced
     undefined and dropped the one piece of free text an activity
     actually carries. */
  if(a.completionNotes) bits.push('  notes: '+a.completionNotes);
  /* normMedia() has already turned every entry into {type,url,poster},
     so this is always objects — never the bare strings the `photos`
     column stores. */
  const media=(a.media||[]).map(m=>(m&&m.url)||'').filter(Boolean);
  const remote=media.filter(u=>!u.startsWith('data:'));
  if(remote.length) bits.push('  media: '+remote.join(' '));
  /* A legacy inline photo is COUNTED, not pasted: a base64 data URL is
     hundreds of kilobytes and would fill the whole snapshot on its own,
     leaving no room for the rest of the report. */
  const inline=media.length-remote.length;
  if(inline) bits.push('  media: '+inline+' inline image(s), not linkable');
  return bits.join('\n');
}

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
  $('reportReasons').innerHTML=REPORT_REASONS.map(r=>`
    <button class="report-reason${r.urgent?' urgent':''}" data-reason="${esc(r.id)}"
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
/* ⚠️ THE VERSION IS THE HALF THAT MATTERS. A timestamp says somebody
   agreed and not what to; the one question a dispute actually turns on
   is what the document said that day, and until this there was nothing
   anywhere that could answer it. TERMS_VERSION lives in js/config.js
   and is bumped whenever legal/terms.html changes materially.

   Still `.is(...,null)` — only the FIRST acceptance is recorded, so
   this cannot quietly restamp an old account as having agreed to a
   document it has never seen. Re-consent to a new version is a
   deliberate act and would need a screen of its own; see the backlog. */
async function recordTermsAcceptance(){
  if(!currentUser) return;
  try{
    const{error}=await sb.from('Users')
      .update({terms_accepted_at:new Date().toISOString(),terms_version:TERMS_VERSION})
      .eq('id',currentUser.id).is('terms_accepted_at',null);
    /* No terms_version column yet — write the timestamp alone rather
       than losing the acceptance entirely. */
    if(error&&(error.code==='PGRST204'||error.code==='42703')){
      await sb.from('Users').update({terms_accepted_at:new Date().toISOString()})
        .eq('id',currentUser.id).is('terms_accepted_at',null);
    }
  }catch(e){ /* The column may not exist yet. Silent by design. */ }
}
