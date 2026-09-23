-- 7. Communication & audit: announcements, message_threads, messages, audit_log, id_cards

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  audience public.announcement_audience not null,
  class_id uuid references public.classes (id) on delete cascade,
  author_id uuid references public.users (id) on delete set null,
  published_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- class_id is required for 'specific_class' and forbidden otherwise
  constraint announcements_class_check check ((audience = 'specific_class') = (class_id is not null))
);
create index announcements_published_idx on public.announcements (published_at desc);

create trigger announcements_set_updated_at
  before update on public.announcements
  for each row execute function private.set_updated_at();

-- Exactly one thread per parent–teacher pair (not per student).
create table public.message_threads (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.parents (id) on delete cascade,
  teacher_id uuid not null references public.teachers (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  unique (parent_id, teacher_id)
);
create index message_threads_teacher_idx on public.message_threads (teacher_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.message_threads (id) on delete cascade,
  sender_id uuid references public.users (id) on delete set null,
  body text not null check (length(trim(body)) > 0),
  sent_at timestamptz not null default now(),
  read_at timestamptz
);
create index messages_thread_sent_idx on public.messages (thread_id, sent_at);

-- The sender must be one of the thread's two participants. When a signed-in
-- user sends, sender_id is forced to that user.
create function private.validate_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.sender_id := private.current_user_id();
  end if;
  if not exists (
    select 1
      from public.message_threads mt
      join public.parents p on p.id = mt.parent_id
      join public.teachers t on t.id = mt.teacher_id
     where mt.id = new.thread_id
       and new.sender_id in (p.user_id, t.user_id)
  ) then
    raise exception 'Sender is not a participant in this thread';
  end if;
  return new;
end;
$$;

create trigger messages_validate
  before insert on public.messages
  for each row execute function private.validate_message();

create function private.touch_thread()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.message_threads set last_message_at = new.sent_at where id = new.thread_id;
  return null;
end;
$$;

create trigger messages_touch_thread
  after insert on public.messages
  for each row execute function private.touch_thread();

create table public.audit_log (
  id bigint generated always as identity primary key,
  user_id uuid references public.users (id) on delete set null,
  action text not null,                       -- 'insert' | 'update' | 'delete'
  entity text not null,                       -- table name
  entity_id text,
  changes jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);
create index audit_log_created_idx on public.audit_log (created_at desc);

-- ID cards are re-issued every session. Revoke by setting is_active = false.
-- The QR code carries verification_token (random, unguessable) rather than
-- card_number, so the public verification page can't be enumerated.
create sequence private.id_card_number_seq;
grant usage on sequence private.id_card_number_seq to authenticated, service_role;

create table public.id_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete restrict,
  session_id uuid not null references public.sessions (id) on delete restrict,
  card_number text not null unique
    default ('JHS-' || lpad(nextval('private.id_card_number_seq')::text, 6, '0')),
  verification_token uuid not null unique default gen_random_uuid(),
  issued_at timestamptz not null default now(),
  issued_by uuid references public.users (id) on delete set null,
  is_active boolean not null default true,
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz not null default now()
);
-- at most one active card per person per session
create unique index id_cards_one_active_idx on public.id_cards (user_id, session_id) where is_active;

-- Generic audit trigger: records who changed what, with before/after values.
create function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_changes jsonb;
begin
  if tg_op = 'UPDATE' then
    -- only the columns that actually changed
    select jsonb_object_agg(n.key, jsonb_build_object('old', v_old -> n.key, 'new', n.value))
      into v_changes
      from jsonb_each(v_new) n
     where n.value is distinct from v_old -> n.key
       and n.key <> 'updated_at';
    if v_changes is null then
      return null;
    end if;
  else
    v_changes := coalesce(v_new, v_old);
  end if;

  insert into public.audit_log (user_id, action, entity, entity_id, changes)
  values (
    private.current_user_id(),
    lower(tg_op),
    tg_table_name,
    coalesce(v_new, v_old) ->> 'id',
    v_changes
  );
  return null;
end;
$$;

-- Attendance is deliberately not audited (very high volume); it keeps
-- marked_by / updated_at instead.
do $$
declare
  t text;
begin
  foreach t in array array[
    'users', 'teachers', 'students', 'parents', 'parent_students',
    'enrollments', 'student_subjects', 'timetable_slots',
    'assessment_components', 'scores',
    'fee_structures', 'invoices', 'payments', 'id_cards'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function private.audit_row_change()',
      t || '_audit', t);
  end loop;
end;
$$;
