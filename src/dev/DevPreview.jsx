import { useState } from 'react'
import { Route, Routes, useSearchParams } from 'react-router-dom'
import AdminShell from '../components/AdminShell'
import { AdminDashboardView } from '../pages/AdminDashboard'
import { Alert, Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, StatCard } from '../components/ui/Primitives'
import { Checkbox, Field, RadioGroup, Select, TextArea, TextInput } from '../components/ui/Form'
import DataTable from '../components/ui/DataTable'
import Dialog from '../components/ui/Dialog'

// DEVELOPMENT ONLY (not in the production build): previews of the admin
// shell and dashboard with SAMPLE data (no sign-in needed), a UI kit, and a
// frame to view any preview at an exact screen width.
//   /__dev/admin                  shell + Overview dashboard (sample data)
//   /__dev/admin?state=loading    ...every panel loading (also: empty, error)
//   /__dev/ui                     every design-system component
//   /__dev/frame?src=/__dev/admin&w=375&h=812   a preview at 375 x 812

const PROFILE = { first_name: 'Ikong', last_name: 'Jessi', admin_level: 'super_admin' }
const ok = (data) => ({ loading: false, error: null, data, reload: () => {} })
const loading = { loading: true, error: null, data: null, reload: () => {} }
const failed = { loading: false, error: new Error('offline'), data: null, reload: () => {} }
const FakeSignOut = (
  <button type="button" className="ds-btn ds-btn-secondary ds-btn-sm">
    Log out
  </button>
)

const TERM = { id: 't1', name: 'First Term', start_date: '2026-09-16', end_date: '2026-12-18', sessions: { name: '2026/2027' } }
const section = (id, name, level, records, present, late, absent, excused) => ({
  section_id: id,
  class_name: name.split(' ')[0],
  section_name: name.split(' ')[1],
  class_level: level,
  records,
  present,
  late,
  absent,
  excused,
})
const SAMPLE = {
  overview: {
    students: 184,
    teachers: 14,
    classes: 3,
    overdueInvoices: 7,
    unassignedSlots: 2,
    inactiveTeacherSlots: 1,
    gaps: [{ section_id: 's2', class_name: 'JSS1', section_name: 'B', subject_name: 'Basic Technology', students: 12 }],
    fees: { amount_due: 9200000, amount_paid: 6150000, invoices: 184, paid: 121 },
  },
  attendance: {
    today: [section('s1', 'JSS1 A', 1, 62, 55, 3, 4, 0), section('s2', 'JSS1 B', 1, 58, 40, 2, 16, 0)],
    week: [section('s1', 'JSS1 A', 1, 310, 280, 12, 16, 2), section('s2', 'JSS1 B', 1, 290, 205, 9, 70, 6), section('s3', 'JSS2 A', 2, 120, 110, 4, 6, 0)],
    term: [section('s1', 'JSS1 A', 1, 1240, 1130, 40, 60, 10), section('s2', 'JSS1 B', 1, 1180, 880, 30, 250, 20), section('s3', 'JSS2 A', 2, 480, 450, 10, 20, 0)],
    lowStudents: [
      { student_id: 'a', full_name: 'Chinedu Okonkwo-Adebayo', class_name: 'JSS1', section_name: 'B', rate: 54.5, absent: 20, records: 44, excused: 0 },
      { student_id: 'b', full_name: 'Amina Bello', class_name: 'JSS1', section_name: 'B', rate: 71.4, absent: 12, records: 42, excused: 0 },
      { student_id: 'c', full_name: 'Ekpeyong Ita', class_name: 'JSS1', section_name: 'A', rate: 78.9, absent: 8, records: 40, excused: 2 },
    ],
  },
  activity: {
    names: {},
    rowsByEntity: {},
    entries: [
      { id: 1, created_at: '2026-09-25T09:12:00Z', action: 'insert_classes', entity: 'classes', entity_id: 'x', changes: { name: 'JSS2' }, users: { first_name: 'Ikong', last_name: 'Jessi' } },
      { id: 2, created_at: '2026-09-25T08:40:00Z', action: 'update_news_posts', entity: 'news_posts', entity_id: 'y', changes: { title: { old: 'a', new: 'b' } }, users: { first_name: 'Admin', last_name: 'One' } },
      { id: 3, created_at: '2026-09-24T16:05:00Z', action: 'delete_contact_messages', entity: 'contact_messages', entity_id: 'z', changes: { name: 'Spam Sender', subject: 'Win now' }, users: null },
    ],
  },
}

export default function DevPreview() {
  return (
    <Routes>
      <Route path="admin" element={<AdminPreview />} />
      <Route path="ui" element={<UiKit />} />
      <Route path="frame" element={<Frame />} />
    </Routes>
  )
}

function AdminPreview() {
  const [params] = useSearchParams()
  const state = params.get('state')
  const pick = (data) => (state === 'loading' ? loading : state === 'error' ? failed : ok(data))
  const empty = state === 'empty'
  return (
    <AdminShell profile={PROFILE} signOut={FakeSignOut}>
      <AdminDashboardView
        term={TERM}
        todayIso="2026-09-25"
        weekStart="2026-09-21"
        range={{ from: '2026-09-16', to: '2026-09-25' }}
        overview={pick(empty ? { ...SAMPLE.overview, overdueInvoices: 0, unassignedSlots: 0, inactiveTeacherSlots: 0, gaps: [] } : SAMPLE.overview)}
        attendance={pick(empty ? { today: [], week: [], term: [], lowStudents: [] } : SAMPLE.attendance)}
        activity={pick(empty ? { ...SAMPLE.activity, entries: [] } : SAMPLE.activity)}
      />
    </AdminShell>
  )
}

function UiKit() {
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState('teacher')
  return (
    <AdminShell profile={PROFILE} signOut={FakeSignOut}>
      <PageHeader title="UI kit" subtitle="Every design-system component, for checking at phone, tablet and desktop widths.">
        <Button onClick={() => setOpen(true)}>Open dialog</Button>
      </PageHeader>
      <Card title="Buttons">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="danger">Delete</Button>
          <Button variant="ghost">Ghost</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm" variant="secondary">
            Small (desktop)
          </Button>
        </div>
      </Card>
      <Card title="Status badges">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {['graded', 'submitted', 'late', 'overdue', 'locked', 'paid', 'partial', 'unpaid', 'new', 'published', 'draft', 'deactivated'].map((s) => (
            <Badge key={s} status={s} dot />
          ))}
        </div>
      </Card>
      <div className="ds-stat-grid">
        <StatCard label="Students" value="184" hint="active this session" />
        <StatCard label="Warning" value="72%" hint="under 80%" tone="warning" />
        <StatCard label="Danger" value="7" hint="overdue" tone="danger" />
      </div>
      <Card title="Form controls">
        <div className="ds-form-grid">
          <Field label="Full name" hint="As it appears on the birth certificate">
            {(p) => <TextInput {...p} placeholder="Ada Okafor" />}
          </Field>
          <Field label="Email" error="That email address does not look right.">
            {(p) => <TextInput {...p} type="email" defaultValue="ada@" />}
          </Field>
          <Field label="Class">
            {(p) => (
              <Select {...p} defaultValue="">
                <option value="">Choose a class</option>
                <option>JSS1</option>
              </Select>
            )}
          </Field>
          <Field label="Date of birth">{(p) => <TextInput {...p} type="date" />}</Field>
          <Field label="Notes" className="ds-span-2">
            {(p) => <TextArea {...p} />}
          </Field>
          <div>
            <Checkbox label="Send an invite email" defaultChecked />
            <Checkbox label="Deactivated" />
          </div>
          <RadioGroup
            legend="Account type"
            name="role"
            value={role}
            onChange={setRole}
            options={[
              { value: 'teacher', label: 'Teacher' },
              { value: 'limited_admin', label: 'Admin (limited)' },
            ]}
          />
        </div>
        <div className="ds-form-actions">
          <Button variant="secondary">Cancel</Button>
          <Button>Save changes</Button>
        </div>
      </Card>
      <Card title="Table (cards on phones)" flush>
        <DataTable
          rowKey={(r) => r.id}
          rows={[
            { id: 1, name: 'Chinedu Okonkwo-Adebayo', no: 'STU/2026/0001', cls: 'JSS1 A', status: 'active' },
            { id: 2, name: 'Amina Bello', no: 'STU/2026/0002', cls: 'JSS1 B', status: 'withdrawn' },
          ]}
          columns={[
            { key: 'name', header: 'Name', primary: true },
            { key: 'no', header: 'Admission no.' },
            { key: 'cls', header: 'Class' },
            { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
          ]}
        />
      </Card>
      <Card title="States">
        <LoadingState lines={3} />
        <EmptyState title="No students yet">Add one with the button above.</EmptyState>
        <ErrorState onRetry={() => {}} />
        <Alert tone="success">Saved.</Alert>
        <Alert tone="warning">This term is locked for teachers.</Alert>
      </Card>
      {open && (
        <Dialog
          title="Edit student details"
          onClose={() => setOpen(false)}
          footer={
            <div className="ds-form-actions">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => setOpen(false)}>Save changes</Button>
            </div>
          }
        >
          <Field label="First name">{(p) => <TextInput {...p} defaultValue="Ada" />}</Field>
          <Field label="Last name">{(p) => <TextInput {...p} defaultValue="Okafor" />}</Field>
          <Field label="Gender">
            {(p) => (
              <Select {...p} defaultValue="female">
                <option value="female">Female</option>
                <option value="male">Male</option>
              </Select>
            )}
          </Field>
        </Dialog>
      )}
    </AdminShell>
  )
}

// A preview at an exact width, e.g. /__dev/frame?src=/__dev/admin&w=375&h=812
function Frame() {
  const [params] = useSearchParams()
  const src = params.get('src') ?? '/__dev/admin'
  const w = Number(params.get('w') ?? 375)
  const h = Number(params.get('h') ?? 812)
  return (
    <div style={{ padding: 12, background: '#333', minHeight: '100vh' }}>
      <iframe title="preview" src={src} width={w} height={h} style={{ border: 0, background: '#fff', display: 'block' }} />
    </div>
  )
}
