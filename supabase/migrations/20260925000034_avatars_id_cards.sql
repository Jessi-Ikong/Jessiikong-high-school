-- 34. Profile pictures and ID cards.
--
-- PROFILE PICTURES
--   * Storage bucket "avatars": PUBLIC-READ (the no-login verification page
--     must show the photo), 5 MB, JPG / PNG / WebP only. Each photo is stored
--     as <user id>/<random uuid>.<ext>, so a photo can only be opened by
--     someone who already has its link (card, app, verification page).
--   * Uploading / replacing / deleting a photo: the person themselves, or an
--     admin who may edit that person (super admins: anyone; limited admins:
--     anyone except admin accounts - same as their other user edits).
--   * users.photo_url now holds the STORAGE PATH ("<user id>/<file>"), and
--     must be inside that user's own folder: nobody can point their photo at
--     an outside URL or at someone else's picture. (Changing photo_url was
--     already limited to yourself or an admin, migration 9.)
--
-- ID CARDS (table + verification since migrations 7 and 9)
--   * At most one ACTIVE card per person per session (existing index).
--   * public.issue_my_id_card(): a signed-in teacher or student gets their
--     active card for the CURRENT session - reused if it exists, otherwise
--     issued now.
--   * public.issue_id_cards(user ids): admins issue (or reuse) current-session
--     cards for many teachers / students at once.
--   * public.id_card_details(card ids): everything needed to PRINT the cards,
--     only for cards the caller may see (their own; admins: all).
--   * public.verify_id_card(token) (public, no login): now returns NOTHING for
--     a revoked card, a deactivated person or an unknown token - before, a
--     revoked card still returned the name and photo. The QR code carries the
--     random verification_token, not the sequential card number, so the page
--     can't be enumerated.

-- ---------------------------------------------------------------------------
-- Avatars
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- May the signed-in user set this person's photo?
create function private.can_set_photo(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_user_id = private.current_user_id()
      or private.is_super_admin()
      or (private.is_admin() and exists (
            select 1 from public.users u where u.id = p_user_id and u.role <> 'admin'))
$$;

-- avatars/<user id>/<file>: the folder decides whose photo it is.
create function private.can_manage_avatar_file(p_name text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_user uuid := private.try_uuid(v_parts[1]);
begin
  return array_length(v_parts, 1) = 2 and v_user is not null and private.can_set_photo(v_user);
end;
$$;

-- Reading is public (public bucket URLs); these cover upload / replace /
-- delete (and the row access the storage API needs for them). No listing
-- for anyone else.
create policy "avatars: see own / manageable files"
  on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and private.can_manage_avatar_file(name));
create policy "avatars: upload own / as admin"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and private.can_manage_avatar_file(name));
create policy "avatars: replace own / as admin"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and private.can_manage_avatar_file(name))
  with check (bucket_id = 'avatars' and private.can_manage_avatar_file(name));
create policy "avatars: delete own / as admin"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and private.can_manage_avatar_file(name));

-- photo_url = a path inside the person's own folder (or empty).
alter table public.users
  add constraint users_photo_in_own_folder
  check (photo_url is null or photo_url ~ ('^' || id::text || '/[A-Za-z0-9._-]{1,120}$'));

-- ---------------------------------------------------------------------------
-- ID cards
-- ---------------------------------------------------------------------------
-- Issue (or reuse) the current-session card for one teacher/student.
-- Internal: callers below decide who may do this.
create function private.issue_card_for(p_user_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_session uuid;
  v_card uuid;
  v_user record;
begin
  select id into v_session from public.sessions where is_current;
  if v_session is null then
    raise exception 'No session is marked as current, so ID cards can''t be issued yet.';
  end if;
  select id, role, is_active, concat_ws(' ', first_name, last_name) as name into v_user from public.users where id = p_user_id;
  if v_user.id is null or v_user.role not in ('teacher', 'student') then
    raise exception 'ID cards are only issued to teachers and students.';
  end if;
  if not v_user.is_active then
    raise exception '% is deactivated, so no ID card can be issued.', v_user.name;
  end if;

  select id into v_card from public.id_cards
   where user_id = p_user_id and session_id = v_session and is_active;
  if v_card is null then
    insert into public.id_cards (user_id, session_id, issued_by)
    values (p_user_id, v_session, private.current_user_id())
    returning id into v_card;
  end if;
  return v_card;
end;
$$;
revoke execute on function private.issue_card_for(uuid) from public, anon, authenticated;

-- A teacher or student: my card for the current session (reused or issued).
create function public.issue_my_id_card()
returns uuid
language plpgsql security definer set search_path = ''
as $$
begin
  if private.current_user_role() not in ('teacher', 'student') then
    raise exception 'ID cards are only issued to teachers and students.';
  end if;
  return private.issue_card_for(private.current_user_id());
end;
$$;

-- Admins: cards for many people at once (reused where they already exist).
create function public.issue_id_cards(p_user_ids uuid[])
returns setof uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.is_admin() then
    raise exception 'Only admins can issue ID cards for other people.' using errcode = '42501';
  end if;
  foreach v_id in array coalesce(p_user_ids, '{}') loop
    return next private.issue_card_for(v_id);
  end loop;
end;
$$;

-- What the card shows, for cards the caller may see (own, or any for admins).
create function public.id_card_details(p_card_ids uuid[])
returns table (
  card_id uuid,
  card_number text,
  verification_token uuid,
  issued_at timestamptz,
  is_active boolean,
  session_name text,
  full_name text,
  role public.user_role,
  id_number text,       -- admission number (students) / staff ID (teachers)
  class_name text,
  section_name text,
  department text,
  subjects text,        -- teachers: subjects they teach this session
  photo_path text
)
language sql stable security definer set search_path = ''
as $$
  select ic.id, ic.card_number, ic.verification_token, ic.issued_at, ic.is_active, s.name,
         concat_ws(' ', u.first_name, u.middle_name, u.last_name),
         u.role,
         coalesce(st.admission_number, t.staff_id),
         c.name, sec.name, t.department,
         (select string_agg(distinct sub.name, ', ' order by sub.name)
            from public.timetable_slots ts
            join public.terms tm on tm.id = ts.term_id and tm.session_id = ic.session_id
            join public.subjects sub on sub.id = ts.subject_id
           where ts.teacher_id = t.id),
         u.photo_url
    from public.id_cards ic
    join public.users u on u.id = ic.user_id
    join public.sessions s on s.id = ic.session_id
    left join public.students st on st.user_id = u.id
    left join public.enrollments e on e.student_id = st.id and e.session_id = ic.session_id
    left join public.classes c on c.id = e.class_id
    left join public.sections sec on sec.id = e.section_id
    left join public.teachers t on t.user_id = u.id
   where ic.id = any(p_card_ids)
     and (private.is_admin() or ic.user_id = private.current_user_id())
$$;

revoke execute on function public.issue_my_id_card() from public, anon;
revoke execute on function public.issue_id_cards(uuid[]) from public, anon;
revoke execute on function public.id_card_details(uuid[]) from public, anon;
grant execute on function public.issue_my_id_card() to authenticated;
grant execute on function public.issue_id_cards(uuid[]) to authenticated;
grant execute on function public.id_card_details(uuid[]) to authenticated;

-- Public verification: only for a card that is active AND whose owner is
-- active; nothing at all otherwise. photo_url is the storage path (the page
-- turns it into the public avatars link). Same columns as before.
create or replace function public.verify_id_card(p_token uuid)
returns table (
  full_name text,
  photo_url text,
  role public.user_role,
  class_name text,
  section_name text,
  department text,
  session_name text,
  card_number text,
  is_valid boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    concat_ws(' ', u.first_name, u.last_name),
    u.photo_url,
    u.role,
    c.name,
    sec.name,
    t.department,
    s.name,
    ic.card_number,
    true
  from public.id_cards ic
  join public.users u on u.id = ic.user_id
  join public.sessions s on s.id = ic.session_id
  left join public.students st on st.user_id = u.id
  left join public.enrollments e on e.student_id = st.id and e.session_id = ic.session_id
  left join public.classes c on c.id = e.class_id
  left join public.sections sec on sec.id = e.section_id
  left join public.teachers t on t.user_id = u.id
  where ic.verification_token = p_token
    and ic.is_active
    and u.is_active
$$;

notify pgrst, 'reload schema';
