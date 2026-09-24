-- 23. Grading edit lock: scores and assignment grades close 7 days after
--     their TERM ends.
--
-- Both use the same reference point: terms.end_date + 7 days (school time,
-- private.school_today() from migration 15).
--   * scores: the score's own term_id.
--   * assignment grades (submissions.score / feedback): the assignment's
--     term_id.
-- Up to and including end_date + 7 a teacher may enter or change them (with
-- all the existing rules). From the day after, only an admin (either tier)
-- can; teachers get a clear message naming the term. Server-side code
-- (service role, no signed-in user) is exempt, like attendance.
--
-- Two layers, the same pattern as the attendance window (migration 15):
--   1. Triggers refuse with the clear message (validate_score,
--      protect_submission_columns). On a score UPDATE both the stored term
--      and the new term are checked, so a score can't be moved out of a
--      locked term either.
--   2. RLS INSERT/UPDATE policies also require the term to be open for
--      non-admins, as a hard backstop. UPDATE USING clauses deliberately
--      don't filter by the window, so a teacher's edit reaches the trigger
--      and gets the message instead of silently changing 0 rows.
-- Corrections by admins are recorded by the generic audit trigger
-- (migration 19) as update_scores / update_submissions, with old and new
-- values and who made them. Nothing extra is needed.

-- Is this term still open for teachers' grading (today <= end_date + 7)?
create function private.term_grading_open(p_term_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.terms t
     where t.id = p_term_id and private.school_today() <= t.end_date + 7
  )
$$;

-- Raise the teachers' message if the term's window has closed.
-- p_what: 'Scores' or 'Assignment grades'.
create function private.require_term_grading_open(p_term_id uuid, p_what text)
returns void
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_term record;
begin
  if private.term_grading_open(p_term_id) then
    return;
  end if;
  select t.name, s.name as session_name, t.end_date into v_term
    from public.terms t join public.sessions s on s.id = t.session_id
   where t.id = p_term_id;
  raise exception '% for % (%) are locked: the term ended on % and teachers could make changes until %. Only an admin can change them now.',
    p_what, v_term.name, v_term.session_name,
    to_char(v_term.end_date, 'FMDD Mon YYYY'), to_char(v_term.end_date + 7, 'FMDD Mon YYYY')
    using errcode = 'P0001';
end;
$$;

-- ---------------------------------------------------------------------------
-- Scores
-- ---------------------------------------------------------------------------
create or replace function private.validate_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max numeric;
begin
  -- Term edit lock for everyone except admins and server-side code.
  if auth.uid() is not null and not private.is_admin() then
    perform private.require_term_grading_open(new.term_id, 'Scores');
    if tg_op = 'UPDATE' and old.term_id is distinct from new.term_id then
      perform private.require_term_grading_open(old.term_id, 'Scores');
    end if;
  end if;

  if not private.components_complete(new.term_id, new.subject_id) then
    raise exception 'Grading isn''t fully configured for this subject yet (the assessment component weights must add up to 100%%). Ask an admin to complete the assessment components.';
  end if;

  select ac.max_score into v_max
    from public.assessment_components ac where ac.id = new.component_id;
  if new.score_obtained > v_max then
    raise exception 'Score % is above the maximum of % for this component', new.score_obtained, v_max;
  end if;

  if not exists (
    select 1
      from public.enrollments e
      join public.terms t on t.session_id = e.session_id
      join public.student_subjects ss on ss.enrollment_id = e.id
     where e.student_id = new.student_id
       and t.id = new.term_id
       and ss.subject_id = new.subject_id
  ) then
    raise exception 'Student is not enrolled for this subject in this term''s session';
  end if;

  if auth.uid() is not null then
    new.entered_by := private.current_user_id();
  end if;
  return new;
end;
$$;

drop policy "scores: subject teacher or admins can enter" on public.scores;
drop policy "scores: subject teacher or admins can update" on public.scores;

create policy "scores: admins, or subject teacher while term open, enter"
  on public.scores for insert to authenticated
  with check (
    (select private.is_admin())
    or (private.teacher_can_score(student_id, subject_id, term_id) and private.term_grading_open(term_id))
  );

create policy "scores: admins, or subject teacher while term open, update"
  on public.scores for update to authenticated
  using ((select private.is_admin()) or private.teacher_can_score(student_id, subject_id, term_id))
  with check (
    (select private.is_admin())
    or (private.teacher_can_score(student_id, subject_id, term_id) and private.term_grading_open(term_id))
  );

-- ---------------------------------------------------------------------------
-- Assignment grades
-- ---------------------------------------------------------------------------
-- Is the assignment's term still open for grading?
create function private.assignment_grading_open(p_assignment_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.term_grading_open(a.term_id) from public.assignments a where a.id = p_assignment_id
$$;

-- Same as migration 22, plus: the term lock in the teacher (grading) branch,
-- and admins who enter or correct a mark are recorded as the grader.
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
    or (private.is_assignment_teacher(assignment_id) and private.assignment_grading_open(assignment_id))
  );
