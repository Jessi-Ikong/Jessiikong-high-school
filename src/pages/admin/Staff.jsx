import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run } from '../../lib/db'
import { callFunction } from '../../lib/functions'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useAuth } from '../../hooks/useAuth'
import { adminDeactivationBlocker, fullName, byName } from '../../lib/people'
import PhotoUpload from '../../components/PhotoUpload'
import { ActiveToggle, EditTeacherDialog } from '../../components/PersonEdit'
import { Alert, Badge, Button, Card, EmptyState, LoadingState, PageHeader } from '../../components/ui/Primitives'
import { Field, Select, TextInput } from '../../components/ui/Form'
import DataTable from '../../components/ui/DataTable'

const EMPTY_FORM = { account: 'teacher', full_name: '', email: '', staff_id: '', department: '' }

async function fetchStaff() {
  const [teachers, admins, slots] = await Promise.all([
    run(supabase.from('teachers').select('id, staff_id, department, users(user_id:id, first_name, middle_name, last_name, email, is_active, photo_url)')),
    run(supabase.from('users').select('id, first_name, middle_name, last_name, email, admin_level, is_active').eq('role', 'admin')),
    // this term's timetable slots, to say what deactivating a teacher leaves behind
    run(supabase.from('timetable_slots').select('teacher_id, terms!inner(is_current)').eq('terms.is_current', true).not('teacher_id', 'is', null)),
  ])
  const slotCount = {}
  for (const s of slots) slotCount[s.teacher_id] = (slotCount[s.teacher_id] ?? 0) + 1
  return {
    teachers: teachers.map((t) => ({ ...t, ...t.users, slotsThisTerm: slotCount[t.id] ?? 0 })).sort(byName),
    admins: admins.sort(byName),
  }
}

export default function Staff() {
  const { profile } = useAuth()
  const isSuperAdmin = profile.admin_level === 'super_admin'
  const { data, error: loadError, loading, reload } = useAsyncData(fetchStaff, 'staff')

  const [form, setForm] = useState(EMPTY_FORM)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(null) // teacher being edited

  const isTeacher = form.account === 'teacher'

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setSuccess(null)
    setSaving(true)
    const body = isTeacher
      ? { role: 'teacher', full_name: form.full_name, email: form.email, staff_id: form.staff_id, department: form.department }
      : { role: 'admin', admin_level: form.account, full_name: form.full_name, email: form.email }
    try {
      await callFunction('invite-user', body)
      setSuccess(`${form.full_name.trim()} was added. An invite email has been sent to ${form.email.trim()}.`)
      setForm(EMPTY_FORM)
      reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader title="Staff" subtitle="Teachers and admins. New staff get an email invite to set their password." />

      <Card title="Add staff member">
        <form onSubmit={handleSubmit}>
          {error && <Alert tone="danger">{error}</Alert>}
          {success && <Alert tone="success">{success}</Alert>}
          <div className="ds-form-grid">
            <Field label="Account type" hint={!isSuperAdmin ? 'Only super admins can add admin accounts.' : undefined}>
              {(p) => (
                <Select {...p} value={form.account} onChange={(e) => update('account', e.target.value)}>
                  <option value="teacher">Teacher</option>
                  {isSuperAdmin && <option value="limited_admin">Admin (limited)</option>}
                  {isSuperAdmin && <option value="super_admin">Admin (super)</option>}
                </Select>
              )}
            </Field>
            <Field label="Full name">
              {(p) => <TextInput {...p} value={form.full_name} onChange={(e) => update('full_name', e.target.value)} placeholder="Musa Bello" required />}
            </Field>
            <Field label="Email">
              {(p) => <TextInput {...p} type="email" value={form.email} onChange={(e) => update('email', e.target.value)} required />}
            </Field>
            {isTeacher && (
              <>
                <Field label="Staff ID">
                  {(p) => <TextInput {...p} value={form.staff_id} onChange={(e) => update('staff_id', e.target.value)} placeholder="STF/001" required />}
                </Field>
                <Field label="Department" hint="Optional">
                  {(p) => <TextInput {...p} value={form.department} onChange={(e) => update('department', e.target.value)} placeholder="Sciences" />}
                </Field>
              </>
            )}
          </div>
          <div className="ds-form-actions">
            <Button type="submit" disabled={saving}>
              {saving ? 'Sending invite…' : 'Add and send invite'}
            </Button>
          </div>
        </form>
      </Card>

      {loading ? (
        <LoadingState lines={5} />
      ) : loadError ? (
        <Alert tone="danger">{friendlyDbError(loadError)}</Alert>
      ) : (
        <>
          <Card title="Teachers" flush>
            <DataTable
              caption="Teachers"
              rowKey={(t) => t.id}
              rows={data.teachers}
              empty={<EmptyState icon="user">No teachers yet — add one above.</EmptyState>}
              columns={[
                {
                  key: 'name',
                  header: 'Name',
                  primary: true,
                  render: (t) => (
                    <span className="ds-inline">
                      {fullName(t)}
                      {!t.is_active && <Badge status="deactivated">Deactivated</Badge>}
                    </span>
                  ),
                },
                { key: 'email', header: 'Email' },
                { key: 'staff_id', header: 'Staff ID' },
                { key: 'department', header: 'Department', render: (t) => t.department ?? <span className="ds-muted">—</span> },
                {
                  key: 'photo',
                  header: 'Photo',
                  render: (t) => <PhotoUpload userId={t.user_id} name={fullName(t)} path={t.photo_url} label="Change" onChanged={reload} />,
                },
                {
                  key: 'actions',
                  header: 'Actions',
                  render: (t) => (
                    <div className="ds-row-actions">
                      <button type="button" className="ds-btn ds-btn-link" onClick={() => setEditing(t)}>
                        Edit
                      </button>
                      <ActiveToggle
                        person={{ userId: t.user_id, name: fullName(t), role: 'teacher', is_active: t.is_active }}
                        extra={
                          t.slotsThisTerm > 0
                            ? `${fullName(t)} teaches ${t.slotsThisTerm} timetable ${t.slotsThisTerm === 1 ? 'slot' : 'slots'} this term.`
                            : null
                        }
                        onChanged={reload}
                      />
                    </div>
                  ),
                },
              ]}
            />
          </Card>

          {/* What's listed is decided by the database (RLS, migration 021):
              super admins see every admin; limited admins only themselves. */}
          <Card title="Admins" flush>
            <p className="ds-note ds-card-body" style={{ paddingBottom: 0 }}>
              {isSuperAdmin
                ? 'As a super admin you see every admin account.'
                : 'As a limited admin you can only see your own admin account here. Other admins are managed by super admins.'}
            </p>
            <DataTable
              caption="Admins"
              rowKey={(a) => a.id}
              rows={data.admins}
              empty={<EmptyState icon="shield">No admin accounts to show.</EmptyState>}
              columns={[
                {
                  key: 'name',
                  header: 'Name',
                  primary: true,
                  render: (a) => (
                    <span className="ds-inline">
                      {fullName(a)}
                      {a.id === profile.id && <span className="ds-muted ds-small">(you)</span>}
                      {!a.is_active && <Badge status="deactivated">Deactivated</Badge>}
                    </span>
                  ),
                },
                { key: 'email', header: 'Email', render: (a) => a.email ?? <span className="ds-muted">—</span> },
                {
                  key: 'level',
                  header: 'Level',
                  render: (a) => <Badge tone={a.admin_level === 'super_admin' ? 'info' : 'neutral'}>{a.admin_level === 'super_admin' ? 'Super admin' : 'Limited admin'}</Badge>,
                },
                // Super admins only: deactivate / reactivate OTHER admins. The
                // database refuses your own account and the last active super
                // admin (migration 042); here we say why instead of failing.
                ...(isSuperAdmin
                  ? [
                      {
                        key: 'actions',
                        header: 'Actions',
                        render: (a) => {
                          const blocker = adminDeactivationBlocker(a, data.admins, profile.id)
                          return blocker ? (
                            <div className="ds-row-actions" style={{ alignItems: 'center' }}>
                              <button type="button" className="ds-btn ds-btn-link" disabled title={blocker} aria-describedby={`why-${a.id}`}>
                                Deactivate
                              </button>
                              <span id={`why-${a.id}`} className="ds-muted ds-small">
                                {blocker}
                              </span>
                            </div>
                          ) : (
                            <div className="ds-row-actions">
                              <ActiveToggle person={{ userId: a.id, name: fullName(a), role: 'admin', is_active: a.is_active }} onChanged={reload} />
                            </div>
                          )
                        },
                      },
                    ]
                  : []),
              ]}
            />
          </Card>
        </>
      )}

      {editing && (
        <EditTeacherDialog
          person={{ teacherId: editing.id, ...editing }}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            reload()
          }}
        />
      )}
    </>
  )
}
