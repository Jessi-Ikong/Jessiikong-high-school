-- 20. Limited admins get a scoped view of the audit log.
--
-- Access control only: which tables are logged and what is recorded
-- (migration 19) are unchanged.
--
--   * Super admins: every entry (unchanged).
--   * Limited admins: an entry if
--       - nobody was signed in when it happened (user_id is null: database /
--         server changes), or
--       - they made it themselves, or
--       - the person who made it is NOT an admin (teacher, student, parent).
--     They do NOT see entries made by any OTHER admin, super or limited.
--   * Everyone else: nothing (unchanged).
--
-- "Is an admin" uses the person's CURRENT role in public.users.

create function private.user_is_admin(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.users u where u.id = p_user_id and u.role = 'admin')
$$;

drop policy "audit_log: super admins can read" on public.audit_log;

create policy "audit_log: super admins all, limited admins own and non-admin"
  on public.audit_log for select to authenticated
  using (
    (select private.is_super_admin())
    or (
      (select private.is_admin())
      and (
        user_id is null
        or user_id = (select private.current_user_id())
        or not private.user_is_admin(user_id)
      )
    )
  );
