-- 24. Extend the term lock (migration 23) to student submissions and to
--     teachers' assignments.
--
-- Same reference point as scores and assignment grades: the assignment's
-- term closes after terms.end_date + 7 days (private.term_grading_open).
--   1. Students: once the term has closed they can't hand in NEW work or
--      change an existing submission (or upload a file for it) for that
--      term's assignments. Message:
--        "This assignment's term (First Term, 2026/2027) has closed for new
--         submissions. Contact an admin if you still need to hand this in."
--   2. Teachers: once the term has closed they can't create, edit or delete
--      an assignment in it (or upload / replace its attachment). Message
--      (same wording as migration 23):
--        "Assignments for First Term (2026/2027) are locked: ... Only an
--         admin can change them now."
--      Deleting is included because deleting an assignment also deletes its
--      submissions (and their grades), which are locked.
-- Admins (either tier) and server-side code are exempt, as everywhere else.
-- Admins can now also INSERT a submission for a student (they could already
-- edit one), so late work can be handed in through them.
-- Enforced in the same two layers: a trigger for the clear message, plus
-- the RLS policies / storage policies as the hard backstop (via
-- student_can_submit and teacher_can_post, which now include the lock).
-- Deletes are refused by the trigger alone (see below).

-- ---------------------------------------------------------------------------
-- Helpers used by RLS: now include the term lock
-- ---------------------------------------------------------------------------
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
       and private.term_grading_open(a.term_id)
  )
$$;

create or replace function private.teacher_can_post(p_section_id uuid, p_subject_id uuid, p_term_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.teacher_teaches(p_section_id, p_subject_id, p_term_id)
     and private.term_grading_open(p_term_id)
     and exists (
       select 1 from public.terms t join public.sessions s on s.id = t.session_id and s.is_current
        where t.id = p_term_id
     )
$$;

-- ---------------------------------------------------------------------------
-- Students: clear message in the submission trigger
-- ---------------------------------------------------------------------------
create or replace function private.protect_submission_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment record;
begin
  if auth.uid() is null then
    return new;
  end if;
  -- Admins may change anything, at any time. When an admin enters or
  -- corrects a mark, record them as the grader (this also locks a
  -- previously ungraded submission, as a teacher's grade would).
  if private.is_admin() then
    if tg_op = 'UPDATE' and new.score is not null
       and (new.score, new.feedback) is distinct from (old.score, old.feedback) then
      new.graded_by := private.current_user_id();
      new.graded_at := now();
    end if;
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
    -- Term lock (migration 24).
    select t.name as term_name, s.name as session_name, private.term_grading_open(t.id) as is_open
      into v_assignment
      from public.assignments a
      join public.terms t on t.id = a.term_id
      join public.sessions s on s.id = t.session_id
     where a.id = new.assignment_id;
    if found and not v_assignment.is_open then
      raise exception 'This assignment''s term (%, %) has closed for new submissions. Contact an admin if you still need to hand this in.',
        v_assignment.term_name, v_assignment.session_name;
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
  select a.max_score, a.term_id into v_assignment from public.assignments a where a.id = new.assignment_id;
  perform private.require_term_grading_open(v_assignment.term_id, 'Assignment grades');
  if new.score is null then
    raise exception 'Enter a mark to grade this submission.';
  end if;
  if v_assignment.max_score is not null and new.score > v_assignment.max_score then
    raise exception 'The mark (%) can''t be more than the assignment''s maximum (%).', new.score, v_assignment.max_score;
  end if;
  new.graded_by := private.current_user_id();
  new.graded_at := now();
  return new;
end;
$$;

-- Admins can hand work in on a student's behalf (e.g. late work after the
-- term closed, which the student is told to ask an admin about). Before this,
-- only the student themself could insert a submission.
drop policy "submissions: students submit their own work" on public.submissions;

create policy "submissions: students submit their own work, or admins"
  on public.submissions for insert to authenticated
  with check (
    (select private.is_admin())
    or (student_id = (select private.current_student_id()) and private.student_can_submit(assignment_id))
  );

-- ---------------------------------------------------------------------------
-- Teachers: clear message when creating / editing / deleting assignments
-- ---------------------------------------------------------------------------
create function private.assignment_term_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or private.is_admin() then
    return coalesce(new, old);
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    perform private.require_term_grading_open(old.term_id, 'Assignments');
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform private.require_term_grading_open(new.term_id, 'Assignments');
  end if;
  return coalesce(new, old);
end;
$$;

create trigger assignments_term_lock
  before insert or update or delete on public.assignments
  for each row execute function private.assignment_term_lock();

-- Deletes: the delete policy is unchanged (owning teacher or admins); the
-- trigger above is what refuses a teacher in a locked term. Triggers can't be
-- bypassed from the app or the API, and this way the teacher gets the clear
-- message rather than a silent "0 rows deleted".

-- ---------------------------------------------------------------------------
-- Storage: attachments follow the same locks
-- ---------------------------------------------------------------------------
create or replace function private.can_access_assignment_file(p_name text, p_write boolean)
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
      return private.is_assignment_teacher(v_assignment) and private.assignment_grading_open(v_assignment);
    end if;
    return private.can_view_assignment(v_assignment);
  end if;

  if v_parts[1] = 'submission' and array_length(v_parts, 1) >= 4 then
    v_student := private.try_uuid(v_parts[3]);
    if v_student is null then
      return false;
    end if;
    if p_write then
      -- student_can_submit includes the term lock (above)
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
