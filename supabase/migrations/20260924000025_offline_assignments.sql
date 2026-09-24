-- 25. Offline assignments: work done outside the app (practicals,
--     presentations, physical projects) that the teacher grades directly.
--
--   * assignments.requires_submission (default true: existing assignments are
--     unchanged). false = "offline": nothing is handed in through the app.
--   * Students can't create or change a submission for an offline assignment
--     (or upload a file for one). Message:
--       "This assignment is offline work, so there's nothing to hand in. Your
--        teacher will grade it directly."
--   * The assignment's teacher can CREATE the graded record directly, for
--     any student who takes the subject in that section (same scoping as
--     the roster): mark required (<= max), feedback optional, no text or
--     file, graded_by / graded_at set automatically. Teachers still can't
--     create a record for a normal (hand-in) assignment.
--   * Admins: exempt as always; an admin who enters a mark on a new record is
--     now also recorded as the grader.
--   * The term lock (migrations 23/24) applies unchanged: teachers can grade
--     offline work only until the term's end_date + 7 days.
--   * requires_submission can't be switched once the assignment has any
--     submission records (by anyone), so hand-in work and offline grades
--     never get mixed on one assignment.
-- Audit: the generic trigger logs these records like any other
-- (insert_submissions / update_submissions).

alter table public.assignments
  add column requires_submission boolean not null default true;

comment on column public.assignments.requires_submission is
  'false = offline work: students hand nothing in; the teacher grades each student directly.';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Students may only submit to hand-in assignments (plus all the rules from
-- migrations 22 and 24). Used by the submissions RLS and storage policies.
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
       and a.requires_submission
       and e.student_id = private.current_student_id()
       and e.status = 'active'
       and private.term_grading_open(a.term_id)
  )
$$;

-- The signed-in teacher may create a graded record for this student on this
-- OFFLINE assignment: it's their assignment, and the student is actively
-- enrolled in its section for the term's session and takes the subject.
-- (The term lock is checked by the trigger, with its clear message, and in
-- the policy below.)
create function private.teacher_can_grade_offline(p_assignment_id uuid, p_student_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
      from public.assignments a
      join public.terms t on t.id = a.term_id
      join public.enrollments e on e.section_id = a.section_id and e.session_id = t.session_id
      join public.student_subjects ss on ss.enrollment_id = e.id and ss.subject_id = a.subject_id
     where a.id = p_assignment_id
       and not a.requires_submission
       and a.teacher_id = private.current_teacher_id()
       and e.student_id = p_student_id
       and e.status = 'active'
  )
$$;

-- ---------------------------------------------------------------------------
-- Submissions: teachers can create graded records for offline work
-- ---------------------------------------------------------------------------
create policy "submissions: teachers grade offline work directly"
  on public.submissions for insert to authenticated
  with check (
    private.teacher_can_grade_offline(assignment_id, student_id)
    and private.assignment_grading_open(assignment_id)
  );

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
    if new.score is not null
       and (tg_op = 'INSERT' or (new.score, new.feedback) is distinct from (old.score, old.feedback)) then
      new.graded_by := private.current_user_id();
      new.graded_at := now();
    end if;
    return new;
  end if;

  select a.requires_submission, a.max_score, a.term_id, t.name as term_name, s.name as session_name,
         private.term_grading_open(t.id) as is_open
    into v_assignment
    from public.assignments a
    join public.terms t on t.id = a.term_id
    join public.sessions s on s.id = t.session_id
   where a.id = new.assignment_id;

  if new.student_id = private.current_student_id() then
    -- Offline work (migration 25): nothing to hand in.
    if found and not v_assignment.requires_submission then
      raise exception 'This assignment is offline work, so there''s nothing to hand in. Your teacher will grade it directly.'
        using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' then
      if old.graded_at is not null then
        raise exception 'This submission has already been graded, so it can no longer be changed.' using errcode = '42501';
      end if;
      if (new.assignment_id, new.student_id) is distinct from (old.assignment_id, old.student_id) then
        raise exception 'A submission can''t be moved to another assignment.' using errcode = '42501';
      end if;
    end if;
    -- Term lock (migration 24).
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
  if tg_op = 'INSERT' then
    -- Only offline work can be graded without a submission (migration 25).
    if v_assignment.requires_submission then
      raise exception 'Students hand this assignment in themselves. You can grade it once they have.' using errcode = '42501';
    end if;
    if new.content is not null or new.attachment_url is not null then
      raise exception 'Offline work has no text or file. Enter just the mark and feedback.' using errcode = '42501';
    end if;
    new.submitted_at := now();   -- no hand-in for offline work: this is when the record was created
  elsif (
       new.assignment_id, new.student_id, new.content, new.attachment_url, new.submitted_at
     ) is distinct from (
       old.assignment_id, old.student_id, old.content, old.attachment_url, old.submitted_at
     ) then
    raise exception 'Teachers can only grade a submission, not change it' using errcode = '42501';
  end if;
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

-- ---------------------------------------------------------------------------
-- Assignments: don't switch between hand-in and offline once records exist
-- ---------------------------------------------------------------------------
create function private.protect_assignment_mode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.requires_submission is distinct from old.requires_submission
     and exists (select 1 from public.submissions s where s.assignment_id = old.id) then
    raise exception 'This assignment already has submissions or grades, so it can''t be switched between hand-in and offline work.';
  end if;
  return new;
end;
$$;

create trigger assignments_protect_mode
  before update on public.assignments
  for each row execute function private.protect_assignment_mode();
