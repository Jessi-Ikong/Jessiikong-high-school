-- 14. Teacher visibility of students limited to the CURRENT session.
--
-- Migration 12 made teacher_can_see_student() subject-based, but it counted
-- ANY session, so a teacher kept seeing a former student's profile and
-- records forever. Now, consistent with messaging (migration 13), a teacher
-- sees a student only if they teach that student a subject the student takes
-- in the session currently marked as CURRENT.
--
-- This function feeds the SELECT policies for students, the student's users
-- row, enrollments, student_subjects, scores, attendance (via the student),
-- parent_students and parents. So once the teaching relationship ends, the
-- teacher loses live access to all of those.
--
-- Nothing is deleted or re-attributed: attendance_records and scores the
-- teacher entered stay in the database with marked_by / entered_by intact,
-- and remain visible to admins, the student and their parents. A teacher
-- still sees attendance rows for timetable slots that are THEIR OWN
-- ("attendance: slot's teacher ..." policy), but no longer the student's
-- name or profile behind them.
--
-- If no session is marked current, teachers see no students.

create or replace function private.teacher_can_see_student(p_student_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
      from public.enrollments e
      join public.sessions s on s.id = e.session_id and s.is_current
      join public.terms t on t.session_id = e.session_id
      join public.timetable_slots ts on ts.term_id = t.id and ts.section_id = e.section_id
      join public.student_subjects ss on ss.enrollment_id = e.id and ss.subject_id = ts.subject_id
     where e.student_id = p_student_id
       and ts.teacher_id = private.current_teacher_id()
  )
$$;
