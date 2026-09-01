/* ==============================================================
   MEDIA — photos and video attached to a completed activity.

   Replaces the old js/photos.js, which could only do photos and only
   as base64.

   ---- Where the bytes live ----

   In Supabase Storage, in a bucket called `media`, one folder per user:

     media/<user id>/<random>.jpg
     media/<user id>/<random>.mp4

   The `Activities.photos` column keeps only URLs. That is the change
   video forced and the app badly needed anyway: photos used to be
   base64 data URLs *inside the row*, so every list render pulled every
   photo down again as part of the JSON, and a handful of them made the
   whole table slow. A phone video is 5–20MB before base64 inflates it
   by another third — there was never a version of that which worked.

   ---- Degrading when the bucket is missing ----

   The schema lives in someone else's Supabase project and there is no
   migration step here that can guarantee the bucket exists, so this
   probes for it once, exactly like api.js probes for `remind_at`:

     - bucket present  → photos and video both upload as files
     - bucket missing  → photos fall back to base64 (what the app did
                         before, so nothing regresses) and video is
                         refused with an explanation rather than
                         failing silently at save time

   To create it, run supabase/storage.sql once. supabase/README.md has
   the steps.

   ---- Shapes ----

   Everything here works on the normalised media entries api.js hands
   out: {type:'photo'|'video', url, poster}. denormMedia() puts them
   back in the column's shape on save.
   ============================================================== */

const MEDIA_BUCKET='media';

/* Video is capped because a phone shoots at a bitrate no one wants to
   wait on over cellular, and there is no transcoding step here. The cap
   is on the file as picked; nothing is re-encoded. */
const MAX_VIDEO_BYTES=100*1024*1024;   /* 100MB — Supabase's default limit */
/* TWO pairs, and the split is load-bearing.

   An uploaded photo is fetched once per device and then cached forever
   (the keys are immutable), and on R2 that fetch costs nothing -- so
   quality here costs storage only, which is cents. Be generous.

   The FALLBACK pair is for the two paths that keep the bytes inline in
   the row instead: no bucket, or offline. Those bytes ship again on
   every single fetch of the list, which is the whole reason the
   backfill in tools/media-backfill.py had to exist. So they stay small
   deliberately. Raising the upload pair without this split raises the
   inline pair with it and quietly rebuilds the problem. */
const MAX_PHOTO_DIM=2560;
const PHOTO_QUALITY=.92;
const FALLBACK_PHOTO_DIM=1280;
const FALLBACK_PHOTO_QUALITY=.72;

/* ==============================================================
   CAPABILITY PROBE
   ============================================================== */
let _storageReady=null;

async function probeStorage(){
  /* R2 needs no bucket probe: the Worker either answers or the upload
     falls back inline, which is the same answer this probe gives. */
  if(r2Ready()){_storageReady=true;return true;}
  try{
    /* list() on a bucket the caller can read succeeds even when empty,
       and 404s when the bucket does not exist. */
    const{error}=await sb.storage.from(MEDIA_BUCKET).list('',{limit:1});
    _storageReady=!error;
    if(error) console.info('[media] no "'+MEDIA_BUCKET+'" storage bucket — '+
      'photos will be stored inline and video is unavailable. '+
      'Run supabase/storage.sql to enable it.');
  }catch(e){ _storageReady=false; }
  return _storageReady;
}
function storageReady(){ return _storageReady===true; }

/* ==============================================================
   UPLOAD
   ============================================================== */

/* Storage keys are random rather than derived from the filename: two
   photos called IMG_0001.jpg from the same camera roll would otherwise
   collide, and the second would silently overwrite the first. */
function mediaKey(ext){
  /* Shares uuidv4() with the row ids — a storage key would tolerate any
     random string, but crypto.randomUUID() is undefined outside a
     secure context and there is no reason to keep a second, weaker
     fallback around for it. See js/utils.js. */
  return `${currentUser.id}/${uuidv4()}.${ext}`;
}

/* R2 is preferred over Supabase Storage for one reason: it does not
   charge for egress, and a photo in a shared list is fetched by
   everyone in it on every device. Falls back to Supabase Storage when
   the Worker is not configured, so an unconfigured checkout still
   works. See MEDIA_WORKER_URL in config.js. */
function r2Ready(){
  return !!(typeof MEDIA_WORKER_URL!=='undefined'&&MEDIA_WORKER_URL);
}

/* The Worker authorizes with the caller's own Supabase access token --
   it asks Supabase whose it is and builds the storage key from the
   answer, so the browser never chooses its own folder. */
async function uploadToR2(blob,contentType){
  const{data:{session}}=await sb.auth.getSession();
  const token=session&&session.access_token;
  if(!token)throw new Error('not signed in');
  const res=await fetch(MEDIA_WORKER_URL.replace(/\/$/,'')+'/upload',{
    method:'POST',
    headers:{'Authorization':'Bearer '+token,'Content-Type':contentType},
    body:blob,
  });
  if(!res.ok){
    let detail='';
    try{detail=(await res.json()).error||'';}catch(e){}
    throw new Error('upload failed ('+res.status+(detail?': '+detail:'')+')');
  }
  const{url}=await res.json();
  if(!url)throw new Error('upload returned no url');
  return url;
}

async function uploadToSupabase(blob,ext,contentType){
  const key=mediaKey(ext);
  const{error}=await sb.storage.from(MEDIA_BUCKET)
    .upload(key,blob,{contentType,cacheControl:'31536000',upsert:false});
  if(error)throw error;
  const{data}=sb.storage.from(MEDIA_BUCKET).getPublicUrl(key);
  return data.publicUrl;
}

async function uploadBlob(blob,ext,contentType){
  if(r2Ready())return uploadToR2(blob,contentType);
  return uploadToSupabase(blob,ext,contentType);
}

/* A cross-origin <a download> is ignored by browsers, so a link
   straight at the bucket opens the photo instead of saving it. The
   Worker re-serves the same object with Content-Disposition set. */
function mediaDownloadUrl(url,name){
  if(!r2Ready()||!url)return url;
  const base=(typeof MEDIA_PUBLIC_BASE!=='undefined'&&MEDIA_PUBLIC_BASE)||'';
  if(!base||url.indexOf(base)!==0)return url;   /* not ours; leave it alone */
  const key=url.slice(base.replace(/\/$/,'').length+1);
  return MEDIA_WORKER_URL.replace(/\/$/,'')+'/download?key='+
    encodeURIComponent(key)+(name?'&name='+encodeURIComponent(name):'');
}

/* A data URL back to a Blob, so the same compressed bytes can be either
   uploaded or kept inline depending on what is available. */
function dataURLToBlob(url){
  const [head,b64]=url.split(',');
  const mime=(head.match(/:(.*?);/)||[])[1]||'image/jpeg';
  const bin=atob(b64);
  const buf=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) buf[i]=bin.charCodeAt(i);
  return new Blob([buf],{type:mime});
}

/* ---- Photos ---- */
function compressFile(file,maxD,q){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onerror=()=>reject(new Error('Could not read that image.'));
    r.onload=ev=>compress(ev.target.result,maxD,q,resolve);
    r.readAsDataURL(file);
  });
}

async function uploadPhoto(file){
  /* Decide where this is going BEFORE compressing, so an inline
     fallback is never encoded at upload quality. */
  const inline=!storageReady()||!navigator.onLine;
  const dataUrl=await compressFile(file,
    inline?FALLBACK_PHOTO_DIM:MAX_PHOTO_DIM,
    inline?FALLBACK_PHOTO_QUALITY:PHOTO_QUALITY);
  /* Offline is the same answer as a missing bucket: keep the bytes
     inline. The activity row itself is queued by js/offline.js and
     syncs with the photo already embedded in it, so a completion
     written on a plane arrives whole rather than arriving with its
     photos missing. It costs table size, which is the trade the app
     made for years before the bucket existed. */
  if(!storageReady()||!navigator.onLine) return{type:'photo',url:dataUrl,poster:''};
  try{
    const url=await uploadBlob(dataURLToBlob(dataUrl),'jpg','image/jpeg');
    return{type:'photo',url,poster:''};
  }catch(e){
    /* The connection dropped mid-upload. Falling back beats losing the
       photo the user just picked. */
    console.warn('[media] upload failed, keeping photo inline:',e);
    /* These bytes are now going into the row after all, so re-encode
       them down rather than embedding a full-quality image. */
    try{
      const small=await compressFile(file,FALLBACK_PHOTO_DIM,FALLBACK_PHOTO_QUALITY);
      return{type:'photo',url:small,poster:''};
    }catch(e2){
      return{type:'photo',url:dataUrl,poster:''};
    }
  }
}

/* ---- Video ----
   A poster frame is grabbed before upload so thumbnails, grid cards and
   map pins have an image to show. Without one a video contributes
   nothing to `a.photos` and the activity looks like it has no media at
   all everywhere except the sheet that plays it. */
function videoPoster(file){
  return new Promise(resolve=>{
    const v=document.createElement('video');
    v.preload='auto';v.muted=true;v.playsInline=true;
    /* MUST BE IN THE DOCUMENT. Safari and the WKWebView the native
       shell runs in will not decode frames for a detached <video>, so
       drawImage() came back blank or threw and every video ended up
       with no poster at all -- which reads to the user as "videos do
       not work", because a posterless video contributes nothing to
       a.photos and the activity looks empty everywhere except the sheet
       that plays it. Off-screen rather than display:none, which some
       versions treat the same as detached. */
    v.setAttribute('muted','');
    v.setAttribute('playsinline','');
    v.style.cssText='position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
    document.body.appendChild(v);

    const url=URL.createObjectURL(file);
    let settled=false,tries=0;
    const done=result=>{
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      v.removeAttribute('src');
      try{ v.load(); }catch(e){}
      v.remove();
      if(!result) console.warn('[media] video poster: capture failed');
      resolve(result);
    };

    /* A frame that is not the very first one: video often opens on
       black, and a black poster is barely better than none. */
    const seekTo=()=>{
      const d=isFinite(v.duration)&&v.duration>0?v.duration:1;
      try{ v.currentTime=Math.min(.6,d/3); }catch(e){ grab(); }
    };

    const grab=()=>{
      /* HAVE_CURRENT_DATA. Seeking can report complete before the frame
         is actually decodable, and drawing then yields a blank canvas
         rather than an error -- the silent failure this whole function
         had. */
      if(v.readyState<2||!v.videoWidth){
        if(tries++<20){ setTimeout(grab,150); return; }
        done('');
        return;
      }
      try{
        const scale=Math.min(1,MAX_PHOTO_DIM/Math.max(v.videoWidth,v.videoHeight));
        const c=document.createElement('canvas');
        c.width=Math.round(v.videoWidth*scale);
        c.height=Math.round(v.videoHeight*scale);
        c.getContext('2d').drawImage(v,0,0,c.width,c.height);
        const data=c.toDataURL('image/jpeg',.75);
        /* A data URL this short is a blank canvas, not a frame. */
        done(data&&data.length>2048?data:'');
      }catch(e){ done(''); }
    };

    v.onloadedmetadata=seekTo;
    v.onloadeddata=()=>{ if(v.currentTime<.01) seekTo(); else grab(); };
    v.onseeked=grab;
    v.onerror=()=>done('');
    /* Some codecs never fire a usable event. Do not hang the upload on
       it -- but give a large clip from a phone longer than 4s, which
       was short enough to lose real videos on a slow device. */
    const timer=setTimeout(()=>done(''),12000);
    v.src=url;
    /* Kicks decoding on iOS, which will not decode from preload alone
       for a muted off-screen element. Rejection is expected and
       harmless -- the seek path still runs. */
    const p=v.play();
    if(p&&p.catch) p.catch(()=>{});
  });
}

async function uploadVideo(file){
  if(!storageReady())
    throw new Error('Video needs the media storage bucket — see supabase/README.md.');
  /* Video has no inline fallback: a phone clip is 5–20MB, and holding
     one in the write queue waiting for a connection is a different
     feature with its own storage budget. Refuse it clearly rather than
     failing at save time. */
  if(!navigator.onLine)
    throw new Error('Video needs a connection. Add it once you’re back online — photos work offline.');
  if(file.size>MAX_VIDEO_BYTES)
    throw new Error('That video is too large. Trim it to under 100MB.');

  const ext=(file.name.split('.').pop()||'mp4').toLowerCase().replace(/[^a-z0-9]/g,'')||'mp4';
  const url=await uploadBlob(file,ext,file.type||'video/mp4');

  let poster='';
  const posterData=await videoPoster(file);
  if(posterData){
    try{ poster=await uploadBlob(dataURLToBlob(posterData),'jpg','image/jpeg'); }
    catch(e){ console.warn('[media] poster upload failed:',e.message); }
  }
  return{type:'video',url,poster};
}

/* ==============================================================
   THE PICKER

   upMedia is the working list for whichever sheet is open. Entries are
   appended as each file finishes, so a slow upload never blocks the
   ones behind it, and each shows a placeholder tile while it runs.
   ============================================================== */
let _mediaPending=0;

async function handleMedia(e){
  const files=Array.from(e.target.files||[]);
  e.target.value='';
  if(!files.length)return;

  /* The first fix found across this batch, if the activity does not
     already have a location. Read here rather than inside uploadPhoto
     because it has to happen against the file *as picked* — that
     function's first act is to run it through a canvas, which strips
     every EXIF tag from the result. See js/exif.js. */
  let geo=null;

  for(const f of files){
    const isVideo=f.type.startsWith('video/');
    if(!isVideo&&!f.type.startsWith('image/'))continue;
    if(!isVideo&&!geo&&needsLocationSuggestion()){
      geo=await exifReadLocation(f);
      /* Silent for the user — a photo with no fix is the normal case,
         not an error — but this feature has too many ways to quietly do
         nothing (wrong format, stripped metadata, no fix, geocoder
         down) to be undebuggable. One line naming which one it was. */
      console.info('[media] photo location:',geo
        ? `${geo.lat.toFixed(4)},${geo.lng.toFixed(4)} from ${f.name}`
        : `none in ${f.name} (${f.type||'unknown type'})`+
          (/^image\/jpe?g$/i.test(f.type||'')?' — no GPS tags in the file'
                                             :' — only JPEG carries readable EXIF here'));
      /* Started the moment the fix is read, NOT after the uploads — the
         reverse lookup is a ~1KB GET and the uploads are megabytes, so
         serialising them behind a video meant the chip appeared seconds
         after the photo it came from. It runs alongside them instead and
         renders whenever it resolves; suggestLocationFromPhoto() re-checks
         needsLocationSuggestion() on the far side of the round trip, so a
         user who typed a place in the meantime still wins. */
      if(geo) suggestLocationFromPhoto(geo);
    }
    _mediaPending++;
    renderThumbs();
    try{
      const entry=isVideo?await uploadVideo(f):await uploadPhoto(f);
      upMedia.push(entry);
    }catch(err){
      console.error('handleMedia:',err);
      showToast(err.message||'Couldn’t add that file.');
    }finally{
      _mediaPending--;
      renderThumbs();
    }
  }

}

function rmMedia(i){ upMedia.splice(i,1); renderThumbs(); }

/* ==============================================================
   WHERE THE PHOTO WAS TAKEN

   An activity with no location never appears on the map, and the
   completion sheet is exactly where that gets missed — you have just
   done the thing, you are attaching the photos of it, and the one
   field that would put it on the map is the one you skip. The photos
   already carry the answer.

   Two rules:

   1. **Only when the field is empty.** A location the user typed, or
      one that came in with an imported link, is never second-guessed
      by a photo's metadata.
   2. **It suggests, it does not fill.** EXIF can be wrong — a photo of
      the poster advertising the thing, a screenshot someone sent you,
      a camera whose clock and fix were both stale. Writing a place
      into the record of something you did, silently, on that evidence
      is worse than not offering it. So it is a chip you tap, which is
      the same rule the import sheet follows for the same reason.

   The dismissal is deliberately sticky for the life of the sheet: an
   offer that has been declined must not come back when the next photo
   is added.
   ============================================================== */
let _photoLocDismissed=false;

/* Called before reading a file, so a photo is not parsed at all when
   its answer could not be used. */
function needsLocationSuggestion(){
  if(_photoLocDismissed) return false;
  const el=$('compLoc');
  /* Not the sheet this runs on — nothing to suggest into. */
  if(!el||!$('compSheet').classList.contains('open')) return false;
  return !el.value.trim();
}

/* Reset by openComp() so a dismissal does not leak into the next
   activity completed in the same session. */
function resetLocationSuggestion(){
  _photoLocDismissed=false;
  _photoLoc=null;
  const box=$('compLocSuggest');
  if(box){ box.hidden=true; box.innerHTML=''; }
}

let _photoLoc=null;

async function suggestLocationFromPhoto(geo){
  /* Re-checked rather than trusted from before the upload: the user
     may have typed a place, or closed the sheet entirely, in the time
     the photos took to go up. */
  if(!needsLocationSuggestion()) return;

  const place=await reverseGeocode(geo.lat,geo.lng);
  if(!place){
    console.info('[media] the photo had a location but the geocoder could not name it');
    return;
  }
  if(!needsLocationSuggestion()) return;

  _photoLoc=place;
  const box=$('compLocSuggest');
  if(!box) return;
  box.innerHTML=`
    <button class="loc-suggest-main" onclick="acceptPhotoLocation()">
      ${icon('pin')}
      <span class="loc-suggest-body">
        <span class="loc-suggest-cap">From your photo</span>
        <span class="loc-suggest-name">${esc(place.display)}</span>
      </span>
    </button>
    <button class="loc-suggest-x" onclick="dismissPhotoLocation()"
            aria-label="Dismiss">${icon('x','ic-xs')}</button>`;
  box.hidden=false;
}

function acceptPhotoLocation(){
  if(!_photoLoc) return;
  $('compLoc').value=_photoLoc.display;
  $('compLocLat').value=_photoLoc.lat;
  $('compLocLng').value=_photoLoc.lng;
  /* These coordinates belong to this exact text, so say so — otherwise
     the save-time resolve treats the field as unresolved and geocodes
     a place the photo already told us. */
  locGeoMark($('compLoc'));
  /* Accepted counts as settled: the field is no longer empty, so
     nothing would offer again anyway, but this keeps the chip from
     lingering next to a field it has already filled. */
  dismissPhotoLocation();
}

function dismissPhotoLocation(){
  _photoLocDismissed=true;
  _photoLoc=null;
  const box=$('compLocSuggest');
  if(box){ box.hidden=true; box.innerHTML=''; }
}

/* ==============================================================
   ORDER, AND THEREFORE THE COVER — BY DRAGGING

   The first piece of media is the cover: it is what the activity's row
   thumbnail, its grid card and its map pin all show. So "choose the
   cover" and "reorder" are the same operation — drag a photo to the
   front and it becomes the cover.

   ---- How the drag works ----

   Pointer events, so a mouse and a finger take the same path.

   The tiles wrap onto several rows, which rules out translating things
   by a fixed x offset. Instead the *slots* — the tiles' original
   rectangles, in order — are measured once when the drag starts, and
   every tile is then translated to whichever slot its index currently
   occupies. Wrapping falls out for free: a tile moving from the end of
   one row to the start of the next just gets a different slot rect.

   ---- Not stealing the scroll ----

   These tiles sit in a scrolling sheet that also has swipe-to-dismiss
   on it, so three gestures want the same finger. The drag engages only
   when the intent is unambiguous:

     - moved sideways first  → a reorder, engage immediately
     - moved downward first  → a scroll, let it go
     - held still for 240ms  → a reorder (this is the one that makes
                               multi-row dragging possible, since that
                               needs vertical movement)

   Until it engages, nothing is prevented and the sheet behaves
   normally. `.photo-previews` is listed in ownsVertical() in
   gestures.js so a downward drag on a tile can never dismiss the sheet.
   ============================================================== */

/* Which entry is actually the cover: the first one with an image to
   show. mapActivity() builds a.photos the same way, so the badge here
   cannot disagree with what the rest of the app displays — a video
   whose poster frame failed to capture is skipped by both. */
function coverIndex(){
  return upMedia.findIndex(m=>m.type==='video'?m.poster:m.url);
}

function moveMedia(from,to){
  if(to<0||to>=upMedia.length||from===to)return;
  const [m]=upMedia.splice(from,1);
  upMedia.splice(to,0,m);
  renderThumbs();
}

const DRAG_HOLD_MS=240;      /* a still press is a reorder */
const DRAG_SLOP=7;           /* movement before intent is readable */
let mDrag=null;

function mediaDragStart(e,i){
  /* Left button or touch only, and never from the remove button. */
  if(e.button>0||e.target.closest('.rm-photo'))return;
  const box=$('photoPrev');
  const tiles=[...box.querySelectorAll('.photo-th')];
  if(tiles.length<2)return;

  mDrag={
    i, from:i, box, tiles,
    el:tiles[i],
    slots:tiles.map(t=>t.getBoundingClientRect()),
    order:tiles.map((_,n)=>n),
    x0:e.clientX, y0:e.clientY, live:false,
    hold:setTimeout(()=>{ if(mDrag&&!mDrag.live) mediaDragEngage(); },DRAG_HOLD_MS),
    pid:e.pointerId,
  };
}

function mediaDragEngage(){
  const d=mDrag;
  if(!d||d.live)return;
  d.live=true;
  clearTimeout(d.hold);
  /* Now that it is ours, stop the browser panning underneath it. */
  d.box.classList.add('reordering');
  d.el.classList.add('dragging');
  try{ d.el.setPointerCapture(d.pid); }catch(err){}
  if(navigator.vibrate) navigator.vibrate(8);
}

function mediaDragMove(e){
  const d=mDrag;
  if(!d)return;
  const dx=e.clientX-d.x0, dy=e.clientY-d.y0;

  if(!d.live){
    if(Math.abs(dx)<DRAG_SLOP&&Math.abs(dy)<DRAG_SLOP)return;
    /* Downward first means they are scrolling the sheet, not reordering. */
    if(Math.abs(dy)>Math.abs(dx)){ mediaDragCancel(); return; }
    mediaDragEngage();
  }
  e.preventDefault();

  /* The dragged tile follows the pointer. */
  d.el.style.transform=`translate(${dx}px, ${dy}px) scale(1.08)`;

  /* Which slot is the pointer over? Nearest centre wins. */
  const px=e.clientX, py=e.clientY;
  let best=0,bestD=Infinity;
  d.slots.forEach((r,n)=>{
    const cx=r.left+r.width/2, cy=r.top+r.height/2;
    const dist=(px-cx)**2+(py-cy)**2;
    if(dist<bestD){bestD=dist;best=n;}
  });

  const cur=d.order.indexOf(d.from);
  if(best!==cur){
    d.order.splice(cur,1);
    d.order.splice(best,0,d.from);
    mediaDragLayout();
  }
}

/* Put every tile except the dragged one in the slot its index now
   occupies. */
function mediaDragLayout(){
  const d=mDrag;
  d.order.forEach((tileIdx,slot)=>{
    if(tileIdx===d.from)return;
    const el=d.tiles[tileIdx];
    const from=d.slots[tileIdx], to=d.slots[slot];
    el.style.transform=`translate(${to.left-from.left}px, ${to.top-from.top}px)`;
  });
}

function mediaDragEnd(){
  const d=mDrag;
  if(!d)return;
  mDrag=null;
  clearTimeout(d.hold);
  /* A press that never became a drag is a TAP, and it used to do
     nothing at all — which left no way to set the cover except by
     dragging a tile to the front. That is unreachable with a mouse, is
     awkward on a phone, and is impossible with assistive technology.
     The menu this opens is the one that was here before the drag
     replaced it; the drag is still the fast path. */
  if(!d.live){ openMediaMenu(d.from); return; }

  d.box.classList.remove('reordering');
  d.el.classList.remove('dragging');
  d.tiles.forEach(t=>{t.style.transform='';});

  const to=d.order.indexOf(d.from);
  if(to!==d.from){
    const wasCover=coverIndex();
    moveMedia(d.from,to);
    if(coverIndex()!==wasCover||to===0) showToast('Cover updated');
  } else {
    renderThumbs();
  }
}

/* Tapping a tile. Make cover is the reason this exists, and it is
   first; the two nudges are the keyboard-free way to reorder without
   dragging. Remove is last and destructive, as everywhere else. */
function openMediaMenu(i){
  const m=upMedia[i];
  if(!m)return;
  const isCover=coverIndex()===i;
  /* A video whose poster frame never got captured has no image for a
     thumbnail, a grid card or a map pin to draw, so it cannot be the
     cover — coverIndex() skips it, and offering the option would let
     the badge and the rest of the app disagree. */
  const canCover=m.type==='video'?!!m.poster:!!m.url;
  const items=[];

  if(!isCover&&canCover){
    items.push({label:'Make cover',icon:'photo',onSelect:()=>makeCover(i)});
  }
  if(i>0) items.push({label:'Move earlier',icon:'chevron-left',
    onSelect:()=>moveMedia(i,i-1)});
  if(i<upMedia.length-1) items.push({label:'Move later',icon:'chevron-right',
    onSelect:()=>moveMedia(i,i+1)});
  items.push({label:'Remove',icon:'trash',role:'destructive',
    onSelect:()=>rmMedia(i)});

  showActionSheet({
    title:m.type==='video'?'Video':'Photo',
    message:isCover?'This is the cover.':'',
    items,
  });
}

/* The first item with a usable image IS the cover — see coverIndex() —
   so making one the cover is moving it to the front. */
function makeCover(i){
  moveMedia(i,0);
  showToast('Cover updated');
}

function mediaDragCancel(){
  const d=mDrag;
  if(!d)return;
  mDrag=null;
  clearTimeout(d.hold);
  if(!d.live)return;
  d.box.classList.remove('reordering');
  d.el.classList.remove('dragging');
  d.tiles.forEach(t=>{t.style.transform='';});
}

document.addEventListener('pointermove',mediaDragMove,{passive:false});
document.addEventListener('pointerup',mediaDragEnd);
document.addEventListener('pointercancel',mediaDragCancel);

/* One tile, used by the picker, the activity sheet and anywhere else
   that shows a piece of media. A video shows its poster with a play
   badge over it; with no poster it falls back to the video element's
   own first frame. */
function mediaTileHTML(m,cls){
  const c=cls?` class="${cls}"`:'';
  if(m.type==='video'){
    const inner=m.poster
      ? `<img src="${esc(m.poster)}" alt="" loading="lazy"/>`
      : `<video src="${esc(m.url)}" muted playsinline preload="metadata"></video>`;
    return `<span class="media-tile is-video"${c}>${inner}
      <span class="media-play">${icon('play','ic-sm')}</span></span>`;
  }
  return `<span class="media-tile"${c}><img src="${esc(m.url)}" alt="" loading="lazy"/></span>`;
}

function renderThumbs(){
  const box=$('photoPrev');
  if(!box)return;
  const cover=coverIndex();
  const tiles=upMedia.map((m,i)=>
    `<div class="photo-th${i===cover?' is-cover':''}" onpointerdown="mediaDragStart(event,${i})"
          aria-label="${i===cover?'Cover. ':''}Drag to reorder">
       ${mediaTileHTML(m)}
       ${i===cover?'<span class="photo-cover-tag">Cover</span>':''}
       <button class="rm-photo" onclick="event.stopPropagation();rmMedia(${i})" aria-label="Remove">${icon('x')}</button>
     </div>`).join('');
  /* An in-flight upload gets a tile of its own. A video can take a
     while, and with no placeholder the sheet looks like it ignored the
     file that was just picked. */
  const pending=Array.from({length:_mediaPending},()=>
    `<div class="photo-th pending"><span class="spinner"></span></div>`).join('');
  box.innerHTML=tiles+pending;
  /* The completion sheet will not save without at least one of these.
     The rule belongs to that sheet, not to the picker, so it lives in
     activities.js — this is only the one place every change to upMedia
     passes through. */
  updateMediaRequirement();
}

/* ==============================================================
   ONE-OFF: BASE64 PHOTOS OUT OF THE ROW

   Rows written before the `media` bucket existed — and anything
   attached while offline — carry the image inline in `Activities.photos`
   as a base64 data URL. That is a third larger than the bytes it holds,
   it sits on `select(...)`'s critical path, and it is pulled down again
   on every launch and every revalidate. With a 45MB database and 1MB of
   Storage, it was essentially all of this project's egress.

   Run it from the console while signed in, once:  await backfillMedia()

   It is deliberately NOT automatic and NOT on any render path:
   uploading somebody's whole library is not something an app should do
   behind their back on a metered connection.

   Safe to re-run — it only touches entries that are still data URLs,
   and it writes a row only when that row actually changed. A row whose
   upload fails is left exactly as it was and reported at the end.
   ============================================================== */
async function backfillMedia(){
  if(!currentUser){ console.warn('[backfill] sign in first'); return; }
  if(!storageReady()){
    console.warn('[backfill] no "'+MEDIA_BUCKET+'" bucket — run supabase/storage.sql');
    return;
  }
  const isData=v=>typeof v==='string'&&v.startsWith('data:');

  /* Read straight from the table rather than the cache: this is the one
     place that wants the raw column shape, and the cache holds the
     mapped one. */
  const{data,error}=await sb.from('Activities').select('id,photos');
  if(error){ console.error('[backfill]',error); return; }

  let rows=0,files=0,bytes=0;const failed=[];
  for(const row of (data||[])){
    let raw=[];
    try{
      raw=Array.isArray(row.photos)?row.photos
         :typeof row.photos==='string'?JSON.parse(row.photos):[];
    }catch(e){ continue; }
    if(!raw.length) continue;

    let changed=false;
    const out=[];
    for(const m of raw){
      try{
        if(isData(m)){
          const blob=dataURLToBlob(m);
          bytes+=m.length; files++;
          out.push(await uploadBlob(blob,'jpg',blob.type||'image/jpeg'));
          changed=true;
        }else if(m&&typeof m==='object'&&isData(m.poster)){
          const blob=dataURLToBlob(m.poster);
          bytes+=m.poster.length; files++;
          out.push({...m,poster:await uploadBlob(blob,'jpg',blob.type||'image/jpeg')});
          changed=true;
        }else{
          out.push(m);
        }
      }catch(e){
        /* Keep the original. A file wrongly kept costs kilobytes; a row
           rewritten with a broken URL costs somebody a photo. */
        console.warn('[backfill] upload failed on',row.id,e);
        out.push(m); failed.push(row.id);
      }
    }
    if(!changed) continue;

    /* Through dbUpdate so the in-memory cache and the offline snapshot
       are patched the same way every other write patches them. */
    const{error:upErr}=await dbUpdate('Activities',row.id,{photos:out});
    if(upErr){ console.warn('[backfill] row failed',row.id,upErr); failed.push(row.id); continue; }
    rows++;
    console.info('[backfill] '+rows+' rows, '+files+' files, ~'+
      Math.round(bytes/1024/1024)+'MB moved');
  }
  console.info('[backfill] done — '+rows+' rows, '+files+' files, ~'+
    Math.round(bytes/1024/1024)+'MB out of the database'+
    (failed.length?'; '+failed.length+' left alone: '+[...new Set(failed)].join(', '):''));
  await revalidate(true);
  refreshAfterChange();
  return{rows,files,failed:[...new Set(failed)]};
}
