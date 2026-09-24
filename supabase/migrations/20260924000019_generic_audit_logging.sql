-- 19. Audit logging on every business table, readable by super admins only.
--
-- ONE generic trigger function, private.audit_row_change(), now logs INSERT,
-- UPDATE and DELETE on every table in the public schema except audit_log
-- itself (which would loop). Each entry records:
--   user_id   = the signed-in person's users.id (null for server-side code or
--               the database owner, e.g. Supabase Table Editor)
--   action    = '<insert|update|delete>_<table>', e.g. 'update_scores'
--   entity    = the table name
--   entity_id = the row's id (tables without an id use their key, e.g.
--               'parent_id:student_id' for parent_students)
--   changes   = INSERT: the new row; DELETE: the old row;
--               UPDATE: only the changed fields as {field: {old, new}}.
--               An update that changes nothing is not logged; updated_at
--               alone doesn't count as a change.
--
-- Special cases:
--   * attendance_records: the bespoke 'correct_attendance' trigger
--     (migration 16) keeps logging corrections (marked_by changes) with its
--     richer details. The generic UPDATE trigger on this table only fires
--     when marked_by does NOT change, so each change is logged exactly once.
--   * grading_scale already used this generic function (migration 18); it
--     just moves to the new trigger name. Still one entry per change.
--   * messages: the message BODY is never copied into the audit log (private
--     content). Sending / deleting is logged with metadata only; updates that
--     only mark a message as read are not logged.
--   * payments: provider_response (the raw Paystack/Flutterwave reply) is not
--     copied into the audit log either.
--   * Existing entries keep their old action names ('insert', 'update', ...).

-- Columns never copied into the audit log, per table.
create function private.audit_redacted_columns(p_table text)
returns text[]
language sql immutable set search_path = ''
as $$
  select case p_table
    when 'messages' then array['body']
    when 'payments' then array['provider_response']
    else array[]::text[]
  end
$$;

create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hidden text[] := private.audit_redacted_columns(tg_table_name);
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - v_hidden end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - v_hidden end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changes jsonb;
  v_entity_id text;
begin
  if tg_op = 'UPDATE' then
    -- only the fields that actually changed
    select jsonb_object_agg(n.key, jsonb_build_object('old', v_old -> n.key, 'new', n.value))
      into v_changes
      from jsonb_each(v_new) n
     where n.value is distinct from v_old -> n.key
       and n.key not in ('updated_at');
    if v_changes is null then
      return null;   -- nothing (visible) changed, e.g. only read_at on a message
    end if;
    if tg_table_name = 'messages' and v_changes - 'read_at' = '{}'::jsonb then
      return null;   -- marking a message as read isn't an edit
    end if;
  else
    v_changes := v_row;
  end if;

  v_entity_id := coalesce(
    v_row ->> 'id',
    case tg_table_name
      when 'parent_students' then concat_ws(':', v_row ->> 'parent_id', v_row ->> 'student_id')
      when 'student_subjects' then concat_ws(':', v_row ->> 'enrollment_id', v_row ->> 'subject_id')
    end
  );

  insert into public.audit_log (user_id, action, entity, entity_id, changes)
  values (private.current_user_id(), lower(tg_op) || '_' || tg_table_name, tg_table_name, v_entity_id, v_changes);
  return null;
end;
$$;

-- Replace the old per-table triggers (migrations 7 and 18) with one
-- consistently named trigger on EVERY table in public except audit_log.
do $$
declare
  t text;
begin
  -- old triggers
  foreach t in array array[
    'users', 'teachers', 'students', 'parents', 'parent_students',
    'enrollments', 'student_subjects', 'timetable_slots',
    'assessment_components', 'scores',
    'fee_structures', 'invoices', 'payments', 'id_cards', 'grading_scale'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
  end loop;

  -- new triggers
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'audit_log'
     order by c.relname
  loop
    if t = 'attendance_records' then
      execute 'create trigger audit_changes after insert or delete on public.attendance_records
                 for each row execute function private.audit_row_change()';
      -- corrections (marked_by changes) are logged by attendance_records_log_correction instead
      execute 'create trigger audit_changes_update after update on public.attendance_records
                 for each row when (old.marked_by is not distinct from new.marked_by)
                 execute function private.audit_row_change()';
    else
      execute format(
        'create trigger audit_changes after insert or update or delete on public.%I
           for each row execute function private.audit_row_change()', t);
    end if;
  end loop;
end;
$$;

-- Only super admins can read the audit log (it was both admin levels).
drop policy "audit_log: admins can read" on public.audit_log;
create policy "audit_log: super admins can read"
  on public.audit_log for select to authenticated
  using ((select private.is_super_admin()));

create index audit_log_user_idx on public.audit_log (user_id, created_at desc);
