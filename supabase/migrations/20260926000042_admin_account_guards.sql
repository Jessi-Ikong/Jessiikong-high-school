-- 042: deactivating / reactivating ADMIN accounts (super admins only), with
-- safety rails enforced by the database, whoever or whatever makes the change.
--
-- Who may change an admin's is_active is unchanged and already enforced:
--   * super admins: any admin (RLS "users: admins update accounts ...");
--   * limited admins: never (they can't even see other admins, migration 21,
--     and protect_user_columns() refuses any change to an admin's status).
--
-- NEW rails (a BEFORE trigger on public.users):
--   1. Nobody can deactivate their OWN account.
--   2. The LAST ACTIVE super admin can't stop being one: it can't be
--      deactivated, and (the same risk) it can't be demoted to limited admin,
--      turned into another role, or deleted. There is always at least one
--      active super admin able to undo mistakes. This also applies to
--      server-side code (no signed-in user).
--   Two super admins deactivating each other at the same moment can't both
--   succeed: the check takes a transaction lock first.
--
-- Audit: nothing new needed. users is already covered by the generic audit
-- trigger (migration 19): update_users with is_active old -> new, and who did it.

create function private.guard_admin_accounts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_leaves_super boolean;
begin
  if tg_op = 'UPDATE' then
    if old.is_active and not new.is_active and old.id = private.current_user_id() then
      raise exception 'You can''t deactivate your own account. Ask another super admin to do it if needed.';
    end if;
    v_leaves_super := old.role = 'admin' and old.admin_level = 'super_admin' and old.is_active
      and not (new.role = 'admin' and new.admin_level = 'super_admin' and new.is_active);
  else -- DELETE
    v_leaves_super := old.role = 'admin' and old.admin_level = 'super_admin' and old.is_active;
  end if;

  if v_leaves_super then
    -- One such change at a time, so two can't each see "another one is left".
    perform pg_advisory_xact_lock(hashtext('private.guard_admin_accounts'));
    if not exists (
      select 1 from public.users u
       where u.role = 'admin' and u.admin_level = 'super_admin' and u.is_active and u.id <> old.id
    ) then
      raise exception '% is the last active super admin, so this account can''t be deactivated, demoted or deleted. Make another admin a super admin (or reactivate one) first.',
        old.first_name || ' ' || old.last_name;
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger users_guard_admin_accounts
  before update of is_active, role, admin_level or delete on public.users
  for each row execute function private.guard_admin_accounts();
