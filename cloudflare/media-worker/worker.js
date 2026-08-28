/* ==============================================================
   MEDIA WORKER — the only thing allowed to write to R2.

   Why this exists at all: R2 knows nothing about Supabase accounts, so
   something server-side has to decide whether a caller may upload. It
   cannot be the browser, because that would mean shipping the R2 secret
   key to every visitor -- the same argument that keeps the HERE key out
   of config.js and inside the geo function.

   Three jobs:

     POST /upload      authorize, store, return the public URL
     GET  /download    serve one object as a file save rather than a
                       navigation (a cross-origin <a download> is
                       ignored by browsers, so the header has to come
                       from here)
     GET  /health      a liveness probe with no auth

   HOW THE CALLER IS VERIFIED. The Authorization header carries the
   user's ordinary Supabase access token and this asks Supabase who it
   belongs to, via GET /auth/v1/user. That is a round trip, and it is
   deliberately preferred over verifying the JWT signature locally:

     - it works with legacy JWT secrets AND the newer signing keys
       without this file needing to know which the project uses;
     - a deleted or banned account is refused, because the check is
       against live state rather than a signature that stays valid until
       it expires. That is the same hole ensureSessionLive() closes in
       the app, arrived at from the other side.

   The verified uid -- never anything from the request body -- is what
   builds the storage key. A uid taken from the body would let any
   signed-in user write into anybody's folder.
   ============================================================== */

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;  /* matches MAX_VIDEO_BYTES */

/* The R2 binding. The dashboard's binding name is written with a hyphen
   (`swd-media`), which is not a valid identifier, so it can only be
   reached with bracket access -- env.swd-media parses as a subtraction.
   `MEDIA` is accepted as well so a differently-named binding does not
   silently 500. */
function bucket(env) {
  const b = env['swd-media'] || env.MEDIA;
  if (!b) throw new Error('no R2 binding: expected "swd-media" or "MEDIA"');
  return b;
}

/* Only what the app actually produces. An open-ended allowlist here
   would make this a general-purpose file host for anyone with an
   account. */
const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'video/mp4':  'mp4',
  'video/quicktime': 'mov',
};

/* ALLOWED_ORIGIN may be a comma-separated list, because the app is
   served from GitHub Pages in production and from localhost while it is
   being worked on, and a single value would mean choosing one. The
   header itself can only ever carry ONE origin, so the caller's own is
   echoed back when it is on the list. Unset means '*'. */
function allowOrigin(env, request) {
  const allowed = (env.ALLOWED_ORIGIN || '').split(',')
    .map(s => s.trim()).filter(Boolean);
  if (!allowed.length) return '*';
  const origin = request && request.headers.get('Origin');
  if (origin && allowed.includes(origin)) return origin;
  return allowed[0];
}

function cors(env, extra, request) {
  return Object.assign({
    'Access-Control-Allow-Origin':  allowOrigin(env, request),
    /* The echoed origin varies by caller, so a shared cache must not
       reuse one response for another site. */
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Max-Age':       '86400',
  }, extra || {});
}

function json(env, body, status, request) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: cors(env, { 'Content-Type': 'application/json' }, request),
  });
}

/* Ask Supabase who this token belongs to. Returns a uid or null. */
async function verifyUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  try {
    const r = await fetch(env.SUPABASE_URL + '/auth/v1/user', {
      headers: {
        'Authorization': auth,
        'apikey': env.SUPABASE_ANON_KEY,
      },
    });
    if (!r.ok) return null;
    const user = await r.json();
    return (user && user.id) || null;
  } catch (e) {
    /* A failed round trip is not proof of a bad token, but it is also
       not permission to write. Refusing is the safe direction: the app
       already falls back to keeping the photo inline. */
    return null;
  }
}

/* uid/uuid.ext -- the same scheme mediaKey() uses in js/media.js, so
   the backfill's objects and new uploads share one layout. */
function objectKey(uid, ext) {
  return `${uid}/${crypto.randomUUID()}.${ext}`;
}

async function handleUpload(request, env) {
  const uid = await verifyUser(request, env);
  if (!uid) return json(env, { error: 'unauthorized' }, 401, request);

  const contentType = (request.headers.get('Content-Type') || '').split(';')[0].trim();
  const ext = ALLOWED_TYPES[contentType];
  if (!ext) return json(env, { error: 'unsupported type: ' + contentType }, 415, request);

  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > MAX_UPLOAD_BYTES) return json(env, { error: 'too large' }, 413, request);

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return json(env, { error: 'empty body' }, 400, request);
  /* Content-Length is a claim; this is the fact. */
  if (body.byteLength > MAX_UPLOAD_BYTES) return json(env, { error: 'too large' }, 413, request);

  const key = objectKey(uid, ext);
  await bucket(env).put(key, body, {
    httpMetadata: {
      contentType,
      /* Keys are random and never reused, so an object can be cached
         forever. This is what makes a viewed photo cost nothing. */
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });

  return json(env, { url: `${env.PUBLIC_BASE}/${key}`, key }, 200, request);
}

/* A browser ignores the `download` attribute cross-origin, so a link
   straight to the public bucket opens the photo instead of saving it.
   This serves the same object with Content-Disposition set. */
async function handleDownload(request, env, url) {
  const key = url.searchParams.get('key');
  if (!key) return json(env, { error: 'key required' }, 400, request);

  const obj = await bucket(env).get(key);
  if (!obj) return json(env, { error: 'not found' }, 404, request);

  const name = (url.searchParams.get('name') || key.split('/').pop() || 'photo')
    .replace(/[^\w.\-]/g, '_');   /* never let a filename shape the header */

  const headers = new Headers(cors(env, null, request));
  obj.writeHttpMetadata(headers);
  headers.set('Content-Disposition', `attachment; filename="${name}"`);
  return new Response(obj.body, { headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(env, null, request) });
    }
    if (url.pathname === '/health') {
      let bound = true;
      try { bucket(env); } catch (e) { bound = false; }
      return json(env, {
        ok: true,
        bucketBound: bound,
        publicBase: env.PUBLIC_BASE || null,
        supabaseConfigured: !!(env.SUPABASE_URL && env.SUPABASE_ANON_KEY),
      }, 200, request);
    }
    if (url.pathname === '/upload' && request.method === 'POST') {
      return handleUpload(request, env);
    }
    if (url.pathname === '/download' && request.method === 'GET') {
      return handleDownload(request, env, url);
    }
    return json(env, { error: 'not found' }, 404, request);
  },
};
