-- 39. Admin correction screens (attendance, scores, assignment grades).
--
-- The new admin pages save through the SAME tables, rules and triggers as
-- the teachers' pages: admins were already exempt from the 7-day attendance
-- window (migration 15) and the term grading lock (migrations 23-25), and
-- every change is audit-logged (migrations 16 and 19). Nothing about who may
-- do what changes here.
--
-- One gap is closed: an admin's assignment grade skipped ALL checks, not
-- just the term lock. It now follows the same data rules as a teacher's
-- grade (the admin exemption stays for the lock only):
--   * the mark can't be above the assignment's maximum;
--   * a grade created directly for OFFLINE work must be for a student who
--     takes the subject in that section (any enrollment status, so admins
--     can correct past sessions), with no text or file.
-- (Scores already validated admins' entries in full: maximum, components
-- complete, student takes the subject. Attendance too: weekday, inside the
-- term, not in the future, student takes the subject.)

create or replace function private.protect_submission_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment record;
  v_admin record;
begin
  if auth.uid() is null then
    return new;
  end if;
  -- Admins are exempt from the term lock and may correct any grade, at any
  -- time. When an admin enters or corrects a mark, record them as the grader
  -- (this also locks a previously ungraded submission, as a teacher's grade
  -- would). Since migration 39 an admin's mark follows the same data rules
  -- as a teacher's: not above the assignment's maximum, and a grade created
  -- directly for OFFLINE work must be for a student who takes the subject in
  -- that section (active or not: admins also correct past sessions) and has
  -- no text or file.
  if private.is_admin() then
    select a.max_score, a.requires_submission, a.section_id, a.subject_id, t.session_id
      into v_admin
      from public.assignments a
      join public.terms t on t.id = a.term_id
     where a.id = new.assignment_id;
    if new.score is not null and v_admin.max_score is not null and new.score > v_admin.max_score then
      raise exception 'The mark (%) can''t be more than the assignment''s maximum (%).', new.score, v_admin.max_score;
    end if;
    if tg_op = 'INSERT' and found and not v_admin.requires_submission then
      if new.content is not null or new.attachment_url is not null then
        raise exception 'Offline work has no text or file. Enter just the mark and feedback.' using errcode = '42501';
      end if;
      if not exists (
        select 1
          from public.enrollments e
          join public.student_subjects ss on ss.enrollment_id = e.id and ss.subject_id = v_admin.subject_id
         where e.student_id = new.student_id
           and e.section_id = v_admin.section_id
           and e.session_id = v_admin.session_id
      ) then
        raise exception 'This student doesn''t take this subject in this class, so they can''t be graded for this assignment.';
      end if;
    end if;
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

