#!/usr/bin/env python3
"""Rate every un-rated activity, by asking Claude, and write a CSV.

This is the missing half of the difficulty backfill. `difficulty` is only
ever written at capture, so every activity created before that feature
existed is un-rated: it sorts last under the Difficulty sort and appears
in none of the three derived lists. tools/difficulty-backfill.py already
turns a CSV of ratings into one UPDATE -- it just had no way to PRODUCE
that CSV. This produces it.

    python3 tools/difficulty-rate.py                 # dry run, rates 10
    python3 tools/difficulty-rate.py --limit 40      # rate 40, still a dry run
    python3 tools/difficulty-rate.py --apply         # rate everything -> ratings.csv
    python3 tools/difficulty-backfill.py ratings.csv > backfill.sql

Then paste backfill.sql into the Supabase SQL editor. Nothing here ever
writes to the database; the two steps are separate precisely so the
ratings can be read -- and edited -- before any of them land.

WHY THE PROMPT IS COPIED AND NOT IMPORTED
-----------------------------------------
The criteria below are PART TWO of PLACE_SYSTEM in
supabase/functions/unfurl/index.ts, copied so a backfilled rating is
judged by the same three costs -- distance, time, money -- as one the app
infers live. It is a COPY, which means it can drift: if that prompt is
retuned and this is not, the library ends up rated by two different
standards and the sort silently stops meaning one thing. Re-copy Part Two
whenever you touch it. It is not imported because that file is Deno
TypeScript running as an Edge Function, and reaching it from here would
mean either deploying a variant of it or standing up a JWT to call it
once per activity.

⚠️ THE MODEL IS NOT THE SAME ONE THE APP USES. The app rates at capture
with Haiku, because that call happens while somebody is watching an empty
field. This is a one-off over a few hundred rows with nobody waiting, so
it defaults to the stronger model; --model switches it. The consequence
worth knowing: ratings produced here become the EXAMPLES the app sends
back to Haiku on every later capture (see "Rating for one person" in
CLAUDE.md), so this run sets the calibration everything after it is
judged against. That is an argument for letting the better model do it,
and an argument for reading the output before applying it.

WHOSE HOME, WHOSE PROFILE
-------------------------
Difficulty is relative to the person: "a few hours away" means nothing
without a home to measure from, and the paragraph in You -> About you
moves a rating in either direction. So activities are grouped by the
OWNER of the collection they live in, and each group is rated with that
user's home address and profile. A shared project with several accounts
in it therefore costs one pass per account, which is correct -- the same
activity is genuinely not equally hard for two people.

RAW HTTP, NOT THE SDK
---------------------
Deliberate, and a deviation from the usual advice to use the official
`anthropic` package. The other two scripts in tools/ are stdlib-only, run
straight from a checkout with nothing installed, and this repo has no
build step and no Python dependencies at all. One `pip install` for a
one-off script is not worth ending that. If this ever grows past a single
request shape, install the SDK and rewrite it -- do not mix the two.
"""
import argparse, csv, json, os, ssl, sys, time, urllib.error, urllib.parse, urllib.request

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backfill-config.txt')

ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
API_VERSION   = '2023-06-01'
DEFAULT_MODEL = 'claude-opus-5'
TIERS         = ('easy', 'medium', 'hard')

# How many activities go in one request. Small enough that a malformed
# answer costs little to redo, large enough that a few hundred rows is a
# handful of calls rather than a few hundred.
BATCH = 25

# ⚠️ Items are numbered and the model answers with the NUMBER, never the
# uuid. Asking it to echo a 36-character id back is a transcription task
# with nothing to gain -- one wrong character silently rates the wrong
# activity, or none at all.
SCHEMA = {
    'type': 'object',
    'properties': {
        'ratings': {
            'type': 'array',
            'items': {
                'type': 'object',
                'properties': {
                    'n':          {'type': 'integer', 'description': 'The number of the activity being rated.'},
                    'difficulty': {'type': 'string', 'enum': list(TIERS)},
                },
                'required': ['n', 'difficulty'],
                'additionalProperties': False,
            },
        },
    },
    'required': ['ratings'],
    'additionalProperties': False,
}

SYSTEM = """You rate how hard an activity would be for one particular person to
actually do. This is PART TWO of the rating prompt used by the app itself, applied
here to a batch of activities at once rather than to one at a time.

Always answer for every activity. There is no "unsure" option: every activity gets
easy, medium or hard. A rough answer is useful and a missing one is not.

Judge the whole cost of actually doing it, from where the user lives. Three things
decide it, and they trade against each other:

- **Distance from home.** The home address is given when it is known. Near home is
  easy; a drive is medium; a flight, a passport or a different continent is hard.
  With no home address given, judge distance as an average person would.
- **Time.** Not the duration of the thing itself -- the time it takes to become able
  to do it. An evening is easy. A weekend, a booking or a bit of training is medium.
  Months of practice, saving or planning is hard.
- **Money.** Pocket money is easy. A few hundred is medium. Thousands, or gear you
  would have to buy, is hard.

Any one of the three being hard makes it hard. Something is easy only when all three
are small.

## Worked examples, for a user whose home is Denver, Colorado

  "Try the new ramen place downtown"    -> easy    (minutes away, one meal)
  "Go to a Rockies game"                -> easy    (in town, one evening)
  "Learn Japanese"                      -> hard    (at home, and years of it)
  "Learn to play the piano"             -> hard    (no travel, enormous time)
  "Hike a fourteener"                   -> medium  (a few hours' drive, one day)
  "Bike the Katy Trail"                 -> medium  (a drive and a weekend)
  "Get scuba certified"                 -> medium  (a course, a few hundred dollars)
  "Hike across Norway"                  -> hard    (a flight, weeks, real money)
  "See the pyramids"                    -> hard    (long haul, real money)
  "Run a marathon"                      -> hard    (months of training)
  "Read Ulysses"                        -> medium  (free, but weeks of evenings)

Note what the first two and the third have in common: all three happen where the user
already is. Distance is only one of the three, and time alone is enough to make
something hard.

## When the user tells you about themselves, they outrank the examples above

The message may carry two extra things.

**About the user** -- a sentence or two they wrote about their own life: no car, a
tight budget, hikes every weekend, will not fly. Read it as fact and let it move a
rating in either direction. Someone who hikes every weekend finds a fourteener easy;
someone with no car finds a two-hour drive hard.

**Their own rated activities** -- items already on their list with the tier each one
carries, drawn from all three tiers so you can see where this person's lines actually
fall. These are the calibration. When one of them disagrees with the Denver examples
above, follow theirs: those are generic and these are the user's.

Do not simply copy a tier from the nearest-looking example, and do not assume an
activity must be a tier that is under-represented in the sample. Judge each activity
on the three costs, with their lines rather than an average person's.

## Answering a batch

You are given a numbered list. Return one rating for every number, using the number
you were given. Judge each activity on its own -- their order carries no meaning, and
a batch is not required to contain a spread of tiers."""


# ---------------------------------------------------------------- config

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
    missing = [k for k in ('SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'ANTHROPIC_API_KEY')
               if not cfg.get(k)]
    # The key may also be in the environment, which is where it usually is.
    if 'ANTHROPIC_API_KEY' in missing and os.environ.get('ANTHROPIC_API_KEY'):
        cfg['ANTHROPIC_API_KEY'] = os.environ['ANTHROPIC_API_KEY']
        missing.remove('ANTHROPIC_API_KEY')
    if missing:
        sys.exit(f'{CONFIG_PATH} is missing: {", ".join(missing)}')
    cfg['SUPABASE_URL'] = cfg['SUPABASE_URL'].rstrip('/')
    return cfg


# -------------------------------------------------------------- supabase

def sb_get(cfg, path, params):
    url = f'{cfg["SUPABASE_URL"]}/rest/v1/{path}?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={
        'apikey': cfg['SUPABASE_SERVICE_KEY'],
        'Authorization': f'Bearer {cfg["SUPABASE_SERVICE_KEY"]}',
        'Accept': 'application/json',
    })
    with urllib.request.urlopen(req, context=ssl.create_default_context(), timeout=60) as r:
        return json.loads(r.read().decode('utf-8'))


def fetch_unrated(cfg, limit):
    """Un-rated activities, each with the user_id of the collection it lives in.

    Completed activities are included deliberately: the three derived lists
    show finished rows too, and a library where only the pending half is
    rated reads as though the ratings are missing at random."""
    params = {
        'select': 'id,name,collection_id,Collections(user_id)',
        'difficulty': 'is.null',
        'order': 'created_at.desc',
    }
    if limit:
        params['limit'] = str(limit)
    rows = sb_get(cfg, 'Activities', params)
    out = []
    for r in rows:
        name = (r.get('name') or '').strip()
        coll = r.get('Collections') or {}
        uid = coll.get('user_id') if isinstance(coll, dict) else None
        # A row with no name has nothing to judge, and one whose collection
        # has gone has nobody to judge it for.
        if len(name) < 3 or not uid:
            continue
        out.append({'id': r['id'], 'name': name, 'uid': uid})
    return out


def fetch_user(cfg, uid):
    """Home and profile, both optional -- either column may not exist yet."""
    for cols in ('id,home_location,difficulty_profile', 'id,home_location', 'id'):
        try:
            rows = sb_get(cfg, 'Users', {'select': cols, 'id': f'eq.{uid}', 'limit': '1'})
            if rows:
                return {'home': (rows[0].get('home_location') or '').strip(),
                        'profile': (rows[0].get('difficulty_profile') or '').strip()}
            return {'home': '', 'profile': ''}
        except urllib.error.HTTPError as e:
            if e.code == 400:       # a column this project does not have
                continue
            raise
    return {'home': '', 'profile': ''}


def fetch_examples(cfg, uid, per_tier=6):
    """The user's OWN ratings, balanced across the three tiers.

    The same rule js/location.js follows and for the same reason: a sample
    that is twelve `easy` rows teaches a lean, not a scale. A first run has
    none of these and the model judges on the Denver examples alone, which
    is exactly what the app did before any of this existed."""
    out = []
    for tier in TIERS:
        try:
            rows = sb_get(cfg, 'Activities', {
                'select': 'name,difficulty,Collections(user_id)',
                'difficulty': f'eq.{tier}',
                'Collections.user_id': f'eq.{uid}',
                'order': 'created_at.desc',
                'limit': str(per_tier * 3),
            })
        except urllib.error.HTTPError:
            return []
        kept = 0
        for r in rows:
            coll = r.get('Collections') or {}
            if not isinstance(coll, dict) or coll.get('user_id') != uid:
                continue
            name = (r.get('name') or '').strip()
            if len(name) < 3:
                continue
            out.append({'name': name[:120], 'difficulty': tier})
            kept += 1
            if kept >= per_tier:
                break
    return out


# ------------------------------------------------------------- anthropic

def ask(cfg, model, effort, items, home, profile, examples, retries=4):
    """One batch -> {index: tier}. Raises on anything it cannot parse."""
    lines = []
    if home:
        lines.append(f'Home: {home}')
    if profile:
        lines.append(f'About the user: {profile}')
    if examples:
        ex = '\n'.join(f'  {json.dumps(e["name"])} -> {e["difficulty"]}' for e in examples)
        lines.append(f'Activities this user has already rated:\n{ex}')
    numbered = '\n'.join(f'  {i + 1}. {it["name"]}' for i, it in enumerate(items))
    lines.append(f'Rate each of these {len(items)} activities:\n{numbered}')

    body = json.dumps({
        'model': model,
        'max_tokens': 4000,
        'system': SYSTEM,
        # `low` matches what the app uses at capture. The prompt does the
        # work here -- the three costs and the worked examples decide the
        # answer, not depth of deliberation.
        'output_config': {'effort': effort,
                          'format': {'type': 'json_schema', 'schema': SCHEMA}},
        'messages': [{'role': 'user', 'content': '\n\n'.join(lines)}],
    }).encode('utf-8')

    last = None
    for attempt in range(retries):
        req = urllib.request.Request(ANTHROPIC_URL, data=body, headers={
            'x-api-key': cfg['ANTHROPIC_API_KEY'],
            'anthropic-version': API_VERSION,
            'content-type': 'application/json',
        })
        try:
            with urllib.request.urlopen(req, context=ssl.create_default_context(),
                                        timeout=300) as r:
                res = json.loads(r.read().decode('utf-8'))
            break
        except urllib.error.HTTPError as e:
            detail = e.read().decode('utf-8', 'replace')[:400]
            last = f'HTTP {e.code}: {detail}'
            # 429 and 5xx are worth another go; a 400 is a bug in this file.
            if e.code not in (408, 409, 429) and e.code < 500:
                raise SystemExit(f'anthropic rejected the request -- {last}')
        except (urllib.error.URLError, TimeoutError) as e:
            last = str(e)
        time.sleep(2 ** attempt)
    else:
        raise RuntimeError(f'gave up after {retries} attempts -- {last}')

    # A refusal is a real outcome and must not be read as content.
    if res.get('stop_reason') == 'refusal':
        raise RuntimeError('the model declined to answer this batch')

    text = next((b.get('text', '') for b in res.get('content', [])
                 if b.get('type') == 'text'), '')
    if not text:
        raise RuntimeError('no text block in the response')
    parsed = json.loads(text)

    out = {}
    for row in parsed.get('ratings', []):
        n, tier = row.get('n'), row.get('difficulty')
        # Out-of-range and unknown tiers are dropped rather than guessed at
        # -- a wrong rating files an activity into the wrong list, and the
        # whole point of the three lists is that they can be trusted.
        if isinstance(n, int) and 1 <= n <= len(items) and tier in TIERS:
            out[n - 1] = tier
    return out, res.get('usage', {})


# ------------------------------------------------------------------ main

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--apply', action='store_true',
                    help='rate everything and write the CSV (default: 10 rows, printed)')
    ap.add_argument('--limit', type=int, default=None,
                    help='cap how many activities are rated')
    ap.add_argument('--out', default='ratings.csv', help='CSV to write (with --apply)')
    ap.add_argument('--model', default=DEFAULT_MODEL, help=f'default {DEFAULT_MODEL}')
    ap.add_argument('--effort', default='low',
                    choices=('low', 'medium', 'high', 'xhigh', 'max'))
    args = ap.parse_args()

    cfg = load_config()
    limit = args.limit if args.limit is not None else (None if args.apply else 10)

    acts = fetch_unrated(cfg, limit)
    if not acts:
        print('nothing to do -- every activity already has a rating')
        return
    print(f'{len(acts)} un-rated activit{"y" if len(acts) == 1 else "ies"}'
          f'{"" if args.apply else "  (dry run)"}', file=sys.stderr)

    by_uid = {}
    for a in acts:
        by_uid.setdefault(a['uid'], []).append(a)

    rated, failed = [], 0
    tokens_in = tokens_out = 0
    for uid, mine in by_uid.items():
        user = fetch_user(cfg, uid)
        examples = fetch_examples(cfg, uid)
        print(f'\nuser {uid[:8]}...  {len(mine)} to rate'
              f'  home={user["home"] or "(none)"}'
              f'  profile={"yes" if user["profile"] else "no"}'
              f'  examples={len(examples)}', file=sys.stderr)

        for i in range(0, len(mine), BATCH):
            chunk = mine[i:i + BATCH]
            try:
                got, usage = ask(cfg, args.model, args.effort, chunk,
                                 user['home'], user['profile'], examples)
            except (RuntimeError, json.JSONDecodeError) as e:
                # One bad batch must not cost the whole run: the rows it
                # covered stay un-rated and are picked up next time, because
                # every read here is "difficulty is null".
                print(f'  batch {i // BATCH + 1}: {e}  -- skipped', file=sys.stderr)
                failed += len(chunk)
                continue
            tokens_in  += usage.get('input_tokens', 0)
            tokens_out += usage.get('output_tokens', 0)
            for n, act in enumerate(chunk):
                if n in got:
                    rated.append((act['id'], got[n], act['name']))
                else:
                    failed += 1
            print(f'  batch {i // BATCH + 1}: {len(got)}/{len(chunk)}', file=sys.stderr)

    counts = {t: sum(1 for r in rated if r[1] == t) for t in TIERS}
    print(f'\nrated {len(rated)}   '
          + '  '.join(f'{t}={counts[t]}' for t in TIERS)
          + (f'   unrated={failed}' if failed else ''), file=sys.stderr)
    print(f'tokens: {tokens_in} in, {tokens_out} out', file=sys.stderr)

    if not args.apply:
        print('\n--- dry run, nothing written. sample: ---', file=sys.stderr)
        for aid, tier, name in rated[:20]:
            print(f'  {tier:<7} {name[:64]}')
        print('\nrerun with --apply to rate everything and write the CSV.', file=sys.stderr)
        return

    with open(args.out, 'w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh)
        w.writerow(['id', 'difficulty', 'name'])
        for aid, tier, name in rated:
            w.writerow([aid, tier, name])
    print(f'\nwrote {args.out}', file=sys.stderr)
    print(f'next:  python3 tools/difficulty-backfill.py {args.out} > backfill.sql',
          file=sys.stderr)


if __name__ == '__main__':
    main()
