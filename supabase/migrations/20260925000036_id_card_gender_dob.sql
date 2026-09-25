-- 36. Student ID cards also print gender and date of birth.
--
-- id_card_details() (migration 34) is what the ID card PDF is drawn from. It
-- now also returns students.gender and students.date_of_birth - for STUDENT
-- cards only (always null for teachers), and nothing else new. Who can call
-- it is unchanged: your own card, or any card for admins.
--
-- The PUBLIC check is NOT affected: verify_id_card() (used only by the
-- verify-card Edge Function) still returns only name, photo, role,
-- class/section, department, session and card number - no gender, no date of
-- birth. (A function's result columns can't be changed in place, hence drop +
-- create with the same permissions.)

drop function public.id_card_details(uuid[]);

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
  photo_path text,
  gender text,          -- students only ('male' / 'female'), else null
  date_of_birth date    -- students only, else null
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
         u.photo_url,
         case when u.role = 'student' then st.gender end,
         case when u.role = 'student' then st.date_of_birth end
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

revoke execute on function public.id_card_details(uuid[]) from public, anon;
grant execute on function public.id_card_details(uuid[]) to authenticated;

notify pgrst, 'reload schema';
