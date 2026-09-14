/* ==============================================================
   EXPORT MY DATA

   The right of data portability, answered in the app rather than by
   email. legal/privacy.html used to promise "email us and we will send
   you your data in a machine-readable format", which is a commitment
   with a 30-day statutory clock behind it and no tooling underneath —
   so the exporter would have been written under deadline, by hand,
   with a regulator's letter already in the inbox. This is that tooling,
   written in advance and available to the person whose data it is.

   ⚠️ IT IS A READ, NOT A FEATURE WITH STATE. Nothing here caches, and
   nothing here goes through the app's two backing queries: an export
   wants the RAW rows, exactly as stored, and api.js deliberately hands
   back camelCase shapes with the media normalised and the Smart Lists
   spliced in. Reading through it would export a picture of the UI's
   model rather than a copy of the data, which is the opposite of the
   point — a portable copy has to be the thing itself.

   RLS is what scopes this. Every select below is unfiltered by user id
   on purpose, exactly as fetchActivitiesFor() is, because the policies
   decide what comes back and duplicating that decision in the client
   would give the two somewhere to disagree. The one consequence worth
   stating: a SHARED list you are a member of comes out in your export
   too, because you can genuinely read it. That is the honest answer
   and it is also why the file says who owns each collection.

   ---- GETTING THE FILE TO THE USER ----

   ⚠️ THREE WAYS, TRIED IN ORDER, AND THE LADDER IS NOT DECORATION.
   The first two are deliverFile() in utils.js — the share sheet, then
   a blob download — and its header explains why that order and not the
   other. The third is this file's own:

     3. The text on screen, selected, with Copy. Ugly, and it is a real
        floor rather than a gesture: it needs nothing from the platform
        at all, so there is no configuration in which the export is
        simply unavailable.

   It does not generalise, which is why it stayed here rather than
   going into the helper — a photo cannot be pasted out of a textarea,
   so saveMedia() in media.js has a different floor under the same two
   rungs.

   No new Capacitor plugin. @capacitor/share would make step 1 tidier
   and is a dependency to add, sync and register for something the web
   API already does inside WKWebView.
   ============================================================== */

/* Bumped if the SHAPE of the file changes, so somebody holding an old
   export can tell which layout they have. Not the app's version. */
const EXPORT_FORMAT=1;

let _exporting=false;

/* Every table that holds something belonging to one person, with the
   column list written out rather than `*`.

   ⚠️ `*` WAS WRONG HERE, not merely loose. It would export whatever
   columns happen to exist on the day — including ones added later for
   internal bookkeeping that nobody decided to hand out — and it would
   silently start including them with no change to this file. Naming
   the columns makes an export a deliberate list.

   `optional: true` marks a table that may genuinely not exist, because
   most of this app's schema is optional migrations. A missing one is
   skipped and noted in the file rather than failing the export. */
const EXPORT_TABLES=[
  {key:'profile',      table:'Users',
   cols:'id,created_at,display_name,username,avatar_url,home_location,home_lat,home_lng,difficulty_profile,date_of_birth,terms_accepted_at,terms_version,age_gate_at',
   optional:true},
  {key:'collections',  table:'Collections',
   cols:'id,created_at,name,description,cover_image,user_id,category_tag'},
  {key:'activities',   table:'Activities',
   cols:'id,created_at,collection_id,name,target_date,priority,date_completed,experience_notes,photos,links,location,location_lat,location_lng,location_is_home,difficulty,difficulty_manual,category_tag,remind_at',
   optional:true},
  {key:'messages',     table:'messages',
   cols:'id,collection_id,sender_id,sender_name,body,activity_ids,created_at,edited_at,deleted_at',
   optional:true},
  {key:'activity_notes',table:'activity_notes',
   cols:'id,activity_id,author_id,author_name,body,created_at',
   optional:true},
  {key:'memberships',  table:'collection_members',
   cols:'collection_id,user_id,role,display_name,created_at',
   optional:true},
  {key:'blocks',       table:'user_blocks',
   cols:'blocker_id,blocked_id,blocked_name,created_at',
   optional:true},
  {key:'conversation_reads',table:'conversation_reads',
   cols:'collection_id,user_id,last_read_at',
   optional:true},
];

async function buildExport(){
  const out={
    format:EXPORT_FORMAT,
    app:APP_NAME,
    exported_at:new Date().toISOString(),
    account:{id:currentUser.id,email:currentUser.email||null},
    /* Named so the file explains itself to somebody opening it a year
       later in a text editor, with no access to this repo. */
    about:{
      media:'Photos and video are stored as URLs in activities[].photos. '+
            'Download them before deleting your account — the links stop '+
            'working when the files are removed.',
      shared_lists:'A collection whose user_id is not your account id is '+
            'one somebody shared with you. It is included because you can '+
            'read it; it is not yours to keep if they remove you.',
    },
    data:{},
    skipped:{},
  };

  for(const t of EXPORT_TABLES){
    try{
      const{data,error}=await sb.from(t.table).select(t.cols);
      if(error)throw error;
      out.data[t.key]=data||[];
    }catch(e){
      if(!t.optional)throw e;
      /* A migration that was never run, or a column this project does
         not have. Recorded IN THE FILE rather than only in the console:
         somebody comparing two exports needs to be able to tell "you
         had no messages" from "messages were not exported". */
      out.skipped[t.key]=(e&&e.message)||String(e);
    }
  }
  return out;
}

function exportFilename(){
  return 'someday-well-die-export-'+todayISO()+'.json';
}

async function exportMyData(){
  if(!currentUser)return;
  if(_exporting)return;                /* Double-tap on a slow connection. */
  _exporting=true;
  const row=$('meExportRow');
  const label=row&&row.querySelector('.row-title');
  const was=label?label.textContent:'';
  if(label)label.textContent='Preparing…';

  try{
    const payload=await buildExport();
    const text=JSON.stringify(payload,null,2);
    const name=exportFilename();
    const delivered=await deliverExport(text,name);
    if(delivered==='copy') showExportFallback(text);
    else showToast(delivered==='share'?'Export ready.':'Export downloaded.');
  }catch(e){
    console.error('exportMyData:',e);
    showToast('Couldn’t build the export. Check your connection.');
  }finally{
    if(label)label.textContent=was;
    _exporting=false;
  }
}

/* Returns 'share' | 'download' | 'copy'. The first two rungs are
   deliverFile() in utils.js, which media.js also saves photos through —
   there is one description of how a file reaches this platform and one
   place to fix it. The third rung is this file's own, because the floor
   does not generalise: a photo cannot be pasted out of a textarea. */
async function deliverExport(text,name){
  const blob=new Blob([text],{type:'application/json'});
  const how=await deliverFile(blob,name,'Someday We’ll Die — your data');
  return how||'copy';
}

/* The floor. Needs nothing from the platform, which is the whole
   reason it exists. */
function showExportFallback(text){
  const ta=$('exportText');
  ta.value=text;
  openModal('exportSheet');
  /* Selected on open, so ⌘C / long-press-Copy works without the user
     having to figure out how to select 400KB of JSON by hand. */
  setTimeout(()=>{try{ta.focus();ta.select();}catch(e){}},60);
}

async function copyExportText(){
  const ta=$('exportText');
  try{
    /* ⚠️ READING navigator.clipboard THROWS on a non-secure origin
       rather than returning undefined, so the whole thing is inside the
       try — the same trap that gates crypto.randomUUID (see uuidv4() in
       utils.js) and that theme-lab.html's Copy CSS also has to work
       around. */
    await navigator.clipboard.writeText(ta.value);
    showToast('Copied.');
  }catch(e){
    ta.focus();ta.select();
    showToast('Press ⌘C or long-press to copy.');
  }
}
