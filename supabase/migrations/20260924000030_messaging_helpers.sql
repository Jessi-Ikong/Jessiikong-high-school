-- 30. Read-only helpers for the parent-teacher Messages pages.
--
-- The messaging RULES are unchanged (migrations 7, 9, 13): a thread is one
-- parent-teacher pair; either of them may open it and send in it only while
-- the teacher teaches one of the parent's children a subject that child
-- takes, in the CURRENT session; otherwise it stays readable but read-only.
--
-- The pages need to show things the browser can't work out safely by itself
-- (parents can't read timetables / other enrollments): which children and
-- subjects link the two people, whether the thread can still be written to,
-- and who the caller could start a new conversation with. These functions
-- return ONLY the caller's own threads / contacts, and change nothing.
--
--   public.my_message_threads()  - the caller's threads, newest activity first
--   public.my_message_contacts() - people the caller may start a thread with
--                                  (linked now, and no thread yet)

-- Every (parent, teacher, child, subject) link in the CURRENT session.
-- Same joins as private.teacher_linked_to_parent (migration 13), plus names.
create function private.current_messaging_links()
returns table (parent_id uuid, teacher_id uuid, student_id uuid, child_name text, subject_name text)
language sql stable security definer set search_path = ''
as $$
  select distinct ps.parent_id, ts.teacher_id, ps.student_id,
         concat_ws(' ', u.first_name, u.last_name), sub.name
    from public.parent_students ps
    join public.enrollments e on e.student_id = ps.student_id
    join public.sessions s on s.id = e.session_id and s.is_current
    join public.terms t on t.session_id = e.session_id
    join public.timetable_slots ts on ts.term_id = t.id and ts.section_id = e.section_id
    join public.student_subjects ss on ss.enrollment_id = e.id and ss.subject_id = ts.subject_id
    join public.subjects sub on sub.id = ts.subject_id
    join public.students st on st.id = ps.student_id
    join public.users u on u.id = st.user_id
$$;
revoke execute on function private.current_messaging_links() from public, anon, authenticated;

create function public.my_message_threads()
returns table (
  thread_id uuid,
  parent_id uuid,
  teacher_id uuid,
  other_name text,        -- the teacher's name for a parent, the parent's name for a teacher
  links text,             -- e.g. 'Ada Adeyemi (Biology), Dan Adeyemi (Mathematics)'; null if none this session
  can_send boolean,       -- false = read-only (no shared class in the current session)
  created_at timestamptz,
  last_message_at timestamptz,
  last_message text,      -- first 120 characters of the newest message
  last_sender_is_me boolean,
  unread_count integer    -- messages from the other person not read yet
)
language sql stable security definer set search_path = ''
as $$
  with me as (
    select private.current_user_id() as user_id,
           private.current_parent_id() as parent_id,
           private.current_teacher_id() as teacher_id
  ),
  mine as (
    select mt.* from public.message_threads mt, me
     where mt.parent_id = me.parent_id or mt.teacher_id = me.teacher_id
  ),
  link_text as (
    select l.parent_id, l.teacher_id,
           string_agg(l.child_name || ' (' || l.subject_name || ')', ', ' order by l.child_name, l.subject_name) as links
      from private.current_messaging_links() l
      join mine on mine.parent_id = l.parent_id and mine.teacher_id = l.teacher_id
     group by l.parent_id, l.teacher_id
  )
  select mine.id, mine.parent_id, mine.teacher_id,
         case when mine.parent_id = me.parent_id
              then concat_ws(' ', tu.first_name, tu.last_name)
              else concat_ws(' ', pu.first_name, pu.last_name) end,
         lt.links,
         lt.links is not null,
         mine.created_at,
         mine.last_message_at,
         left(last_msg.body, 120),
         last_msg.sender_id = me.user_id,
         (select count(*)::integer from public.messages m
           where m.thread_id = mine.id and m.read_at is null and m.sender_id <> me.user_id)
    from mine
    cross join me
    join public.teachers t on t.id = mine.teacher_id
    join public.users tu on tu.id = t.user_id
    join public.parents p on p.id = mine.parent_id
    join public.users pu on pu.id = p.user_id
    left join link_text lt on lt.parent_id = mine.parent_id and lt.teacher_id = mine.teacher_id
    left join lateral (
      select m.body, m.sender_id from public.messages m
       where m.thread_id = mine.id order by m.sent_at desc limit 1
    ) last_msg on true
   order by coalesce(mine.last_message_at, mine.created_at) desc
$$;

create function public.my_message_contacts()
returns table (
  parent_id uuid,
  teacher_id uuid,
  name text,   -- the teacher's name for a parent, the parent's name for a teacher
  links text   -- the children / subjects that link you
)
language sql stable security definer set search_path = ''
as $$
  with me as (
    select private.current_parent_id() as parent_id, private.current_teacher_id() as teacher_id
  )
  select l.parent_id, l.teacher_id,
         case when l.parent_id = me.parent_id
              then concat_ws(' ', tu.first_name, tu.last_name)
              else concat_ws(' ', pu.first_name, pu.last_name) end as name,
         string_agg(l.child_name || ' (' || l.subject_name || ')', ', ' order by l.child_name, l.subject_name)
    from private.current_messaging_links() l
    cross join me
    join public.teachers t on t.id = l.teacher_id
    join public.users tu on tu.id = t.user_id
    join public.parents p on p.id = l.parent_id
    join public.users pu on pu.id = p.user_id
   where (l.parent_id = me.parent_id or l.teacher_id = me.teacher_id)
     and not exists (
       select 1 from public.message_threads mt where mt.parent_id = l.parent_id and mt.teacher_id = l.teacher_id
     )
   group by l.parent_id, l.teacher_id, me.parent_id, tu.first_name, tu.last_name, pu.first_name, pu.last_name
   order by name
$$;

revoke execute on function public.my_message_threads() from public, anon;
revoke execute on function public.my_message_contacts() from public, anon;
grant execute on function public.my_message_threads() to authenticated;
grant execute on function public.my_message_contacts() to authenticated;

notify pgrst, 'reload schema';
