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

// News & events for the PUBLIC website (both admin tiers). Published posts
// are visible to anyone, signed in or not, from their publish date; drafts
// only here. Posts are listed newest first by publish date (change the date
// to reorder or to schedule a post).

const STATE_BADGES = {
  draft: <span className="badge badge-muted">Draft</span>,
  scheduled: <span className="badge badge-info">Scheduled</span>,
  published: <span className="badge">Published</span>,
}

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
      <h1>News &amp; Events</h1>
      <p className="muted">
        Posts for the school&apos;s public website. Published posts can be read by anyone, without signing in; drafts stay
        here until you publish them.
      </p>
      {message && <p className="alert alert-success" role="status">{message}</p>}

      {editing ? (
        <NewsForm key={editing === 'new' ? 'new' : editing.id} post={editing === 'new' ? null : editing} onCancel={() => setEditing(null)} onSaved={done} />
      ) : (
        <button
          type="button"
          onClick={() => {
            setMessage(null)
            setEditing('new')
          }}
        >
          New post
        </button>
      )}

      {query.loading ? (
        <p className="muted">Loading posts…</p>
      ) : query.error ? (
        <p className="alert alert-error" role="alert">{friendlyDbError(query.error)}</p>
      ) : query.data.length === 0 ? (
        <p className="empty-state">No posts yet.</p>
      ) : (
        <div className="card-list">
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
    <article className="panel news-card">
      {post.cover_image_url && <img className="news-cover" src={galleryUrl(post.cover_image_url)} alt="" />}
      <div className="news-card-body">
        <h2>
          {post.title} {STATE_BADGES[state]}
        </h2>
        <p className="muted small">
          {state === 'draft'
            ? `Draft, created ${formatDateTime(post.created_at)}`
            : `${state === 'scheduled' ? 'Goes live' : 'Published'} ${formatDateTime(post.published_at)}`}
          {post.author && ` · by ${post.author.first_name} ${post.author.last_name}`}
        </p>
        <p className="small">{snippet(post.body, 240)}</p>
        {error && <p className="alert alert-error" role="alert">{error}</p>}
        <div className="row-actions">
          <button type="button" className="button-link" onClick={onEdit}>
            Edit
          </button>
          <button type="button" className="button-link" onClick={togglePublished} disabled={busy}>
            {post.is_published ? 'Unpublish' : 'Publish'}
          </button>
          <DeleteAction
            itemName={`"${post.title}"`}
            dependencyChecks={[]}
            onDelete={async () => {
              await deleteNewsPost(post.id)
              await removeGalleryImage(post.cover_image_url)
            }}
            onDeleted={() => onChanged(`Deleted "${post.title}".`)}
          />
        </div>
      </div>
    </article>
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
    <form className="panel form-grid news-form" onSubmit={handleSubmit}>
      <h2>{post ? 'Edit post' : 'New post'}</h2>
      <label className="span-all">
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
      </label>
      <label className="span-all">
        Text
        <textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} maxLength={20000} required />
      </label>
      <label>
        Cover image <span className="muted small">(optional, JPEG/PNG/WebP, max 10 MB)</span>
        <input type="file" accept={IMAGE_ACCEPT} onChange={(e) => setCover(e.target.files[0] ?? null)} />
      </label>
      {post?.cover_image_url && !cover && (
        <label className="checkbox-field">
          <input type="checkbox" checked={removeCover} onChange={(e) => setRemoveCover(e.target.checked)} />
          Remove the current cover image
        </label>
      )}
      <label className="checkbox-field">
        <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
        Published (visible on the public website)
      </label>
      <label>
        Publish date <span className="muted small">(optional: empty = now; a future date schedules the post)</span>
        <input type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} />
      </label>
      <p className="muted small form-note">
        Only share content appropriate for the public. Don&apos;t include students&apos; personal details.
      </p>
      {error && <p className="alert alert-error form-note" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : post ? 'Save post' : 'Create post'}
        </button>
        <button type="button" className="button-secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  )
}
