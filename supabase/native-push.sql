-- ==============================================================
-- native-push.sql — let push_subscriptions hold an APNs device
-- token as well as a Web Push subscription.
--
-- ---- Why this is needed at all ----
--
-- Inside the Capacitor WKWebView there is no service worker and no
-- Notification API: the page is served from the `capacitor://` scheme,
-- and WKWebView does not give a custom scheme either of them. So every
-- line of js/reminders.js that reaches for PushManager is dead in the
-- shipping iOS app, and all three delivery tiers collapse to the Home
-- banner — silently, because notificationsSupported() simply answers
-- false and the UI hides itself exactly as designed.
--
-- The native app therefore registers with APNs instead and stores the
-- device token here, beside the browsers. Both send-reminders and
-- send-message-push then fan out to whichever kind each row is.
--
-- ---- Why one table and not two ----
--
-- Every question either function asks is "which devices belong to this
-- user" — the audience, the muting, the delivery marker and the stale
-- pruning are all per-user, not per-transport. Splitting the table
-- would duplicate that query and give the two halves somewhere to
-- disagree about who has been told. `platform` is the only thing that
-- differs, and it is read at exactly one point: which sender to use.
--
-- ---- What each column means for a native row ----
--
--   platform  'ios'
--   endpoint  the APNs device token (hex). Still the unique key, which
--             is correct — a token identifies one install of one app on
--             one device, exactly as a Web Push endpoint does.
--   p256dh    null. Web Push encrypts its payload to a key pair the
--   auth      null. browser owns; APNs encrypts the connection instead
--             and carries the payload in the clear to Apple.
--
-- Existing rows are all Web Push, so the default backfills them
-- correctly and this migration cannot lose anything.
-- ==============================================================

-- 1. Which transport this row is for.
alter table push_subscriptions
  add column if not exists platform text not null default 'web';

-- 2. The two Web Push key columns stop being mandatory, because an
--    APNs row has nothing to put in them.
alter table push_subscriptions alter column p256dh drop not null;
alter table push_subscriptions alter column auth   drop not null;

-- 3. ...but a *web* row without them is unusable — webpush.sendNotification
--    would throw on every send. The constraint is what keeps "nullable"
--    from meaning "optional for everyone".
alter table push_subscriptions drop constraint if exists push_subscriptions_platform_ck;
alter table push_subscriptions add constraint push_subscriptions_platform_ck
  check (
    (platform = 'web' and p256dh is not null and auth is not null)
    or (platform <> 'web')
  );

-- 4. Both functions select by user_id and then branch on platform, so
--    the composite is what they actually read.
create index if not exists push_subscriptions_user_platform_idx
  on push_subscriptions(user_id, platform);

-- RLS is unchanged: the existing "own subscriptions" policy is
-- for-all and already covers the new column.
