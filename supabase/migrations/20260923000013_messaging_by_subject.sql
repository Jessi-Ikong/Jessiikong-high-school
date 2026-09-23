-- 13. Parent–teacher messaging scoped by SUBJECT (consistent with migration 12).
--
-- Before: a teacher and parent could open a thread if the teacher taught ANY
-- class in the child's section, e.g. the Literature teacher could message the
-- parent of a Biology student in a section with parallel electives. Sending
-- messages had no link check at all once a thread existed.
--
-- Now: in the session currently marked as CURRENT, the teacher must teach one
-- of the parent's children a subject that child takes (enrollment +
-- student_subjects for that session), both to OPEN a thread and to SEND a
-- message in it. Past sessions don't count. Threads that no longer qualify
-- (e.g. last session's teacher, or a new session has been made current) stay
-- readable as history but become read-only; they work again if the teacher
-- teaches the child a subject in the current session.
-- If no session is marked current, no new messages can be sent.
--
-- Which parents a teacher can see was already subject-based via
-- teacher_can_see_student() in migration 12.

create or replace function private.teacher_linked_to_parent(p_teacher_id uuid, p_parent_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
      from public.parent_students ps
      join public.enrollments e on e.student_id = ps.student_id
      join public.sessions s on s.id = e.session_id and s.is_current
      join public.terms t on t.session_id = e.session_id
      join public.timetable_slots ts on ts.term_id = t.id and ts.section_id = e.section_id
      join public.student_subjects ss on ss.enrollment_id = e.id and ss.subject_id = ts.subject_id
     where ps.parent_id = p_parent_id
       and ts.teacher_id = p_teacher_id
  )
$$;

-- Is this thread's parent–teacher pair linked by a subject in the CURRENT session?
create function private.thread_is_linked(p_thread_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.message_threads mt
     where mt.id = p_thread_id
       and private.teacher_linked_to_parent(mt.teacher_id, mt.parent_id)
  )
$$;

drop policy "messages: participants send as themselves" on public.messages;

create policy "messages: participants send, if teacher teaches child"
  on public.messages for insert to authenticated
  with check (
    private.is_thread_participant(thread_id)
    and sender_id = (select private.current_user_id())
    and private.thread_is_linked(thread_id)
  );
