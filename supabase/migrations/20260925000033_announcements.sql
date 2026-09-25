-- 33. Announcements: tighter class audience, author set by the database, and
--     the author's name stored for display.
--
-- The table and visibility rules exist since migrations 7 and 9:
--   all       -> every signed-in user
--   teachers  -> teachers        students -> students        parents -> parents
--   specific_class -> that class's students and their parents, AND the
--                     teachers who teach that class in the current session
--                     (kept deliberately: class notices usually affect lessons)
--   admins (both tiers) see and manage everything.
-- Changes here:
--   1. specific_class now counts only students ACTIVELY enrolled in the class
--      this session (any section), and their parents. Before, any enrollment
--      status counted (e.g. a withdrawn student still got class notices).
--   2. author_id is always the admin who posted it (set by the database on
--      insert, unchanged by edits); the page can't name someone else.
--   3. author_name: the poster's display name, stored when posting. Parents,
--      students and teachers can't read admin accounts (and limited admins
--      can't read other admins, migration 21), so without it "Posted by"
--      would be blank in most feeds. It reveals nothing beyond the name the
--      admin posted under.

-- 1. Only used by the announcements policy.
create or replace function private.is_in_current_class(p_class_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
      from public.enrollments e
      join public.sessions s on s.id = e.session_id and s.is_current
     where e.class_id = p_class_id
       and e.status = 'active'
       and (e.student_id = private.current_student_id() or private.is_parent_of(e.student_id))
  )
  or exists (
    select 1
      from public.timetable_slots ts
      join public.sections sec on sec.id = ts.section_id
      join public.terms t on t.id = ts.term_id
      join public.sessions s on s.id = t.session_id and s.is_current
     where sec.class_id = p_class_id
       and ts.teacher_id = private.current_teacher_id()
  )
$$;

-- 2 + 3.
alter table public.announcements add column author_name text;

update public.announcements a
   set author_name = concat_ws(' ', u.first_name, u.last_name)
  from public.users u
 where u.id = a.author_id and a.author_name is null;

create function private.set_announcement_author()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.author_id := private.current_user_id();
    end if;
    new.author_name := (select concat_ws(' ', u.first_name, u.last_name) from public.users u where u.id = new.author_id);
  else
    -- Edits keep the original poster.
    new.author_id := old.author_id;
    new.author_name := old.author_name;
  end if;
  return new;
end;
$$;

create trigger announcements_set_author
  before insert or update on public.announcements
  for each row execute function private.set_announcement_author();
