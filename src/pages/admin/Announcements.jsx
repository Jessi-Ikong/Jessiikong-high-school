import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run, runWrite } from '../../lib/db'
import { AUDIENCES, audienceLabel, fetchAnnouncements } from '../../lib/announcements'
import { formatDateTime } from '../../lib/assignments'
import { useAsyncData } from '../../hooks/useAsyncData'
import DeleteAction from '../../components/DeleteAction'

const EMPTY_FORM = { title: '', body: '', audience: 'all', class_id: '' }
const MAX_BODY = 5000

async function fetchPage() {
  const [announcements, classes] = await Promise.all([
    fetchAnnouncements(),
    run(supabase.from('classes').select('id, name, level').order('level')),
  ])
  return { announcements, classes }
}

// Both admin tiers: every announcement, whatever its audience, newest first.
export default function Announcements() {
  const query = useAsyncData(fetchPage, 'admin-announcements')
  const [form, setForm] = useState(EMPTY_FORM)
  const [editing, setEditing] = useState(null)
  const [formError, setFormError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [saving, setSaving] = useState(false)

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  function resetForm() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError(null)
  }

  function startEdit(a) {
    setEditing(a)
    setForm({ title: a.title, body: a.body, audience: a.audience, class_id: a.class_id ?? '' })
    setFormError(null)
    setNotice(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setFormError(null)
    setNotice(null)
    const values = {
      title: form.title.trim(),
      body: form.body.trim(),
      audience: form.audience,
      class_id: form.audience === 'specific_class' ? form.class_id || null : null,
    }
    if (!values.title) return setFormError('Give the announcement a title.')
    if (!values.body) return setFormError('Write the announcement text.')
    if (values.audience === 'specific_class' && !values.class_id) return setFormError('Choose the class.')
    setSaving(true)
    try {
      if (editing) {
        await runWrite(supabase.from('announcements').update(values).eq('id', editing.id).select('id'))
        setNotice(`"${values.title}" was updated.`)
      } else {
        // The database records you as the author.
        await run(supabase.from('announcements').insert(values))
        setNotice(`"${values.title}" was posted.`)
      }
      resetForm()
      query.reload()
    } catch (err) {
      setFormError(friendlyDbError(err))
    } finally {
      setSaving(false)
    }
  }

  if (query.loading) return <p className="muted">Loading…</p>
  if (query.error) return <p className="alert alert-error" role="alert">{friendlyDbError(query.error)}</p>
  const { announcements, classes } = query.data

  return (
    <>
      <h1>Announcements</h1>
      <p className="muted">
        Post notices to everyone, to one group, or to a single class. A class announcement reaches the class&apos;s
        students (active this session, any section), their parents, and the teachers who teach that class this session.
      </p>

      <form className="panel form-grid" onSubmit={handleSubmit}>
        <h2>{editing ? `Edit "${editing.title}"` : 'New announcement'}</h2>
        {formError && <p className="alert alert-error" role="alert">{formError}</p>}
        {notice && <p className="alert alert-success" role="status">{notice}</p>}
        <label className="span-all">
          Title
          <input value={form.title} onChange={(e) => update('title', e.target.value)} maxLength={200} required />
        </label>
        <label>
          Audience
          <select value={form.audience} onChange={(e) => update('audience', e.target.value)}>
            {AUDIENCES.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        {form.audience === 'specific_class' && (
          <label>
            Class
            <select value={form.class_id} onChange={(e) => update('class_id', e.target.value)} required>
              <option value="">Choose a class…</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="span-all">
          Message
          <textarea rows={6} value={form.body} onChange={(e) => update('body', e.target.value)} maxLength={MAX_BODY} required />
          <span className="muted small">
            Plain text. {form.body.length}/{MAX_BODY}
          </span>
        </label>
        <div className="form-actions">
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Post announcement'}
          </button>
          {editing && (
            <button type="button" className="button-secondary" onClick={resetForm}>
              Cancel
            </button>
          )}
        </div>
      </form>

      <h2>All announcements</h2>
      {announcements.length === 0 ? (
        <p className="empty-state">Nothing posted yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table announcement-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Audience</th>
                <th>Posted by</th>
                <th>Posted</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {announcements.map((a) => (
                <tr key={a.id} className={editing?.id === a.id ? 'row-editing' : undefined}>
                  <td>
                    <strong>{a.title}</strong>
                    <div className="muted small announcement-preview">{a.body}</div>
                  </td>
                  <td>{audienceLabel(a)}</td>
                  <td>{a.author_name ?? '—'}</td>
                  <td className="small">
                    {formatDateTime(a.published_at)}
                    {a.updated_at && a.created_at && new Date(a.updated_at) - new Date(a.created_at) > 60_000 && (
                      <div className="muted small">edited {formatDateTime(a.updated_at)}</div>
                    )}
                  </td>
                  <td className="row-actions">
                    <button type="button" className="button-link" onClick={() => startEdit(a)}>
                      Edit
                    </button>
                    <DeleteAction
                      itemName={`"${a.title}"`}
                      dependencyChecks={[]}
                      onDelete={() => runWrite(supabase.from('announcements').delete().eq('id', a.id).select('id'))}
                      onDeleted={() => {
                        if (editing?.id === a.id) resetForm()
                        setNotice(`"${a.title}" was deleted.`)
                        query.reload()
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
