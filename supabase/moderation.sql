/* ==============================================================
   MODERATION — reporting, blocking, and the agreement record
   --------------------------------------------------------------
   This file exists for App Store review, not because the app grew a
   social problem. Apple's Guideline 1.2 applies the moment an app
   carries user-generated content that other people can see — here
   that is a shared list's name, its activities and its conversation —
   and it asks for four things:

     1. an agreement to terms that forbids objectionable content,
        accepted before the account is created;
     2. a way to report content;
     3. a way to block an abusive user;
     4. a stated commitment to act on a report within 24 hours.

   (1) is Users.terms_accepted_at below. (2) and (3) are the two
   tables. (4) is a promise made in legal/terms.html and kept by a
   person reading content_reports — there is no moderation queue in
   the app and this file does not pretend otherwise.

   Everything here is OPTIONAL in the same sense every other migration
   in this directory is: probeModeration() in js/moderation.js looks
   for user_blocks once at sign-in, and without it the report and
   block controls simply do not appear. Unlike the others, though,
   THIS ONE IS NOT OPTIONAL FOR SHIPPING — the controls not appearing
   is exactly the rejection this file is written to avoid.

   Run it in the SQL editor. It is idempotent.
   ============================================================== */

/* --------------------------------------------------------------
   1. THE AGREEMENT
   --------------------------------------------------------------
   A timestamp rather than a boolean, because the question review
   asks is "did this person accept, and which version" — and a null
   is a legible "an account created before this existed".

   Nothing gates on it. Backfilling every existing row to now() would
   record an acceptance that never happened, and re-prompting an
   established account at sign-in punishes people for a requirement
   that arrived after them. New accounts carry it; old ones read null
   and that is the honest answer.
   -------------------------------------------------------------- */
alter table "Users" add column if not exists terms_accepted_at timestamptz;

/* --------------------------------------------------------------
   2. BLOCKING
   --------------------------------------------------------------
   One row per (blocker, blocked). Deliberately one-directional and
   deliberately not a friendship: there is no request, no approval and
   no notification. You block someone and their messages stop being
   drawn for you.

   What it does NOT do, and this is worth stating because it will look
   like a gap: it does not remove either of you from a shared list.
   That is somebody else's list — often the person who invited you
   both — and quietly ejecting a member on a private decision by a
   third party would be a worse surprise than the messages staying.
   Leaving the list is one tap away in the ⋯ menu and is the right
   control for "I want nothing to do with this".

   The filtering is client-side (js/moderation.js) rather than in the
   select policy. A policy would be stronger, but it would also have
   to be a subquery on every message read, and — more to the point —
   the block is a display preference, not a permission: the messages
   are still legitimately readable by a member of that list, and the
   author must not be able to discover a block by watching their own
   messages vanish for one reader.
   -------------------------------------------------------------- */
create table if not exists user_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  /* A snapshot of the name they were carrying when you blocked them,
     for the same reason messages.sender_name is one: profiles.sql
     deliberately does not let you select anybody else's Users row, so
     without this the Blocked People list could only show you a column
     of uuids. See A FACE ON THE ACCOUNT in CLAUDE.md for the same
     argument made about avatars. */
  blocked_name text,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  /* Blocking yourself is not a thing anybody means to do, and a row
     that filtered your own messages out of your own conversation
     would read as the app losing them. */
  constraint user_blocks_not_self check (blocker_id <> blocked_id)
);

alter table user_blocks enable row level security;

/* Your own block list and nobody else's — in both directions. The
   read policy is scoped to blocker_id alone, so a blocked user cannot
   query whether they have been blocked, which is the whole reason
   blocking is silent. */
drop policy if exists bl_blocks_select on user_blocks;
create policy bl_blocks_select on user_blocks
  for select to authenticated
  using (blocker_id = auth.uid());

drop policy if exists bl_blocks_insert on user_blocks;
create policy bl_blocks_insert on user_blocks
  for insert to authenticated
  with check (blocker_id = auth.uid());

drop policy if exists bl_blocks_delete on user_blocks;
create policy bl_blocks_delete on user_blocks
  for delete to authenticated
  using (blocker_id = auth.uid());

create index if not exists user_blocks_blocker_idx on user_blocks(blocker_id);

/* --------------------------------------------------------------
   3. REPORTING
   --------------------------------------------------------------
   Append-only from the client's point of view: you file a report and
   that is the end of your involvement with it. There is no update
   policy and no select policy AT ALL — not even for the reporter.

   That second part is deliberate and is the interesting decision.
   Letting somebody read their own reports back sounds harmless and
   costs the one property that matters here: a report carries a
   snapshot of what was reported, so a readable report is a way to
   retrieve content after the author deleted it. Reports go one way,
   into a table only the service role reads.

   The snapshot is why the column exists. A report pointing at a
   message id is worthless the moment that message is soft-deleted —
   which is precisely what an author does when someone reports them.
   -------------------------------------------------------------- */
create table if not exists content_reports (
  id uuid primary key default gen_random_uuid(),
  /* Nulled rather than cascaded: a reporter deleting their account
     must not erase the report, or deleting an account becomes the way
     to withdraw an accusation you no longer want looked at. */
  reporter_id uuid references auth.users(id) on delete set null,
  /* Likewise. The reported account is the one under review; losing
     the row when they delete themselves loses the record of why. */
  reported_id uuid references auth.users(id) on delete set null,
  /* 'message' | 'collection' | 'activity' — what kind of thing this
     points at. Free text rather than an enum so a new surface does
     not need a migration to become reportable. */
  target_kind text not null,
  target_id uuid,
  collection_id uuid,
  /* One of the fixed reasons offered in the sheet. */
  reason text not null,
  /* What the reporter typed, if anything. */
  detail text,
  /* The content as it stood when reported. See above — without this
     the report is a dangling id. */
  snapshot text,
  created_at timestamptz not null default now(),
  /* Written by whoever works the queue, by hand, with the service
     role. The app never reads or writes these two. */
  reviewed_at timestamptz,
  resolution text
);

alter table content_reports enable row level security;

/* Insert only, as yourself. No select, no update, no delete — the
   absence of those three policies IS the design; do not add them. */
drop policy if exists bl_reports_insert on content_reports;
create policy bl_reports_insert on content_reports
  for insert to authenticated
  with check (reporter_id = auth.uid());

create index if not exists content_reports_open_idx
  on content_reports(created_at desc) where reviewed_at is null;

/* --------------------------------------------------------------
   4. WORKING THE QUEUE
   --------------------------------------------------------------
   There is no admin UI. Run this in the SQL editor — it is the whole
   moderation tool, and the 24-hour commitment in the terms is a
   promise that somebody runs it daily.

     select r.created_at, r.reason, r.detail, r.target_kind,
            r.snapshot, r.reported_id, r.reporter_id
     from content_reports r
     where r.reviewed_at is null
     order by r.created_at;

   Acting on one is a soft delete of the message plus, if it comes to
   it, a ban on the account (Authentication → Users → Ban). Then:

     update content_reports
        set reviewed_at = now(), resolution = 'removed'
      where id = '...';

   ensureSessionLive() in js/auth.js signs a banned account out on
   every device within a JWT lifetime — see BEING SIGNED INTO AN
   ACCOUNT THAT NO LONGER EXISTS in CLAUDE.md. That is what makes a
   ban take effect rather than waiting for the person to sign out.
   -------------------------------------------------------------- */
