/* ==============================================================
   PICKING MEDIA — one entry point, two implementations.

   ⚠️ THE WEB PATH IS UNTOUCHED. In a browser pickMedia() clicks
   the same hidden <input id="photoInput"> the app has always used
   and handleMedia() runs exactly as before. Nothing in media.js
   changed. The native branch only exists when the plugin does.

   Why bother: <input type="file"> gets a CONVERTED copy of a HEIC
   photo from iOS, and the conversion strips every EXIF tag — so
   js/exif.js reads a file with no GPS block in it on the default
   camera format of every modern iPhone, and the "where was this
   taken" feature silently does nothing. PHPicker hands back the
   original bytes. See NativeMedia.swift.

   ⚠️ IT ENDS IN handleMedia(), NOT BESIDE IT. The native branch
   builds real File objects and calls the same function with the
   same shape of argument, so EXIF reading, the location offer, the
   upload, the pending counter, the cover rule and the completion
   sheet's media requirement are all one code path with one set of
   bugs. Anything that "handles native media" separately from
   handleMedia() is the thing to avoid here.
   ============================================================== */

function nativeMediaPlugin(){
  return (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.NativeMedia) || null;
}

/* Both call sites that used to do $('photoInput').click() call this
   instead — the completion sheet's Media card and its media page's
   button. */
function pickMedia(){
  const p=nativeMediaPlugin();
  if(!p){ $('photoInput').click(); return; }
  /* iOS convention, and the reason for the extra tap: PHPicker is the
     library only, so without a choice here the camera — which the
     <input> used to offer through the OS sheet — would be gone. */
  showActionSheet({
    items:[
      {label:'Photo Library', icon:'photo', onSelect:()=>runNativePick('library')},
      {label:'Take Photo or Video', icon:'camera', onSelect:()=>runNativePick('camera')},
    ],
  });
}

async function runNativePick(source){
  const p=nativeMediaPlugin();
  if(!p) return;
  let files=[];
  try{
    const r=await p.pick({source:source});
    files=(r&&r.files)||[];
  }catch(e){ console.warn('[media] native pick failed',e); return; }
  if(!files.length) return;          /* cancelled — not an error */

  const out=[];
  for(const f of files){
    try{
      /* The plugin wrote the pick into the app's tmp/ and handed back a
         capacitor:// URL, so the bytes come across as a fetch rather
         than as a base64 string on the bridge. That is what makes
         video survivable. */
      const res=await fetch(f.url);
      const blob=await res.blob();
      /* ⚠️ The type must come from the plugin, not from the blob. A
         capacitor:// response can arrive as application/octet-stream,
         and handleMedia() decides photo-or-video on f.type — an
         unrecognised type is skipped outright. */
      out.push(new File([blob],f.name||'media',{type:f.type||blob.type}));
    }catch(e){ console.warn('[media] could not read pick',f&&f.url,e); }
  }
  if(!out.length) return;

  /* The shape handleMedia() reads: it takes e.target.files and then
     blanks e.target.value to let the same file be picked twice. A
     plain object satisfies both. */
  handleMedia({target:{files:out,value:''}});
}
