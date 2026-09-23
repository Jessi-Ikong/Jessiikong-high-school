-- Manual check: the 7-day attendance edit window.
--
-- Paste into Supabase Dashboard > SQL Editor, set the two emails below, click
-- Run. It finds one of the teacher's own classes with a student who takes the
-- subject, creates a TEMPORARY attendance record dated more than 7 days ago,
-- and then tries to change it:
--   1) as the TEACHER -> must be refused ("older than 7 days ... admin")
--   2) as the ADMIN   -> must be allowed (what the future admin screen will do)
-- NOTHING IS SAVED: the script ends with a deliberate error whose text is the
-- report, which undoes everything. A red box is expected; read the text in it.

do $$
declare
  v_teacher_email text := 'jessiikong11+jhs-teacher@gmail.com';   -- <- a teacher
  v_admin_email   text := 'jessiikong11@gmail.com';               -- <- an admin (either level)
  v_teacher_auth uuid;
  v_teacher_id uuid;
  v_admin_auth uuid;
  v_case record;
  v_result text;
  v_report text := '';
begin
  select u.auth_id, t.id into v_teacher_auth, v_teacher_id
    from public.users u join public.teachers t on t.user_id = u.id where lower(u.email) = lower(v_teacher_email);
  select u.auth_id into v_admin_auth
    from public.users u where lower(u.email) = lower(v_admin_email) and u.role = 'admin';
  if v_teacher_auth is null then raise exception 'No teacher with a login found for %', v_teacher_email; end if;
  if v_admin_auth is null then raise exception 'No admin with a login found for %', v_admin_email; end if;

  -- One of the teacher's classes + a student taking its subject, and the most
  -- recent class date that is MORE than 7 days ago and inside the term.
  select ts.id as slot_id, e.id as enrollment_id, sub.name || ' — ' || cl.name || ' ' || sec.name as description, d.class_date
    into v_case
    from public.timetable_slots ts
    join public.terms t on t.id = ts.term_id
    join public.subjects sub on sub.id = ts.subject_id
    join public.sections sec on sec.id = ts.section_id
    join public.classes cl on cl.id = sec.class_id
    join public.enrollments e on e.section_id = ts.section_id and e.session_id = t.session_id
    join public.student_subjects ss on ss.enrollment_id = e.id and ss.subject_id = ts.subject_id
    cross join lateral (
      select private.school_today() - 8
             - ((extract(isodow from private.school_today() - 8)::int
                 - array_position(enum_range(null::public.day_of_week), ts.day_of_week) + 7) % 7) as class_date
    ) d
   where ts.teacher_id = v_teacher_id
     and d.class_date between t.start_date and t.end_date
   limit 1;
  if v_case.slot_id is null then
    raise exception 'SKIPPED: % has no class with a student taking its subject on a date more than 7 days ago inside the term (the term may have started less than 8 days ago).', v_teacher_email;
  end if;

  -- Temporary old record (created as the database owner, so the window doesn't apply).
  insert into public.attendance_records (timetable_slot_id, enrollment_id, date, status, marked_by)
  values (v_case.slot_id, v_case.enrollment_id, v_case.class_date, 'present',
          (select id from public.users where auth_id = v_teacher_auth));

  -- 1) As the teacher
  perform set_config('request.jwt.claims', json_build_object('sub', v_teacher_auth, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    update public.attendance_records set status = 'absent'
     where timetable_slot_id = v_case.slot_id and enrollment_id = v_case.enrollment_id and date = v_case.class_date;
    v_result := 'ALLOWED';
  exception when others then
    v_result := 'REFUSED (' || sqlerrm || ')';
  end;
  execute 'reset role';
  v_report := v_report || E'\n1) Teacher edits attendance from ' || v_case.class_date || ' (' || (private.school_today() - v_case.class_date)
    || ' days old, ' || v_case.description || '): expected REFUSED, got ' || v_result
    || case when v_result like 'REFUSED (Attendance older than 7 days%' then '  PASS' else '  FAIL' end;

  -- 2) As the admin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_auth, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    update public.attendance_records set status = 'excused'
     where timetable_slot_id = v_case.slot_id and enrollment_id = v_case.enrollment_id and date = v_case.class_date;
    v_result := case when found then 'ALLOWED' else 'NOTHING CHANGED' end;
  exception when others then
    v_result := 'REFUSED (' || sqlerrm || ')';
  end;
  execute 'reset role';
  v_report := v_report || E'\n2) Admin corrects the same record: expected ALLOWED, got ' || v_result
    || case when v_result = 'ALLOWED' then '  PASS' else '  FAIL' end;

  raise exception '%', 'ATTENDANCE 7-DAY WINDOW CHECK — nothing was saved.' || v_report;
end;
$$;
