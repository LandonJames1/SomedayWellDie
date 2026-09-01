/* ==============================================================
   PEOPLE — a real roster, and adding somebody by username
   --------------------------------------------------------------
   Sharing worked and was invisible. You could invite by link and you
   could leave, but you could not see who was actually in a list: the
   sheet showed "The owner" plus a row per membership carrying a
   snapshot name, with no photo, no handle, and no way to tell one
   "Someone" from another. Blocking somebody you cannot see is not a
   feature, which is how this connects to moderation.sql.

   The reason it was invisible is deliberate and stays true:
   profiles.sql does NOT let a signed-in user select anybody else's
   Users row, because that would turn a private table into a directory
   of every account on the project. So this file does what avatars.sql
   did for photos -- narrows the disclosure to exactly what one screen
   needs, behind SECURITY DEFINER functions, scoped to a collection you
   are already in.

   ---- On find_user_by_username, which is the risky one ----

   CLAUDE.md records that inviting by username was considered and
   rejected for exactly the directory reason. This is the narrower
   version of it and the distinction is the whole safety argument:

     * EXACT match, case-insensitive. Not a prefix, not a substring,
       not a similarity search. `lando` returns nothing when the
       username is `landon`.
     * One row or none. There is no listing, no pagination, no ordering.
     * You must already know the handle, the way you must already know
       a phone number. It cannot be walked.

   A prefix search would be a directory with extra steps. Do not
   "improve" this into one.

   Run it in the SQL editor. Idempotent. Requires sharing.sql.
   ============================================================== */

/* --------------------------------------------------------------
   1. WHO IS IN THIS LIST
   --------------------------------------------------------------
   Everything one roster row needs and nothing else: no email, no
   home address, no difficulty profile. The owner is included as a
   synthesised row rather than being left for the client to prepend --
   the client did that before and could only label them "The owner",
   having no way to look them up.
   -------------------------------------------------------------- */
create or replace function collection_people(cid uuid)
returns table (
  user_id uuid,
  display_name text,
  username text,
  avatar_url text,
  role text,
  is_owner boolean,
  joined_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  /* The owner. */
  select u.id, u.display_name, u.username, u.avatar_url,
         'owner'::text, true, c.created_at
    from "Collections" c
    join "Users" u on u.id = c.user_id
   where c.id = cid
     and can_use_collection(cid)

  union all

  /* Everybody else. left join so a membership whose Users row has not
     been created yet still appears -- it falls back to the snapshot
     name the client already holds rather than vanishing. */
  select m.user_id, coalesce(u.display_name, m.display_name), u.username,
         u.avatar_url, coalesce(m.role,'editor'), false, m.created_at
    from collection_members m
    left join "Users" u on u.id = m.user_id
   where m.collection_id = cid
     and can_use_collection(cid)
   order by 6 desc, 7 asc;
$$;

revoke all on function collection_people(uuid) from public;
grant execute on function collection_people(uuid) to authenticated;

/* --------------------------------------------------------------
   2. FINDING ONE PERSON BY HANDLE OR NAME
   --------------------------------------------------------------
   Read the header before touching this. Exact, case-insensitive, one
   row or none -- matched against the username OR the display name,
   because "what is Sarah's username" is a question people cannot
   answer about their own friends.

   The username half is an index lookup: profiles.sql creates a unique
   index on lower(username). The display-name half is not indexed and
   is not unique, which is the interesting difference:

     * USERNAMES ARE UNIQUE, so a username match is always the right
       person. Names are not -- two accounts may both be "Sam Rivera".
     * So username matches are ordered FIRST and the query still stops
       at one row. Typing a handle can never be beaten by somebody
       else's display name.
     * When only a name matches and several people share it, this
       returns the oldest account and there is no way for the caller to
       see the others. That is a real limitation and it is the right
       one: listing them would be the directory this whole file exists
       to avoid. Someone who cannot be reached by name can still be
       added by username, which is exact.

   Still EXACT on both sides. Not a prefix, not a substring. `Sam`
   does not find `Sam Rivera`. Do not "improve" that.
   -------------------------------------------------------------- */
/* The return type gained matched_on, and CREATE OR REPLACE cannot
   change a function's signature -- Postgres rejects it outright. So it
   is dropped first. Safe to re-run: the drop is conditional and the
   grant below re-applies. */
drop function if exists find_user_by_username(text);

create function find_user_by_username(handle text)
returns table (
  user_id uuid,
  display_name text,
  username text,
  avatar_url text,
  matched_on text
)
language sql
security definer
set search_path = public
as $$
  select u.id, u.display_name, u.username, u.avatar_url,
         case when lower(u.username) = lower(btrim(handle))
              then 'username' else 'name' end
    from "Users" u
   where (lower(u.username)     = lower(btrim(handle))
       or lower(u.display_name) = lower(btrim(handle)))
     /* Something this short is not a lookup, it is a probe. */
     and length(btrim(handle)) >= 3
   /* A username match outranks a name match, always. */
   order by (lower(u.username) = lower(btrim(handle))) desc, u.created_at asc
   limit 1;
$$;

revoke all on function find_user_by_username(text) from public;
grant execute on function find_user_by_username(text) to authenticated;

/* --------------------------------------------------------------
   3. ADDING SOMEBODY
   --------------------------------------------------------------
   collection_members deliberately has NO INSERT POLICY -- see the
   header of sharing.sql. join_collection(code) was the only way a
   membership row could ever be created, and that is still true for
   the link path. This is the second door, and it is narrower:

     * only the collection's OWNER may call it;
     * the target must already exist as a real account;
     * it is idempotent -- adding somebody twice is not an error,
       because from the owner's point of view the state they asked for
       is the state they get.

   ⚠️ THIS ADDS SOMEBODY WITHOUT ASKING THEM. That is the same thing a
   shared photo album does and it is a real tradeoff: a list appears in
   their app that they did not accept. It is bounded by the fact that
   you must know their exact handle, and by the fact that they can
   leave -- but if this is ever abused, the fix is a pending-invite
   state on collection_members (say, role = 'invited') that the
   recipient accepts, rather than removing the feature.
   -------------------------------------------------------------- */
create or replace function add_collection_member(cid uuid, target uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not owns_collection(cid) then
    raise exception 'Only the list owner can add people.';
  end if;
  if target is null or not exists (select 1 from auth.users where id = target) then
    raise exception 'That account no longer exists.';
  end if;
  /* The owner is already in the list by being its owner. A membership
     row for them would draw them twice on the roster. */
  if exists (select 1 from "Collections" where id = cid and user_id = target) then
    return false;
  end if;

  insert into collection_members (collection_id, user_id, role, display_name)
  select cid, target, 'editor',
         coalesce((select display_name from "Users" where id = target), 'Someone')
  on conflict (collection_id, user_id) do nothing;

  return true;
end;
$$;

revoke all on function add_collection_member(uuid, uuid) from public;
grant execute on function add_collection_member(uuid, uuid) to authenticated;
