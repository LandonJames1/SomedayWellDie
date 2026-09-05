#!/usr/bin/env python3
"""Prove RLS actually holds, by attacking it as a signed-in user.

⚠️ READING pg_policies IS NOT THE SAME TEST, AND NEITHER IS PROBING
ANONYMOUSLY. supabase/rls-lockdown.sql exists because this project
shipped for a while with a policy literally named "ALL" on each of the
three core tables -- `to authenticated ... using (true)` -- which OR'd
over every correct bl_* policy and gave every signed-in user full
access to everyone's rows. It granted nothing to a LOGGED-OUT request,
so an anonymous probe came back empty and the project looked locked
down. That is the exact shape of hole this script is built to catch:
it signs in as a real user and tries to reach another real user's data.

It uses SUPABASE_KEY out of js/config.js -- the publishable key, the
one that ships in the browser -- deliberately. The point is to test
with precisely the credential an attacker has.

    python3 tools/demo-account.py --apply    # first: the two accounts
    python3 tools/rls-probe.py

Read-only except for two writes it EXPECTS to be refused (an update and
a delete against the other account's rows). If either is allowed the
script says so loudly -- and in that case something was genuinely
modified, which is the finding.

Exit code is 0 only if every check passes.
"""
import os, re, sys, json, io, urllib.request, urllib.parse, urllib.error, ssl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_JS = os.path.join(ROOT, 'js', 'config.js')

# Must match tools/demo-account.py.
REVIEW_EMAIL = 'appreview@somedaywelldie.app'
FRIEND_EMAIL = 'sam@somedaywelldie.app'
PASSWORD     = 'ReviewDemo!2026'


def _ssl_context():
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        pass
    for p in ('/etc/ssl/cert.pem', '/usr/local/etc/openssl/cert.pem'):
        if os.path.exists(p):
            return ssl.create_default_context(cafile=p)
    return ssl.create_default_context()


CTX = _ssl_context()


def read_public_config():
    """The URL and publishable key exactly as the browser gets them."""
    src = io.open(CONFIG_JS, encoding='utf-8').read()
    url = re.search(r"const SUPABASE_URL\s*=\s*'([^']+)'", src)
    key = re.search(r"const SUPABASE_KEY\s*=\s*'([^']+)'", src)
    if not url or not key:
        sys.exit('could not read SUPABASE_URL / SUPABASE_KEY from js/config.js')
    return url.group(1).rstrip('/'), key.group(1)


URL, ANON = read_public_config()


def req(method, path, token=None, body=None, params=None, prefer=None):
    """Returns (status, parsed-body-or-text). Never raises on 4xx --
    a refusal IS the result we are testing for."""
    u = f'{URL}{path}'
    if params:
        u += '?' + urllib.parse.urlencode(params)
    headers = {'apikey': ANON, 'Content-Type': 'application/json'}
    headers['Authorization'] = 'Bearer ' + (token or ANON)
    if prefer:
        headers['Prefer'] = prefer
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(u, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, context=CTX) as resp:
            raw = resp.read().decode()
            try:
                return resp.status, json.loads(raw) if raw.strip() else None
            except json.JSONDecodeError:
                return resp.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw) if raw.strip() else None
        except json.JSONDecodeError:
            return e.code, raw


def sign_in(email, password):
    st, body = req('POST', '/auth/v1/token', params={'grant_type': 'password'},
                   body={'email': email, 'password': password})
    if st != 200 or not isinstance(body, dict) or not body.get('access_token'):
        sys.exit(f'could not sign in as {email} ({st}).\n'
                 f'Run:  python3 tools/demo-account.py --apply\n{body}')
    return body['access_token'], body['user']['id']


RESULTS = []


def check(name, passed, detail=''):
    RESULTS.append((name, passed, detail))
    print(('  PASS  ' if passed else '  FAIL  ') + name + (f'   {detail}' if detail else ''))


def main():
    print(f'project: {URL}')
    print(f'key:     {ANON[:18]}…  (publishable, as shipped in js/config.js)')
    print()

    rtok, rid = sign_in(REVIEW_EMAIL, PASSWORD)
    ftok, fid = sign_in(FRIEND_EMAIL, PASSWORD)
    print(f'signed in as {REVIEW_EMAIL}  {rid}')
    print(f'signed in as {FRIEND_EMAIL}  {fid}')
    print()

    # What Sam actually owns, read as Sam. This is the ground truth the
    # rest of the script measures against.
    st, sam_cols = req('GET', '/rest/v1/Collections', token=ftok,
                       params={'select': 'id,name,user_id'})
    sam_owned = [c for c in (sam_cols or []) if c['user_id'] == fid]
    shared = [c for c in sam_owned if c['name'] == 'Road Trip with Sam']
    private = [c for c in sam_owned if c['name'] != 'Road Trip with Sam']
    print(f'Sam owns {len(sam_owned)} collections '
          f'({len(shared)} shared with the reviewer, {len(private)} private)')
    print()

    print('Anonymous (no session) — the weak test, run for completeness:')
    for t in ('Collections', 'Activities', 'Users'):
        st, body = req('GET', f'/rest/v1/{t}', params={'select': 'id'})
        check(f'anon cannot read {t}', st in (401, 403) or body == [],
              f'{st} {json.dumps(body)[:60] if body else ""}')
    print()

    print('Signed in as the reviewer, reaching for Sam:')

    st, cols = req('GET', '/rest/v1/Collections', token=rtok,
                   params={'select': 'id,name,user_id'})
    visible = {c['id'] for c in (cols or [])}
    leaked = [c['name'] for c in private if c['id'] in visible]
    check('cannot see Sam\'s private collections', not leaked,
          ('LEAKED: ' + ', '.join(leaked)) if leaked else '')
    if shared:
        check('CAN see the collection shared with them',
              shared[0]['id'] in visible)

    if private:
        target = private[0]
        st, acts = req('GET', '/rest/v1/Activities', token=rtok,
                       params={'select': 'id,name', 'collection_id': f'eq.{target["id"]}'})
        check('cannot read activities in a private collection',
              st in (401, 403) or acts == [],
              f'{st} got {len(acts) if isinstance(acts, list) else "?"} rows')

        st, body = req('PATCH', '/rest/v1/Collections', token=rtok,
                       params={'id': f'eq.{target["id"]}'},
                       body={'name': 'RLS PROBE — SHOULD NEVER APPEAR'},
                       prefer='return=representation')
        wrote = isinstance(body, list) and len(body) > 0
        check('cannot rename a private collection', not wrote,
              'WROTE IT — data was modified, go and check' if wrote else f'{st}')

        st, body = req('DELETE', '/rest/v1/Collections', token=rtok,
                       params={'id': f'eq.{target["id"]}'},
                       prefer='return=representation')
        killed = isinstance(body, list) and len(body) > 0
        check('cannot delete a private collection', not killed,
              'DELETED IT — data was destroyed' if killed else f'{st}')

    st, users = req('GET', '/rest/v1/Users', token=rtok,
                    params={'select': 'id,username,display_name'})
    others = [u for u in (users or []) if u['id'] != rid]
    check('cannot read other people\'s Users rows (no directory)', not others,
          f'saw {len(others)} other rows' if others else '')

    st, subs = req('GET', '/rest/v1/push_subscriptions', token=rtok,
                   params={'select': 'user_id,endpoint'})
    foreign = [s for s in (subs or []) if s.get('user_id') != rid]
    check('cannot read other devices\' push tokens', not foreign,
          f'saw {len(foreign)}' if foreign else '')

    st, body = req('GET', '/rest/v1/content_reports', token=rtok, params={'select': 'id'})
    check('cannot read content_reports at all',
          st in (401, 403) or body == [], f'{st}')

    st, body = req('GET', '/rest/v1/user_blocks', token=rtok, params={'select': 'blocker_id'})
    foreign = [b for b in (body or []) if b.get('blocker_id') != rid] if isinstance(body, list) else []
    check('cannot read anybody else\'s blocks', not foreign)

    st, body = req('GET', '/rest/v1/invite_claims', token=rtok, params={'select': 'email'})
    check('cannot read invite_claims', st in (401, 403) or body == [], f'{st}')

    print()
    bad = [n for n, ok, _ in RESULTS if not ok]
    if bad:
        print(f'{len(bad)} CHECK(S) FAILED:')
        for n in bad:
            print('  - ' + n)
        print('\nStart with supabase/rls-lockdown.sql, then re-run.')
        sys.exit(1)
    print(f'All {len(RESULTS)} checks passed. RLS is enforcing scope for a '
          f'signed-in user, not just for an anonymous one.')


if __name__ == '__main__':
    main()
