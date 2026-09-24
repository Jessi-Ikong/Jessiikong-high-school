-- 27. Run public.mark_overdue_invoices() (migration 6) automatically every
--     day, so unpaid / partial invoices past their due date become "overdue"
--     without anyone having to trigger it.
--
-- Uses pg_cron (Supabase's recommended scheduler). Jobs are stored in the
-- database itself (cron.job), so this migration does everything; no
-- dashboard step is needed. (If a project ever refuses to enable the
-- extension from SQL, turn it on under Database > Extensions > pg_cron and
-- re-run the migration.)
--
-- Schedule: '0 0 * * *' = every day at 00:00 UTC = 01:00 in Nigeria (WAT,
-- UTC+1 all year; there is no daylight saving). pg_cron on Supabase runs in
-- UTC.
--
-- Check it's registered:  select jobid, jobname, schedule, command, active from cron.job;
-- Check it ran:           select * from cron.job_run_details order by start_time desc limit 5;

create extension if not exists pg_cron with schema pg_catalog;

-- Named job: re-running this migration updates the job instead of adding a
-- second one (unschedule first to be explicit about it).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'mark-overdue-invoices') then
    perform cron.unschedule('mark-overdue-invoices');
  end if;
  perform cron.schedule('mark-overdue-invoices', '0 0 * * *', 'select public.mark_overdue_invoices()');
end;
$$;
