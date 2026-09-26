import { useState } from 'react'
import { friendlyDbError } from '../../lib/db'
import { formatDateTime } from '../../lib/assignments'
import {
  IMAGE_ACCEPT,
  deleteNewsPost,
  fetchAllNews,
  galleryUrl,
  imageProblem,
  newsState,
  removeGalleryImage,
  saveNewsPost,
  uploadGalleryImage,
} from '../../lib/publicContent'
import { snippet } from '../../lib/messages'
import { useAsyncData } from '../../hooks/useAsyncData'
import DeleteAction from '../../components/DeleteAction'
import { Alert, Badge, Button, Card, EmptyState, LoadingState, PageHeader } from '../../components/ui/Primitives'
import { Checkbox, Field, TextArea, TextInput } from '../../components/ui/Form'
import Dialog from '../../components/ui/Dialog'

// News & events for the PUBLIC website (both admin tiers). Published posts
// are visible to anyone, signed in or not, from their publish date; drafts
// only here. Posts are listed newest first by publish date (change the date
// to reorder or to schedule a post).

const STATE_LABELS = { draft: 'Draft', scheduled: 'Scheduled', published: 'Published' }
// ISO timestamp <-> the value of an <input type="datetime-local"> (local time)
function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function PublicNews() {
  const query = useAsyncData(fetchAllNews, 'admin-news')
  const [editing, setEditing] = useState(null) // null | 'new' | post
  const [message, setMessage] = useState(null)

  function done(text) {
    setEditing(null)
    setMessage(text)
    query.reload()
  }

  return (
    <>
      <PageHeader
        title="News & Events"
        subtitle="Posts for the school's public website. Published posts can be read by anyone, without signing in; drafts stay here until you publish them."
      >
        <Button
          onClick={() => {
            setMessage(null)
            setEditing('new')
          }}
        >
          New post
        </Button>
      </PageHeader>
      {message && <Alert tone="success">{message}</Alert>}

      {editing && (
        <NewsForm key={editing === 'new' ? 'new' : editing.id} post={editing === 'new' ? null : editing} onCancel={() => setEditing(null)} onSaved={done} />
      )}

      {query.loading ? (
        <LoadingState lines={5} label="Loading posts…" />
      ) : query.error ? (
        <Alert tone="danger">{friendlyDbError(query.error)}</Alert>
      ) : query.data.length === 0 ? (
        <Card>
          <EmptyState icon="globe">No posts yet.</EmptyState>
        </Card>
      ) : (
        <div className="ds-gallery-grid">
          {query.data.map((post) => (
            <NewsCard key={post.id} post={post} onEdit={() => setEditing(post)} onChanged={done} />
          ))}
        </div>
      )}
    </>
  )
}

function NewsCard({ post, onEdit, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const state = newsState(post)

  async function togglePublished() {
    setBusy(true)
    setError(null)
    try {
      await saveNewsPost(post.id, { is_published: !post.is_published })
      onChanged(post.is_published ? `"${post.title}" is now a draft (hidden from the website).` : `"${post.title}" is published.`)
    } catch (err) {
      setError(friendlyDbError(err))
      setBusy(false)
    }
  }

  return (
    <Card
      title={
        <span className="ds-inline">
          {post.title}
          <Badge status={state}>{STATE_LABELS[state]}</Badge>
        </span>
      }
    >
      {post.cover_image_url && <img className="ds-thumb" src={galleryUrl(post.cover_image_url)} alt="" style={{ marginBottom: 12 }} />}
      <p className="ds-muted ds-small">
        {state === 'draft'
          ? `Draft, created ${formatDateTime(post.created_at)}`
          : `${state === 'scheduled' ? 'Goes live' : 'Published'} ${formatDateTime(post.published_at)}`}
        {post.author && ` · by ${post.author.first_name} ${post.author.last_name}`}
      </p>
      <p className="ds-small" style={{ overflowWrap: 'anywhere' }}>{snippet(post.body, 240)}</p>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="ds-row-actions">
        <button type="button" className="ds-btn ds-btn-link" onClick={onEdit}>
          Edit
        </button>
        <button type="button" className="ds-btn ds-btn-link" onClick={togglePublished} disabled={busy}>
          {post.is_published ? 'Unpublish' : 'Publish'}
        </button>
        <DeleteAction
          itemName={`"${post.title}"`}
          buttonClassName="ds-btn ds-btn-link ds-btn-link-danger"
          dependencyChecks={[]}
          onDelete={async () => {
            await deleteNewsPost(post.id)
            await removeGalleryImage(post.cover_image_url)
          }}
          onDeleted={() => onChanged(`Deleted "${post.title}".`)}
        />
      </div>
    </Card>
  )
}

function NewsForm({ post, onCancel, onSaved }) {
  const [title, setTitle] = useState(post?.title ?? '')
  const [body, setBody] = useState(post?.body ?? '')
  const [publish, setPublish] = useState(post?.is_published ?? false)
  const [publishAt, setPublishAt] = useState(toLocalInput(post?.published_at))
  const [cover, setCover] = useState(null) // new File
  const [removeCover, setRemoveCover] = useState(false)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    if (!title.trim() || !body.trim()) return setError('Enter a title and the text of the post.')
    if (cover && imageProblem(cover)) return setError(imageProblem(cover))
    setSaving(true)
    let uploaded = null
    try {
      if (cover) uploaded = await uploadGalleryImage('news', cover)
      const fields = {
        title: title.trim(),
        body: body.trim(),
        is_published: publish,
        // empty = "now" when publishing (filled in by the database)
        published_at: publishAt ? new Date(publishAt).toISOString() : null,
      }
      if (uploaded) fields.cover_image_url = uploaded
      else if (removeCover) fields.cover_image_url = null
      await saveNewsPost(post?.id, fields)
      // The old cover is no longer used.
      if (post?.cover_image_url && (uploaded || removeCover)) await removeGalleryImage(post.cover_image_url)
      onSaved(post ? `Saved "${fields.title}".` : `Created "${fields.title}"${publish ? ' and published it' : ' as a draft'}.`)
    } catch (err) {
      if (uploaded) await removeGalleryImage(uploaded)
      setError(err.message && !err.code ? err.message : friendlyDbError(err))
      setSaving(false)
    }
  }

  return (
    <Dialog
      title={post ? 'Edit post' : 'New post'}
      onClose={onCancel}
      busy={saving}
      dismissOnBackdrop={false}
      footer={
        <div className="ds-form-actions" style={{ margin: 0, width: '100%' }}>
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="news-form" disabled={saving}>
            {saving ? 'Saving…' : post ? 'Save post' : 'Create post'}
          </Button>
        </div>
      }
    >
      <form id="news-form" onSubmit={handleSubmit}>
        <Field label="Title">
          {(p) => <TextInput {...p} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required data-autofocus />}
        </Field>
        <Field label="Text">
          {(p) => <TextArea {...p} rows={8} value={body} onChange={(e) => setBody(e.target.value)} maxLength={20000} required />}
        </Field>
        <Field label="Cover image" hint="Optional. JPEG/PNG/WebP, max 10 MB.">
          {(p) => <TextInput {...p} type="file" accept={IMAGE_ACCEPT} onChange={(e) => setCover(e.target.files[0] ?? null)} />}
        </Field>
        {post?.cover_image_url && !cover && (
          <Checkbox label="Remove the current cover image" checked={removeCover} onChange={(e) => setRemoveCover(e.target.checked)} />
        )}
        <Checkbox label="Published (visible on the public website)" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
        <Field label="Publish date" hint="Optional: empty = now; a future date schedules the post.">
          {(p) => <TextInput {...p} type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} />}
        </Field>
        <p className="ds-note">Only share content appropriate for the public. Don&apos;t include students&apos; personal details.</p>
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  )
}
