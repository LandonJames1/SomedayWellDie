#!/usr/bin/env python3
"""Move base64 photos out of Postgres and into R2.

Any activity written before the media bucket existed carries its images
as base64 data URLs *inside* Activities.photos. `photos` is in the
narrowed select (api.js selectCols) and has to stay there -- photos[0]
is the cover every thumbnail, grid card and map pin draws -- so those
bytes ship again on every fetchAllActivities(): cold launch, every
foreground revalidate(), every reconnect, on every device, forever.
Base64 adds ~33% on top. That is the egress overage.

This is the one-off that fixes it. Each data URL is decoded, uploaded
to R2 under the same `${uid}/${uuid}.${ext}` scheme mediaKey() uses,
and the column is rewritten to hold the URL instead. Rows already
holding URLs are untouched, so re-running is harmless.

Stdlib only -- SigV4 is hand-rolled rather than pulling in boto3, the
same trade exif.js makes.

Usage:
    export SUPABASE_URL=https://xxdmendegyxlkikejvps.supabase.co
    export SUPABASE_SERVICE_KEY=...      # service_role, NOT the anon key
    export R2_ACCOUNT_ID=...
    export R2_BUCKET=media
    export R2_ACCESS_KEY_ID=...
    export R2_SECRET_ACCESS_KEY=...
    export R2_PUBLIC_BASE=https://media.example.com   # public custom domain

    python3 tools/media-backfill.py            # dry run, reports only
    python3 tools/media-backfill.py --apply    # actually writes

The dry run is the default deliberately: it reports exactly what would
move and how many bytes come out of the table, and touches nothing.

A row is rewritten only after every one of its uploads has succeeded,
so a failure part-way leaves that row exactly as it was rather than
half-converted. Failures are reported and the run continues.
"""
import os, sys, json, base64, hashlib, hmac, uuid, datetime, urllib.request, urllib.parse, urllib.error
import ssl

def _ssl_context():
    """A verifying SSL context that works on a stock python.org macOS build.

    Those builds ship without a CA bundle wired in, so every HTTPS call
    fails with CERTIFICATE_VERIFY_FAILED until someone runs the
    "Install Certificates.command" that ships beside them. certifi is
    usually already on disk, and macOS always has /etc/ssl/cert.pem, so
    this finds one rather than making that a prerequisite.

    Verification is never disabled: this call carries a service_role key
    and moves user photos, so an unverified connection is not an
    acceptable fallback. If no bundle is found we let the default fail
    loudly.
    """
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        pass
    if os.path.exists('/etc/ssl/cert.pem'):
        return ssl.create_default_context(cafile='/etc/ssl/cert.pem')
    return ssl.create_default_context()


SSL_CTX = _ssl_context()

APPLY = '--apply' in sys.argv


def _limit():
    """--limit N: stop after N rows have been converted.

    The rewrite REPLACES the base64 with a URL, so the original bytes
    leave the database. If R2_PUBLIC_BASE is wrong those photos are
    broken with nothing to roll back to. Converting one row first and
    looking at it in the app turns that from a leap into a check.
    """
    for i, a in enumerate(sys.argv):
        if a == '--limit' and i + 1 < len(sys.argv):
            try:
                return int(sys.argv[i + 1])
            except ValueError:
                die('--limit needs a number')
        if a.startswith('--limit='):
            try:
                return int(a.split('=', 1)[1])
            except ValueError:
                die('--limit needs a number')
    return None


LIMIT = _limit()

CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           'backfill-config.txt')


def load_config():
    """Read NAME=value lines out of tools/backfill-config.txt into the env.

    Editing a file in a text editor beats pasting six exports into a
    shell: the values survive closing the terminal, and a typo is
    something you can see and fix rather than re-paste. Anything already
    set in the real environment wins, so CI or a one-off export still
    overrides the file. The file holds a service_role key and an R2
    secret, so it is in .gitignore.
    """
    if not os.path.exists(CONFIG_FILE):
        return
    with open(CONFIG_FILE) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            name, _, value = line.partition('=')
            name = name.strip()
            # Tolerate quotes and stray whitespace -- these get pasted.
            value = value.strip().strip('"').strip("'")
            if value and not os.environ.get(name):
                os.environ[name] = value


load_config()

SUPABASE_URL = os.environ.get('SUPABASE_URL', '').rstrip('/')
SERVICE_KEY  = os.environ.get('SUPABASE_SERVICE_KEY', '')
ACCOUNT_ID   = os.environ.get('R2_ACCOUNT_ID', '')
BUCKET       = os.environ.get('R2_BUCKET', 'media')
ACCESS_KEY   = os.environ.get('R2_ACCESS_KEY_ID', '')
SECRET_KEY   = os.environ.get('R2_SECRET_ACCESS_KEY', '')
PUBLIC_BASE  = os.environ.get('R2_PUBLIC_BASE', '').rstrip('/')

MIME_EXT = {
    'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
    'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic',
    'video/mp4': 'mp4', 'video/quicktime': 'mov',
}


def die(msg):
    print('error: ' + msg, file=sys.stderr)
    sys.exit(1)


def check_env():
    missing = [n for n, v in (
        ('SUPABASE_URL', SUPABASE_URL), ('SUPABASE_SERVICE_KEY', SERVICE_KEY),
        ('R2_ACCOUNT_ID', ACCOUNT_ID), ('R2_ACCESS_KEY_ID', ACCESS_KEY),
        ('R2_SECRET_ACCESS_KEY', SECRET_KEY), ('R2_PUBLIC_BASE', PUBLIC_BASE),
    ) if not v]
    if missing:
        die('missing env: ' + ', '.join(missing))


# ---------- Supabase REST ----------

def sb(path, method='GET', body=None, extra_headers=None):
    url = SUPABASE_URL + '/rest/v1/' + path
    data = json.dumps(body).encode() if body is not None else None
    headers = {
        'apikey': SERVICE_KEY,
        'Authorization': 'Bearer ' + SERVICE_KEY,
        'Content-Type': 'application/json',
    }
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, context=SSL_CTX) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        die('supabase %s %s -> %s %s' % (method, path, e.code, e.read().decode()[:400]))


# ---------- R2 (SigV4) ----------

def _sign(key, msg):
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def r2_put(key, blob, content_type):
    """PUT one object to R2 with an S3 SigV4 signature. Returns public URL."""
    host = '%s.r2.cloudflarestorage.com' % ACCOUNT_ID
    # The key is already URL-safe (uid/uuid.ext) but encode defensively.
    canonical_uri = '/' + BUCKET + '/' + urllib.parse.quote(key, safe='/')
    now = datetime.datetime.now(datetime.timezone.utc)
    amzdate = now.strftime('%Y%m%dT%H%M%SZ')
    datestamp = now.strftime('%Y%m%d')
    payload_hash = hashlib.sha256(blob).hexdigest()

    signed_headers = 'content-type;host;x-amz-content-sha256;x-amz-date'
    canonical_headers = (
        'content-type:%s\nhost:%s\nx-amz-content-sha256:%s\nx-amz-date:%s\n'
        % (content_type, host, payload_hash, amzdate)
    )
    canonical_request = '\n'.join(
        ['PUT', canonical_uri, '', canonical_headers, signed_headers, payload_hash])

    scope = '%s/auto/s3/aws4_request' % datestamp
    string_to_sign = '\n'.join([
        'AWS4-HMAC-SHA256', amzdate, scope,
        hashlib.sha256(canonical_request.encode()).hexdigest()])

    k = _sign(('AWS4' + SECRET_KEY).encode(), datestamp)
    k = _sign(k, 'auto')
    k = _sign(k, 's3')
    k = _sign(k, 'aws4_request')
    signature = hmac.new(k, string_to_sign.encode(), hashlib.sha256).hexdigest()

    authorization = (
        'AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s'
        % (ACCESS_KEY, scope, signed_headers, signature))

    req = urllib.request.Request(
        'https://%s%s' % (host, canonical_uri), data=blob, method='PUT',
        headers={
            'Host': host,
            'Content-Type': content_type,
            'X-Amz-Content-Sha256': payload_hash,
            'X-Amz-Date': amzdate,
            'Authorization': authorization,
            # Matches the cacheControl uploadBlob() sets today.
            'Cache-Control': 'public, max-age=31536000, immutable',
        })
    with urllib.request.urlopen(req, context=SSL_CTX) as r:
        if r.status not in (200, 201):
            raise RuntimeError('R2 PUT %s -> %s' % (key, r.status))
    return '%s/%s' % (PUBLIC_BASE, key)


# ---------- data URLs ----------

def parse_data_url(s):
    """('image/jpeg', b'...') for a data URL, else None."""
    if not isinstance(s, str) or not s.startswith('data:'):
        return None
    try:
        head, b64 = s.split(',', 1)
        mime = head[5:].split(';')[0] or 'image/jpeg'
        return mime, base64.b64decode(b64)
    except Exception:
        return None


MIGRATE_STORAGE = '--migrate-storage' in sys.argv


def fetch_url(url):
    """Download an existing object. Returns (content_type, bytes)."""
    req = urllib.request.Request(url, headers={'User-Agent': 'media-backfill'})
    with urllib.request.urlopen(req, context=SSL_CTX) as r:
        return r.headers.get('Content-Type', 'image/jpeg').split(';')[0].strip(), r.read()


def move_storage_url(s, uid, stats):
    """Re-host a Supabase Storage URL on R2. Anything else passes through.

    Photos left on Supabase Storage still bill egress on every view,
    which is the same cost the base64 rows had -- just smaller. Only
    runs under --migrate-storage so the common case stays one job.
    """
    if not isinstance(s, str) or not s.startswith('http'):
        return s
    if SUPABASE_URL.split('//')[-1] not in s or '/storage/' not in s:
        return s
    stats['storage'] += 1
    if not APPLY:
        return s
    mime, blob = fetch_url(s)
    stats['bytes'] += len(blob)
    ext = MIME_EXT.get(mime, s.rsplit('.', 1)[-1].split('?')[0].lower() or 'jpg')
    key = '%s/%s.%s' % (uid, uuid.uuid4(), ext)
    return r2_put(key, blob, mime)


def convert(s, uid, stats):
    """Whichever of the two conversions applies to this URL."""
    out = upload_data_url(s, uid, stats)
    if MIGRATE_STORAGE:
        out = move_storage_url(out, uid, stats)
    return out


def upload_data_url(s, uid, stats):
    """Upload one data URL, return its new URL. Non-data URLs pass through."""
    parsed = parse_data_url(s)
    if not parsed:
        return s
    mime, blob = parsed
    stats['inline'] += 1
    stats['bytes'] += len(s)          # what the row actually costs today
    if not APPLY:
        return s
    ext = MIME_EXT.get(mime, 'jpg')
    key = '%s/%s.%s' % (uid, uuid.uuid4(), ext)
    return r2_put(key, blob, mime)


# ---------- main ----------

def main():
    check_env()

    print('Reading collections...')
    cols = sb('Collections?select=id,user_id') or []
    owner = {c['id']: c['user_id'] for c in cols}
    print('  %d collections' % len(owner))

    print('Reading activities...')
    acts = sb('Activities?select=id,collection_id,photos&photos=not.is.null') or []
    print('  %d activities with media' % len(acts))

    stats = {'inline': 0, 'storage': 0, 'bytes': 0, 'rows': 0, 'failed': 0}
    for a in acts:
        raw = a.get('photos')
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except Exception:
                continue
        if not isinstance(raw, list) or not raw:
            continue
        # Cheap pre-filter: skip rows with nothing to convert.
        blob = json.dumps(raw)
        has_inline = 'data:' in blob
        has_storage = MIGRATE_STORAGE and '/storage/' in blob
        if not has_inline and not has_storage:
            continue

        uid = owner.get(a.get('collection_id'))
        if not uid:
            print('  ! %s: no owner for collection, skipped' % a['id'])
            stats['failed'] += 1
            continue

        before = stats['inline'] + stats['storage']
        try:
            out = []
            for m in raw:
                if isinstance(m, str):
                    out.append(convert(m, uid, stats))
                elif isinstance(m, dict):
                    m = dict(m)
                    if m.get('url'):
                        m['url'] = convert(m['url'], uid, stats)
                    if m.get('poster'):
                        m['poster'] = convert(m['poster'], uid, stats)
                    out.append(m)
                else:
                    out.append(m)
        except Exception as e:
            # Leave the row exactly as it was rather than half-converted.
            print('  ! %s: upload failed (%s), row left alone' % (a['id'], e))
            stats['failed'] += 1
            continue

        if stats['inline'] + stats['storage'] == before:
            continue
        stats['rows'] += 1
        if APPLY:
            sb('Activities?id=eq.' + a['id'], 'PATCH', {'photos': out},
               {'Prefer': 'return=minimal'})
            print('  moved %s (%d items)' % (a['id'], stats['inline'] + stats['storage'] - before))
            for m in out:
                url = m if isinstance(m, str) else (m or {}).get('url', '')
                if url.startswith('http'):
                    print('      %s' % url)
        if LIMIT and stats['rows'] >= LIMIT:
            print('  -- stopping at --limit %d --' % LIMIT)
            break

    mb = stats['bytes'] / 1024 / 1024
    print()
    print('%s: %d inline + %d storage items across %d rows, %.1f MB'
          % ('MOVED' if APPLY else 'WOULD MOVE', stats['inline'], stats['storage'],
             stats['rows'], mb))
    if not MIGRATE_STORAGE:
        print('(pass --migrate-storage to also re-host Supabase Storage URLs)')
    if stats['failed']:
        print('%d rows failed and were left alone' % stats['failed'])
    if LIMIT:
        print('(--limit %d was set, so this is a partial run)' % LIMIT)
    if not APPLY:
        print('\nDry run. Re-run with --apply to write.')


if __name__ == '__main__':
    main()
