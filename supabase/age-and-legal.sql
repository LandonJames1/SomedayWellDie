-- AGE, THE TERMS VERSION, AND REPORT RETENTION
--
-- Three unrelated-looking columns and one purge job, filed together
-- because all four exist for the same reason: something in the app
-- CLAIMED a legal fact that nothing in the database could prove.
--
-- ⚠️ THIS ONE IS NOT OPTIONAL. Every other migration here degrades to
-- "the feature is absent"; the absent feature in this file is a
-- COPPA/GDPR exposure and an unenforceable set of terms.
--
--
-- 1. Users.date_of_birth
--
-- legal/terms.html has always said "you must be at least N years old"
-- and legal/privacy.html has always said accounts are not knowingly
-- created for children -- and NOTHING ANYWHERE ASKED. Both documents
-- were making a claim the product did not support, which is the worst
-- shape a legal document can be in: it is evidence against you rather
-- than for you.
--
-- WHY THE DATE AND NOT A BOOLEAN. "They ticked a box saying they were
-- old enough" is worth very little afterwards. A date is what lets you
-- show WHAT was asked and WHAT was answered, and it is what a later
-- age-appropriate-design decision (a different default for a 16 year
-- old than for a 40 year old) would have to read. The cost is one more
-- piece of personal data, which is why it is disclosed in section 2 of
-- the privacy policy and deleted with the account like everything else.
--
-- WHY IT IS NULLABLE, AND DELIBERATELY NOT BACKFILLED. Writing a date
-- into an existing row would fabricate an answer nobody gave -- the
-- same argument that left terms_accepted_at null on accounts predating
-- moderation.sql. Null means "never asked", and js/me.js reads that as
-- its cue to ask once, at launch, on any account that has no answer.
-- That is also what closes the OTHER hole: Sign in with Apple never
-- touches the sign-up form, so a form-only gate would be bypassed by
-- one button.
--
-- The CHECK is a floor under a client that could be edited in
-- devtools. It is deliberately loose -- a plausibility check, not the
-- age rule, which lives in MIN_AGE in js/config.js where it can be
-- changed without a migration.
--
--
-- 2. Users.terms_version
--
-- terms_accepted_at recorded WHEN somebody agreed and not WHAT they
-- agreed to, so the one question a dispute actually turns on -- what
-- did the document say that day -- had no answer. TERMS_VERSION in
-- js/config.js is bumped whenever legal/terms.html changes materially,
-- and this stores the string that was on screen at the moment of the
-- tap.
--
--
-- 3. Users.age_gate_at
--
-- When the age question was answered, kept separately from
-- terms_accepted_at because the two now happen at different moments
-- for an existing account: the terms were accepted at sign-up months
-- ago and the age sheet is answered on the next launch.
--
--
-- 4. Report retention
--
-- content_reports carries a snapshot of what was reported, precisely
-- so a report survives its author deleting the evidence (see A REPORT
-- GOES ONE WAY in CLAUDE.md). That is right, and it also means the
-- table accumulates copies of the worst content anybody has ever sent
-- through the app, forever, with no policy saying otherwise. Keeping
-- personal data with no defined retention period is its own GDPR
-- problem, and "we keep reports so repeated behaviour can be
-- recognised" -- which privacy.html says -- is a reason to keep the
-- ROW, not a reason to keep the copy of the content in it.
--
-- So: purge_report_snapshots() blanks the snapshot and the reporter's
-- free-text on reviewed reports older than the window, leaving the
-- report itself -- who, whom, why, when, what was decided -- intact
-- forever. Run it from the same cron that runs anything else here.

-- ---------------------------------------------------------------
-- 1-3. The three columns
-- ---------------------------------------------------------------

alter table "Users"
  add column if not exists date_of_birth date,
  add column if not exists terms_version text,
  add column if not exists age_gate_at timestamptz;

-- A floor under a tampered client. Nobody is 150 and nobody is born
-- tomorrow; the real age rule is MIN_AGE in js/config.js.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_dob_plausible'
  ) then
    alter table "Users"
      add constraint users_dob_plausible
      check (
        date_of_birth is null
        or (date_of_birth > current_date - interval '150 years'
            and date_of_birth <= current_date)
      ) not valid;
  end if;
end $$;

comment on column "Users".date_of_birth is
  'Answered by the neutral age screen at sign-up, or by the one-time '
  'age sheet on an account that predates it. Null = never asked. '
  'Deliberately not backfilled.';
comment on column "Users".terms_version is
  'TERMS_VERSION from js/config.js as it stood when the account agreed. '
  'Null = agreed before versions were recorded.';

-- ---------------------------------------------------------------
-- 4. Report retention
-- ---------------------------------------------------------------

-- Keeps the report; drops the copy of the content. Safe to re-run, and
-- safe to run when moderation.sql has never been run at all.
create or replace function purge_report_snapshots(keep_days int default 180)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int := 0;
begin
  if to_regclass('public.content_reports') is null then
    return 0;
  end if;

  update content_reports
     set snapshot = null,
         detail   = null
   where reviewed_at is not null
     and reviewed_at < now() - make_interval(days => keep_days)
     and (snapshot is not null or detail is not null);

  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function purge_report_snapshots(int) from public, anon, authenticated;

-- Schedule it beside whatever else runs here. Monthly is plenty; the
-- window is 180 days.
--
--   select cron.schedule(
--     'purge-report-snapshots', '0 4 1 * *',
--     $$select purge_report_snapshots(180)$$
--   );
--
-- Or run it by hand:  select purge_report_snapshots(180);

-- ---------------------------------------------------------------
-- Verifying
-- ---------------------------------------------------------------
--
--   select
--     (select count(*) from information_schema.columns
--        where table_name='Users' and column_name='date_of_birth') as has_dob,
--     (select count(*) from information_schema.columns
--        where table_name='Users' and column_name='terms_version') as has_terms_version,
--     (select count(*) from "Users" where date_of_birth is null) as never_asked;
--
-- The first two should be 1. `never_asked` counts the accounts that
-- will see the age sheet on their next launch -- it should fall to 0
-- on its own as people come back.
