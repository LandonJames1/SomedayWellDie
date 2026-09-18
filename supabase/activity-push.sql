-- ==============================================================
-- Completion notifications on a shared list.
--
-- One table, and it exists for exactly one reason: to make the push
-- happen ONCE.
--
-- send-message-push can check that the caller wrote the message it is
-- being asked to announce (messages.sender_id), so a member cannot
-- re-push somebody else's message at will. An activity row records no
-- such thing -- there is no completed_by column, because any member of
-- a shared list may tick anything in it off and the app has never
-- needed to know which one did. So the equivalent check is not
-- available, and without something standing in for it, "announce
-- activity X" is a button any member can hold down: a notification
-- spam vector wearing a valid JWT, aimed at everybody else in the
-- list.
--
-- The stand-in is a delivery marker, which is the same answer
-- reminder_deliveries already gives to the same question one table
-- over. The key is (activity_id, completed_on), NOT activity_id alone,
-- for the reason the reminder key carries remind_at: un-completing and
-- completing again on a different day is a new event and should be
-- announced again, while pressing Done twice on the same day is not.
--
-- RLS is on with no policies at all, so only the service role can see
-- it -- exactly like reminder_deliveries and invite_claims. Nothing in
-- the client ever reads this.
--
-- Optional, like everything else here. Without it the feature still
-- works and only the once-only guarantee is lost; the function says so
-- in the console and in its JSON rather than refusing. That is a
-- deliberate departure from send-reminders, which DOES refuse without
-- its delivery table -- there, a missing marker means re-notifying
-- everybody every single day, and here it means one duplicate.
-- ==============================================================

create table if not exists public.activity_completion_pushes (
  activity_id  uuid        not null references public."Activities"(id) on delete cascade,
  -- The date the activity was completed on, which is what makes a
  -- re-completion a new event rather than a repeat of the old one.
  completed_on date        not null,
  notified_at  timestamptz not null default now(),
  -- Who triggered it. Never read by the app; it is here so that a
  -- burst of notifications has somebody's name on it when you go
  -- looking in six months.
  notified_by  uuid        references auth.users(id) on delete set null,
  primary key (activity_id, completed_on)
);

alter table public.activity_completion_pushes enable row level security;

-- No policies. Deliberately. The service role bypasses RLS, and
-- nothing else has any business here.

-- Housekeeping: rows for activities that no longer exist go with them
-- (on delete cascade above). Nothing else grows without bound -- one
-- row per completed activity per completion date.
