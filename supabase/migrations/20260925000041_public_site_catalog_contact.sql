-- 41. Public website pages: the class / subject catalogue and a contact form.
--
-- 1. Signed-out visitors may READ classes and subjects (names, levels, codes,
--    descriptions): the public Academics page lists them and the admissions
--    form offers the real class list. Nothing else about the school opens up
--    (no sections, timetable, people, enrollments...). Read only.
--
-- 2. contact_messages: general questions from the public "Contact" page.
--    A separate table rather than reusing admissions_inquiries: a general
--    message has no child or class (both required there), and its handling
--    (new / replied / closed) isn't an admissions pipeline (new / contacted /
--    enrolled / declined), so mixing them would muddy the Admissions
--    Inquiries list. Same rules as inquiries (migration 40):
--      * anyone can SUBMIT (insert only: status 'new', no internal notes;
--        submission time always "now"; fields trimmed; email lower-cased;
--        at most 3 per email address per hour);
--      * only admins (both tiers) can read, update or delete them;
--      * audit-logged by the generic trigger.

-- ---------------------------------------------------------------------------
-- 1. Public catalogue
-- ---------------------------------------------------------------------------
create policy "classes: the public can read"
  on public.classes for select to anon using (true);
create policy "subjects: the public can read"
  on public.subjects for select to anon using (true);
revoke all on public.classes, public.subjects from anon;
grant select on public.classes, public.subjects to anon;

-- ---------------------------------------------------------------------------
-- 2. Contact messages
-- ---------------------------------------------------------------------------
create table public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> '' and length(name) <= 120),
  email text not null check (length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  phone text check (length(phone) <= 30),
  subject text check (length(subject) <= 150),
  message text not null check (btrim(message) <> '' and length(message) <= 3000),
  status text not null default 'new' check (status in ('new', 'replied', 'closed')),
  internal_notes text check (length(internal_notes) <= 5000),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.contact_messages.internal_notes is 'Staff-only notes. Never shown to the public.';
create index contact_messages_submitted_idx on public.contact_messages (submitted_at desc);
create index contact_messages_email_idx on public.contact_messages (lower(email), submitted_at);

create function private.stamp_contact_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.submitted_at := now();
    new.email := lower(btrim(new.email));
    new.name := btrim(new.name);
    new.phone := nullif(btrim(coalesce(new.phone, '')), '');
    new.subject := nullif(btrim(coalesce(new.subject, '')), '');
    new.message := btrim(new.message);
    if (select count(*) from public.contact_messages m
         where lower(m.email) = new.email and m.submitted_at > now() - interval '1 hour') >= 3 then
      raise exception 'We have already received several messages from this email address in the last hour. We will reply soon.'
        using errcode = 'P0001';
    end if;
  else
    new.submitted_at := old.submitted_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger contact_messages_stamp
  before insert or update on public.contact_messages
  for each row execute function private.stamp_contact_message();

alter table public.contact_messages enable row level security;
create policy "contact_messages: anyone can send"
  on public.contact_messages for insert to anon, authenticated
  with check (status = 'new' and internal_notes is null);
create policy "contact_messages: admins read"
  on public.contact_messages for select to authenticated using ((select private.is_admin()));
create policy "contact_messages: admins update"
  on public.contact_messages for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "contact_messages: admins delete"
  on public.contact_messages for delete to authenticated using ((select private.is_admin()));

revoke all on public.contact_messages from anon;
grant insert on public.contact_messages to anon;

create trigger audit_changes after insert or update or delete on public.contact_messages
  for each row execute function private.audit_row_change();

notify pgrst, 'reload schema';
