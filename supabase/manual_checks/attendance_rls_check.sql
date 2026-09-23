-- Manual check: a teacher can NOT record attendance for a class that isn't
-- theirs, even by sending the other class's ID directly to the database.
--
-- Paste into Supabase Dashboard > SQL Editor, set the teacher's email below,
-- and click Run. It acts as that teacher (exactly like the app does), tries:
--   1) a class taught by SOMEONE ELSE  -> must be BLOCKED by row-level security
--   2) one of the teacher's OWN classes -> should be ALLOWED (proves the test works)
-- NOTHING IS SAVED: the script ends with a deliberate error whose text is the
-- report, which undoes everything. A red box is expected; read the text in it.

do $$
declare
  v_teacher_email text := 'jessiikong11+jhs-teacher@gmail.com';   -- <- the teacher to test
  v_auth uuid;
  v_teacher_id uuid;
  v_report text := '';
  v_result text;
  v_case record;
begin
  select u.auth_id, t.id into v_auth, v_teacher_id
    from public.users u join public.teachers t on t.user_id = u.id
   where lower(u.email) = lower(v_teacher_email);
  if v_teacher_id is null or v_auth is null then
    raise exception 'No teacher with a login found for %', v_teacher_email;
  end if;

  for v_case in
    -- For each case: a class plus a student who takes its subject, and the
    -- most recent valid date for it (right weekday, inside the term, not future).
    select c.label, c.expect, x.slot_id, x.enrollment_id, x.class_date, x.description
      from (values ('someone else''s class', 'BLOCKED', false), ('their own class', 'ALLOWED', true)) as c(label, expect, own)
      left join lateral (
        select ts.id as slot_id, e.id as enrollment_id,
               sub.name || ' — ' || cl.name || ' ' || sec.name as description,
               d.class_date
          from public.timetable_slots ts
          join public.terms t on t.id = ts.term_id
          join public.subjects sub on sub.id = ts.subject_id
          join public.sections sec on sec.id = ts.section_id
          join public.classes cl on cl.id = sec.class_id
          join public.enrollments e on e.section_id = ts.section_id and e.session_id = t.session_id
          join public.student_subjects ss on ss.enrollment_id = e.id and ss.subject_id = ts.subject_id
          cross join lateral (
            select (now() at time zone 'Africa/Lagos')::date
                   - ((extract(isodow from (now() at time zone 'Africa/Lagos')::date)::int
                       - (array_position(enum_range(null::public.day_of_week), ts.day_of_week))
                       + 7) % 7) as class_date
          ) d
         where (ts.teacher_id = v_teacher_id) = c.own
           and d.class_date between t.start_date and t.end_date
         limit 1
      ) x on true
  loop
    if v_case.slot_id is null then
      v_report := v_report || E'\n- ' || v_case.label || ': SKIPPED (no suitable class with a student taking its subject was found)';
      continue;
    end if;

    perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
      insert into public.attendance_records (timetable_slot_id, enrollment_id, date, status)
      values (v_case.slot_id, v_case.enrollment_id, v_case.class_date, 'present');
      v_result := 'ALLOWED';
    exception when others then
      v_result := 'BLOCKED (' || sqlerrm || ')';
    end;
    execute 'reset role';

    v_report := v_report || E'\n- ' || v_case.label || ' [' || v_case.description || ', ' || v_case.class_date
      || ']: expected ' || v_case.expect || ', got ' || v_result
      || case when v_result like v_case.expect || '%' then '  PASS' else '  FAIL' end;
  end loop;

  raise exception '%', 'ATTENDANCE RLS CHECK for ' || v_teacher_email || ' — nothing was saved.' || v_report;
end;
$$;
