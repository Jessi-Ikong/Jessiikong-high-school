-- 17. Grading: complete component set-ups, score scoping, and ranking.
--
--   1. Assessment components for a term + subject are "complete" only when
--      their weights add up to exactly 100. Admins may save components in
--      any state (they may be mid-edit), but NO score can be saved for that
--      term + subject until it is complete, and incomplete subjects are left
--      out of the class ranking.
--   2. Score entry uses the same scoping as attendance: a teacher can enter
--      scores only for students in a section they teach that subject to, who
--      take that subject (student_subjects), in the CURRENT session.
--   3. A component's max_score can't be lowered below scores already entered.
--   4. get_class_rankings() also returns each student's name and admission
--      number (only for students the caller may see, as before).

-- Do this term + subject's component weights add up to exactly 100?
create function private.components_complete(p_term_id uuid, p_subject_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(ac.weight), 0) = 100
    from public.assessment_components ac
   where ac.term_id = p_term_id and ac.subject_id = p_subject_id
$$;

create or replace function private.validate_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max numeric;
begin
  if not private.components_complete(new.term_id, new.subject_id) then
    raise exception 'Grading isn''t fully configured for this subject yet (the assessment component weights must add up to 100%%). Ask an admin to complete the assessment components.';
  end if;

  select ac.max_score into v_max
    from public.assessment_components ac where ac.id = new.component_id;
  if new.score_obtained > v_max then
    raise exception 'Score % is above the maximum of % for this component', new.score_obtained, v_max;
  end if;

  if not exists (
    select 1
      from public.enrollments e
      join public.terms t on t.session_id = e.session_id
      join public.student_subjects ss on ss.enrollment_id = e.id
     where e.student_id = new.student_id
       and t.id = new.term_id
       and ss.subject_id = new.subject_id
  ) then
    raise exception 'Student is not enrolled for this subject in this term''s session';
  end if;

  if auth.uid() is not null then
    new.entered_by := private.current_user_id();
  end if;
  return new;
end;
$$;

-- Same scoping as attendance / teacher_can_see_student (migrations 12 + 14):
-- current session, teacher teaches the section + subject that term, and the
-- student takes the subject.
create or replace function private.teacher_can_score(p_student_id uuid, p_subject_id uuid, p_term_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
      from public.enrollments e
      join public.sessions s on s.id = e.session_id and s.is_current
      join public.terms t on t.session_id = e.session_id
      join public.student_subjects ss on ss.enrollment_id = e.id and ss.subject_id = p_subject_id
     where e.student_id = p_student_id
       and t.id = p_term_id
       and private.teacher_teaches(e.section_id, p_subject_id, p_term_id)
  )
$$;

-- Don't let a component's maximum drop below scores already entered.
create function private.validate_component_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_highest numeric;
begin
  if new.max_score < old.max_score then
    select max(sc.score_obtained) into v_highest from public.scores sc where sc.component_id = new.id;
    if v_highest > new.max_score then
      raise exception 'Some students already have scores up to % for %, so its maximum can''t be lowered to %',
        v_highest, new.name, new.max_score;
    end if;
  end if;
  return new;
end;
$$;

create trigger assessment_components_validate_change
  before update on public.assessment_components
  for each row execute function private.validate_component_change();

-- Ranking: only subjects whose components are complete (sum to 100) count.
-- Otherwise unchanged from migration 8: a subject's % = sum(score / max x
-- weight) / sum(weight) x 100 over the components already graded in that
-- section (a missing score for a graded component = 0); a student's average
-- is the mean of their subject %s; rank within section + term, ties share.
create or replace view private.student_subject_results as
with graded_components as (
  select distinct sc.component_id, e.section_id
    from public.scores sc
    join public.assessment_components ac on ac.id = sc.component_id
    join public.terms t on t.id = ac.term_id
    join public.enrollments e on e.student_id = sc.student_id and e.session_id = t.session_id
),
complete_setups as (
  select ac.term_id, ac.subject_id
    from public.assessment_components ac
   group by ac.term_id, ac.subject_id
  having sum(ac.weight) = 100
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
join complete_setups cs on cs.term_id = t.id and cs.subject_id = ss.subject_id
join public.assessment_components ac on ac.term_id = t.id and ac.subject_id = ss.subject_id
join graded_components gc on gc.component_id = ac.id and gc.section_id = e.section_id
left join public.scores sc on sc.component_id = ac.id and sc.student_id = e.student_id
where e.status <> 'withdrawn'
group by e.id, e.student_id, e.class_id, e.section_id, t.id, ss.subject_id;

drop function public.get_class_rankings(uuid, uuid);

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
  class_size integer,
  admission_number text,
  full_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select r.enrollment_id, r.student_id, r.class_id, r.section_id, r.term_id,
         r.subjects_counted, r.average_score, r.position, r.class_size,
         st.admission_number,
         concat_ws(' ', u.first_name, u.middle_name, u.last_name)
    from private.class_rankings r
    join public.students st on st.id = r.student_id
    join public.users u on u.id = st.user_id
   where r.term_id = p_term_id
     and (p_section_id is null or r.section_id = p_section_id)
     and private.can_view_student(r.student_id)
   order by r.section_id, r.position, u.last_name, u.first_name;
end;
$$;
revoke execute on function public.get_class_rankings(uuid, uuid) from public, anon;
grant execute on function public.get_class_rankings(uuid, uuid) to authenticated;
