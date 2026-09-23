-- 9. Row-Level Security: helper functions, RLS on every table, policies,
--    column-protection triggers and the public ID-card verification lookup.
--
-- Conventions
--  * Every table in public has RLS enabled. No policy = no access.
--  * Nothing is granted to `anon` (signed-out visitors) except the
--    verify_id_card() function at the bottom.
--  * The service_role key (server-side only) bypasses RLS, as usual in Supabase.
--  * Helpers are SECURITY DEFINER so they can look up roles/links without
--    being blocked by RLS themselves (and without policy recursion).

-- ---------------------------------------------------------------------------
-- Helper functions (who is signed in, and what are they linked to?)
-- ---------------------------------------------------------------------------

create function private.current_user_role()
returns public.user_role
language sql stable security definer set search_path = ''
as $$
  select u.role from public.users u where u.auth_id = auth.uid() and u.is_active
$$;

create function private.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.current_user_role() = 'admin', false)
$$;

create function private.is_super_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.users u
     where u.auth_id = auth.uid() and u.is_active and u.admin_level = 'super_admin'
  )
$$;

create function private.current_teacher_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select t.id from public.teachers t where t.user_id = private.current_user_id()
$$;

create function private.current_student_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select s.id from public.students s where s.user_id = private.current_user_id()
$$;

create function private.current_parent_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select p.id from public.parents p where p.user_id = private.current_user_id()
$$;

create function private.is_parent_of(p_student_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.parent_students ps
     where ps.student_id = p_student_id and ps.parent_id = private.current_parent_id()
  )
$$;

-- Does the signed-in teacher teach this section (in this term)?
create function private.teacher_teaches(p_section_id uuid, p_subject_id uuid, p_term_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.timetable_slots ts
     where ts.teacher_id = private.current_teacher_id()
       and ts.section_id = p_section_id
       and ts.term_id = p_term_id
       and (p_subject_id is null or ts.subject_id = p_subject_id)
  )
$$;

create function private.teacher_owns_slot(p_slot_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.timetable_slots ts
     where ts.id = p_slot_id and ts.teacher_id = private.current_teacher_id()
  )
$$;

-- Is the student in a section the signed-in teacher teaches (same session)?
create function private.teacher_can_see_student(p_student_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
      from public.enrollments e
      join public.terms t on t.session_id = e.session_id
      join public.timetable_slots ts on ts.term_id = t.id and ts.section_id = e.section_id
     where e.student_id = p_student_id
       and ts.teacher_id = private.current_teacher_id()
  )
$$;

-- Admin, the student themself, a linked parent, or one of their teachers.
create function private.can_view_student(p_student_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_admin()
      or p_student_id = private.current_student_id()
      or private.is_parent_of(p_student_id)
      or private.teacher_can_see_student(p_student_id)
$$;

create function private.can_view_enrollment(p_enrollment_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.enrollments e
     where e.id = p_enrollment_id and private.can_view_student(e.student_id)
  )
$$;

-- Teacher may record a score only for a student in a section where they
-- teach that subject in that term.
create function private.teacher_can_score(p_student_id uuid, p_subject_id uuid, p_term_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
      from public.enrollments e
      join public.terms t on t.session_id = e.session_id
     where e.student_id = p_student_id
       and t.id = p_term_id
       and private.teacher_teaches(e.section_id, p_subject_id, p_term_id)
  )
$$;

-- Admin, the parent themself, their linked children, their children's
-- teachers, or a teacher they already have a message thread with.
create function private.can_view_parent(p_parent_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_admin()
      or p_parent_id = private.current_parent_id()
      or exists (
        select 1 from public.parent_students ps
         where ps.parent_id = p_parent_id
           and (ps.student_id = private.current_student_id()
                or private.teacher_can_see_student(ps.student_id))
      )
      or exists (
        select 1 from public.message_threads mt
         where mt.parent_id = p_parent_id and mt.teacher_id = private.current_teacher_id()
      )
$$;

-- Is the signed-in student (or one of the signed-in parent's children) in
-- this section during this term's session?
create function private.has_student_in_section(p_section_id uuid, p_term_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
      from public.enrollments e
      join public.terms t on t.session_id = e.session_id
     where t.id = p_term_id
       and e.section_id = p_section_id
       and (e.student_id = private.current_student_id() or private.is_parent_of(e.student_id))
  )
$$;

-- Is the signed-in user connected to this class in the current session
-- (student in it, parent of a student in it, or teaching a section of it)?
create function private.is_in_current_class(p_class_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
      from public.enrollments e
      join public.sessions s on s.id = e.session_id and s.is_current
     where e.class_id = p_class_id
       and (e.student_id = private.current_student_id() or private.is_parent_of(e.student_id))
  )
  or exists (
    select 1
      from public.timetable_slots ts
      join public.sections sec on sec.id = ts.section_id
      join public.terms t on t.id = ts.term_id
      join public.sessions s on s.id = t.session_id and s.is_current
     where sec.class_id = p_class_id
       and ts.teacher_id = private.current_teacher_id()
  )
$$;

create function private.is_assignment_teacher(p_assignment_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.assignments a
     where a.id = p_assignment_id and a.teacher_id = private.current_teacher_id()
  )
$$;

create function private.student_can_submit(p_assignment_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
      from public.assignments a
      join public.terms t on t.id = a.term_id
      join public.enrollments e on e.section_id = a.section_id and e.session_id = t.session_id
     where a.id = p_assignment_id
       and e.student_id = private.current_student_id()
  )
$$;

create function private.can_view_invoice(p_invoice_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.invoices i
     where i.id = p_invoice_id
       and (private.is_admin()
            or i.student_id = private.current_student_id()
            or private.is_parent_of(i.student_id))
  )
$$;

create function private.is_thread_participant(p_thread_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.message_threads mt
     where mt.id = p_thread_id
       and (mt.parent_id = private.current_parent_id()
            or mt.teacher_id = private.current_teacher_id())
  )
$$;

-- A parent–teacher thread may only be opened if the teacher teaches (or has
-- taught) one of the parent's children.
create function private.teacher_linked_to_parent(p_teacher_id uuid, p_parent_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
      from public.parent_students ps
      join public.enrollments e on e.student_id = ps.student_id
      join public.terms t on t.session_id = e.session_id
      join public.timetable_slots ts on ts.term_id = t.id and ts.section_id = e.section_id
     where ps.parent_id = p_parent_id
       and ts.teacher_id = p_teacher_id
  )
$$;

-- ---------------------------------------------------------------------------
-- Column-protection triggers (RLS decides WHICH rows; these decide WHICH
-- columns a non-admin may change). Skipped when there is no signed-in user,
-- i.e. server-side code using the service_role key, or migrations.
-- ---------------------------------------------------------------------------

-- Users may edit only their own photo and phone. Limited admins can't touch
-- admin accounts, or change their own role / level / status / login link.
create function private.protect_user_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or private.is_super_admin() then
    return new;
  end if;

  if not private.is_admin() then
    if (to_jsonb(new) - array['photo_url', 'phone', 'updated_at'])
       is distinct from (to_jsonb(old) - array['photo_url', 'phone', 'updated_at']) then
      raise exception 'You can only change your own photo and phone number'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- limited admin
  if new.role = 'admin' and old.role <> 'admin' then
    raise exception 'Only a super admin can make someone an admin' using errcode = '42501';
  end if;
  if old.role = 'admin' and (
       new.role, new.admin_level, new.is_active, new.auth_id
     ) is distinct from (
       old.role, old.admin_level, old.is_active, old.auth_id
     ) then
    raise exception 'Only a super admin can change an admin''s role, level, status or login'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger users_protect_columns
  before update on public.users
  for each row execute function private.protect_user_columns();

-- Students may edit their answer until it's graded; teachers may only grade.
create function private.protect_submission_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or private.is_admin() then
    return new;
  end if;

  if new.student_id = private.current_student_id() then
    if tg_op = 'UPDATE' and old.graded_at is not null then
      raise exception 'This submission has already been graded' using errcode = '42501';
    end if;
    if new.score is not null or new.feedback is not null
       or new.graded_by is not null or new.graded_at is not null then
      raise exception 'Students cannot grade submissions' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' then
      new.submitted_at := now();
    end if;
    return new;
  end if;

  -- the assignment's teacher, grading
  if tg_op = 'UPDATE' and (
       new.assignment_id, new.student_id, new.content, new.attachment_url, new.submitted_at
     ) is distinct from (
       old.assignment_id, old.student_id, old.content, old.attachment_url, old.submitted_at
     ) then
    raise exception 'Teachers can only grade a submission, not change it' using errcode = '42501';
  end if;
  new.graded_by := private.current_user_id();
  new.graded_at := now();
  return new;
end;
$$;

create trigger submissions_protect_columns
  before insert or update on public.submissions
  for each row execute function private.protect_submission_columns();

-- Messages can't be edited; the recipient may only mark them read.
create function private.protect_message_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at') then
    raise exception 'Messages cannot be edited' using errcode = '42501';
  end if;
  if old.sender_id = private.current_user_id() then
    raise exception 'Only the recipient can mark a message as read' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger messages_protect_columns
  before update on public.messages
  for each row execute function private.protect_message_columns();

-- ---------------------------------------------------------------------------
-- Enable RLS on every table
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'sessions', 'terms', 'classes', 'sections', 'subjects', 'periods',
    'users', 'teachers', 'students', 'parents', 'parent_students',
    'enrollments', 'student_subjects', 'timetable_slots',
    'attendance_records', 'assessment_components', 'scores',
    'assignments', 'submissions', 'fee_structures', 'invoices', 'payments',
    'announcements', 'message_threads', 'messages', 'audit_log', 'id_cards'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reference data: readable by every signed-in user, managed by admins.
-- (sessions, terms, classes, sections, subjects, periods, timetable_slots,
--  assessment_components, teachers)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'sessions', 'terms', 'classes', 'sections', 'subjects', 'periods',
    'timetable_slots', 'assessment_components', 'teachers'
  ] loop
    execute format(
      'create policy "%1$s: signed-in users can read" on public.%1$I
         for select to authenticated using (true)', t);
    execute format(
      'create policy "%1$s: admins can insert" on public.%1$I
         for insert to authenticated with check ((select private.is_admin()))', t);
    execute format(
      'create policy "%1$s: admins can update" on public.%1$I
         for update to authenticated
         using ((select private.is_admin())) with check ((select private.is_admin()))', t);
    execute format(
      'create policy "%1$s: admins can delete" on public.%1$I
         for delete to authenticated using ((select private.is_admin()))', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
create policy "users: own row, admins, teachers, and visible students/parents"
  on public.users for select to authenticated
  using (
    auth_id = (select auth.uid())
    or (select private.is_admin())
    or role = 'teacher'
    or (role = 'student' and exists (
          select 1 from public.students s
           where s.user_id = users.id and private.can_view_student(s.id)))
    or (role = 'parent' and exists (
          select 1 from public.parents p
           where p.user_id = users.id and private.can_view_parent(p.id)))
  );

-- Admins manage non-admin accounts; only super admins manage admin accounts.
create policy "users: admins create accounts (super admin for admin accounts)"
  on public.users for insert to authenticated
  with check (
    (select private.is_super_admin())
    or ((select private.is_admin()) and role <> 'admin')
  );

create policy "users: admins update accounts (super admin for admin accounts)"
  on public.users for update to authenticated
  using (
    (select private.is_super_admin())
    or ((select private.is_admin()) and role <> 'admin')
  )
  with check (
    (select private.is_super_admin())
    or ((select private.is_admin()) and role <> 'admin')
  );

-- Anyone may update their own row; protect_user_columns() limits which columns.
create policy "users: update own profile"
  on public.users for update to authenticated
  using (auth_id = (select auth.uid()))
  with check (auth_id = (select auth.uid()));

create policy "users: admins delete accounts (super admin for admin accounts)"
  on public.users for delete to authenticated
  using (
    (select private.is_super_admin())
    or ((select private.is_admin()) and role <> 'admin')
  );

-- ---------------------------------------------------------------------------
-- students, parents, parent_students, enrollments, student_subjects
-- ---------------------------------------------------------------------------
create policy "students: self, linked parents, their teachers, admins"
  on public.students for select to authenticated
  using (private.can_view_student(id));

create policy "students: admins manage" on public.students
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "parents: self, their children, children's teachers, admins"
  on public.parents for select to authenticated
  using (private.can_view_parent(id));

create policy "parents: admins manage" on public.parents
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "parent_students: the parent, student, their teachers, admins"
  on public.parent_students for select to authenticated
  using (
    (select private.is_admin())
    or parent_id = (select private.current_parent_id())
    or student_id = (select private.current_student_id())
    or private.teacher_can_see_student(student_id)
  );

create policy "parent_students: admins manage" on public.parent_students
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "enrollments: visible to whoever can see the student"
  on public.enrollments for select to authenticated
  using (private.can_view_student(student_id));

create policy "enrollments: admins manage" on public.enrollments
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "student_subjects: visible to whoever can see the enrollment"
  on public.student_subjects for select to authenticated
  using (private.can_view_enrollment(enrollment_id));

create policy "student_subjects: admins manage" on public.student_subjects
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- attendance_records: the slot's teacher marks; family and staff read.
-- ---------------------------------------------------------------------------
create policy "attendance: slot's teacher and whoever can see the student"
  on public.attendance_records for select to authenticated
  using (private.teacher_owns_slot(timetable_slot_id) or private.can_view_enrollment(enrollment_id));

create policy "attendance: slot's teacher or admins can mark"
  on public.attendance_records for insert to authenticated
  with check ((select private.is_admin()) or private.teacher_owns_slot(timetable_slot_id));

create policy "attendance: slot's teacher or admins can correct"
  on public.attendance_records for update to authenticated
  using ((select private.is_admin()) or private.teacher_owns_slot(timetable_slot_id))
  with check ((select private.is_admin()) or private.teacher_owns_slot(timetable_slot_id));

create policy "attendance: admins can delete"
  on public.attendance_records for delete to authenticated
  using ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- scores: entered by the subject teacher for that section/term.
-- ---------------------------------------------------------------------------
create policy "scores: visible to whoever can see the student"
  on public.scores for select to authenticated
  using (private.can_view_student(student_id));

create policy "scores: subject teacher or admins can enter"
  on public.scores for insert to authenticated
  with check (
    (select private.is_admin()) or private.teacher_can_score(student_id, subject_id, term_id)
  );

create policy "scores: subject teacher or admins can update"
  on public.scores for update to authenticated
  using ((select private.is_admin()) or private.teacher_can_score(student_id, subject_id, term_id))
  with check ((select private.is_admin()) or private.teacher_can_score(student_id, subject_id, term_id));

create policy "scores: admins can delete"
  on public.scores for delete to authenticated
  using ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- assignments & submissions
-- ---------------------------------------------------------------------------
create policy "assignments: its teacher, section's students/parents, admins"
  on public.assignments for select to authenticated
  using (
    (select private.is_admin())
    or teacher_id = (select private.current_teacher_id())
    or private.has_student_in_section(section_id, term_id)
  );

create policy "assignments: teachers post for classes they teach"
  on public.assignments for insert to authenticated
  with check (
    (select private.is_admin())
    or (teacher_id = (select private.current_teacher_id())
        and private.teacher_teaches(section_id, subject_id, term_id))
  );

create policy "assignments: owning teacher or admins can edit"
  on public.assignments for update to authenticated
  using ((select private.is_admin()) or teacher_id = (select private.current_teacher_id()))
  with check (
    (select private.is_admin())
    or (teacher_id = (select private.current_teacher_id())
        and private.teacher_teaches(section_id, subject_id, term_id))
  );

create policy "assignments: owning teacher or admins can delete"
  on public.assignments for delete to authenticated
  using ((select private.is_admin()) or teacher_id = (select private.current_teacher_id()));

create policy "submissions: student, their parents, the teacher, admins"
  on public.submissions for select to authenticated
  using (
    (select private.is_admin())
    or student_id = (select private.current_student_id())
    or private.is_parent_of(student_id)
    or private.is_assignment_teacher(assignment_id)
  );

create policy "submissions: students submit their own work"
  on public.submissions for insert to authenticated
  with check (
    student_id = (select private.current_student_id())
    and private.student_can_submit(assignment_id)
  );

create policy "submissions: student edits own, teacher grades, admins"
  on public.submissions for update to authenticated
  using (
    (select private.is_admin())
    or student_id = (select private.current_student_id())
    or private.is_assignment_teacher(assignment_id)
  )
  with check (
    (select private.is_admin())
    or student_id = (select private.current_student_id())
    or private.is_assignment_teacher(assignment_id)
  );

create policy "submissions: admins can delete"
  on public.submissions for delete to authenticated
  using ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- Fees: fee structures are SUPER ADMIN ONLY to change.
-- ---------------------------------------------------------------------------
create policy "fee_structures: signed-in users can read"
  on public.fee_structures for select to authenticated
  using (true);

create policy "fee_structures: super admins can insert"
  on public.fee_structures for insert to authenticated
  with check ((select private.is_super_admin()));

create policy "fee_structures: super admins can update"
  on public.fee_structures for update to authenticated
  using ((select private.is_super_admin())) with check ((select private.is_super_admin()));

create policy "fee_structures: super admins can delete"
  on public.fee_structures for delete to authenticated
  using ((select private.is_super_admin()));

create policy "invoices: visible to the student, their parents, admins"
  on public.invoices for select to authenticated
  using (
    (select private.is_admin())
    or student_id = (select private.current_student_id())
    or private.is_parent_of(student_id)
  );

-- Invoices are generated automatically; manual changes (e.g. discounts) are
-- treated like fee configuration: super admin only.
create policy "invoices: super admins manage"
  on public.invoices for all to authenticated
  using ((select private.is_super_admin())) with check ((select private.is_super_admin()));

create policy "payments: visible to whoever can see the invoice"
  on public.payments for select to authenticated
  using (private.can_view_invoice(invoice_id));

-- Parents may only START an online payment (status 'pending'). Marking it
-- successful must happen server-side after verifying with Paystack/Flutterwave
-- (service_role), or by an admin.
create policy "payments: parents start online payments for their children"
  on public.payments for insert to authenticated
  with check (
    status = 'pending'
    and provider in ('paystack', 'flutterwave')
    and paid_by = (select private.current_user_id())
    and exists (
      select 1 from public.invoices i
       where i.id = invoice_id and private.is_parent_of(i.student_id))
  );

create policy "payments: admins record payments"
  on public.payments for insert to authenticated
  with check ((select private.is_admin()));

create policy "payments: super admins can update"
  on public.payments for update to authenticated
  using ((select private.is_super_admin())) with check ((select private.is_super_admin()));

create policy "payments: super admins can delete"
  on public.payments for delete to authenticated
  using ((select private.is_super_admin()));

-- ---------------------------------------------------------------------------
-- announcements
-- ---------------------------------------------------------------------------
create policy "announcements: visible to their audience once published"
  on public.announcements for select to authenticated
  using (
    (select private.is_admin())
    or (
      published_at <= now()
      and (expires_at is null or expires_at > now())
      and (
        audience = 'all'
        or (audience = 'teachers' and (select private.current_user_role()) = 'teacher')
        or (audience = 'students' and (select private.current_user_role()) = 'student')
        or (audience = 'parents' and (select private.current_user_role()) = 'parent')
        or (audience = 'specific_class' and private.is_in_current_class(class_id))
      )
    )
  );

create policy "announcements: admins manage" on public.announcements
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- Messaging: ONLY the thread's parent and teacher. (Admins included: no.)
-- ---------------------------------------------------------------------------
create policy "message_threads: visible to its two participants"
  on public.message_threads for select to authenticated
  using (
    parent_id = (select private.current_parent_id())
    or teacher_id = (select private.current_teacher_id())
  );

create policy "message_threads: participant opens it if teacher teaches child"
  on public.message_threads for insert to authenticated
  with check (
    (parent_id = (select private.current_parent_id())
     or teacher_id = (select private.current_teacher_id()))
    and private.teacher_linked_to_parent(teacher_id, parent_id)
  );

create policy "messages: visible to the thread's participants"
  on public.messages for select to authenticated
  using (private.is_thread_participant(thread_id));

create policy "messages: participants send as themselves"
  on public.messages for insert to authenticated
  with check (
    private.is_thread_participant(thread_id)
    and sender_id = (select private.current_user_id())
  );

-- protect_message_columns() limits this to the recipient setting read_at.
create policy "messages: participants mark as read"
  on public.messages for update to authenticated
  using (private.is_thread_participant(thread_id))
  with check (private.is_thread_participant(thread_id));

-- ---------------------------------------------------------------------------
-- audit_log: admins read; written only by the audit trigger.
-- ---------------------------------------------------------------------------
create policy "audit_log: admins can read"
  on public.audit_log for select to authenticated
  using ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- id_cards
-- ---------------------------------------------------------------------------
create policy "id_cards: own cards, admins see all"
  on public.id_cards for select to authenticated
  using ((select private.is_admin()) or user_id = (select private.current_user_id()));

create policy "id_cards: admins manage" on public.id_cards
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- Public QR-code verification. Callable WITHOUT signing in, but returns only
-- display-safe fields for the one card whose random token was scanned.
-- No table access is granted to anon; this function is the only door.
create function public.verify_id_card(p_token uuid)
returns table (
  full_name text,
  photo_url text,
  role public.user_role,
  class_name text,
  section_name text,
  department text,
  session_name text,
  card_number text,
  is_valid boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    concat_ws(' ', u.first_name, u.last_name),
    u.photo_url,
    u.role,
    c.name,
    sec.name,
    t.department,
    s.name,
    ic.card_number,
    (ic.is_active and u.is_active)
  from public.id_cards ic
  join public.users u on u.id = ic.user_id
  join public.sessions s on s.id = ic.session_id
  left join public.students st on st.user_id = u.id
  left join public.enrollments e on e.student_id = st.id and e.session_id = ic.session_id
  left join public.classes c on c.id = e.class_id
  left join public.sections sec on sec.id = e.section_id
  left join public.teachers t on t.user_id = u.id
  where ic.verification_token = p_token
$$;
revoke execute on function public.verify_id_card(uuid) from public;
grant execute on function public.verify_id_card(uuid) to anon, authenticated;
