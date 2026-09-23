-- 11. Allow parallel classes in one timetable cell.
--
-- Migration 4 allowed only ONE lesson per section per day + period. Sections
-- can have parallel electives at the same time (e.g. Biology and Literature),
-- and each student attends the one matching their own student_subjects.
--
-- New rule: a cell (section + term + day + period) may hold several lessons,
-- but not the same subject twice.
--
-- Unchanged: a teacher still can't teach two lessons at the same day + period
-- in a term, across ALL sections (timetable_slots_teacher_id_term_id_day_of_week_period_id_key).

alter table public.timetable_slots
  drop constraint timetable_slots_section_id_term_id_day_of_week_period_id_key;

alter table public.timetable_slots
  add constraint timetable_slots_one_subject_per_cell
  unique (section_id, term_id, day_of_week, period_id, subject_id);
