-- 37. Read-only summaries for the dashboards.
--
-- The dashboards summarise existing data (attendance, invoices, timetable).
-- Doing that in the browser would mean downloading thousands of rows, and the
-- API returns at most 1,000 rows per request, so totals would be silently
-- wrong. These functions add things up in the database instead.
--
-- All of them are SECURITY INVOKER: they run with the CALLER's permissions,
-- so the existing row rules (RLS) decide what is counted. An admin's totals
-- cover the whole school; a parent's only their own children; a student's
-- only themselves. They open no new access path and change nothing.
--
--   attendance_by_section(from, to)            marked attendance per class section
--   student_attendance_rates(from, to, ids)    attendance rate per student
--   fee_totals(term)                           invoice totals for a term
--   timetable_gaps(term)                       subjects students take with no teacher timetabled
--
-- Attendance rate = (present + late) / (records - excused): late still
-- counts as attending; an excused absence counts neither for nor against.

create function public.attendance_by_section(p_from date, p_to date)
returns table (
  section_id uuid,
  class_name text,
  class_level smallint,
  section_name text,
  records bigint,
  present bigint,
  late bigint,
  absent bigint,
  excused bigint,
  students bigint
)
language sql stable security invoker set search_path = ''
as $$
  select sec.id, c.name, c.level, sec.name,
         count(*),
         count(*) filter (where ar.status = 'present'),
         count(*) filter (where ar.status = 'late'),
         count(*) filter (where ar.status = 'absent'),
         count(*) filter (where ar.status = 'excused'),
         count(distinct ar.enrollment_id)
    from public.attendance_records ar
    join public.timetable_slots ts on ts.id = ar.timetable_slot_id
    join public.sections sec on sec.id = ts.section_id
    join public.classes c on c.id = sec.class_id
   where ar.date between p_from and p_to
   group by sec.id, c.name, c.level, sec.name
   order by c.level, sec.name
$$;

-- p_student_ids null = every student the caller can see.
create function public.student_attendance_rates(p_from date, p_to date, p_student_ids uuid[] default null)
returns table (
  student_id uuid,
  full_name text,
  class_name text,
  section_name text,
  records bigint,
  attended bigint,
  absent bigint,
  excused bigint,
  rate numeric   -- 0-100, null if nothing counts yet
)
language sql stable security invoker set search_path = ''
as $$
  select e.student_id,
         concat_ws(' ', u.first_name, u.last_name),
         c.name, sec.name,
         count(*),
         count(*) filter (where ar.status in ('present', 'late')),
         count(*) filter (where ar.status = 'absent'),
         count(*) filter (where ar.status = 'excused'),
         round(100.0 * count(*) filter (where ar.status in ('present', 'late'))
               / nullif(count(*) filter (where ar.status <> 'excused'), 0), 1)
    from public.attendance_records ar
    join public.enrollments e on e.id = ar.enrollment_id
    join public.classes c on c.id = e.class_id
    join public.sections sec on sec.id = e.section_id
    left join public.students st on st.id = e.student_id
    left join public.users u on u.id = st.user_id
   where ar.date between p_from and p_to
     and (p_student_ids is null or e.student_id = any(p_student_ids))
   group by e.student_id, u.first_name, u.last_name, c.name, sec.name
$$;

create function public.fee_totals(p_term_id uuid)
returns table (
  invoices bigint,
  amount_due numeric,
  amount_paid numeric,
  paid bigint,
  partial bigint,
  unpaid bigint,
  overdue bigint,
  overdue_amount numeric
)
language sql stable security invoker set search_path = ''
as $$
  select count(*),
         coalesce(sum(i.amount_due), 0),
         coalesce(sum(i.amount_paid), 0),
         count(*) filter (where i.status = 'paid'),
         count(*) filter (where i.status = 'partial'),
         count(*) filter (where i.status = 'unpaid'),
         count(*) filter (where i.status = 'overdue'),
         coalesce(sum(greatest(i.amount_due - i.amount_paid, 0)) filter (where i.status = 'overdue'), 0)
    from public.invoices i
   where i.term_id = p_term_id
$$;

-- Subjects that students actively enrolled in a section TAKE, but that no
-- teacher is timetabled to teach in that section this term.
create function public.timetable_gaps(p_term_id uuid)
returns table (
  section_id uuid,
  class_name text,
  section_name text,
  subject_name text,
  students bigint
)
language sql stable security invoker set search_path = ''
as $$
  select sec.id, c.name, sec.name, sub.name, count(distinct e.id)
    from public.terms t
    join public.enrollments e on e.session_id = t.session_id and e.status = 'active'
    join public.student_subjects ss on ss.enrollment_id = e.id
    join public.sections sec on sec.id = e.section_id
    join public.classes c on c.id = sec.class_id
    join public.subjects sub on sub.id = ss.subject_id
   where t.id = p_term_id
     and not exists (
       select 1 from public.timetable_slots ts
        where ts.term_id = t.id and ts.section_id = e.section_id and ts.subject_id = ss.subject_id
     )
   group by sec.id, c.name, c.level, sec.name, sub.name
   order by c.level, sec.name, sub.name
$$;

revoke execute on function public.attendance_by_section(date, date) from public, anon;
revoke execute on function public.student_attendance_rates(date, date, uuid[]) from public, anon;
revoke execute on function public.fee_totals(uuid) from public, anon;
revoke execute on function public.timetable_gaps(uuid) from public, anon;
grant execute on function public.attendance_by_section(date, date) to authenticated;
grant execute on function public.student_attendance_rates(date, date, uuid[]) to authenticated;
grant execute on function public.fee_totals(uuid) to authenticated;
grant execute on function public.timetable_gaps(uuid) to authenticated;

notify pgrst, 'reload schema';
