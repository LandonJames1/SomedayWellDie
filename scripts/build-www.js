/* ==============================================================
   BUILD — assemble www/ for the native shell
   --------------------------------------------------------------
   Capacitor copies one directory into the app binary. This app has
   no build step and lives at the repo root, so that directory has to
   be assembled: www/ is a copy of exactly the files the app needs at
   runtime and nothing else.

   Why not point webDir at '.'? Because it would bundle node_modules,
   .git, _backup, the SQL migrations, the Cloudflare Worker source and
   the two design labs into a binary shipped to users — tens of
   megabytes of things that are not the app, including source that has
   no business on somebody's phone.

   ⚠️ THE ASSETS ARE BUNDLED, NEVER FETCHED FROM A URL. Capacitor can
   be pointed at a remote server instead (`server.url`), and doing that
   here would be a Guideline 2.5.2 rejection: an app that loads its own
   executable code from the network is updating itself outside the App
   Store. Do not set server.url for anything but local development.

   ⚠️ KEEP `INCLUDE` IN STEP WITH index.html AND sw.js. A new css/ or
   js/ file is picked up automatically because whole directories are
   copied — but a new TOP-LEVEL file is not, and the failure is a blank
   screen on device while the browser works perfectly.
   ============================================================== */
const fs=require('fs');
const path=require('path');

const ROOT=path.resolve(__dirname,'..');
const OUT=path.join(ROOT,'www');

/* Everything the app loads at runtime, and nothing else. Directories
   are copied whole; files are copied individually. */
const INCLUDE=[
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'css',
  'js',
  'icons',
  /* The two legal documents are linked from the You tab and from the
     sign-up screen, so they have to be in the bundle — otherwise those
     rows open a blank page on device. */
  'legal',
];

/* Deliberately not shipped, listed here so the reason is recorded
   rather than inferred from the absence:

     node_modules/      the toolchain
     ios/               the generated Xcode project
     supabase/          migrations and Edge Function source
     cloudflare/        the media Worker's source, which holds no
                        secrets but is not the app either
     tools/             one-off Python scripts
     _backup/           the pre-refactor original
     Supabase Setup/    stale CSV exports
     *-lab.html         the colour and modal benches (dev tools)
     CLAUDE.md, README  documentation
*/

function rm(p){ fs.rmSync(p,{recursive:true,force:true}); }

function copy(src,dst){
  const st=fs.statSync(src);
  if(st.isDirectory()){
    fs.mkdirSync(dst,{recursive:true});
    for(const name of fs.readdirSync(src)){
      /* .DS_Store and dotfiles have no business in a shipped binary. */
      if(name.startsWith('.')) continue;
      copy(path.join(src,name),path.join(dst,name));
    }
  }else{
    fs.mkdirSync(path.dirname(dst),{recursive:true});
    fs.copyFileSync(src,dst);
  }
}

function count(dir){
  let n=0,bytes=0;
  (function walk(d){
    for(const name of fs.readdirSync(d)){
      const p=path.join(d,name),st=fs.statSync(p);
      if(st.isDirectory()) walk(p); else { n++; bytes+=st.size; }
    }
  })(dir);
  return{n,bytes};
}

rm(OUT);
fs.mkdirSync(OUT,{recursive:true});

const missing=[];
for(const item of INCLUDE){
  const src=path.join(ROOT,item);
  if(!fs.existsSync(src)){ missing.push(item); continue; }
  copy(src,path.join(OUT,item));
}

if(missing.length){
  console.error('[build] MISSING, not copied: '+missing.join(', '));
  process.exit(1);
}

const{n,bytes}=count(OUT);
console.log(`[build] www/ — ${n} files, ${(bytes/1024/1024).toFixed(2)} MB`);
