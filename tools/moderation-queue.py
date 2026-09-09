#!/usr/bin/env python3
"""Work the content-report queue.

⚠️ THIS IS WHAT MAKES THE 24-HOUR COMMITMENT TRUE. legal/terms.html
section 6 promises that reports of objectionable content are reviewed
within 24 hours, and Apple's Guideline 1.2 requires that promise before
an app carrying user-generated content ships. Until this existed the
mechanism behind it was "somebody remembers to open the Supabase SQL
editor and run a select by hand" -- which is not a process, and a
promise with no process behind it is worse than no promise: it is an
FTC section 5 problem on its own, and it is the first exhibit in any
negligence claim by somebody who was harmed while a report sat unread.

It does not moderate anything for you. It shows you the queue, shows
you what was reported, and applies the decision you make -- which is
the honest division of labour, because deciding whether something is
harassment is not a thing a script should be doing.

    python3 tools/moderation-queue.py                 # open reports
    python3 tools/moderation-queue.py --all           # include resolved
    python3 tools/moderation-queue.py --show <id>     # one report in full
    python3 tools/moderation-queue.py --resolve <id> --action removed
    python3 tools/moderation-queue.py --resolve <id> --action no-action

⚠️ --resolve WITH --action removed DOES NOT DELETE ANYTHING. It records
your decision. Removing the content is a separate, deliberate step:

    --delete-message <id>     soft-deletes one message (sets deleted_at)

Everything else -- banning an account, deleting a collection -- is done
in the Supabase dashboard, on purpose. A script that can ban accounts is
a script that can ban accounts by accident at 2am.

Reads SUPABASE_URL and SUPABASE_SERVICE_KEY from tools/backfill-config.txt
(gitignored) or the environment, like every other tool here. It needs the
service_role key because content_reports has no select policy at all --
not even for the reporter -- which is deliberate: a readable report
would be a way to retrieve content after its author deleted it.

DRY RUN BY DEFAULT for anything that writes. Add --apply.
"""
import os, sys, json, io, ssl, argparse, urllib.request, urllib.parse, urllib.error
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(HERE, 'backfill-config.txt')

# How long a report may sit before this script shouts about it. The
# terms say 24 hours; 20 gives you four to notice.
WARN_HOURS = 20


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


def load_config():
    """NAME=value lines out of tools/backfill-config.txt into the env.
    Anything already in the real environment wins."""
    if not os.path.exists(CONFIG_FILE):
        return
    with open(CONFIG_FILE) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            name, _, value = line.partition('=')
            name = name.strip()
            value = value.strip().strip('"').strip("'")
            if value and not os.environ.get(name):
                os.environ[name] = value


load_config()
URL = os.environ.get('SUPABASE_URL', '').rstrip('/')
KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')


def req(method, path, params=None, body=None, prefer=None):
    u = f'{URL}/rest/v1{path}'
    if params:
        u += '?' + urllib.parse.urlencode(params)
    headers = {'apikey': KEY, 'Authorization': 'Bearer ' + KEY,
               'Content-Type': 'application/json'}
    if prefer:
        headers['Prefer'] = prefer
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(u, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, context=CTX) as resp:
            raw = resp.read().decode() or '[]'
            return resp.status, (json.loads(raw) if raw.strip() else [])
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def age_hours(iso):
    try:
        t = datetime.fromisoformat(iso.replace('Z', '+00:00'))
        return (datetime.now(timezone.utc) - t).total_seconds() / 3600.0
    except Exception:
        return 0.0


# The one reason that is a legal obligation rather than a preference.
# Kept in step with REPORT_REASONS in js/moderation.js.
URGENT = {'csam'}


def fmt_row(r, wide=False):
    age = age_hours(r.get('created_at', ''))
    flag = ' '
    if r.get('reason') in URGENT:
        flag = '!'
    elif not r.get('reviewed_at') and age > WARN_HOURS:
        flag = '*'
    state = r.get('resolution') or ('open' if not r.get('reviewed_at') else 'reviewed')
    line = (f"{flag} {r.get('id','')[:8]}  {age:6.1f}h  "
            f"{(r.get('reason') or '?'):<12} {(r.get('target_kind') or '?'):<10} {state}")
    if wide:
        snap = (r.get('snapshot') or '').replace('\n', ' ⏎ ')
        line += '\n           ' + snap[:160]
    return line


def cmd_list(args):
    params = {'select': '*', 'order': 'created_at.asc'}
    if not args.all:
        params['reviewed_at'] = 'is.null'
    status, rows = req('GET', '/content_reports', params=params)
    if status == 404:
        sys.exit('content_reports does not exist. Run supabase/moderation.sql.')
    if status >= 400:
        sys.exit(f'{status}: {rows}')
    if not rows:
        print('Queue is empty.' if not args.all else 'No reports at all.')
        return 0

    # Urgent first, then oldest -- which is the order they have to be
    # worked in, not the order they arrived in.
    rows.sort(key=lambda r: (r.get('reason') not in URGENT, r.get('created_at', '')))

    print(f'{len(rows)} report(s).  ! = child-safety, * = past {WARN_HOURS}h\n')
    print('  id        age      reason       kind       state')
    print('  ' + '-' * 62)
    for r in rows:
        print(fmt_row(r, wide=args.wide))

    late = [r for r in rows
            if not r.get('reviewed_at') and age_hours(r.get('created_at', '')) > 24]
    urgent = [r for r in rows if r.get('reason') in URGENT and not r.get('reviewed_at')]
    print()
    if urgent:
        print(f'⚠️  {len(urgent)} CHILD-SAFETY report(s) open. These are reportable to '
              'NCMEC under 18 U.S.C. §2258A — see legal/terms.html §5.')
    if late:
        print(f'⚠️  {len(late)} report(s) older than the 24 hours the terms promise.')
    # Non-zero so this can gate something, or just be noticed in a cron log.
    return 1 if (late or urgent) else 0


def cmd_show(args):
    status, rows = req('GET', '/content_reports',
                       params={'select': '*', 'id': f'eq.{args.show}'})
    if status >= 400:
        sys.exit(f'{status}: {rows}')
    if not rows:
        sys.exit('No such report.')
    print(json.dumps(rows[0], indent=2))
    return 0


def cmd_resolve(args):
    if not args.action:
        sys.exit('--resolve needs --action (removed | no-action | banned)')
    body = {'reviewed_at': datetime.now(timezone.utc).isoformat(),
            'resolution': args.action}
    if not args.apply:
        print(f'DRY RUN — would set {body} on report {args.resolve}')
        print('Add --apply to write it.')
        return 0
    status, out = req('PATCH', '/content_reports',
                      params={'id': f'eq.{args.resolve}'}, body=body,
                      prefer='return=representation')
    if status >= 400:
        sys.exit(f'{status}: {out}')
    print(f'Report {args.resolve} → {args.action}')
    return 0


def cmd_delete_message(args):
    """Soft delete, matching what the app does. The thread does not
    reflow under somebody mid-read, and the select filters it out."""
    body = {'deleted_at': datetime.now(timezone.utc).isoformat()}
    if not args.apply:
        print(f'DRY RUN — would soft-delete message {args.delete_message}')
        print('Add --apply to write it.')
        return 0
    status, out = req('PATCH', '/messages',
                      params={'id': f'eq.{args.delete_message}'}, body=body,
                      prefer='return=representation')
    if status >= 400:
        sys.exit(f'{status}: {out}')
    if not out:
        sys.exit('No such message (or it was already deleted).')
    print(f'Message {args.delete_message} soft-deleted.')
    return 0


def main():
    p = argparse.ArgumentParser(description='Work the content-report queue.')
    p.add_argument('--all', action='store_true', help='include resolved reports')
    p.add_argument('--wide', action='store_true', help='show the snapshot inline')
    p.add_argument('--show', metavar='ID', help='one report, in full')
    p.add_argument('--resolve', metavar='ID', help='mark a report reviewed')
    p.add_argument('--action', choices=['removed', 'no-action', 'banned'],
                   help='what you decided')
    p.add_argument('--delete-message', metavar='ID', help='soft-delete a message')
    p.add_argument('--apply', action='store_true', help='actually write')
    args = p.parse_args()

    missing = [n for n, v in (('SUPABASE_URL', URL), ('SUPABASE_SERVICE_KEY', KEY)) if not v]
    if missing:
        sys.exit('Missing: ' + ', '.join(missing) +
                 f'\nSet them in {CONFIG_FILE} or the environment.')

    if args.show:
        return cmd_show(args)
    if args.resolve:
        return cmd_resolve(args)
    if args.delete_message:
        return cmd_delete_message(args)
    return cmd_list(args)


if __name__ == '__main__':
    sys.exit(main())
