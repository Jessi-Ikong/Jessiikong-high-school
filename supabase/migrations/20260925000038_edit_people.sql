-- 38. Admins correcting student and teacher details after creation.
--
-- Who may edit is unchanged: both admin tiers already manage students,
-- teachers, their user accounts (not admin accounts) and student subjects
-- (migration 9). This migration adds:
--
--   1. public.update_student_details() / public.update_teacher_details():
--      save a person's details in ONE transaction (their user row + their
--      student/teacher row). They run with the CALLER's permissions (security
--      invoker), so the existing row rules still decide who may do it, and
--      the generic audit trigger (migration 19) logs each changed row.
--      Validation matches account creation: first and last name required
--      (extra spaces removed), staff ID required and unique, gender
--      male/female; plus a date of birth can't be in the future.
--   2. Names and staff IDs can never be blank (constraints).
--   3. An account's email can't be changed by anyone signed in: it is the
--      login (the Supabase Auth user), so changing only users.email would
--      make the two disagree. Server-side code is unaffected.
--   4. A student's subjects can only be added / removed on a CURRENT-session
--      enrollment. Past sessions' subject lists stay as they were (they
--      define which past scores and attendance count). Rows removed because
--      their enrollment is deleted are unaffected.
--   5. public.student_subject_usage(enrollment): per subject, how many
--      scores, attendance marks and submissions the student has, so the admin
--      is warned before removing a subject that has records. Removing a
--      subject never deletes those records (there is no cascade): they stop
--      counting (rosters, ranking) and come back if the subject is re-added.
--
-- Deactivating / reactivating is a plain update of users.is_active, already
-- allowed for both admin tiers on non-admin accounts and already audit-logged.

-- ---------------------------------------------------------------------------
-- 2. Never blank
-- ---------------------------------------------------------------------------
alter table public.users
  add constraint users_names_not_blank check (btrim(first_name) <> '' and btrim(last_name) <> '');
alter table public.teachers
  add constraint teachers_staff_id_not_blank check (btrim(staff_id) <> '');

-- ---------------------------------------------------------------------------
-- 1. Saving details
-- ---------------------------------------------------------------------------
-- '  Ada   Grace ' -> 'Ada Grace'; blank -> null
create function private.clean_text(p_value text)
returns text
language sql immutable set search_path = ''
as $$
  select nullif(regexp_replace(btrim(coalesce(p_value, '')), '\s+', ' ', 'g'), '')
$$;

create function public.update_student_details(
  p_student_id uuid,
  p_first_name text,
  p_middle_name text,
  p_last_name text,
  p_date_of_birth date,
  p_gender text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_first text := private.clean_text(p_first_name);
  v_middle text := private.clean_text(p_middle_name);
  v_last text := private.clean_text(p_last_name);
  v_gender text := nullif(lower(btrim(coalesce(p_gender, ''))), '');
  v_user_id uuid;
begin
  if not private.is_admin() then
    raise exception 'Only admins can edit student details' using errcode = '42501';
  end if;
  if v_first is null or v_last is null then
    raise exception 'Please enter both a first name and a last name.' using errcode = 'P0001';
  end if;
  if v_gender is not null and v_gender not in ('male', 'female') then
    raise exception 'Choose a valid gender.' using errcode = 'P0001';
  end if;
  if p_date_of_birth > private.school_today() then
    raise exception 'The date of birth can''t be in the future.' using errcode = 'P0001';
  end if;

  select s.user_id into v_user_id from public.students s where s.id = p_student_id;
  if v_user_id is null then
    raise exception 'That student no longer exists. Refresh the page.' using errcode = 'P0001';
  end if;

  -- Only rows that actually change are written (and so audit-logged).
  update public.users
     set first_name = v_first, middle_name = v_middle, last_name = v_last
   where id = v_user_id
     and (first_name, middle_name, last_name) is distinct from (v_first, v_middle, v_last);
  update public.students
     set date_of_birth = p_date_of_birth, gender = v_gender
   where id = p_student_id
     and (date_of_birth, gender) is distinct from (p_date_of_birth, v_gender);
end;
$$;

create function public.update_teacher_details(
  p_teacher_id uuid,
  p_first_name text,
  p_middle_name text,
  p_last_name text,
  p_staff_id text,
  p_department text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_first text := private.clean_text(p_first_name);
  v_middle text := private.clean_text(p_middle_name);
  v_last text := private.clean_text(p_last_name);
  v_staff_id text := private.clean_text(p_staff_id);
  v_department text := private.clean_text(p_department);
  v_user_id uuid;
begin
  if not private.is_admin() then
    raise exception 'Only admins can edit teacher details' using errcode = '42501';
  end if;
  if v_first is null or v_last is null then
    raise exception 'Please enter both a first name and a last name.' using errcode = 'P0001';
  end if;
  if v_staff_id is null then
    raise exception 'A staff ID is required for teachers.' using errcode = 'P0001';
  end if;

  select t.user_id into v_user_id from public.teachers t where t.id = p_teacher_id;
  if v_user_id is null then
    raise exception 'That teacher no longer exists. Refresh the page.' using errcode = 'P0001';
  end if;
  -- Same rule as at creation (the unique constraint); checked first for a clear message.
  if exists (select 1 from public.teachers t where t.staff_id = v_staff_id and t.id <> p_teacher_id) then
    raise exception 'Another teacher already has that staff ID.' using errcode = 'P0001';
  end if;

  update public.users
     set first_name = v_first, middle_name = v_middle, last_name = v_last
   where id = v_user_id
     and (first_name, middle_name, last_name) is distinct from (v_first, v_middle, v_last);
  update public.teachers
     set staff_id = v_staff_id, department = v_department
   where id = p_teacher_id
     and (staff_id, department) is distinct from (v_staff_id, v_department);
end;
$$;

revoke execute on function public.update_student_details(uuid, text, text, text, date, text) from public, anon;
revoke execute on function public.update_teacher_details(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.update_student_details(uuid, text, text, text, date, text) to authenticated;
grant execute on function public.update_teacher_details(uuid, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Email is fixed after creation
-- ---------------------------------------------------------------------------
create function private.keep_user_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and new.email is distinct from old.email then
    raise exception 'An email address can''t be changed after the account is created (it is the login).'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger users_keep_email
  before update on public.users
  for each row execute function private.keep_user_email();

-- ---------------------------------------------------------------------------
-- 4. Subjects: current session only
-- ---------------------------------------------------------------------------
create function private.student_subjects_current_session_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  -- Any enrollment touched (old and/or new) must be in the current session.
  -- A missing enrollment means it is being deleted (cascade): allowed.
  if exists (
    select 1
      from public.enrollments e
      join public.sessions s on s.id = e.session_id
     where e.id in (
             case when tg_op in ('UPDATE', 'DELETE') then old.enrollment_id end,
             case when tg_op in ('INSERT', 'UPDATE') then new.enrollment_id end
           )
       and not s.is_current
  ) then
    raise exception 'Subjects can only be changed for the current session. Past sessions are kept as they were.'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger student_subjects_current_session_only
  before insert or update or delete on public.student_subjects
  for each row execute function private.student_subjects_current_session_only();

-- ---------------------------------------------------------------------------
-- 5. What a student has recorded per subject (for the removal warning)
-- ---------------------------------------------------------------------------
create function public.student_subject_usage(p_enrollment_id uuid)
returns table (subject_id uuid, scores bigint, attendance bigint, submissions bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with e as (
    select id, student_id, session_id from public.enrollments where id = p_enrollment_id
  ),
  used as (
    select sc.subject_id, 'score' as kind
      from public.scores sc
      join public.terms t on t.id = sc.term_id
      join e on e.student_id = sc.student_id and e.session_id = t.session_id
    union all
    select ts.subject_id, 'attendance'
      from public.attendance_records ar
      join e on e.id = ar.enrollment_id
      join public.timetable_slots ts on ts.id = ar.timetable_slot_id
    union all
    select a.subject_id, 'submission'
      from public.submissions sb
      join public.assignments a on a.id = sb.assignment_id
      join public.terms t on t.id = a.term_id
      join e on e.student_id = sb.student_id and e.session_id = t.session_id
  )
  select subject_id,
         count(*) filter (where kind = 'score'),
         count(*) filter (where kind = 'attendance'),
         count(*) filter (where kind = 'submission')
    from used
   group by subject_id
$$;

revoke execute on function public.student_subject_usage(uuid) from public, anon;
grant execute on function public.student_subject_usage(uuid) to authenticated;

notify pgrst, 'reload schema';
