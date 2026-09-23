-- 4. Enrollment & timetable: enrollments, student_subjects, timetable_slots

-- The ONLY place a student's class/section is recorded: one row per student
-- per session. Rows are added each session, never overwritten, so history
-- stays attributed to the class the student was in at the time.
create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete restrict,
  session_id uuid not null references public.sessions (id) on delete restrict,
  class_id uuid not null references public.classes (id) on delete restrict,
  section_id uuid not null,
  status public.enrollment_status not null default 'active',
  enrolled_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, session_id),
  -- the section must belong to the class
  foreign key (section_id, class_id) references public.sections (id, class_id) on delete restrict
);
create index enrollments_section_session_idx on public.enrollments (section_id, session_id);
create index enrollments_session_class_idx on public.enrollments (session_id, class_id);

create trigger enrollments_set_updated_at
  before update on public.enrollments
  for each row execute function private.set_updated_at();

-- Individually assigned subjects (core + electives) for one enrollment.
create table public.student_subjects (
  enrollment_id uuid not null references public.enrollments (id) on delete cascade,
  subject_id uuid not null references public.subjects (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (enrollment_id, subject_id)
);
create index student_subjects_subject_idx on public.student_subjects (subject_id);

-- Who teaches what, where and when. teacher_id is nullable so a slot can be
-- planned before a teacher is assigned (an "unfilled" slot).
create table public.timetable_slots (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete restrict,
  term_id uuid not null references public.terms (id) on delete restrict,
  period_id uuid not null references public.periods (id) on delete restrict,
  day_of_week public.day_of_week not null,
  subject_id uuid not null references public.subjects (id) on delete restrict,
  teacher_id uuid references public.teachers (id) on delete set null,
  created_at timestamptz not null default now(),
  -- a section has one lesson per period
  unique (section_id, term_id, day_of_week, period_id),
  -- a teacher can't be in two places at once
  unique (teacher_id, term_id, day_of_week, period_id)
);
create index timetable_slots_teacher_term_idx on public.timetable_slots (teacher_id, term_id);
create index timetable_slots_section_term_idx on public.timetable_slots (section_id, term_id);
