import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run } from '../../lib/db'
import { callFunction } from '../../lib/functions'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useAuth } from '../../hooks/useAuth'
import { fullName, byName } from '../../lib/people'
import PhotoUpload from '../../components/PhotoUpload'

const EMPTY_FORM = { account: 'teacher', full_name: '', email: '', staff_id: '', department: '' }

async function fetchStaff() {
  const [teachers, admins] = await Promise.all([
    run(supabase.from('teachers').select('id, staff_id, department, users(user_id:id, first_name, middle_name, last_name, email, is_active, photo_url)')),
    run(supabase.from('users').select('id, first_name, middle_name, last_name, email, admin_level, is_active').eq('role', 'admin')),
  ])
  return {
    teachers: teachers.map((t) => ({ ...t, ...t.users })).sort(byName),
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
      <h1>Staff</h1>
      <p className="muted">Teachers and admins. New staff get an email invite to set their password.</p>

      <form className="panel form-grid" onSubmit={handleSubmit}>
        <h2>Add staff member</h2>
        {error && <p className="alert alert-error" role="alert">{error}</p>}
        {success && <p className="alert alert-success" role="status">{success}</p>}
        <label>
          Account type
          <select value={form.account} onChange={(e) => update('account', e.target.value)}>
            <option value="teacher">Teacher</option>
            {isSuperAdmin && <option value="limited_admin">Admin (limited)</option>}
            {isSuperAdmin && <option value="super_admin">Admin (super)</option>}
          </select>
        </label>
        <label>
          Full name
          <input value={form.full_name} onChange={(e) => update('full_name', e.target.value)} placeholder="Musa Bello" required />
        </label>
        <label>
          Email
          <input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} required />
        </label>
        {isTeacher && (
          <>
            <label>
              Staff ID
              <input value={form.staff_id} onChange={(e) => update('staff_id', e.target.value)} placeholder="STF/001" required />
            </label>
            <label>
              Department (optional)
              <input value={form.department} onChange={(e) => update('department', e.target.value)} placeholder="Sciences" />
            </label>
          </>
        )}
        <div className="form-actions">
          <button type="submit" disabled={saving}>
            {saving ? 'Sending invite…' : 'Add and send invite'}
          </button>
        </div>
        {!isSuperAdmin && <p className="muted small form-note">Only super admins can add admin accounts.</p>}
      </form>

      {loading ? (
        <p className="muted">Loading staff…</p>
      ) : loadError ? (
        <p className="alert alert-error" role="alert">{friendlyDbError(loadError)}</p>
      ) : (
        <>
          <h2>Teachers</h2>
          {data.teachers.length === 0 ? (
            <p className="empty-state">No teachers yet — add one above.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Photo</th>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Staff ID</th>
                    <th>Department</th>
                  </tr>
                </thead>
                <tbody>
                  {data.teachers.map((t) => (
                    <tr key={t.id}>
                      <td>
                        {/* No staff edit screen yet: the photo is set right here. */}
                        <PhotoUpload userId={t.user_id} name={fullName(t)} path={t.photo_url} label="Change" onChanged={reload} />
                      </td>
                      <td>
                        {fullName(t)}
                        {!t.is_active && <span className="muted small"> (deactivated)</span>}
                      </td>
                      <td>{t.email}</td>
                      <td>{t.staff_id}</td>
                      <td>{t.department ?? <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h2>Admins</h2>
          {/* What's listed is decided by the database (RLS, migration 021):
              super admins see every admin; limited admins only themselves. */}
          <p className="muted small">
            {isSuperAdmin
              ? 'As a super admin you see every admin account.'
              : 'As a limited admin you can only see your own admin account here. Other admins are managed by super admins.'}
          </p>
          {data.admins.length === 0 ? (
            <p className="empty-state">No admin accounts to show.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Level</th>
                  </tr>
                </thead>
                <tbody>
                  {data.admins.map((a) => (
                    <tr key={a.id}>
                      <td>
                        {fullName(a)}
                        {a.id === profile.id && <span className="muted small"> (you)</span>}
                        {!a.is_active && <span className="muted small"> (deactivated)</span>}
                      </td>
                      <td>{a.email ?? <span className="muted">—</span>}</td>
                      <td>{a.admin_level === 'super_admin' ? 'Super admin' : 'Limited admin'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  )
}
