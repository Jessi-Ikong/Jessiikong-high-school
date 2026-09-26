import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { toIsoDate } from '../lib/dates'
import { AuthContext } from '../hooks/useAuth'
import AppShell from '../components/AppShell'
import Students from '../pages/admin/Students'
import Timetable from '../pages/admin/Timetable'
import GradeScale from '../pages/admin/GradeScale'
import CorrectAttendance from '../pages/admin/CorrectAttendance'
import StuckPayments from '../pages/admin/StuckPayments'
import Announcements from '../pages/admin/Announcements'
import AdmissionsInquiries from '../pages/admin/AdmissionsInquiries'
import IdCards from '../pages/admin/IdCards'
import Staff from '../pages/admin/Staff'
import TeacherDashboard from '../pages/TeacherDashboard'
import Gradebook from '../pages/teacher/Gradebook'
import TeacherAssignments from '../pages/teacher/Assignments'
import MarkAttendance from '../pages/teacher/MarkAttendance'
import TeacherMessages from '../pages/teacher/Messages'
import StudentDashboard from '../pages/StudentDashboard'
import StudentAssignments from '../pages/student/Assignments'
import ParentDashboard from '../pages/ParentDashboard'
import ParentFees from '../pages/parent/Fees'
import ParentMessages from '../pages/parent/Messages'
import AnnouncementFeed from '../components/AnnouncementFeed'
import Profile from '../pages/Profile'

// DEVELOPMENT ONLY: the REAL pages of every portal rendered with SAMPLE data,
// inside that portal's shell, to check layouts at phone / tablet / desktop
// widths without signing in:
//   /__dev/page/<name>, e.g. /__dev/page/students or /__dev/page/parent-messages?thread=th1
//   (all names: see PREVIEWS below; teacher-attendance takes a slot:
//    /__dev/page/teacher-attendance/11111111-1111-4111-8111-111111111111)
// While a preview is open, the Supabase client is swapped for a fake that
// answers reads from SAMPLE_TABLES / SAMPLE_RPC (applying simple eq / in
// filters) and refuses every write, so nothing is ever sent or saved.
// Its auth is fake too (Change password on the profile previews): the
// "current password" it accepts is PREVIEW_PASSWORD below (a made-up test
// value, never a real one); every call is recorded in window.__previewAuthCalls.

const PROFILES = {
  admin: { id: 'u-admin', first_name: 'Ikong', last_name: 'Jessi', role: 'admin', admin_level: 'super_admin' },
  'limited-admin': { id: 'u-admin2', first_name: 'Ada', last_name: 'Okafor', role: 'admin', admin_level: 'limited_admin' },
  teacher: { id: 'ut1', first_name: 'Ekaette', last_name: 'Bassey', role: 'teacher' },
  student: { id: 'us1', first_name: 'Chinedu', last_name: 'Okonkwo-Adebayo', role: 'student' },
  parent: { id: 'up1', first_name: 'Grace', last_name: 'Okonkwo-Adebayo', role: 'parent' },
}

const PREVIEWS = {
  // admin (one per group)
  students: ['admin', Students],
  timetable: ['admin', Timetable],
  grades: ['admin', GradeScale],
  corrections: ['admin', CorrectAttendance],
  'stuck-payments': ['admin', StuckPayments],
  announcements: ['admin', Announcements],
  inquiries: ['admin', AdmissionsInquiries],
  'id-cards': ['admin', IdCards],
  staff: ['admin', Staff],
  'admin-profile': ['admin', Profile],
  'limited-admin-profile': ['limited-admin', Profile],
  // teacher
  'teacher-today': ['teacher', TeacherDashboard],
  'teacher-gradebook': ['teacher', Gradebook],
  'teacher-assignments': ['teacher', TeacherAssignments],
  'teacher-attendance': ['teacher', MarkAttendance],
  'teacher-messages': ['teacher', TeacherMessages],
  'teacher-profile': ['teacher', Profile],
  // student
  'student-home': ['student', StudentDashboard],
  'student-assignments': ['student', StudentAssignments],
  'student-announcements': ['student', AnnouncementFeed],
  // parent
  'parent-home': ['parent', ParentDashboard],
  'parent-fees': ['parent', ParentFees],
  'parent-messages': ['parent', ParentMessages],
  'parent-profile': ['parent', Profile],
}

const SLOT_ID = '11111111-1111-4111-8111-111111111111'
const TODAY = toIsoDate(new Date())
const TODAY_NAME = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date().getDay()]
const ago = (hours) => new Date(Date.now() - hours * 3_600_000).toISOString()
const person = (id, first, last, extra = {}) => ({ id, first_name: first, middle_name: null, last_name: last, email: `${first.toLowerCase()}@example.com`, photo_url: null, is_active: true, ...extra })
// Just the name columns (queries that select users(first_name, ...) get no id).
const names = ({ first_name, middle_name, last_name }) => ({ first_name, middle_name, last_name })
const CHINEDU = person('us1', 'Chinedu', 'Okonkwo-Adebayo')
const AMINA = person('us2', 'Amina', 'Bello')
const EKAETTE = person('ut1', 'Ekaette', 'Bassey')
const SEUN = person('ut2', 'Oluwaseun', 'Adeyemi-Nwachukwu')
const TERM = { id: 't1', name: 'First Term', term_number: 1, is_current: true, start_date: '2026-09-14', end_date: '2026-12-18', session_id: 'se1', sessions: { name: '2026/2027', start_date: '2026-09-14', is_current: true } }
const SECTION_A = { name: 'A', classes: { name: 'JSS1', level: 1 } }
const SUBJECTS = {
  sb1: { name: 'Mathematics', code: 'MTH' },
  sb2: { name: 'English Language', code: 'ENG' },
  sb3: { name: 'Basic Science and Technology', code: 'BST' },
}
const PERIODS = {
  p1: { name: 'Period 1', start_time: '08:00', end_time: '08:40', is_break: false },
  p2: { name: 'Period 2', start_time: '08:40', end_time: '09:20', is_break: false },
  p4: { name: 'Period 3', start_time: '09:40', end_time: '10:20', is_break: false },
}
const enrollment = (id, studentId, sectionId, sectionName, adm, user, status = 'active') => ({
  id,
  status,
  student_id: studentId,
  class_id: 'c1',
  section_id: sectionId,
  session_id: 'se1',
  classes: { name: 'JSS1', level: 1 },
  sections: { name: sectionName, classes: { name: 'JSS1' } },
  sessions: { name: '2026/2027', is_current: true },
  student_subjects: [{ subject_id: 'sb1' }, { subject_id: 'sb2' }, { subject_id: 'sb3' }],
  students: { id: studentId, admission_number: adm, gender: 'female', date_of_birth: '2014-03-02', users: user },
})
const slot = (id, periodId, day, subjectId, teacher) => ({
  id,
  term_id: 't1',
  section_id: 's1',
  period_id: periodId,
  day_of_week: day,
  subject_id: subjectId,
  teacher_id: teacher ? teacher.teacherId : null,
  subjects: SUBJECTS[subjectId],
  sections: SECTION_A,
  periods: PERIODS[periodId],
  teachers: teacher ? { users: teacher.user } : null,
  terms: TERM,
})
const payment = (id, status, hours, lastCheck, extra = {}) => ({
  id,
  amount: 45000,
  status,
  provider: 'paystack',
  provider_ref: `JHS-2026-${id}-8f3a9c2d7e`,
  created_at: ago(hours),
  paid_at: status === 'successful' ? ago(hours - 0.1) : null,
  provider_response: lastCheck ? { last_check: lastCheck, ...extra } : null,
  users: { first_name: 'Grace', last_name: 'Okonkwo-Adebayo', email: 'grace.okonkwo.adebayo@example.com' },
  invoices: { student_id: 'st1', amount_due: 45000, amount_paid: 0, status: 'unpaid', fee_structures: { name: 'Tuition' }, terms: { name: 'First Term' }, students: { admission_number: 'JHS/2026/014', users: CHINEDU } },
})
const assignment = (id, title, dueHours, extra = {}) => ({
  id,
  title,
  description: 'Answer questions 1 to 10 on page 42. Show your working.',
  attachment_url: null,
  due_at: new Date(Date.now() + dueHours * 3_600_000).toISOString(),
  max_score: 20,
  requires_submission: true,
  created_at: ago(72),
  term_id: 't1',
  section_id: 's1',
  subject_id: 'sb1',
  subjects: SUBJECTS.sb1,
  sections: SECTION_A,
  teachers: { users: EKAETTE },
  terms: TERM,
  submissions: [],
  ...extra,
})
const submission = (id, assignmentId, studentId, extra = {}) => ({
  id,
  assignment_id: assignmentId,
  student_id: studentId,
  content: 'Photosynthesis is how green plants make food from sunlight, water and carbon dioxide.',
  attachment_url: null,
  submitted_at: ago(20),
  score: null,
  feedback: null,
  graded_at: null,
  assignments: { title: 'Fractions worksheet', max_score: 20, subjects: SUBJECTS.sb1 },
  ...extra,
})

const SAMPLE_TABLES = {
  users: [
    ...Object.values(PROFILES).map((p) => ({ ...p, middle_name: null, email: `${p.first_name.toLowerCase()}@example.com`, photo_url: null, is_active: true })),
    { id: 'u-admin3', first_name: 'Tobi', middle_name: null, last_name: 'Second', role: 'admin', admin_level: 'super_admin', email: 'tobi@example.com', photo_url: null, is_active: false },
  ],
  teachers: [
    { id: 'te1', user_id: 'ut1', users: EKAETTE },
    { id: 'te2', user_id: 'ut2', users: SEUN },
  ],
  students: [
    { id: 'st1', user_id: 'us1' },
    { id: 'st2', user_id: 'us2' },
  ],
  parents: [{ id: 'pa1', user_id: 'up1' }],
  parent_students: [
    { parent_id: 'pa1', relationship: 'mother', students: { id: 'st1', admission_number: 'JHS/2026/014', users: names(CHINEDU) } },
    { parent_id: 'pa1', relationship: 'mother', students: { id: 'st2', admission_number: 'JHS/2026/002', users: names(AMINA) } },
  ],
  sessions: [{ id: 'se1', name: '2026/2027', is_current: true, start_date: '2026-09-14' }],
  terms: [TERM],
  classes: [
    { id: 'c1', name: 'JSS1', level: 1 },
    { id: 'c2', name: 'JSS2', level: 2 },
  ],
  sections: [
    { id: 's1', class_id: 'c1', name: 'A' },
    { id: 's2', class_id: 'c1', name: 'B' },
    { id: 's3', class_id: 'c2', name: 'A' },
  ],
  subjects: Object.entries(SUBJECTS).map(([id, s]) => ({ id, ...s })),
  periods: [
    { id: 'p1', ...PERIODS.p1 },
    { id: 'p2', ...PERIODS.p2 },
    { id: 'p3', name: 'Short break', start_time: '09:20', end_time: '09:40', is_break: true },
    { id: 'p4', ...PERIODS.p4 },
  ],
  timetable_slots: [
    slot('ts1', 'p1', 'monday', 'sb1', { teacherId: 'te1', user: EKAETTE }),
    slot('ts2', 'p2', 'monday', 'sb3', { teacherId: 'te2', user: SEUN }),
    slot('ts3', 'p4', 'wednesday', 'sb2', null),
    // today's lessons (whatever weekday the preview runs on)
    slot(SLOT_ID, 'p1', TODAY_NAME, 'sb1', { teacherId: 'te1', user: EKAETTE }),
    slot('ts5', 'p4', TODAY_NAME, 'sb3', { teacherId: 'te1', user: EKAETTE }),
  ],
  enrollments: [
    enrollment('e1', 'st1', 's1', 'A', 'JHS/2026/014', CHINEDU),
    enrollment('e2', 'st2', 's1', 'A', 'JHS/2026/002', AMINA),
    enrollment('e3', 'st3', 's2', 'B', 'JHS/2026/031', person('us3', 'Ekpeyong', 'Ita', { is_active: false }), 'withdrawn'),
  ],
  attendance_records: [{ timetable_slot_id: SLOT_ID, enrollment_id: 'e1', status: 'present', date: TODAY, updated_at: ago(1), marker: EKAETTE }],
  assessment_components: [
    { id: 'ac1', name: 'CA 1', max_score: 20, weight: 20, sort_order: 1 },
    { id: 'ac2', name: 'CA 2', max_score: 20, weight: 20, sort_order: 2 },
    { id: 'ac3', name: 'Exam', max_score: 60, weight: 60, sort_order: 3 },
  ],
  scores: [
    { id: 'sc1', student_id: 'st1', component_id: 'ac1', score_obtained: 17, created_at: ago(30), updated_at: ago(30), subjects: SUBJECTS.sb1, assessment_components: { name: 'CA 1', max_score: 20 } },
    { id: 'sc2', student_id: 'st2', component_id: 'ac1', score_obtained: 12.5, created_at: ago(30), updated_at: ago(30), subjects: SUBJECTS.sb1, assessment_components: { name: 'CA 1', max_score: 20 } },
    { id: 'sc3', student_id: 'st1', component_id: 'ac2', score_obtained: 15, created_at: ago(8), updated_at: ago(8), subjects: SUBJECTS.sb1, assessment_components: { name: 'CA 2', max_score: 20 } },
  ],
  grading_scale: [
    { id: 'g1', grade: 'A', min_score: 70, max_score: 100, remark: 'Excellent' },
    { id: 'g2', grade: 'B', min_score: 60, max_score: 69, remark: 'Very good' },
    { id: 'g3', grade: 'C', min_score: 50, max_score: 59, remark: 'Credit' },
    { id: 'g4', grade: 'F', min_score: 0, max_score: 49, remark: 'Fail' },
  ],
  assignments: [
    assignment('as1', 'Fractions worksheet', 30, { submissions: [{ id: 'sub1', submitted_at: ago(20), graded_at: null }] }),
    assignment('as2', 'Measure your classroom (practical)', 80, { requires_submission: false, description: null }),
    assignment('as3', 'Number bases exercise', -60, { submissions: [{ id: 'sub3', submitted_at: ago(70), graded_at: ago(40) }] }),
  ],
  submissions: [
    submission('sub1', 'as1', 'st1'),
    submission('sub2', 'as1', 'st2', { submitted_at: new Date(Date.now() + 1000).toISOString(), content: null }),
    submission('sub3', 'as3', 'st1', { score: 16, feedback: 'Good work. Check question 4 again.', graded_at: ago(40), assignments: { title: 'Number bases exercise', max_score: 20, subjects: SUBJECTS.sb1 } }),
  ],
  messages: [
    { id: 'm1', thread_id: 'th1', sender_id: 'up1', body: 'Good morning. Chinedu said there is a maths test on Friday. Which chapters should he revise?', sent_at: ago(26), read_at: ago(25), edited_at: null, reply_to_message_id: null },
    { id: 'm2', thread_id: 'th1', sender_id: 'ut1', body: 'Good morning Mrs Okonkwo-Adebayo. Chapters 1 to 3: fractions, decimals and number bases.', sent_at: ago(25), read_at: ago(3), edited_at: null, reply_to_message_id: 'm1' },
    { id: 'm3', thread_id: 'th1', sender_id: 'up1', body: 'Thank you!', sent_at: ago(0.4), read_at: null, edited_at: null, reply_to_message_id: null },
  ],
  invoices: [
    { id: 'in1', student_id: 'st1', amount_due: 45000, amount_paid: 20000, status: 'partial', due_date: '2026-10-15', created_at: ago(300), fee_structures: { name: 'Tuition' }, terms: { name: 'First Term', start_date: '2026-09-14', sessions: { name: '2026/2027' } }, balance: 25000 },
    { id: 'in2', student_id: 'st1', amount_due: 5000, amount_paid: 0, status: 'overdue', due_date: '2026-09-20', created_at: ago(300), fee_structures: { name: 'PTA Levy' }, terms: { name: 'First Term', start_date: '2026-09-14', sessions: { name: '2026/2027' } }, balance: 5000 },
    { id: 'in3', student_id: 'st1', amount_due: 12000, amount_paid: 12000, status: 'paid', due_date: null, created_at: ago(300), fee_structures: { name: 'Books' }, terms: { name: 'First Term', start_date: '2026-09-14', sessions: { name: '2026/2027' } }, balance: 0 },
  ],
  payments: [
    payment('01', 'pending', 0.5, null),
    payment('02', 'pending', 30, { at: ago(0.2), first_checked_at: ago(29), check_count: 5, source: 'reconcile', paystack_status: 'abandoned', gateway_response: 'The transaction was not completed' }),
    payment('03', 'pending', 2, { at: ago(0.1), check_count: 1, source: 'reconcile', outcome: 'paystack-unreachable' }),
    payment('04', 'successful', 20, { at: ago(19), check_count: 1, source: 'reconcile', paystack_status: 'success' }),
    payment('05', 'failed', 50, { at: ago(2), check_count: 9, source: 'reconcile', paystack_status: 'abandoned' }, { expired: true }),
  ],
  announcements: [
    { id: 'a1', title: 'Inter-house sports: Friday 9 October', body: 'All students should come in their house colours. Parents are welcome from 10 am. Refreshments will be available at the canteen, and the closing ceremony starts at 2 pm on the main field.', audience: 'all', class_id: null, classes: null, author_name: 'Ikong Jessi', published_at: ago(5), created_at: ago(5), updated_at: ago(1) },
    { id: 'a2', title: 'JSS1 mathematics test', body: 'Chapters 1 to 3.', audience: 'specific_class', class_id: 'c1', classes: { name: 'JSS1' }, author_name: 'Ekaette Bassey', published_at: ago(30), created_at: ago(30), updated_at: ago(30) },
  ],
  admissions_inquiries: [
    { id: 'i1', parent_name: 'Mrs Blessing Okonkwo-Adebayo', email: 'blessing.okonkwo.adebayo@example.com', phone: '+234 803 000 0000', child_name: 'Tochukwu Okonkwo-Adebayo', desired_class: 'JSS1', message: 'We are relocating to Yala in December. Is there space in JSS1 for the second term?\n\nThank you.', status: 'new', internal_notes: null, submitted_at: ago(3), updated_at: ago(3) },
    { id: 'i2', parent_name: 'Mr Idris Bello', email: 'idris@example.com', phone: null, child_name: 'Fatima Bello', desired_class: 'JSS2', message: null, status: 'contacted', internal_notes: 'Called on Monday.', submitted_at: ago(80), updated_at: ago(40) },
  ],
  id_cards: [
    { id: 'id1', card_number: 'JHS-26-0001', issued_at: ago(48), is_active: true, revoked_at: null, revoked_reason: null, users: person('ut1', 'Ekaette', 'Bassey', { role: 'teacher' }) },
    { id: 'id2', card_number: 'JHS-26-0002', issued_at: ago(48), is_active: true, revoked_at: null, revoked_reason: null, users: person('us1', 'Chinedu', 'Okonkwo-Adebayo', { role: 'student' }) },
    { id: 'id3', card_number: 'JHS-26-0003', issued_at: ago(96), is_active: false, revoked_at: ago(50), revoked_reason: 'Lost on the school bus', users: person('us2', 'Amina', 'Bello', { role: 'student' }) },
  ],
}

const SAMPLE_RPC = {
  my_message_threads: [
    { thread_id: 'th1', other_name: 'Grace Okonkwo-Adebayo', links: 'Parent of Chinedu Okonkwo-Adebayo (JSS1 A, Mathematics)', last_message: 'Thank you!', last_sender_is_me: false, last_message_at: ago(0.4), created_at: ago(200), unread_count: 1, can_send: true },
    { thread_id: 'th2', other_name: 'Idris Bello', links: null, last_message: 'See you at the PTA meeting.', last_sender_is_me: true, last_message_at: ago(400), created_at: ago(900), unread_count: 0, can_send: false },
  ],
  my_message_contacts: [{ teacher_id: 'te2', parent_id: 'pa1', name: 'Oluwaseun Adeyemi-Nwachukwu', links: 'Teaches Chinedu Basic Science and Technology' }],
  get_class_rankings: [{ student_id: 'st1', position: 3, class_size: 28, average_score: 71.4 }],
  student_attendance_rates: [
    { student_id: 'st1', rate: 92.5, attended: 37, records: 40, excused: 0, absent: 3 },
    { student_id: 'st2', rate: 74.2, attended: 23, records: 32, excused: 1, absent: 8 },
  ],
}

const PREVIEW_ERROR = { message: 'Preview only: nothing is saved.', code: 'PREVIEW' }

// Fake sign-in check for "Change password" (a made-up test value).
const PREVIEW_PASSWORD = 'preview-current-pw-1'
function fakeAuth(authUser) {
  const calls = (window.__previewAuthCalls ??= [])
  return {
    signInWithPassword: async ({ email, password }) => {
      calls.push({ call: 'signInWithPassword', email, ok: password === PREVIEW_PASSWORD })
      return password === PREVIEW_PASSWORD && email === authUser.email
        ? { data: { user: authUser, session: {} }, error: null }
        : { data: { user: null, session: null }, error: { code: 'invalid_credentials', message: 'Invalid login credentials' } }
    },
    updateUser: async ({ password }) => {
      calls.push({ call: 'updateUser', length: password.length })
      return { data: { user: authUser }, error: null }
    },
  }
}

// A stand-in for supabase.from(table): every filter/order method chains; eq
// and in filter on plain columns; awaiting it gives { data, error, count }.
function fakeQuery(table) {
  let rows = SAMPLE_TABLES[table] ?? []
  let write = false
  let single = false
  const builder = {
    then(resolve, reject) {
      const result = write ? { data: null, error: PREVIEW_ERROR, count: null } : { data: single ? (rows[0] ?? null) : rows, error: null, count: rows.length }
      return Promise.resolve(result).then(resolve, reject)
    },
  }
  const chain = () => builder
  for (const name of ['select', 'order', 'limit', 'range', 'lt', 'lte', 'gt', 'gte', 'neq', 'is', 'not', 'or', 'filter', 'match', 'ilike', 'like', 'contains']) builder[name] = chain
  for (const name of ['insert', 'update', 'upsert', 'delete']) {
    builder[name] = () => {
      write = true
      return builder
    }
  }
  builder.eq = (column, value) => {
    if (!column.includes('.') && !column.includes('->')) rows = rows.filter((r) => !(column in r) || r[column] === value)
    return builder
  }
  builder.in = (column, values) => {
    if (!column.includes('.')) rows = rows.filter((r) => !(column in r) || values.includes(r[column]))
    return builder
  }
  builder.maybeSingle = builder.single = () => {
    single = true
    return builder
  }
  return builder
}

function fakeRpc(name) {
  return Promise.resolve(name in SAMPLE_RPC ? { data: SAMPLE_RPC[name], error: null } : { data: null, error: PREVIEW_ERROR })
}

export default function PagePreview() {
  const { name } = useParams()
  const [role, Page] = PREVIEWS[name] ?? []
  // Swap the client BEFORE the page's first fetch (children's effects run after this render).
  const profile = PROFILES[role]
  const authUser = profile && { id: `auth-${profile.id}`, email: `${profile.first_name.toLowerCase()}@example.com` }
  // Installed once and never undone (React's development double-run would
  // otherwise undo it mid-page): reload the tab to use the real client again.
  useState(() => {
    supabase.from = fakeQuery
    supabase.rpc = fakeRpc
    if (authUser) Object.assign(supabase.auth, fakeAuth(authUser))
  })

  if (!Page) return <p style={{ padding: 16 }}>Unknown preview. Try: {Object.keys(PREVIEWS).join(', ')}</p>
  const auth = { user: authUser, profile, profileError: null, loading: false, signOut: () => {} }
  return (
    <AuthContext.Provider value={auth}>
      <AppShell role={role === 'limited-admin' ? 'admin' : role} profile={profile} signOut={<button type="button" className="ds-btn ds-btn-secondary ds-btn-sm">Log out</button>}>
        <Page />
      </AppShell>
    </AuthContext.Provider>
  )
}
