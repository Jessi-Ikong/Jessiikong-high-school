-- 26. Fee structures and automatic invoices: one shared generator, due-date
--     default, late joiners, and protection of payment records.
--
-- Migration 6 already invoiced students automatically (on a new fee
-- structure, and on a new enrollment) and prevented duplicates with
-- unique (student_id, fee_structure_id) + ON CONFLICT DO NOTHING. This
-- migration tightens it:
--
--   1. ONE generator, private.create_invoices(fee, enrollment,
--      only_unfinished_terms), used by both triggers, so the "who gets
--      invoiced" rule lives in one place:
--        every ACTIVE enrollment in the fee's class (any section) for the
--        term's session, ON CONFLICT DO NOTHING (never a duplicate).
--   2. Due date: an invoice is due on the fee's due_date, or, if the fee has
--      none, the term's end_date (before: no due date, so it could never
--      become overdue). Kept in step when either date changes.
--   3. Late joiners: a student gets invoices when an enrollment is created
--      as active, when it becomes active later, or when it moves to another
--      class. Only for terms that HAVEN'T ENDED yet (someone joining in the
--      second term isn't billed for the first term's fees). A new fee
--      structure, by contrast, invoices the class even for a past term (the
--      admin chose that term explicitly).
--   4. Protecting payment records. Once ANY payment (pending, successful or
--      failed) exists against a fee structure's invoices:
--        * the fee structure can't be deleted (that would delete its
--          invoices, and payments can't lose their invoice);
--        * its amount can't be changed (that would rewrite invoices people
--          have already paid against).
--      A fee structure's class or term can't be changed once it has
--      invoices at all (they'd belong to the wrong students/term).
--      Name, description and due date stay editable. These rules apply to
--      everyone, super admins included: they protect data consistency, not
--      permissions. (Only super admins can manage fee structures anyway.)
--   5. public.fee_collection_summary(term, class): per fee structure, how
--      many invoices are paid / partial / unpaid / overdue, and the totals.
--      Runs with the caller's permissions (RLS applies).

-- ---------------------------------------------------------------------------
-- 1 + 2. The shared generator
-- ---------------------------------------------------------------------------
-- Creates the missing invoices for a fee structure and/or an enrollment
-- (null = any). Returns how many were created.
create function private.create_invoices(
  p_fee_structure_id uuid,
  p_enrollment_id uuid,
  p_only_unfinished_terms boolean
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.invoices (student_id, term_id, fee_structure_id, amount_due, due_date)
  select e.student_id, fs.term_id, fs.id, fs.amount, coalesce(fs.due_date, t.end_date)
    from public.fee_structures fs
    join public.terms t on t.id = fs.term_id
    join public.enrollments e on e.class_id = fs.class_id and e.session_id = t.session_id and e.status = 'active'
   where (p_fee_structure_id is null or fs.id = p_fee_structure_id)
     and (p_enrollment_id is null or e.id = p_enrollment_id)
     and (not p_only_unfinished_terms or t.end_date >= private.school_today())
  on conflict (student_id, fee_structure_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- New fee structure: invoice its class.
create or replace function private.invoice_students_for_fee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.create_invoices(new.id, null, false);
  return null;
end;
$$;

-- Enrollment created as active, activated later, or moved to another class:
-- invoice it for the class's fees in terms that haven't ended.
create or replace function private.invoice_new_enrollment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'active' then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and old.status = 'active' and old.class_id = new.class_id and old.session_id = new.session_id then
    return null;   -- nothing relevant changed
  end if;
  perform private.create_invoices(null, new.id, true);
  return null;
end;
$$;

drop trigger enrollments_create_invoices on public.enrollments;
create trigger enrollments_create_invoices
  after insert or update of status, class_id, session_id on public.enrollments
  for each row execute function private.invoice_new_enrollment();

-- Fee amount / due date changed: carry it to the invoices (the protection
-- trigger below has already refused amount changes once payments exist).
create or replace function private.sync_invoices_with_fee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.invoices i
     set amount_due = new.amount,
         due_date = coalesce(new.due_date, t.end_date)
    from public.terms t
   where i.fee_structure_id = new.id
     and t.id = new.term_id;
  return null;
end;
$$;

-- A term's end date moved: invoices without their own fee due date follow it.
create function private.sync_invoice_due_dates_with_term()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.invoices i
     set due_date = new.end_date
    from public.fee_structures fs
   where fs.id = i.fee_structure_id
     and fs.term_id = new.id
     and fs.due_date is null;
  return null;
end;
$$;

create trigger terms_sync_invoice_due_dates
  after update of end_date on public.terms
  for each row execute function private.sync_invoice_due_dates_with_term();

-- Existing invoices with no due date get the term's end date.
update public.invoices i
   set due_date = t.end_date
  from public.fee_structures fs
  join public.terms t on t.id = fs.term_id
 where fs.id = i.fee_structure_id
   and i.due_date is null
   and fs.due_date is null;

-- ---------------------------------------------------------------------------
-- 4. Protect payment records
-- ---------------------------------------------------------------------------
create function private.protect_fee_structure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paid_invoices integer;
  v_invoices integer;
  v_label text;
begin
  select count(distinct p.invoice_id) into v_paid_invoices
    from public.payments p
    join public.invoices i on i.id = p.invoice_id
   where i.fee_structure_id = old.id;
  select count(*) into v_invoices from public.invoices i where i.fee_structure_id = old.id;
  select format('"%s" (%s, %s %s)', old.name, c.name, t.name, s.name) into v_label
    from public.classes c, public.terms t join public.sessions s on s.id = t.session_id
   where c.id = old.class_id and t.id = old.term_id;

  if tg_op = 'DELETE' then
    if v_paid_invoices > 0 then
      raise exception '% can''t be deleted: payments have been recorded against % of its invoices, and payment records must be kept. You can still rename it or change its description.',
        v_label, v_paid_invoices;
    end if;
    return old;
  end if;

  if new.amount is distinct from old.amount and v_paid_invoices > 0 then
    raise exception 'The amount of % can''t be changed: payments have been recorded against % of its invoices. If the fee really changed, add a separate fee item for the difference.',
      v_label, v_paid_invoices;
  end if;
  if (new.class_id, new.term_id) is distinct from (old.class_id, old.term_id) and v_invoices > 0 then
    raise exception 'The class or term of % can''t be changed because it has already been invoiced (% invoices). Create a new fee structure for the other class or term instead.',
      v_label, v_invoices;
  end if;
  return new;
end;
$$;

create trigger fee_structures_protect
  before update or delete on public.fee_structures
  for each row execute function private.protect_fee_structure();

-- ---------------------------------------------------------------------------
-- 5. Collection overview
-- ---------------------------------------------------------------------------
create function public.fee_collection_summary(p_term_id uuid, p_class_id uuid)
returns table (
  fee_structure_id uuid,
  invoices bigint,
  paid bigint,
  partial bigint,
  unpaid bigint,
  overdue bigint,
  amount_due numeric,
  amount_paid numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select fs.id,
         count(i.id),
         count(i.id) filter (where i.status = 'paid'),
         count(i.id) filter (where i.status = 'partial'),
         count(i.id) filter (where i.status = 'unpaid'),
         count(i.id) filter (where i.status = 'overdue'),
         coalesce(sum(i.amount_due), 0),
         coalesce(sum(i.amount_paid), 0)
    from public.fee_structures fs
    left join public.invoices i on i.fee_structure_id = fs.id
   where fs.term_id = p_term_id and fs.class_id = p_class_id
   group by fs.id
$$;

revoke execute on function public.fee_collection_summary(uuid, uuid) from public, anon;
grant execute on function public.fee_collection_summary(uuid, uuid) to authenticated;
