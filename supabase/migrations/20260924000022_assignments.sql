-- 22. Assignments: subject-scoped access, submission rules, and file storage.
--
-- 1. Who sees / posts / submits (same subject + section + session scoping as
--    attendance and the gradebook):
--      * Students (and their parents) see an assignment only if the student is
--        in that section for the term's session AND takes that subject.
--      * A student can submit only to such an assignment in the CURRENT
--        session, with an active enrollment, as themselves.
--      * Teachers post / edit assignments only for classes they teach in the
--        CURRENT session; they see and grade submissions only for assignments
--        they created.
--      * Admins: everything (unchanged).
-- 2. Submissions (protect_submission_columns):
--      * Students: can't grade, can't move a submission to another assignment
--        or student, must include text or a file, and can't change it once it
--        has been graded. Submitting after the due date is ALLOWED ("late" is
--        simply submitted_at > due_at); re-submitting updates submitted_at.
--      * Teachers: can only grade (score + feedback); a score is required and
--        can't be above the assignment's max_score.
-- 3. Storage bucket "assignments" (private, 10 MB, PDF / Word / images).
--    Object paths:
--      assignment/<assignment_id>/<file>              teacher's attachment
--      submission/<assignment_id>/<student_id>/<file> student's attachment
--    assignments.attachment_url and submissions.attachment_url store the path.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- text -> uuid without erroring on bad input (for storage paths).
create function private.try_uuid(p_text text)
returns uuid
language plpgsql immutable set search_path = ''
as $$
begin
  return p_text::uuid;
exception when others then
  return null;
end;
$$;

-- Is the signed-in student (or one of the signed-in parent's children) in
-- this section for the term's session AND taking this subject?
create function private.family_takes_class(p_section_id uuid, p_subject_id uuid, p_term_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
      from public.enrollments e
      join public.terms t on t.session_id = e.session_id
      join public.student_subjects ss on ss.enrollment_id = e.id and ss.subject_id = p_subject_id
     where t.id = p_term_id
       and e.section_id = p_section_id
       and (e.student_id = private.current_student_id() or private.is_parent_of(e.student_id))
  )
$$;

-- Can the signed-in user see this assignment?
create function private.can_view_assignment(p_assignment_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.assignments a
     where a.id = p_assignment_id
       and (private.is_admin()
            or a.teacher_id = private.current_teacher_id()
            or private.family_takes_class(a.section_id, a.subject_id, a.term_id))
  )
$$;

-- The signed-in student may submit: in the section, taking the subject, in
-- the CURRENT session, enrollment active.
create or replace function private.student_can_submit(p_assignment_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
      from public.assignments a
      join public.terms t on t.id = a.term_id
      join public.sessions s on s.id = t.session_id and s.is_current
      join public.enrollments e on e.section_id = a.section_id and e.session_id = t.session_id
      join public.student_subjects ss on ss.enrollment_id = e.id and ss.subject_id = a.subject_id
     where a.id = p_assignment_id
       and e.student_id = private.current_student_id()
       and e.status = 'active'
  )
$$;

-- The signed-in teacher teaches this section + subject in this term, and the
-- term is in the CURRENT session.
create function private.teacher_can_post(p_section_id uuid, p_subject_id uuid, p_term_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.teacher_teaches(p_section_id, p_subject_id, p_term_id)
     and exists (
       select 1 from public.terms t join public.sessions s on s.id = t.session_id and s.is_current
        where t.id = p_term_id
     )
$$;

-- ---------------------------------------------------------------------------
-- Assignments policies (replace the section-only versions from migration 9)
-- ---------------------------------------------------------------------------
drop policy "assignments: its teacher, section's students/parents, admins" on public.assignments;
drop policy "assignments: teachers post for classes they teach" on public.assignments;
drop policy "assignments: owning teacher or admins can edit" on public.assignments;

create policy "assignments: its teacher, subject's students/parents, admins"
  on public.assignments for select to authenticated
  using (
    (select private.is_admin())
    or teacher_id = (select private.current_teacher_id())
    or private.family_takes_class(section_id, subject_id, term_id)
  );

create policy "assignments: teachers post for their current classes"
  on public.assignments for insert to authenticated
  with check (
    (select private.is_admin())
    or (teacher_id = (select private.current_teacher_id())
        and private.teacher_can_post(section_id, subject_id, term_id))
  );

create policy "assignments: owning teacher (current classes) or admins edit"
  on public.assignments for update to authenticated
  using ((select private.is_admin()) or teacher_id = (select private.current_teacher_id()))
  with check (
    (select private.is_admin())
    or (teacher_id = (select private.current_teacher_id())
        and private.teacher_can_post(section_id, subject_id, term_id))
  );
-- ("assignments: owning teacher or admins can delete" is unchanged.)

-- ---------------------------------------------------------------------------
-- Submissions: students must still be allowed to submit when they edit
-- ---------------------------------------------------------------------------
drop policy "submissions: student edits own, teacher grades, admins" on public.submissions;

create policy "submissions: student edits own, teacher grades, admins"
  on public.submissions for update to authenticated
  using (
    (select private.is_admin())
    or student_id = (select private.current_student_id())
    or private.is_assignment_teacher(assignment_id)
  )
  with check (
    (select private.is_admin())
    or (student_id = (select private.current_student_id()) and private.student_can_submit(assignment_id))
    or private.is_assignment_teacher(assignment_id)
  );
-- ("submissions: students submit their own work" already requires
--  student_can_submit, which is now subject- and current-session-scoped.)

create or replace function private.protect_submission_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max numeric;
begin
  if auth.uid() is null or private.is_admin() then
    return new;
  end if;

  if new.student_id = private.current_student_id() then
    if tg_op = 'UPDATE' then
      if old.graded_at is not null then
        raise exception 'This submission has already been graded, so it can no longer be changed.' using errcode = '42501';
      end if;
      if (new.assignment_id, new.student_id) is distinct from (old.assignment_id, old.student_id) then
        raise exception 'A submission can''t be moved to another assignment.' using errcode = '42501';
      end if;
    end if;
    if new.score is not null or new.feedback is not null
       or new.graded_by is not null or new.graded_at is not null then
      raise exception 'Students cannot grade submissions' using errcode = '42501';
    end if;
    if coalesce(trim(new.content), '') = '' and coalesce(new.attachment_url, '') = '' then
      raise exception 'Add some text or attach a file before submitting.';
    end if;
    new.submitted_at := now();   -- (re-)submission time; "late" = after the due date
    return new;
  end if;

  -- anyone else (e.g. a student writing another student's row): leave the
  -- refusal to RLS
  if not private.is_assignment_teacher(new.assignment_id) then
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
  if new.score is null then
    raise exception 'Enter a mark to grade this submission.';
  end if;
  select a.max_score into v_max from public.assignments a where a.id = new.assignment_id;
  if v_max is not null and new.score > v_max then
    raise exception 'The mark (%) can''t be more than the assignment''s maximum (%).', new.score, v_max;
  end if;
  new.graded_by := private.current_user_id();
  new.graded_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Storage: bucket + access rules
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'assignments', 'assignments', false, 10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg', 'image/png', 'image/gif', 'image/webp'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Who may READ / WRITE a file at this path?
--   assignment/<assignment_id>/...          read: anyone who can see the assignment
--                                           write: the assignment's teacher (admins too)
--   submission/<assignment_id>/<student>/.. read: that student, their parents, the
--                                           assignment's teacher (admins too)
--                                           write: that student while they may submit
--                                           and it isn't graded (admins too)
create function private.can_access_assignment_file(p_name text, p_write boolean)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_assignment uuid := private.try_uuid(v_parts[2]);
  v_student uuid;
begin
  if private.is_admin() then
    return true;
  end if;
  if v_assignment is null then
    return false;
  end if;

  if v_parts[1] = 'assignment' and array_length(v_parts, 1) >= 3 then
    if p_write then
      return private.is_assignment_teacher(v_assignment);
    end if;
    return private.can_view_assignment(v_assignment);
  end if;

  if v_parts[1] = 'submission' and array_length(v_parts, 1) >= 4 then
    v_student := private.try_uuid(v_parts[3]);
    if v_student is null then
      return false;
    end if;
    if p_write then
      return v_student = private.current_student_id()
         and private.student_can_submit(v_assignment)
         and not exists (select 1 from public.submissions s
                          where s.assignment_id = v_assignment and s.student_id = v_student and s.graded_at is not null);
    end if;
    return v_student = private.current_student_id()
        or private.is_parent_of(v_student)
        or private.is_assignment_teacher(v_assignment);
  end if;

  return false;
end;
$$;

create policy "assignments bucket: read"
  on storage.objects for select to authenticated
  using (bucket_id = 'assignments' and private.can_access_assignment_file(name, false));

create policy "assignments bucket: upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'assignments' and private.can_access_assignment_file(name, true));

create policy "assignments bucket: replace"
  on storage.objects for update to authenticated
  using (bucket_id = 'assignments' and private.can_access_assignment_file(name, true))
  with check (bucket_id = 'assignments' and private.can_access_assignment_file(name, true));

create policy "assignments bucket: delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'assignments' and private.can_access_assignment_file(name, true));
