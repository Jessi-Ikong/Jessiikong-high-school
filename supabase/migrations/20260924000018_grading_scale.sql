-- 18. School-wide grading scale (grade letters).
--
-- One scale for the whole school (not per term / subject). Each band covers
-- whole-number percentages, both ends included, e.g. B = 60–69. A student's
-- percentage is rounded to the nearest whole number (.5 rounds up) before
-- its band is looked up, so 69.5 -> 70 -> A and 69.4 -> 69 -> B.
--
-- Rules, checked by the database:
--   * min_score and max_score are whole numbers 0–100, min <= max.
--   * Grade letters are unique.
--   * The bands never overlap, and together they cover 0–100 with no gaps:
--     sorted by min_score, the first starts at 0, each next band starts one
--     above the previous band's max, and the last ends at 100.
-- The coverage rule is checked when the save COMPLETES (a deferred check),
-- so a scale can be rearranged in several steps inside one save, e.g. by
-- replace_grading_scale() below, which the admin page uses.

create table public.grading_scale (
  id uuid primary key default gen_random_uuid(),
  grade text not null unique check (length(trim(grade)) > 0),
  min_score smallint not null check (min_score between 0 and 100),
  max_score smallint not null check (max_score between 0 and 100),
  remark text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint grading_scale_min_le_max check (min_score <= max_score),
  constraint grading_scale_no_overlap
    exclude using gist (int4range(min_score, max_score, '[]') with &&)
    deferrable initially deferred
);

create trigger grading_scale_set_updated_at
  before update on public.grading_scale
  for each row execute function private.set_updated_at();

create trigger grading_scale_audit
  after insert or update or delete on public.grading_scale
  for each row execute function private.audit_row_change();

-- Whole-scale check: no gaps or overlaps, covering exactly 0–100.
create function private.check_grading_scale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_band record;
  v_prev record;
  v_count integer := 0;
begin
  for v_band in select grade, min_score, max_score from public.grading_scale order by min_score, max_score loop
    v_count := v_count + 1;
    if v_count = 1 then
      if v_band.min_score <> 0 then
        raise exception 'The grading scale must start at 0: the lowest band (%) starts at %.', v_band.grade, v_band.min_score;
      end if;
    elsif v_band.min_score <= v_prev.max_score then
      raise exception 'Grades % (%–%) and % (%–%) overlap.',
        v_prev.grade, v_prev.min_score, v_prev.max_score, v_band.grade, v_band.min_score, v_band.max_score;
    elsif v_band.min_score > v_prev.max_score + 1 then
      raise exception 'There is a gap in the grading scale: no grade covers % to % (between % and %).',
        v_prev.max_score + 1, v_band.min_score - 1, v_prev.grade, v_band.grade;
    end if;
    v_prev := v_band;
  end loop;

  if v_count = 0 then
    raise exception 'The grading scale can''t be empty: it must cover every score from 0 to 100.';
  end if;
  if v_prev.max_score <> 100 then
    raise exception 'The grading scale must reach 100: the highest band (%) ends at %.', v_prev.grade, v_prev.max_score;
  end if;
  return null;
end;
$$;

create constraint trigger grading_scale_complete
  after insert or update or delete on public.grading_scale
  deferrable initially deferred
  for each row execute function private.check_grading_scale();

-- Replace the whole scale in one save. SECURITY INVOKER: the normal RLS
-- policies apply, so only admins can use it. p_bands is a JSON array of
-- { "grade", "min_score", "max_score", "remark" }.
create function public.replace_grading_scale(p_bands jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if jsonb_typeof(p_bands) <> 'array' then
    raise exception 'The grading scale must be a list of bands.';
  end if;
  delete from public.grading_scale where true;
  insert into public.grading_scale (grade, min_score, max_score, remark)
  select trim(b ->> 'grade'), (b ->> 'min_score')::smallint, (b ->> 'max_score')::smallint,
         nullif(trim(coalesce(b ->> 'remark', '')), '')
    from jsonb_array_elements(p_bands) as b;
end;
$$;
revoke execute on function public.replace_grading_scale(jsonb) from public, anon;
grant execute on function public.replace_grading_scale(jsonb) to authenticated;

-- Everyone signed in can read the scale (teachers, and later students and
-- parents, need it to show grades). Admins (both levels) can change it.
alter table public.grading_scale enable row level security;

create policy "grading_scale: signed-in users can read"
  on public.grading_scale for select to authenticated using (true);
create policy "grading_scale: admins can insert"
  on public.grading_scale for insert to authenticated with check ((select private.is_admin()));
create policy "grading_scale: admins can update"
  on public.grading_scale for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "grading_scale: admins can delete"
  on public.grading_scale for delete to authenticated using ((select private.is_admin()));

-- Default scale, so grades show from day one. Admins can edit or replace it.
insert into public.grading_scale (grade, min_score, max_score, remark) values
  ('A', 70, 100, 'Excellent'),
  ('B', 60, 69, 'Very good'),
  ('C', 50, 59, 'Good'),
  ('D', 45, 49, 'Fair'),
  ('E', 40, 44, 'Poor'),
  ('F', 0, 39, 'Fail');
