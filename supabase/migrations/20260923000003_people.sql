-- 3. People: users, teachers, students, parents, parent_students

-- One row per person in the system. Linked to Supabase Auth via auth_id.
-- auth_id is nullable so a profile can exist before (or without) a login,
-- e.g. a student with no email of their own.
create table public.users (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid unique references auth.users (id) on delete set null,
  role public.user_role not null,
  admin_level public.admin_level,
  first_name text not null,
  middle_name text,
  last_name text not null,
  email text,
  phone text,
  photo_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- admin_level is required for admins and forbidden for everyone else
  constraint users_admin_level_check check ((role = 'admin') = (admin_level is not null)),
  -- lets role tables prove their user has the matching role
  unique (id, role)
);
create unique index users_email_unique_idx on public.users (lower(email)) where email is not null;
create index users_role_idx on public.users (role);

create trigger users_set_updated_at
  before update on public.users
  for each row execute function private.set_updated_at();

-- The signed-in person's users.id (null if signed out, unlinked or deactivated).
create function private.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id from public.users u
  where u.auth_id = auth.uid() and u.is_active
$$;

create table public.teachers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  user_role public.user_role not null default 'teacher' check (user_role = 'teacher'),
  staff_id text not null unique,
  department text,
  qualification text,
  hire_date date,
  created_at timestamptz not null default now(),
  foreign key (user_id, user_role) references public.users (id, role) on delete cascade
);

-- No class/section column here on purpose: a student's class for any
-- session lives only in public.enrollments.
create table public.students (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  user_role public.user_role not null default 'student' check (user_role = 'student'),
  -- filled automatically from admission_session_id (see migration 8)
  admission_number text not null unique,
  admission_session_id uuid not null references public.sessions (id) on delete restrict,
  date_of_birth date,
  gender text check (gender in ('male', 'female')),
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, user_role) references public.users (id, role) on delete cascade
);

create trigger students_set_updated_at
  before update on public.students
  for each row execute function private.set_updated_at();

create table public.parents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  user_role public.user_role not null default 'parent' check (user_role = 'parent'),
  occupation text,
  address text,
  created_at timestamptz not null default now(),
  foreign key (user_id, user_role) references public.users (id, role) on delete cascade
);

-- Many-to-many: a parent can have several children, a child several guardians.
create table public.parent_students (
  parent_id uuid not null references public.parents (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  relationship text,                          -- e.g. 'mother', 'father', 'guardian'
  is_primary_contact boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (parent_id, student_id)
);
create index parent_students_student_idx on public.parent_students (student_id);
