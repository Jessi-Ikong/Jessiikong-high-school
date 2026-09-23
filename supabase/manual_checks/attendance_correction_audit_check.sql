-- Manual check: attendance corrections are written to the audit log.
--
-- Paste into Supabase Dashboard > SQL Editor, set the two emails below, click
-- Run. Using one of the teacher's own classes it creates a TEMPORARY
-- attendance record marked by the teacher, then:
--   1) the TEACHER re-saves it  -> must NOT create an audit entry
--   2) the ADMIN corrects it    -> must create ONE 'correct_attendance' entry
--      with the old/new status and the teacher kept as the original marker
-- NOTHING IS SAVED: the script ends with a deliberate error whose text is the
-- report, which undoes everything. A red box is expected; read the text in it.

do $$
declare
  v_teacher_email text := 'jessiikong11+jhs-teacher@gmail.com';   -- <- a teacher
  v_admin_email   text := 'jessiikong11@gmail.com';               -- <- an admin (either level)
  v_teacher_auth uuid; v_teacher_user uuid; v_teacher_id uuid;
  v_admin_auth uuid; v_admin_user uuid;
  v_case record;
  v_record_id uuid;
  v_before bigint;
  v_entry record;
  v_report text := '';
  v_ok boolean;
begin
  select u.auth_id, u.id, t.id into v_teacher_auth, v_teacher_user, v_teacher_id
    from public.users u join public.teachers t on t.user_id = u.id where lower(u.email) = lower(v_teacher_email);
  select u.auth_id, u.id into v_admin_auth, v_admin_user
    from public.users u where lower(u.email) = lower(v_admin_email) and u.role = 'admin';
  if v_teacher_auth is null then raise exception 'No teacher with a login found for %', v_teacher_email; end if;
  if v_admin_auth is null then raise exception 'No admin with a login found for %', v_admin_email; end if;

  -- One of the teacher's classes + a student taking its subject, on the most
  -- recent date that class met (within the last 7 days, inside the term).
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
      select private.school_today()
             - ((extract(isodow from private.school_today())::int
                 - array_position(enum_range(null::public.day_of_week), ts.day_of_week) + 7) % 7) as class_date
    ) d
   where ts.teacher_id = v_teacher_id
     and d.class_date between t.start_date and t.end_date
     and not exists (select 1 from public.attendance_records ar
                      where ar.timetable_slot_id = ts.id and ar.enrollment_id = e.id and ar.date = d.class_date)
   limit 1;
  if v_case.slot_id is null then
    raise exception 'SKIPPED: % has no class this week with a student taking its subject (and no attendance already saved for it).', v_teacher_email;
  end if;

  -- Temporary record, marked by the teacher.
  insert into public.attendance_records (timetable_slot_id, enrollment_id, date, status, marked_by)
  values (v_case.slot_id, v_case.enrollment_id, v_case.class_date, 'present', v_teacher_user)
  returning id into v_record_id;
  select count(*) into v_before from public.audit_log where action = 'correct_attendance';

  -- 1) Teacher re-saves their own record.
  perform set_config('request.jwt.claims', json_build_object('sub', v_teacher_auth, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.attendance_records set status = 'late' where id = v_record_id;
  execute 'reset role';
  v_ok := (select count(*) from public.audit_log where action = 'correct_attendance') = v_before;
  v_report := v_report || E'\n1) Teacher re-saves their own record (present -> late): expected NO audit entry, got '
    || case when v_ok then 'none' else 'an entry' end || case when v_ok then '  PASS' else '  FAIL' end;

  -- 2) Admin corrects it.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_auth, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.attendance_records set status = 'excused' where id = v_record_id;
  execute 'reset role';
  select * into v_entry from public.audit_log
   where action = 'correct_attendance' and entity_id = v_record_id::text order by id desc limit 1;
  v_ok := v_entry.id is not null
          and v_entry.user_id = v_admin_user
          and v_entry.entity = 'attendance_records'
          and v_entry.changes -> 'status' = '{"old": "late", "new": "excused"}'::jsonb
          and (v_entry.changes ->> 'original_marked_by')::uuid = v_teacher_user;
  v_report := v_report || E'\n2) Admin corrects it (late -> excused): expected ONE entry by the admin keeping the teacher as original marker, got '
    || coalesce('user_id=' || v_entry.user_id || ', changes=' || v_entry.changes::text, 'NO entry')
    || case when v_ok then '  PASS' else '  FAIL' end;

  raise exception '%', 'ATTENDANCE CORRECTION AUDIT CHECK [' || v_case.description || ', ' || v_case.class_date
    || '] — nothing was saved.' || v_report;
end;
$$;
