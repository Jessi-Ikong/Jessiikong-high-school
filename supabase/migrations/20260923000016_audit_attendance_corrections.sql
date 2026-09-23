-- 16. Log attendance corrections to audit_log.
--
-- When an existing attendance record is saved by someone OTHER than the
-- person who last marked it (i.e. marked_by is about to change), write an
-- audit_log row:
--   user_id  = the person making the correction
--   action   = 'correct_attendance'
--   entity   = 'attendance_records', entity_id = the record's id
--   changes  = { status: {old, new},
--                original_marked_by: <users.id>, original_marked_by_name: "...",
--                other_changes: {field: {old, new}, ...}   (only if any) }
-- so the original teacher's identity is kept even after marked_by is
-- overwritten. A teacher re-saving their own record (marked_by unchanged) is
-- NOT logged. New records (inserts) are not logged by this trigger either.
--
-- How marked_by changes: validate_attendance() sets it to whoever is signed
-- in on every insert/update. Edits made with NO signed-in user (Supabase
-- Table Editor / SQL Editor as the database owner, or server-side code) leave
-- marked_by as it was, so they are NOT logged unless marked_by itself is
-- edited by hand (then they are logged with no user_id).

create function private.log_attendance_correction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_other jsonb;
begin
  if new.marked_by is not distinct from old.marked_by then
    return null;   -- same person saving again: not a correction
  end if;

  select jsonb_object_agg(n.key, jsonb_build_object('old', v_old -> n.key, 'new', n.value))
    into v_other
    from jsonb_each(to_jsonb(new)) n
   where n.value is distinct from v_old -> n.key
     and n.key not in ('status', 'marked_by', 'updated_at');

  insert into public.audit_log (user_id, action, entity, entity_id, changes)
  values (
    private.current_user_id(),
    'correct_attendance',
    'attendance_records',
    new.id::text,
    jsonb_build_object(
      'status', jsonb_build_object('old', old.status, 'new', new.status),
      'original_marked_by', old.marked_by,
      'original_marked_by_name',
        (select concat_ws(' ', u.first_name, u.last_name) from public.users u where u.id = old.marked_by)
    ) || case when v_other is not null then jsonb_build_object('other_changes', v_other) else '{}'::jsonb end
  );
  return null;
end;
$$;

create trigger attendance_records_log_correction
  after update on public.attendance_records
  for each row execute function private.log_attendance_correction();
