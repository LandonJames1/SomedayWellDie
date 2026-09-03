-- MOVING THE 2-3 YEAR BAND TO 2-4 YEARS
--
-- The picker offered "In 2-3 Years", which resolved to the last day of
-- year+3. It now offers "In 2-4 Years", which resolves to the last day
-- of year+4. The window moved out by a year, so the rows filed under it
-- move with it: Dec 31 2029 -> Dec 31 2030.
--
-- Two populations, both handled below:
--   1. Rows holding the resolved DATE (the normal case, once
--      target-rollover.sql has run). Step 2.
--   2. Rows still holding the literal string 'In 2-3 Years' (only if
--      that rollover was never run). Step 3.
--
-- The dates are written as intervals off date_trunc('year', now())
-- rather than as literals, so this file says what it means and matches
-- presetTargetDate() in js/utils.js exactly:
--     4 years - 1 day  =  Dec 31 of year+3   (the old band)
--     5 years - 1 day  =  Dec 31 of year+4   (the new band)
--
-- ⚠️ Run it in the year the old band was last resolved in. The match
-- above is relative to now(), so running it in 2027 would look for
-- Dec 31 2030 and find nothing. If you are reading this in a later
-- year, replace the two intervals with the literal dates you mean.
--
-- Note in passing: an activity whose owner picked Dec 31 2029 by hand
-- is indistinguishable from one filed under the band, and moves too.
-- There is nothing in the column that separates them.
--
-- No schema change: target_date is free text with no constraint.


-- ============================================================
-- 1. WHAT IS ABOUT TO CHANGE. Run this first.
-- ============================================================
select
  count(*) filter (
    where target_date = to_char(date_trunc('year', now()) + interval '4 years - 1 day',
                                'YYYY-MM-DD')
  ) as dates_to_move,
  count(*) filter (where target_date = 'In 2-3 Years') as literals_to_move,
  count(*) filter (
    where target_date = to_char(date_trunc('year', now()) + interval '5 years - 1 day',
                                'YYYY-MM-DD')
  ) as already_on_the_new_date
from "Activities";


-- ============================================================
-- 2 + 3. THE UPDATE. One statement, one transaction: both the resolved
-- dates and any surviving literals land on the new band's date.
-- ============================================================
begin;

update "Activities"
set target_date = to_char(date_trunc('year', now()) + interval '5 years - 1 day',
                          'YYYY-MM-DD')
where target_date = to_char(date_trunc('year', now()) + interval '4 years - 1 day',
                            'YYYY-MM-DD')
   or target_date = 'In 2-3 Years';

commit;


-- ============================================================
-- 4. VERIFY. dates_to_move and literals_to_move should now be 0, and
-- already_on_the_new_date should have grown by what they were.
-- ============================================================
select
  count(*) filter (
    where target_date = to_char(date_trunc('year', now()) + interval '4 years - 1 day',
                                'YYYY-MM-DD')
  ) as dates_to_move,
  count(*) filter (where target_date = 'In 2-3 Years') as literals_to_move,
  count(*) filter (
    where target_date = to_char(date_trunc('year', now()) + interval '5 years - 1 day',
                                'YYYY-MM-DD')
  ) as already_on_the_new_date
from "Activities";
