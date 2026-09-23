-- 6. Assignments & fees: assignments, submissions, fee_structures, invoices, payments

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers (id) on delete restrict,
  subject_id uuid not null references public.subjects (id) on delete restrict,
  section_id uuid not null references public.sections (id) on delete restrict,
  term_id uuid not null references public.terms (id) on delete restrict,
  title text not null,
  description text,
  attachment_url text,
  due_at timestamptz,
  max_score numeric(6, 2) check (max_score > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index assignments_section_term_idx on public.assignments (section_id, term_id);
create index assignments_teacher_idx on public.assignments (teacher_id);

create trigger assignments_set_updated_at
  before update on public.assignments
  for each row execute function private.set_updated_at();

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete restrict,
  content text,
  attachment_url text,
  submitted_at timestamptz not null default now(),
  score numeric(6, 2) check (score >= 0),
  feedback text,
  graded_by uuid references public.users (id) on delete set null,
  graded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, student_id)
);
create index submissions_student_idx on public.submissions (student_id);

create trigger submissions_set_updated_at
  before update on public.submissions
  for each row execute function private.set_updated_at();

-- Termly fee items per class, e.g. JSS1 / First Term / 'Tuition' / 50,000.
create table public.fee_structures (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete restrict,
  term_id uuid not null references public.terms (id) on delete restrict,
  name text not null,
  amount numeric(12, 2) not null check (amount > 0),
  due_date date,
  description text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (class_id, term_id, name),
  unique (id, term_id)
);

create trigger fee_structures_set_updated_at
  before update on public.fee_structures
  for each row execute function private.set_updated_at();

-- One invoice per student per fee item. Created automatically (see triggers
-- below). amount_paid and status are maintained by the database.
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete restrict,
  term_id uuid not null references public.terms (id) on delete restrict,
  fee_structure_id uuid not null,
  amount_due numeric(12, 2) not null check (amount_due >= 0),
  amount_paid numeric(12, 2) not null default 0 check (amount_paid >= 0),
  status public.invoice_status not null default 'unpaid',
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, fee_structure_id),
  -- deleting a fee item removes its invoices, but payments (below) block
  -- that once any money has been recorded against them
  foreign key (fee_structure_id, term_id)
    references public.fee_structures (id, term_id) on delete cascade
);
create index invoices_term_status_idx on public.invoices (term_id, status);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  provider public.payment_provider not null,
  provider_ref text,                          -- Paystack/Flutterwave reference
  status public.payment_status not null default 'pending',
  paid_by uuid references public.users (id) on delete set null,
  paid_at timestamptz,
  provider_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_ref)
);
create index payments_invoice_idx on public.payments (invoice_id);

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function private.set_updated_at();

-- Invoice status is derived from what's been paid and the due date.
create function private.set_invoice_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.status := case
    when new.amount_paid >= new.amount_due then 'paid'
    when new.due_date is not null and new.due_date < current_date then 'overdue'
    when new.amount_paid > 0 then 'partial'
    else 'unpaid'
  end::public.invoice_status;
  new.updated_at := now();
  return new;
end;
$$;

create trigger invoices_set_status
  before insert or update on public.invoices
  for each row execute function private.set_invoice_status();

-- Recalculate an invoice's amount_paid from its successful payments.
create function private.refresh_invoice_paid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice_id uuid := coalesce(new.invoice_id, old.invoice_id);
begin
  update public.invoices i
     set amount_paid = coalesce((
       select sum(p.amount) from public.payments p
        where p.invoice_id = v_invoice_id and p.status = 'successful'
     ), 0)
   where i.id = v_invoice_id;
  return null;
end;
$$;

create trigger payments_refresh_invoice
  after insert or update or delete on public.payments
  for each row execute function private.refresh_invoice_paid();

-- 'overdue' depends on today's date, so it can't be kept current by
-- triggers alone. Run this daily (e.g. with pg_cron) to re-evaluate.
create function public.mark_overdue_invoices()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.invoices
     set updated_at = now()                 -- status recomputed by trigger
   where status in ('unpaid', 'partial')
     and due_date < current_date;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.mark_overdue_invoices() from public, anon, authenticated;

-- When a fee item is added, invoice every active student in that class for
-- the term's session.
create function private.invoice_students_for_fee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.invoices (student_id, term_id, fee_structure_id, amount_due, due_date)
  select e.student_id, new.term_id, new.id, new.amount, new.due_date
    from public.enrollments e
    join public.terms t on t.session_id = e.session_id
   where t.id = new.term_id
     and e.class_id = new.class_id
     and e.status = 'active'
  on conflict (student_id, fee_structure_id) do nothing;
  return null;
end;
$$;

create trigger fee_structures_create_invoices
  after insert on public.fee_structures
  for each row execute function private.invoice_students_for_fee();

-- If a fee item's amount or due date changes, carry it to its invoices.
create function private.sync_invoices_with_fee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.invoices
     set amount_due = new.amount, due_date = new.due_date
   where fee_structure_id = new.id;
  return null;
end;
$$;

create trigger fee_structures_sync_invoices
  after update of amount, due_date on public.fee_structures
  for each row execute function private.sync_invoices_with_fee();

-- When a student is enrolled after fee items already exist, invoice them too.
create function private.invoice_new_enrollment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'active' then
    return null;
  end if;
  insert into public.invoices (student_id, term_id, fee_structure_id, amount_due, due_date)
  select new.student_id, fs.term_id, fs.id, fs.amount, fs.due_date
    from public.fee_structures fs
    join public.terms t on t.id = fs.term_id
   where t.session_id = new.session_id
     and fs.class_id = new.class_id
  on conflict (student_id, fee_structure_id) do nothing;
  return null;
end;
$$;

create trigger enrollments_create_invoices
  after insert on public.enrollments
  for each row execute function private.invoice_new_enrollment();
