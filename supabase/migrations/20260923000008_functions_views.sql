-- 8. Functions & views: admission number generator, class ranking

-- ---------------------------------------------------------------------------
-- Admission numbers: STU/{year}/{0001, 0002, ...}
-- The sequence restarts for each session; {year} is the session's start year.
-- ---------------------------------------------------------------------------
create table private.admission_sequences (
  session_id uuid primary key references public.sessions (id) on delete cascade,
  last_value integer not null
);
alter table private.admission_sequences enable row level security;

create function public.generate_admission_number(p_session_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year integer;
  v_seq integer;
begin
  select extract(year from s.start_date)::integer into v_year
    from public.sessions s where s.id = p_session_id;
  if v_year is null then
    raise exception 'Session % does not exist', p_session_id;
  end if;

  -- atomic increment: safe when several students are admitted at once
  insert into private.admission_sequences as a (session_id, last_value)
  values (p_session_id, 1)
  on conflict (session_id) do update set last_value = a.last_value + 1
  returning a.last_value into v_seq;

  return format('STU/%s/%s', v_year, lpad(v_seq::text, greatest(4, length(v_seq::text)), '0'));
end;
$$;
-- Only the database itself (and server-side code) may consume numbers.
revoke execute on function public.generate_admission_number(uuid) from public, anon, authenticated;

-- Fill in the admission number when a student is admitted, unless one was
-- supplied explicitly (e.g. importing existing students).
create function private.assign_admission_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.admission_number is null then
    new.admission_number := public.generate_admission_number(new.admission_session_id);
  end if;
  return new;
end;
$$;

create trigger students_assign_admission_number
  before insert on public.students
  for each row execute function private.assign_admission_number();

-- ---------------------------------------------------------------------------
-- Class ranking (computed live from scores; nothing is stored)
-- ---------------------------------------------------------------------------

-- Per student, term and subject: weighted score as a percentage.
--   subject % = sum(score / max_score * weight) / sum(weight) * 100
-- Only components that have at least one score entered in that section are
-- counted, so subjects/components not graded yet don't drag averages down.
-- A student missing a score for a counted component gets 0 for it.
-- Withdrawn enrollments are excluded.
create view private.student_subject_results as
with graded_components as (
  select distinct sc.component_id, e.section_id
    from public.scores sc
    join public.assessment_components ac on ac.id = sc.component_id
    join public.terms t on t.id = ac.term_id
    join public.enrollments e on e.student_id = sc.student_id and e.session_id = t.session_id
)
select
  e.id as enrollment_id,
  e.student_id,
  e.class_id,
  e.section_id,
  t.id as term_id,
  ss.subject_id,
  round(
    sum(coalesce(sc.score_obtained, 0) / ac.max_score * ac.weight) / sum(ac.weight) * 100,
    2
  ) as weighted_score
from public.enrollments e
join public.terms t on t.session_id = e.session_id
join public.student_subjects ss on ss.enrollment_id = e.id
join public.assessment_components ac on ac.term_id = t.id and ac.subject_id = ss.subject_id
join graded_components gc on gc.component_id = ac.id and gc.section_id = e.section_id
left join public.scores sc on sc.component_id = ac.id and sc.student_id = e.student_id
where e.status <> 'withdrawn'
group by e.id, e.student_id, e.class_id, e.section_id, t.id, ss.subject_id;

-- Per student and term: average of subject percentages and position within
-- the section. Ties share a position (1, 1, 3).
create view private.class_rankings as
select
  enrollment_id,
  student_id,
  class_id,
  section_id,
  term_id,
  count(*)::integer as subjects_counted,
  round(avg(weighted_score), 2) as average_score,
  rank() over (partition by section_id, term_id order by avg(weighted_score) desc)::integer as position,
  count(*) over (partition by section_id, term_id)::integer as class_size
from private.student_subject_results
group by enrollment_id, student_id, class_id, section_id, term_id;

-- Public entry point. Positions are computed over the WHOLE section, then
-- only rows the caller may see are returned (a parent sees their child's
-- true position without seeing classmates' results).
create function public.get_class_rankings(p_term_id uuid, p_section_id uuid default null)
returns table (
  enrollment_id uuid,
  student_id uuid,
  class_id uuid,
  section_id uuid,
  term_id uuid,
  subjects_counted integer,
  average_score numeric,
  "position" integer,
  class_size integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select r.enrollment_id, r.student_id, r.class_id, r.section_id, r.term_id,
         r.subjects_counted, r.average_score, r.position, r.class_size
    from private.class_rankings r
   where r.term_id = p_term_id
     and (p_section_id is null or r.section_id = p_section_id)
     and private.can_view_student(r.student_id)   -- defined in migration 9
   order by r.section_id, r.position;
end;
$$;
revoke execute on function public.get_class_rankings(uuid, uuid) from public, anon;
grant execute on function public.get_class_rankings(uuid, uuid) to authenticated;
