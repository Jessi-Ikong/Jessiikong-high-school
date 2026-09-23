# School Management System (SMS)

## Overview
A single-school management system for a Nigerian school, built with **React (frontend)** and **Supabase (backend: Postgres DB, Auth, Storage)**. Four roles: **Admin, Teacher, Student, Parent**. Real fee payment integration via **Paystack/Flutterwave**.

This is being built collaboratively: the project owner and a planning Claude (chat) make all decisions and write task prompts; **Claude Code (terminal)** executes each task — writing code, running migrations, testing, and reporting results.

**IMPORTANT for Claude Code:** After completing each task, append an entry to `test.txt` in the project root following the format described in that file — this is how the project owner tracks progress and verifies work manually.

---

## Tech Stack
- Frontend: React
- Backend: Supabase (Postgres + Auth + Storage)
- Payments: Paystack / Flutterwave
- Hosting: TBD (likely Vercel for frontend, Supabase-hosted backend)

---

## Scope & Constraints
- **Single school** (not multi-tenant)
- **No self-registration** — admin creates all accounts, invite link sent via email for first login; users can reset/change password after
- Students without their own email get the invite sent to their parent's email

---

## Roles

### Admin
- Two tiers: `super_admin` and `limited_admin` (limited admin cannot manage fee structures or other admin accounts — exact permission boundaries to be enforced via RLS)
- Manages: sessions/terms, classes/sections, subjects, staff, students, parent-student linking, timetable, fee structures, grading scale/components, announcements, reports/analytics, audit log
- Handles student promotion/demotion/repeat/graduation (manual, admin-driven, per session)
- Bulk or individual ID card generation

### Teacher
- Assigned to specific `timetable_slots` (subject + section + period)
- Marks attendance **per period/subject** (no homeroom/daily attendance — that role doesn't exist in this system)
- Gradebook: enters scores per configurable assessment component
- Posts/grades assignments
- Messaging with parents (flat thread per parent-teacher pair)
- Can generate/download their own ID card

### Student
- Enrolled in a class + section per session, with individually assigned elective subjects
- Views timetable, assignments, grades/report card, attendance history, announcements
- Submits assignments
- Can download own ID card
- Can update own profile picture (admin sets initial photo)

### Parent
- Linked to one or more students (many-to-many via `parent_students`)
- Multi-child dashboard (switch between children)
- Views attendance, grades, fee balance per child
- Pays fees via Paystack/Flutterwave
- Messaging with teachers
- Downloads report cards

---

## Key Design Decisions

### Enrollment & history (critical)
Student class/section assignment is **never overwritten directly**. Every session, a new row is added to `enrollments` (student_id, session_id, class_id, section_id, status). This preserves historical accuracy — a student's grades/attendance from a past session stay correctly attributed to the class they were in *then*, even after promotion.

`enrollment_status` enum: `active | promoted | repeated | graduated | withdrawn`

### Electives
Subjects are **not fixed per class** — each student has an individually assigned subject list per enrollment, via `student_subjects`.

### Timetable & attendance
- Fixed periods (`periods` table: name, start_time, end_time)
- `timetable_slots` ties together: section + term + period + day_of_week + subject + teacher
- Attendance is marked **per period**, tied to a specific `timetable_slot`. Daily/overall attendance % is derived by aggregation — there is no separate daily attendance record and no homeroom teacher role.

### Grading
- Configurable per term/subject via `assessment_components` (e.g. CA = 30%, Exam = 70% by default, but admin can change weights/add components)
- Scores stored per component in `scores`
- **Class position/ranking is auto-computed** (rank by average weighted score within section + term) — via a database view/function, not stored redundantly, so it's always accurate when scores change
- Report cards generated **on-demand** as PDF when viewed/downloaded (not pre-generated and stored)

### Promotion / demotion
- **Manual, admin-driven**, typically at end of session (not end of term)
- Admin sees a roster with a default "promote all" bulk action, can override individual students to repeat, graduate, or withdraw before confirming
- Graduation = final `enrollment_status = 'graduated'`, read-only historical access, no further class assignment

### Fees
- **Termly cycle** — fees due each term, not per session
- Invoices **auto-generated** for relevant students when admin sets up a term's `fee_structures`
- Real payment integration: Paystack/Flutterwave, tracked via `payments` table (linked to `invoices`)

### Messaging
- **Flat thread per parent-teacher pair** (`message_threads`: parent_id, teacher_id) — not per-student-scoped, not a full inbox system

### Notifications
- **Email only for v1** (via a transactional email provider, e.g. Resend). SMS deferred to a later phase.

### ID cards
- Re-issued **every session** (since class/level changes at promotion)
- Contains: photo, full name, role-specific ID (admission no. for students, staff ID for teachers), class/section or subject/department, school name/logo, session/academic year, QR code, issue date
- **QR code** links to a public verification page showing only non-sensitive info (name, photo, role, class, active status) — looked up via an `id_cards` record
- `id_cards` table stores a lightweight record per issue: `user_id, session_id, card_number, issued_at, issued_by, is_active` — this enables revocation (lost/reissued cards) and lets admin see who already has a card issued this session before bulk-generating
- Both individual self-download and admin bulk-generation (per class or full staff list) supported

### Admission numbers
- Sequential, auto-generated format: `STU/{year}/{zero-padded sequence}` (e.g. `STU/2026/0001`), generated at enrollment time

### Profile pictures
- Admin sets initial photo at enrollment/hiring; user can update their own later via Supabase Storage

### Sorting & filtering
Expected across all major list views — not an afterthought:
- Student lists: by name (alphabetical, the default for rosters/registers), admission number, class/section; filter by status
- Gradebook: by score (asc/desc), filter by subject/component
- Attendance: by attendance % (ascending surfaces chronic absentees), filter by date range/status
- Fees: by amount outstanding, filter by payment status
- Assignments: filter by submitted/not submitted

### Row-Level Security (RLS)
All access control is enforced at the database level via Postgres RLS policies, not just app-level filtering:
- Parents can only see data for their own linked children (via `parent_students`)
- Teachers can only touch attendance/scores for sections they're assigned to (via `timetable_slots`)
- Students see only their own records
- Limited admins are restricted from fee structure config and admin account management (super_admin only)

---

## Dashboards (summary)
- **Admin**: quick stats (students/teachers/classes/attendance %/fees), recent activity, alerts (overdue fees, low attendance, unfilled timetable slots)
- **Teacher**: today's timetable, unmarked attendance flags, pending submissions to grade, recent messages
- **Student**: today's timetable, upcoming assignment deadlines, recent grades, attendance summary, announcements
- **Parent**: per-child summary cards, fee due dates, recent messages, announcements

---

## Current Status
Planning and schema design complete (see decisions above). Implementation has not yet started.

## Follow-ups explicitly deferred (do not forget)
- **Admin attendance overview/dashboard**: a school-wide attendance view for admins (e.g. today's attendance %, per-class/per-section summaries, alerts for chronic absentees) — deferred until the "real dashboards for all four roles" step. Only the teacher-facing attendance module exists so far.
- **Admin: Correct Attendance screen**: admins can currently only fix old/locked attendance records via Supabase's Table Editor directly (bypasses the 7-day window, subject-scoping rules, and audit logging). A proper in-app screen going through the normal rules is still needed.
- **Score edit window**: unlike attendance's 7-day rule, scores currently have no time limit within the current session — a teacher can edit any term's scores at any time. Decision deferred to be made alongside the report-card task (likely rule: locked once results are published, or N days after term end, admins exempt).

## Next Steps
1. Database schema (tables + types) as Supabase migrations
2. RLS policies
3. Auth + role-based routing (React)
4. Admin module (school/class/user management)
5. Attendance module
6. Gradebook + assignments
7. Fees module (+ Paystack/Flutterwave integration)
8. Messaging/announcements
9. ID card generation
10. Parent/student dashboards

Each step will be handed to Claude Code as a scoped, self-contained prompt with full relevant context from this document.