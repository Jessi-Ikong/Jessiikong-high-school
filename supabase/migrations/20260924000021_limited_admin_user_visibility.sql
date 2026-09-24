-- 21. Limited admins can't see OTHER admins' user accounts.
--
-- Consistent with the audit log rule (migration 20). On public.users:
--   * Super admins: every user row (unchanged).
--   * Limited admins: every NON-admin row (teachers, students, parents) as
--     before, plus their OWN row, but not other admins (super or limited).
--   * Everyone else: unchanged (own row, all teachers, and the students /
--     parents they are allowed to see; never admins).
-- Only the admin part of the SELECT policy changes; update / insert / delete
-- policies (already super-admin-only for admin accounts) are untouched.

drop policy "users: own row, admins, teachers, and visible students/parents" on public.users;

create policy "users: self, scoped admins, teachers, visible students/parents"
  on public.users for select to authenticated
  using (
    auth_id = (select auth.uid())
    or (select private.is_super_admin())
    or ((select private.is_admin()) and role <> 'admin')
    or role = 'teacher'
    or (role = 'student' and exists (
          select 1 from public.students s
           where s.user_id = users.id and private.can_view_student(s.id)))
    or (role = 'parent' and exists (
          select 1 from public.parents p
           where p.user_id = users.id and private.can_view_parent(p.id)))
  );
