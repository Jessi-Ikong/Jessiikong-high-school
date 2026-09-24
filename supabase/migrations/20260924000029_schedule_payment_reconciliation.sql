-- 29. Every 15 minutes, re-check Paystack payments stuck in 'pending'.
--
-- The checking itself needs Paystack's secret key, so it lives in the Edge
-- Function reconcile-pending-payments (same verification as the webhook:
-- nothing is marked paid unless Paystack confirms it). This migration only
-- schedules a call to it:
--   pg_cron (migration 27) runs the job; pg_net (enabled here) makes the
--   HTTP request from inside the database, asynchronously.
--
-- The function has no user login to check (verify_jwt = false), so each call
-- carries a shared secret in the x-cron-secret header. The secret is NOT in
-- this file (it would end up in git). It is stored once, outside migrations:
--   * in Vault, as "reconcile_cron_secret" (read here, at run time), and
--   * as the Edge Function secret RECONCILE_CRON_SECRET (checked there).
-- See test.txt for the one-time setup. Until it exists, the job's calls are
-- simply refused (401): harmless.
--
-- Settings are in the request body so they can be changed with one
-- statement (re-run the cron.schedule below with new numbers):
--   min_age_minutes    - only payments pending longer than this (default 15)
--   expire_after_hours - payments Paystack still reports as never completed
--                        after this long are marked failed (48; 0 = never)
--   limit              - most payments checked per run (50)
--
-- Check it's registered:  select jobname, schedule, active from cron.job;
-- Check it ran:           select * from cron.job_run_details order by start_time desc limit 5;
-- See the HTTP replies:   select id, status_code, content, created from net._http_response order by created desc limit 5;

create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'reconcile-pending-payments') then
    perform cron.unschedule('reconcile-pending-payments');
  end if;
  perform cron.schedule(
    'reconcile-pending-payments',
    '*/15 * * * *',
    $job$
    select net.http_post(
      url := 'https://drrapyknckdzsdhqcxka.supabase.co/functions/v1/reconcile-pending-payments',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'reconcile_cron_secret'), '')
      ),
      body := '{"min_age_minutes": 15, "expire_after_hours": 48, "limit": 50}'::jsonb,
      timeout_milliseconds := 60000
    );
    $job$
  );
end;
$$;
