#!/usr/bin/env python3
"""Build (or tear down) the App Review demo account.

App Review needs credentials, because this app is entirely behind an
auth wall. Two things make a reviewer's account different from an
ordinary one, and both are why this script exists rather than a note
saying "go and sign up":

  1. EMAIL CONFIRMATION IS ON for this project. A reviewer who signs up
     normally has to go and find a confirmation email in an inbox they
     do not have. That is the likeliest single cause of a Guideline 2.1
     rejection here. The Admin API can create a user with
     email_confirm=true, which nothing in the app can do.

  2. AN EMPTY ACCOUNT REVIEWS BADLY. Half the app is invisible without
     data -- the map has no pins, Up Next is empty, the Accomplished
     screen is empty, and the whole Guideline 1.2 surface (a shared
     list, a conversation, the report and block controls) cannot be
     reached at all, because reporting and blocking only exist on
     somebody ELSE's message. So this seeds two accounts and shares a
     list between them.

Usage:
    python3 tools/demo-account.py                  # dry run, reports only
    python3 tools/demo-account.py --apply          # create it
    python3 tools/demo-account.py --destroy        # remove both accounts
    python3 tools/demo-account.py --destroy --apply

Credentials come from tools/backfill-config.txt (gitignored), the same
file the other two tools read. Only SUPABASE_URL and
SUPABASE_SERVICE_KEY are used.

⚠️ THIS WRITES TO THE LIVE PROJECT. There is no separate review
environment. Dry run is the default for that reason; --apply is the
only thing that touches anything.

Re-running with --apply is safe: both accounts are deleted and rebuilt,
so the demo data is always exactly what this file says it is. That
matters more than it sounds -- a reviewer who marks something
accomplished changes the account, and a resubmission months later
should not show them somebody else's half-finished state.

Stdlib only, like media-backfill.py.
"""
import os, sys, json, uuid, datetime, urllib.request, urllib.parse, urllib.error, ssl

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backfill-config.txt')

# ---------------------------------------------------------------- accounts
#
# ⚠️ CHANGE THESE TO AN ADDRESS YOU CONTROL BEFORE RUNNING.
# They never receive mail -- the accounts are created pre-confirmed and
# the password is set here -- but the address is what goes in the App
# Store Connect review notes, and a reviewer occasionally tries a
# password reset. An address that bounces is a bad look on the one
# account Apple actually reads.
REVIEW_EMAIL    = 'appreview@somedaywelldie.app'
REVIEW_PASSWORD = 'ReviewDemo!2026'
REVIEW_NAME     = 'Alex Reviewer'
REVIEW_USERNAME = 'alexreviewer'

# The other person in the shared list. A conversation needs somebody to
# have said something, and report/block are only offered on a message
# that is not yours -- so without this second account the entire
# Guideline 1.2 surface is unreachable and a reviewer looking for it
# concludes it is not there.
FRIEND_EMAIL    = 'sam@somedaywelldie.app'
FRIEND_PASSWORD = 'ReviewDemo!2026'
FRIEND_NAME     = 'Sam Okonkwo'
FRIEND_USERNAME = 'samokonkwo'

HOME_PLACE = ('Denver, Colorado', 39.7392, -104.9903)

COVERS = [
    'https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=1600&q=90',
    'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=1600&q=90',
    'https://images.unsplash.com/photo-1528164344705-47542687000d?w=1600&q=90',
    'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1600&q=90',
]


def _ssl_context():
    """Same trade media-backfill.py makes: find a CA bundle rather than
    require one, and never fall back to an unverified connection -- this
    call carries a service_role key."""
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
    if not os.path.exists(CONFIG_PATH):
        sys.exit(f'missing {CONFIG_PATH}\n'
                 f'copy tools/backfill-config.example.txt to it and fill it in')
    cfg = {}
    with open(CONFIG_PATH, encoding='utf-8') as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            cfg[k.strip()] = v.strip()
    missing = [k for k in ('SUPABASE_URL', 'SUPABASE_SERVICE_KEY') if not cfg.get(k)]
    if missing:
        sys.exit(f'{CONFIG_PATH} is missing: {", ".join(missing)}')
    cfg['SUPABASE_URL'] = cfg['SUPABASE_URL'].rstrip('/')
    return cfg


def call(cfg, method, path, body=None, params=None, prefer=None):
    url = f'{cfg["SUPABASE_URL"]}{path}'
    if params:
        url += '?' + urllib.parse.urlencode(params)
    data = json.dumps(body).encode() if body is not None else None
    headers = {
        'apikey': cfg['SUPABASE_SERVICE_KEY'],
        'Authorization': 'Bearer ' + cfg['SUPABASE_SERVICE_KEY'],
        'Content-Type': 'application/json',
    }
    if prefer:
        headers['Prefer'] = prefer
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, context=CTX) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw.strip() else None
    except urllib.error.HTTPError as e:
        detail = e.read().decode()
        raise SystemExit(f'{method} {path} -> {e.code}\n{detail}')


# ---------------------------------------------------------------- helpers

def iso(d):
    return d.strftime('%Y-%m-%d')


def find_user(cfg, email):
    """The Admin API has no 'get by email', so page the list. Fine at
    this project's size and it is only ever two addresses."""
    page = 1
    while page < 20:
        got = call(cfg, 'GET', '/auth/v1/admin/users',
                   params={'page': page, 'per_page': 200})
        users = (got or {}).get('users', [])
        if not users:
            return None
        for u in users:
            if (u.get('email') or '').lower() == email.lower():
                return u
        page += 1
    return None


def create_user(cfg, email, password, name, username):
    """email_confirm=true is the whole reason this is an admin call.
    The name and username go on user_metadata because that is where
    profileSeed() in js/me.js looks when it repairs a missing profile
    row -- so the account behaves like one made through the app."""
    return call(cfg, 'POST', '/auth/v1/admin/users', body={
        'email': email,
        'password': password,
        'email_confirm': True,
        'user_metadata': {'display_name': name, 'username': username},
    })


def delete_user(cfg, uid):
    call(cfg, 'DELETE', f'/auth/v1/admin/users/{uid}')


# ---------------------------------------------------------------- the data

def build_rows(review_id, friend_id):
    """Everything the two accounts own, as plain dicts ready to POST.

    Shaped to exercise the screens a reviewer will actually open:
      - enough LOCATED activities that the Map tab has pins in more
        than one place;
      - a spread of target dates so Up Next has something in each
        urgency band rather than one flat list;
      - completed rows WITH photos, so the Accomplished screen and the
        completion sheet are not empty;
      - all three difficulty tiers, so the three derived lists on the
        Lists tab are populated -- they read as broken when they are
        empty, which is exactly what an un-seeded account shows.
    """
    today = datetime.date.today()
    cols, acts = [], []

    def col(name, desc, cover, owner=review_id):
        cid = str(uuid.uuid4())
        cols.append({
            'id': cid, 'name': name, 'description': desc,
            'cover_image': cover, 'user_id': owner,
        })
        return cid

    def act(cid, name, **kw):
        row = {
            'id': str(uuid.uuid4()), 'collection_id': cid, 'name': name,
            'priority': kw.get('priority', 'medium'),
            'target_date': kw.get('target', ''),
            'date_completed': kw.get('done'),
            'location': kw.get('place', ''),
            'location_lat': kw.get('lat'),
            'location_lng': kw.get('lng'),
            'difficulty': kw.get('diff'),
            'photos': kw.get('photos', []),
            'links': kw.get('links', []),
            'experience_notes': kw.get('notes', ''),
        }
        acts.append(row)
        return row['id']

    # ---- A trip, mostly ahead of them -------------------------------
    japan = col('Japan 2027', 'Two weeks in spring, cherry blossoms if we time it.', COVERS[0])
    act(japan, 'Walk the Fushimi Inari gates at sunrise',
        priority='high', target=iso(today + datetime.timedelta(days=210)),
        place='Fushimi Inari Taisha, Kyoto, Japan', lat=34.9671, lng=135.7727, diff='hard')
    act(japan, 'Stay a night in a ryokan with an onsen',
        priority='high', target=iso(today + datetime.timedelta(days=210)),
        place='Hakone, Kanagawa, Japan', lat=35.2324, lng=139.1069, diff='hard')
    act(japan, 'Eat at a standing sushi bar in Tokyo',
        priority='medium', target=iso(today + datetime.timedelta(days=212)),
        place='Tsukiji, Tokyo, Japan', lat=35.6654, lng=139.7707, diff='hard')
    act(japan, 'Learn enough Japanese to order dinner',
        priority='medium', target=iso(today + datetime.timedelta(days=150)),
        place='Denver, Colorado', lat=39.7392, lng=-104.9903, diff='hard')

    # ---- Close to home, so Distance and the Easy list have content ---
    home = col('Around Denver', 'Small things, most of them a weekend.', COVERS[1])
    act(home, 'Try the new ramen place on Federal',
        priority='low', target=iso(today + datetime.timedelta(days=12)),
        place='Federal Boulevard, Denver, Colorado', lat=39.7420, lng=-105.0250, diff='easy')
    act(home, 'Hike Mount Falcon before it gets hot',
        priority='medium', target=iso(today + datetime.timedelta(days=26)),
        place='Mount Falcon Park, Morrison, Colorado', lat=39.6469, lng=-105.2178, diff='medium')
    act(home, 'Finally clear out the garage',
        priority='low', target=iso(today + datetime.timedelta(days=40)),
        place='Denver, Colorado', lat=39.7392, lng=-104.9903, diff='easy')
    # Overdue on purpose: the red urgency band is a real state and a
    # reviewer should see the app in it.
    act(home, 'Renew the national parks pass',
        priority='high', target=iso(today - datetime.timedelta(days=6)),
        place='Denver, Colorado', lat=39.7392, lng=-104.9903, diff='easy')

    # ---- Done, with photos ------------------------------------------
    done = col('Already Done', 'The ones that happened.', COVERS[2])
    act(done, 'Watch the sunrise from Haleakala',
        priority='medium', done=iso(today - datetime.timedelta(days=48)),
        place='Haleakala National Park, Hawaii', lat=20.7097, lng=-156.2533, diff='hard',
        photos=[COVERS[3]],
        notes='Freezing at the top and worth every minute of the drive up in the dark.')
    act(done, 'Swim in the Adriatic',
        priority='low', done=iso(today - datetime.timedelta(days=120)),
        place='Dubrovnik, Croatia', lat=42.6507, lng=18.0944, diff='hard',
        photos=[COVERS[0]],
        notes='Water clearer than it had any right to be.')
    act(done, 'Run a half marathon',
        priority='high', done=iso(today - datetime.timedelta(days=15)),
        place='Denver, Colorado', lat=39.7392, lng=-104.9903, diff='medium',
        photos=[COVERS[1]], notes='Slower than I wanted. Still counts.')

    # ---- The SHARED list, owned by the friend ------------------------
    #
    # Owned by Sam, not by the reviewer, and that is deliberate. Leave,
    # Report and Block are drawn for a MEMBER; an owner sees Delete and
    # Share instead. The reviewer is looking for the 1.2 controls, so
    # they have to be standing in the role that has them.
    trip = col('Road Trip with Sam', 'Utah, five days, one car.', COVERS[3], owner=friend_id)
    a_arches = act(trip, 'Sunrise at Delicate Arch',
                   priority='high', target=iso(today + datetime.timedelta(days=64)),
                   place='Arches National Park, Utah', lat=38.7331, lng=-109.5925, diff='medium')
    act(trip, 'Drive the Burr Trail switchbacks',
        priority='medium', target=iso(today + datetime.timedelta(days=65)),
        place='Boulder, Utah', lat=37.9105, lng=-111.4249, diff='medium')
    act(trip, 'Book the campsite the day reservations open',
        priority='high', target=iso(today + datetime.timedelta(days=30)),
        place='Moab, Utah', lat=38.5733, lng=-109.5498, diff='easy')

    return cols, acts, trip, a_arches


def build_messages(trip_id, review_id, friend_id, arches_id):
    """A conversation with the OTHER person speaking first and last.

    Report and block are only offered on somebody else's message, so a
    thread the reviewer wrote all of would show neither control. The
    last word is Sam's so the newest row in the list is reportable."""
    now = datetime.datetime.now(datetime.timezone.utc)

    def at(mins):
        return (now - datetime.timedelta(minutes=mins)).isoformat()

    return [
        {'id': str(uuid.uuid4()), 'collection_id': trip_id, 'sender_id': friend_id,
         'sender_name': FRIEND_NAME, 'body': 'Added the Utah list. Five days should be plenty.',
         'activity_ids': [], 'created_at': at(240)},
        {'id': str(uuid.uuid4()), 'collection_id': trip_id, 'sender_id': review_id,
         'sender_name': REVIEW_NAME, 'body': 'Perfect. I can drive the first leg.',
         'activity_ids': [], 'created_at': at(180)},
        {'id': str(uuid.uuid4()), 'collection_id': trip_id, 'sender_id': friend_id,
         'sender_name': FRIEND_NAME,
         'body': 'Sunrise at Delicate Arch means leaving at 4am. Still in?',
         'activity_ids': [arches_id], 'created_at': at(90)},
        {'id': str(uuid.uuid4()), 'collection_id': trip_id, 'sender_id': review_id,
         'sender_name': REVIEW_NAME, 'body': 'In. Bringing coffee.',
         'activity_ids': [], 'created_at': at(45)},
        {'id': str(uuid.uuid4()), 'collection_id': trip_id, 'sender_id': friend_id,
         'sender_name': FRIEND_NAME,
         'body': 'Reservations open the 1st. I set a reminder on that one.',
         'activity_ids': [], 'created_at': at(10)},
    ]


# ---------------------------------------------------------------- run

def destroy(cfg, apply):
    for email in (REVIEW_EMAIL, FRIEND_EMAIL):
        u = find_user(cfg, email)
        if not u:
            print(f'  {email:38s} not present')
            continue
        print(f'  {email:38s} {"DELETING" if apply else "would delete"}  {u["id"]}')
        if apply:
            # Collections, Activities, members and messages all reference
            # auth.users with on-delete cascade, so this takes the data
            # with it. See supabase/*.sql.
            delete_user(cfg, u['id'])


def create(cfg, apply):
    existing = [e for e in (REVIEW_EMAIL, FRIEND_EMAIL) if find_user(cfg, e)]
    if existing:
        print('  already present, will be rebuilt: ' + ', '.join(existing))
        destroy(cfg, apply)

    if not apply:
        print(f'  would create {REVIEW_EMAIL} (pre-confirmed) and {FRIEND_EMAIL}')
        cols, acts, _, _ = build_rows('<review-uid>', '<friend-uid>')
        print(f'  would seed {len(cols)} collections and {len(acts)} activities')
        print(f'  would share "Road Trip with Sam" and seed 5 messages')
        return

    review = create_user(cfg, REVIEW_EMAIL, REVIEW_PASSWORD, REVIEW_NAME, REVIEW_USERNAME)
    friend = create_user(cfg, FRIEND_EMAIL, FRIEND_PASSWORD, FRIEND_NAME, FRIEND_USERNAME)
    rid, fid = review['id'], friend['id']
    print(f'  created {REVIEW_EMAIL}  {rid}')
    print(f'  created {FRIEND_EMAIL}  {fid}')

    # The profile rows. profiles.sql installs a trigger that writes these
    # on sign-up, so they may already exist -- merge-duplicates makes
    # this work either way, and fills in the parts the trigger does not
    # know about (Home, and the terms acceptance).
    place, lat, lng = HOME_PLACE
    call(cfg, 'POST', '/rest/v1/Users', prefer='resolution=merge-duplicates', body=[
        {'id': rid, 'display_name': REVIEW_NAME, 'username': REVIEW_USERNAME,
         'home_location': place, 'home_lat': lat, 'home_lng': lng,
         'terms_accepted_at': datetime.datetime.now(datetime.timezone.utc).isoformat()},
        {'id': fid, 'display_name': FRIEND_NAME, 'username': FRIEND_USERNAME,
         'terms_accepted_at': datetime.datetime.now(datetime.timezone.utc).isoformat()},
    ])
    print('  profiles written')

    cols, acts, trip_id, arches_id = build_rows(rid, fid)
    call(cfg, 'POST', '/rest/v1/Collections', body=cols)
    call(cfg, 'POST', '/rest/v1/Activities', body=acts)
    print(f'  seeded {len(cols)} collections, {len(acts)} activities')

    # Membership. join_collection() is the only path the CLIENT has, by
    # design -- collection_members deliberately has no INSERT policy.
    # service_role bypasses RLS, so the row goes in directly here.
    call(cfg, 'POST', '/rest/v1/collection_members', body=[{
        'collection_id': trip_id, 'user_id': rid,
        'role': 'member', 'display_name': REVIEW_NAME,
    }])
    msgs = build_messages(trip_id, rid, fid, arches_id)
    call(cfg, 'POST', '/rest/v1/messages', body=msgs)
    print(f'  shared "Road Trip with Sam" and seeded {len(msgs)} messages')


def main():
    args = set(sys.argv[1:])
    apply = '--apply' in args
    cfg = load_config()

    print(f'project: {cfg["SUPABASE_URL"]}')
    print('mode:    ' + ('APPLY (writes)' if apply else 'dry run (reports only)'))
    print()

    if '--destroy' in args:
        print('Removing the demo accounts:')
        destroy(cfg, apply)
    else:
        print('Building the demo account:')
        create(cfg, apply)

    print()
    if not apply:
        print('Nothing was written. Re-run with --apply.')
    elif '--destroy' not in args:
        print('Put these in App Store Connect -> App Review Information:')
        print(f'  Email:    {REVIEW_EMAIL}')
        print(f'  Password: {REVIEW_PASSWORD}')


if __name__ == '__main__':
    main()
