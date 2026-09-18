/* ==============================================================
   send-activity-push — everyone else on a shared list hears that
   something got ticked off.

   ---- Why this is a sibling of send-message-push and not a branch ----

   The two answer the same shape of question (something happened in a
   shared list, tell the others) and they verify entirely different
   things, which is where the code would have forked immediately
   anyway. Keeping them apart also keeps each one's refusal simple:
   a message is announced by its author, a completion by whoever is
   holding the phone.

   ---- What the client is NOT trusted for ----

   It sends an activity id and nothing else. The name, the list, who is
   in it and whether the thing is actually completed are all read back
   here with the service role. The person it is attributed to is taken
   from the JWT, never from the body — so a caller cannot announce a
   completion in somebody else's name.

   ---- The one check that is not available, and what stands in ----

   send-message-push can refuse when msg.sender_id !== caller.id.
   There is no equivalent here: an activity row does not record who
   completed it, because any member of a shared list may tick anything
   in it off and the app has never needed to know which one did.
   Without a stand-in, "announce activity X" is a button any member can
   hold down.

   The stand-in is activity_completion_pushes: one row per
   (activity_id, completed_on), inserted before anything is sent. A
   second call finds the row and returns `skipped: already-notified`.
   See supabase/activity-push.sql.

   Deploy:
     supabase functions deploy send-activity-push

   Secrets (shared with the other two):
     VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
     APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_PRIVATE_KEY, APNS_ENV

   ⚠️ Never deploy this with --no-verify-jwt. The JWT is how the caller
   is identified at all, exactly as in send-message-push.
   ============================================================== */

import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { apnsConfigured, sendApns } from '../_shared/apns.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

/* A lock screen is not the place for a long activity name. */
const NAME_MAX = 90;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'missing authorization' }, 401);

  let activityId = '';
  try {
    const body = await req.json();
    activityId = String(body?.activityId ?? '');
  } catch {
    return json({ error: 'bad request body' }, 400);
  }
  if (!activityId) return json({ error: 'activityId required' }, 400);

  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  /* Who is calling. From the token, never from the body — the same rule
     delete-account and send-message-push follow, and for the same
     reason: this runs as service_role. */
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  const caller = userData?.user;
  if (userError || !caller) return json({ error: 'invalid session' }, 401);

  /* ---- The activity, read back rather than trusted ---- */
  const { data: act, error: actError } = await admin
    .from('Activities')
    .select('id, name, collection_id, date_completed')
    .eq('id', activityId)
    .maybeSingle();

  if (actError) return json({ error: 'lookup failed', detail: actError.message }, 500);
  if (!act) return json({ error: 'no such activity' }, 404);

  /* Un-completing writes date_completed = null, and it must not
     announce anything. This is also what stops a call racing ahead of
     the write it is reporting: if the row does not say it is done, we
     do not say it is done. */
  if (!act.date_completed) return json({ skipped: 'not completed' });

  /* ---- The list it belongs to ---- */
  const { data: collection, error: colError } = await admin
    .from('Collections')
    .select('id, name, user_id')
    .eq('id', act.collection_id)
    .maybeSingle();

  if (colError || !collection) return json({ error: 'no such collection' }, 404);

  /* ---- The audience: the owner plus every member ----
     The rule send-reminders and send-message-push both arrived at. */
  const audience = new Set<string>();
  if (collection.user_id) audience.add(collection.user_id);

  const { data: members, error: membersError } = await admin
    .from('collection_members')
    .select('user_id')
    .eq('collection_id', act.collection_id);

  if (membersError) {
    /* sharing.sql not run. Nothing is shared, so there is nobody to
       tell — but say so rather than silently pushing to the owner. */
    console.info('[send-activity-push] no collection_members table');
  } else {
    for (const m of members ?? []) audience.add(m.user_id);
  }

  /* The caller has to be somebody who could have completed this.
     Computed before the caller is removed below. */
  const callerIsInList =
    collection.user_id === caller.id ||
    (members ?? []).some((m) => m.user_id === caller.id);
  if (!callerIsInList) return json({ error: 'not in this list' }, 403);

  /* ⚠️ THE WHOLE POINT: everyone EXCEPT the person who filled in the
     sheet. They were just looking at it. */
  audience.delete(caller.id);

  if (!audience.size) return json({ sent: 0, note: 'no one else in this list' });

  /* ---- Once, and only once ----
     Claimed BEFORE anything is sent, so two calls racing each other
     cannot both win. A duplicate key is the expected outcome on the
     second call, not an error. See supabase/activity-push.sql. */
  const { error: claimError } = await admin
    .from('activity_completion_pushes')
    .insert({
      activity_id: act.id,
      completed_on: act.date_completed,
      notified_by: caller.id,
    });

  if (claimError) {
    /* 23505 is the unique violation: somebody already announced this
       completion. That is a successful outcome, not a failure. */
    if (claimError.code === '23505') return json({ skipped: 'already-notified' });
    /* 42P01 is "no such table" — the migration has not been run. The
       feature still works; only the once-only guarantee is lost, which
       is a duplicate notification rather than a daily one. Unlike
       send-reminders, that is survivable, so this continues. */
    if (claimError.code === '42P01') {
      console.info('[send-activity-push] no activity_completion_pushes table — run supabase/activity-push.sql');
    } else {
      return json({ error: 'claim failed', detail: claimError.message }, 500);
    }
  }

  /* ---- Anyone who has muted this list ----
     conversation_prefs is reused rather than given a sibling: muting is
     a statement about a LIST being noisy, and somebody who has silenced
     the conversation has not asked to hear about it by another route.
     Absent table means nothing is muted, which is the right default. */
  const { data: muted, error: mutedError } = await admin
    .from('conversation_prefs')
    .select('user_id')
    .eq('collection_id', act.collection_id)
    .eq('muted', true);

  if (mutedError) {
    console.info('[send-activity-push] no conversation_prefs table — nothing muted');
  } else {
    for (const row of muted ?? []) audience.delete(row.user_id);
  }

  if (!audience.size) return json({ sent: 0, note: 'everyone has muted this list' });

  /* ---- Who to say it was ----
     The caller's own display name, looked up rather than passed in.
     messages carry a sender_name snapshot for this; an activity does
     not, so it is read here. */
  const { data: profile } = await admin
    .from('Users')
    .select('display_name')
    .eq('id', caller.id)
    .maybeSingle();

  const who = (profile?.display_name || '').trim() || 'Someone';
  const listName = collection.name || 'a shared list';
  let what = String(act.name ?? '').trim() || 'something';
  if (what.length > NAME_MAX) what = what.slice(0, NAME_MAX - 1) + '…';

  /* Built once, rendered for both transports — the same split the
     other two functions make, so the two cannot disagree about what
     the notification says. "Dana · Japan 2027" over the thing itself:
     the list is the context, the name is the news. */
  const note = {
    kind: 'completion',
    title: `${who} · ${listName}`,
    body: `Accomplished “${what}”`,
    collectionId: act.collection_id,
    activityId: act.id,
  };
  const payload = JSON.stringify(note);

  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT') ?? 'mailto:noreply@example.com',
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!,
  );

  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth, user_id, platform')
    .in('user_id', [...audience]);

  if (!subs?.length) return json({ sent: 0, note: 'no registered devices' });

  let sent = 0;
  let apnsSkipped = 0;
  const stale: string[] = [];

  for (const sub of subs) {
    if (sub.platform === 'ios') {
      if (!apnsConfigured()) { apnsSkipped++; continue; }
      const res = await sendApns(sub.endpoint, {
        title: note.title,
        body: note.body,
        /* Grouped by list, so a burst of ticking-off on a trip is one
           thread in Notification Center rather than nine banners.
           Deliberately a different thread from `conv:` — a completion
           is not part of the conversation. */
        threadId: `done:${act.collection_id}`,
        data: {
          kind: 'completion',
          collectionId: note.collectionId,
          activityId: note.activityId,
        },
      });
      if (res.ok) sent++;
      else if (res.prune) stale.push(sub.endpoint);
      else console.error('apns failed', sub.endpoint, res.status, res.reason);
      continue;
    }
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      );
      sent++;
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) stale.push(sub.endpoint);
      else console.error('push failed', sub.endpoint, e?.statusCode, e?.body);
    }
  }

  if (stale.length) {
    await admin.from('push_subscriptions').delete().in('endpoint', stale);
  }

  return json({ recipients: audience.size, sent, pruned: stale.length, apnsSkipped });
});
