-- 10. Account creation used by the invite-user Edge Function.
--
-- How accounts are created (see supabase/functions/invite-user):
--   1. The Edge Function checks the caller is an admin.
--   2. It calls admin_create_account(), which creates the public.users row
--      and the role row (teachers / students / parents) - and, for students,
--      the admission number, enrollment and subjects - in ONE transaction.
--      If anything is invalid, nothing is created and no email is sent.
--   3. It sends the Supabase Auth invite and links the new login (auth_id).
--   4. If the invite fails, it calls admin_discard_account() to undo step 2.
--
-- Both functions can only be called with the service role key (server side).

create function public.admin_create_account(
  p_actor_auth_id uuid,        -- the admin doing this, for the audit log
  p_role public.user_role,
  p_first_name text,
  p_middle_name text,
  p_last_name text,
  p_email text,                -- required for every account (it becomes their login)
  p_admin_level public.admin_level default null,
  p_staff_id text default null,
  p_department text default null,
  p_date_of_birth date default null,
  p_gender text default null,
  p_session_id uuid default null,
  p_class_id uuid default null,
  p_section_id uuid default null,
  p_subject_ids uuid[] default '{}'
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_student_id uuid;
  v_enrollment_id uuid;
  v_admission_number text;
begin
  -- Attribute the audit log entries to the admin who made the request.
  perform set_config('request.jwt.claims', json_build_object('sub', p_actor_auth_id)::text, true);

  if coalesce(trim(p_email), '') = '' then
    raise exception 'An email address is required' using errcode = '22023';
  end if;
  -- One login per email: a student can never share a parent's address.
  if p_role = 'student' and exists (
    select 1 from public.users u
     where u.role = 'parent' and lower(u.email) = lower(trim(p_email))
  ) then
    raise exception 'This email is already registered as a parent account — students need their own email address'
      using errcode = '22023';
  end if;
  if p_role = 'teacher' and coalesce(trim(p_staff_id), '') = '' then
    raise exception 'A staff ID is required for teachers' using errcode = '22023';
  end if;
  if p_role = 'student' and (p_session_id is null or p_class_id is null or p_section_id is null) then
    raise exception 'Session, class and section are required for students' using errcode = '22023';
  end if;

  insert into public.users (role, admin_level, first_name, middle_name, last_name, email)
  values (p_role, p_admin_level, p_first_name, nullif(trim(p_middle_name), ''), p_last_name,
          lower(trim(p_email)))
  returning id into v_user_id;

  if p_role = 'teacher' then
    insert into public.teachers (user_id, staff_id, department)
    values (v_user_id, trim(p_staff_id), nullif(trim(p_department), ''));

  elsif p_role = 'parent' then
    insert into public.parents (user_id) values (v_user_id);

  elsif p_role = 'student' then
    -- admission_number is filled by the students_assign_admission_number
    -- trigger, which calls public.generate_admission_number(session).
    insert into public.students (user_id, admission_session_id, date_of_birth, gender)
    values (v_user_id, p_session_id, p_date_of_birth, p_gender)
    returning id, admission_number into v_student_id, v_admission_number;

    insert into public.enrollments (student_id, session_id, class_id, section_id)
    values (v_student_id, p_session_id, p_class_id, p_section_id)
    returning id into v_enrollment_id;

    insert into public.student_subjects (enrollment_id, subject_id)
    select v_enrollment_id, s from unnest(p_subject_ids) as s
    on conflict do nothing;
  end if;

  return jsonb_build_object(
    'user_id', v_user_id,
    'student_id', v_student_id,
    'admission_number', v_admission_number
  );
end;
$$;

-- Undo admin_create_account() when the invite could not be sent.
-- SECURITY DEFINER because it adjusts private.admission_sequences, which the
-- service role cannot touch directly. Execution is still service-role only.
create function public.admin_discard_account(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student record;
  v_number integer;
begin
  select s.id, s.admission_session_id, s.admission_number into v_student
    from public.students s where s.user_id = p_user_id;

  if v_student.id is not null then
    delete from public.invoices where student_id = v_student.id;
    delete from public.enrollments where student_id = v_student.id;   -- cascades to student_subjects

    -- Give the admission number back if it was the last one issued, so a
    -- failed invite doesn't leave a gap in the numbering.
    v_number := nullif(regexp_replace(v_student.admission_number, '^.*/', ''), '')::integer;
    update private.admission_sequences
       set last_value = last_value - 1
     where session_id = v_student.admission_session_id
       and last_value = v_number;
  end if;

  delete from public.users where id = p_user_id;   -- cascades to teachers / students / parents
end;
$$;

revoke execute on function public.admin_create_account(uuid, public.user_role, text, text, text, text, public.admin_level, text, text, date, text, uuid, uuid, uuid, uuid[])
  from public, anon, authenticated;
revoke execute on function public.admin_discard_account(uuid) from public, anon, authenticated;
grant execute on function public.admin_create_account(uuid, public.user_role, text, text, text, text, public.admin_level, text, text, date, text, uuid, uuid, uuid, uuid[])
  to service_role;
grant execute on function public.admin_discard_account(uuid) to service_role;
