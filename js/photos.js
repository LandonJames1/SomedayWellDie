/* ==============================================================
   ALL PHOTOS — every photo and video, in one grid.

   The payoff of this whole app is the photographs, and until this
   screen they were the hardest thing in it to look at: to see one you
   had to remember which activity it was attached to, find that
   activity, and open its sheet. Accomplished lists the activities;
   nothing listed the pictures.

   A pushed screen owned by the Home tab, reached from Accomplished's
   bar button and from the You tab. Grouped by the month things were
   finished, newest first, three to a row.

   It owns no data. Everything comes out of the same fetchAllActivities()
   cache Home and Accomplished already read.
   ============================================================== */

/* ⚠️ BUILT FROM a.media, NEVER FROM a.photos.

   mapActivity() derives `photos` by mapping a video to its poster and
   then dropping anything falsy — so an activity holding a video whose
   poster never got captured has FEWER entries in `photos` than in
   `media`, and from that point on the two arrays' indices disagree.
   Everywhere else in the app that does not matter, because `photos` is
   only ever read as a thumbnail. Here the index is what the lightbox
   opens on, so an off-by-one shows the wrong picture. `media` is the
   full ordered list and is the shape openLB() already expects.

   The flat list is held here rather than serialised into each tile's
   onclick the way activities.js does it: that is fine for one
   activity's handful of items and would put the entire library's JSON
   into every cell on this screen. */
let _pwItems=[];

/* One entry per piece of media, newest activity first, carrying enough
   to name the file and caption the viewer. `saveIdx`/`saveTotal` are
   the item's position WITHIN ITS OWN ACTIVITY — see lbSave(). */
function photoWallItems(acts){
  const done=(acts||[]).filter(a=>a.completed&&a.media&&a.media.length);
  done.sort((a,b)=>{
    /* Undated completions last, as on Accomplished. */
    if(!a.completedDate&&!b.completedDate)return 0;
    if(!a.completedDate)return 1;
    if(!b.completedDate)return -1;
    return new Date(b.completedDate)-new Date(a.completedDate);
  });
  const out=[];
  done.forEach(a=>{
    a.media.forEach((m,i)=>{
      if(!m||!m.url)return;
      out.push({type:m.type,url:m.url,poster:m.poster||'',
        label:a.name||'',saveIdx:i,saveTotal:a.media.length,
        actId:a.id,when:a.completedDate||''});
    });
  });
  return out;
}

async function renderPhotoWall(){
  const body=$('photosBody');
  if(!body)return;
  /* Only when there is actually a wait — the rows are cached for the
     session, so every visit after the first paints from memory and
     blanking it first would turn an instant redraw into a flash of
     nothing. Same guard renderDone() makes. */
  if(!cacheWarm()) body.innerHTML='<div class="spinner"></div>';

  const lists=await fetchCollections();
  const acts=await fetchAllActivities(lists);
  _pwItems=photoWallItems(acts);

  $('photosEyebrow').textContent=_pwItems.length
    ? `${_pwItems.length} ${_pwItems.length===1?'photo':'photos'}`
    : 'Nothing yet';

  if(!_pwItems.length){
    setHTML(body,`<div class="empty">${icon('photo')}
      <div class="empty-title">No photos yet</div>
      <div class="empty-sub">Photos you attach when you mark something accomplished show up here.</div>
    </div>`);
    return;
  }

  /* Grouped by the month the activity was finished, reusing done.js's
     own monthLabel() so the two screens cannot disagree about what a
     month is called. The index carried into each cell is the position
     in the FLAT list, so the lightbox pages across month boundaries. */
  const buckets=new Map();
  _pwItems.forEach((m,i)=>{
    const key=m.when?m.when.slice(0,7):'undated';
    if(!buckets.has(key)) buckets.set(key,[]);
    buckets.get(key).push(i);
  });

  setHTML(body,[...buckets.entries()].map(([key,idxs])=>`
      <div class="home-sec-head">
        <h2>${esc(monthLabel(key))}</h2>
        <span class="upnext-count">${idxs.length}</span>
      </div>
      <div class="pw-grid">${idxs.map(i=>pwCellHTML(_pwItems[i],i)).join('')}</div>`)
    .join(''));
}

function pwCellHTML(m,i){
  /* mediaTileHTML() already draws the play badge over a video and falls
     back to the video's own first frame when there is no poster, so the
     cell is only the button and the box around it. Its second argument
     emits a duplicate class attribute, so it is deliberately not used. */
  return `<button class="pw-cell" onclick="photoWallOpen(${i})"
      aria-label="${esc(m.label||'Photo')}">${mediaTileHTML(m)}</button>`;
}

/* Over the whole wall rather than one activity's set, so a swipe walks
   every photo you own. Each item names itself — see the note above
   lbPhotos in modals.js. */
function photoWallOpen(i){
  if(!_pwItems.length)return;
  openLB(_pwItems,i,APP_NAME);
}
