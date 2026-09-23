-- 5. Attendance & grading: attendance_records, assessment_components, scores

-- Attendance is per lesson: one row per student (enrollment) per timetable
-- slot per date. Daily / overall attendance % is derived by aggregation.
create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  timetable_slot_id uuid not null references public.timetable_slots (id) on delete restrict,
  enrollment_id uuid not null references public.enrollments (id) on delete restrict,
  date date not null,
  status public.attendance_status not null,
  marked_by uuid references public.users (id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (timetable_slot_id, enrollment_id, date)
);
create index attendance_records_enrollment_idx on public.attendance_records (enrollment_id, date);
create index attendance_records_slot_date_idx on public.attendance_records (timetable_slot_id, date);

create trigger attendance_records_set_updated_at
  before update on public.attendance_records
  for each row execute function private.set_updated_at();

-- Keeps attendance consistent with the timetable: the student must be in the
-- slot's section for that session, the date must fall on the slot's weekday
-- and inside the term. Also stamps marked_by with whoever is signed in.
create function private.validate_attendance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot record;
  v_enrollment record;
begin
  select ts.section_id, ts.day_of_week, t.session_id, t.start_date, t.end_date
    into v_slot
    from public.timetable_slots ts
    join public.terms t on t.id = ts.term_id
   where ts.id = new.timetable_slot_id;

  select e.section_id, e.session_id into v_enrollment
    from public.enrollments e where e.id = new.enrollment_id;

  if v_enrollment.section_id <> v_slot.section_id or v_enrollment.session_id <> v_slot.session_id then
    raise exception 'Student is not enrolled in this timetable slot''s section for that session';
  end if;
  if to_char(new.date, 'FMday') <> v_slot.day_of_week::text then
    raise exception 'Date % is a %, but this timetable slot is on %',
      new.date, to_char(new.date, 'FMday'), v_slot.day_of_week;
  end if;
  if new.date not between v_slot.start_date and v_slot.end_date then
    raise exception 'Date % is outside the term (% to %)', new.date, v_slot.start_date, v_slot.end_date;
  end if;

  if auth.uid() is not null then
    new.marked_by := private.current_user_id();
  end if;
  return new;
end;
$$;

create trigger attendance_records_validate
  before insert or update on public.attendance_records
  for each row execute function private.validate_attendance();

-- Configurable assessment breakdown per term + subject, e.g.
-- ('CA', max 30, weight 30) and ('Exam', max 70, weight 70).
-- Nothing is hard-coded: admins add/rename/reweight components.
create table public.assessment_components (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.terms (id) on delete restrict,
  subject_id uuid not null references public.subjects (id) on delete restrict,
  name text not null,
  max_score numeric(6, 2) not null check (max_score > 0),
  weight numeric(5, 2) not null check (weight > 0 and weight <= 100),
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (term_id, subject_id, name),
  -- lets scores prove their term/subject match the component
  unique (id, term_id, subject_id)
);

create table public.scores (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete restrict,
  subject_id uuid not null references public.subjects (id) on delete restrict,
  term_id uuid not null references public.terms (id) on delete restrict,
  component_id uuid not null,
  score_obtained numeric(6, 2) not null check (score_obtained >= 0),
  entered_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, component_id),
  foreign key (component_id, term_id, subject_id)
    references public.assessment_components (id, term_id, subject_id) on delete restrict
);
create index scores_term_subject_idx on public.scores (term_id, subject_id);

create trigger scores_set_updated_at
  before update on public.scores
  for each row execute function private.set_updated_at();

-- A score must not exceed the component's max, and the student must be
-- enrolled that session and registered for the subject.
create function private.validate_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max numeric;
begin
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

create trigger scores_validate
  before insert or update on public.scores
  for each row execute function private.validate_score();
