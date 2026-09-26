import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run, runWrite } from '../../lib/db'
import { AUDIENCES, audienceLabel, fetchAnnouncements } from '../../lib/announcements'
import { formatDateTime } from '../../lib/assignments'
import { useAsyncData } from '../../hooks/useAsyncData'
import DeleteAction from '../../components/DeleteAction'
import { Alert, Badge, Button, Card, EmptyState, LoadingState, PageHeader } from '../../components/ui/Primitives'
import { Field, Select, TextArea, TextInput } from '../../components/ui/Form'
import DataTable from '../../components/ui/DataTable'

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

  if (query.loading) return <LoadingState lines={6} />
  if (query.error) return <Alert tone="danger">{friendlyDbError(query.error)}</Alert>
  const { announcements, classes } = query.data

  return (
    <>
      <PageHeader
        title="Announcements"
        subtitle="Post notices to everyone, to one group, or to a single class. A class announcement reaches the class's students (active this session, any section), their parents, and the teachers who teach that class this session."
      />

      <Card title={editing ? `Edit "${editing.title}"` : 'New announcement'}>
        <form onSubmit={handleSubmit}>
          {formError && <Alert tone="danger">{formError}</Alert>}
          {notice && <Alert tone="success">{notice}</Alert>}
          <div className="ds-form-grid">
            <Field label="Title" className="ds-span-2">
              {(p) => <TextInput {...p} value={form.title} onChange={(e) => update('title', e.target.value)} maxLength={200} required />}
            </Field>
            <Field label="Audience">
              {(p) => (
                <Select {...p} value={form.audience} onChange={(e) => update('audience', e.target.value)}>
                  {AUDIENCES.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {form.audience === 'specific_class' && (
              <Field label="Class">
                {(p) => (
                  <Select {...p} value={form.class_id} onChange={(e) => update('class_id', e.target.value)} required>
                    <option value="">Choose a class…</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <Field label="Message" className="ds-span-2" hint={`Plain text. ${form.body.length}/${MAX_BODY}`}>
              {(p) => <TextArea {...p} rows={6} value={form.body} onChange={(e) => update('body', e.target.value)} maxLength={MAX_BODY} required />}
            </Field>
          </div>
          <div className="ds-form-actions">
            {editing && (
              <Button variant="secondary" onClick={resetForm}>
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Post announcement'}
            </Button>
          </div>
        </form>
      </Card>

      <Card title="All announcements" flush>
        <DataTable
          caption="All announcements"
          rowKey={(a) => a.id}
          rows={announcements}
          empty={<EmptyState icon="megaphone">Nothing posted yet.</EmptyState>}
          columns={[
            {
              key: 'title',
              header: 'Title',
              primary: true,
              render: (a) => (
                <span>
                  <span className="ds-inline">
                    {a.title}
                    {editing?.id === a.id && <Badge status="editing">Editing</Badge>}
                  </span>
                  <span className="ds-muted ds-small ds-clamp-2" style={{ fontWeight: 400 }}>
                    {a.body}
                  </span>
                </span>
              ),
            },
            { key: 'audience', header: 'Audience', render: (a) => audienceLabel(a) },
            { key: 'author', header: 'Posted by', render: (a) => a.author_name ?? '—' },
            {
              key: 'posted',
              header: 'Posted',
              render: (a) => (
                <span className="ds-small">
                  {formatDateTime(a.published_at)}
                  {a.updated_at && a.created_at && new Date(a.updated_at) - new Date(a.created_at) > 60_000 && (
                    <span className="ds-muted" style={{ display: 'block' }}>
                      edited {formatDateTime(a.updated_at)}
                    </span>
                  )}
                </span>
              ),
            },
            {
              key: 'actions',
              header: 'Actions',
              render: (a) => (
                <div className="ds-row-actions">
                  <button type="button" className="ds-btn ds-btn-link" onClick={() => startEdit(a)}>
                    Edit
                  </button>
                  <DeleteAction
                    itemName={`"${a.title}"`}
                    buttonClassName="ds-btn ds-btn-link ds-btn-link-danger"
                    dependencyChecks={[]}
                    onDelete={() => runWrite(supabase.from('announcements').delete().eq('id', a.id).select('id'))}
                    onDeleted={() => {
                      if (editing?.id === a.id) resetForm()
                      setNotice(`"${a.title}" was deleted.`)
                      query.reload()
                    }}
                  />
                </div>
              ),
            },
          ]}
        />
      </Card>
    </>
  )
}
