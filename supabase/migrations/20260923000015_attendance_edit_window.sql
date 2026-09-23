-- 15. Seven-day edit window for attendance.
--
-- Teachers may record or change attendance only for dates within the last
-- 7 days (today and the 7 days before it, Nigerian time). Older records can
-- only be corrected by an admin (either tier). This is on top of the existing
-- rules: own class, student takes the subject, right weekday, inside the
-- term, not in the future.
--
-- Enforced in two layers:
--   1. validate_attendance() refuses with a clear message:
--        "Attendance older than 7 days can only be corrected by an admin."
--      On UPDATE it checks both the stored date and the new date, so an old
--      record can't be edited, and a record can't be moved into or out of
--      the window.
--   2. The attendance INSERT / UPDATE RLS policies also require the date to
--      be inside the window for non-admins, as a hard backstop. The UPDATE
--      policy's USING clause deliberately does NOT filter by date, so a
--      teacher's edit of an old record reaches the trigger and gets the
--      clear message, instead of silently changing 0 rows.
-- Admins are exempt in both layers. Server-side code (service role, no
-- signed-in user) is also exempt from the trigger check and bypasses RLS.

-- "Today" for the school (Nigeria), since the database server runs on UTC.
create function private.school_today()
returns date
language sql stable set search_path = ''
as $$
  select (now() at time zone 'Africa/Lagos')::date
$$;

-- Is this date inside the teacher edit window (today and the 7 days before)?
create function private.within_attendance_edit_window(p_date date)
returns boolean
language sql stable set search_path = ''
as $$
  select p_date >= private.school_today() - 7
$$;

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
  -- 7-day window for everyone except admins and server-side code.
  if auth.uid() is not null and not private.is_admin() then
    if not private.within_attendance_edit_window(new.date)
       or (tg_op = 'UPDATE' and not private.within_attendance_edit_window(old.date)) then
      raise exception 'Attendance older than 7 days can only be corrected by an admin.';
    end if;
  end if;

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
  if new.date > private.school_today() then
    raise exception 'Attendance cannot be recorded for a future date (%)', new.date;
  end if;

  if auth.uid() is not null then
    new.marked_by := private.current_user_id();
  end if;
  return new;
end;
$$;

drop policy "attendance: slot's teacher or admins can mark" on public.attendance_records;
drop policy "attendance: slot's teacher or admins can correct" on public.attendance_records;

create policy "attendance: admins, or slot's teacher within 7 days, can mark"
  on public.attendance_records for insert to authenticated
  with check (
    (select private.is_admin())
    or (private.teacher_owns_slot(timetable_slot_id) and private.within_attendance_edit_window(date))
  );

create policy "attendance: admins, or slot's teacher within 7 days, can edit"
  on public.attendance_records for update to authenticated
  using ((select private.is_admin()) or private.teacher_owns_slot(timetable_slot_id))
  with check (
    (select private.is_admin())
    or (private.teacher_owns_slot(timetable_slot_id) and private.within_attendance_edit_window(date))
  );
