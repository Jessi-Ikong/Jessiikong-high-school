-- 12. Attendance and teacher visibility scoped by SUBJECT, not just section.
--
-- Since migration 11 a section can have parallel classes in one period
-- (e.g. Biology and Literature). A student belongs to a class only if they
-- take its subject (student_subjects for that session's enrollment).
--
-- Changes:
--   1. validate_attendance(): the student must take the slot's subject, and
--      attendance can't be recorded for a future date (school time zone).
--   2. teacher_can_see_student(): a teacher sees a student only if they teach
--      that student's section AND one of the student's own subjects. This
--      narrows student / enrollment / parent visibility for parallel classes.
--
-- The attendance RLS policies themselves are unchanged: a teacher can only
-- insert/update attendance for timetable slots where they are the teacher.

create or replace function private.validate_attendance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot record;
  v_enrollment record;
begin
  select ts.section_id, ts.day_of_week, ts.subject_id, sub.name as subject_name,
         t.session_id, t.start_date, t.end_date
    into v_slot
    from public.timetable_slots ts
    join public.terms t on t.id = ts.term_id
    join public.subjects sub on sub.id = ts.subject_id
   where ts.id = new.timetable_slot_id;

  select e.section_id, e.session_id into v_enrollment
    from public.enrollments e where e.id = new.enrollment_id;

  if v_enrollment.section_id <> v_slot.section_id or v_enrollment.session_id <> v_slot.session_id then
    raise exception 'Student is not enrolled in this timetable slot''s section for that session';
  end if;
  if not exists (
    select 1 from public.student_subjects ss
     where ss.enrollment_id = new.enrollment_id and ss.subject_id = v_slot.subject_id
  ) then
    raise exception 'This student does not take %, so their attendance cannot be recorded for this class', v_slot.subject_name;
  end if;
  if to_char(new.date, 'FMday') <> v_slot.day_of_week::text then
    raise exception 'Date % is a %, but this timetable slot is on %',
      new.date, to_char(new.date, 'FMday'), v_slot.day_of_week;
  end if;
  if new.date not between v_slot.start_date and v_slot.end_date then
    raise exception 'Date % is outside the term (% to %)', new.date, v_slot.start_date, v_slot.end_date;
  end if;
  -- "Today" in the school's time zone (Nigeria), not the server's (UTC).
  if new.date > (now() at time zone 'Africa/Lagos')::date then
    raise exception 'Attendance cannot be recorded for a future date (%)', new.date;
  end if;

  if auth.uid() is not null then
    new.marked_by := private.current_user_id();
  end if;
  return new;
end;
$$;

create or replace function private.teacher_can_see_student(p_student_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
      from public.enrollments e
      join public.terms t on t.session_id = e.session_id
      join public.timetable_slots ts on ts.term_id = t.id and ts.section_id = e.section_id
      join public.student_subjects ss on ss.enrollment_id = e.id and ss.subject_id = ts.subject_id
     where e.student_id = p_student_id
       and ts.teacher_id = private.current_teacher_id()
  )
$$;
