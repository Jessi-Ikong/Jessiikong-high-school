import { useState } from 'react'
import { friendlyDbError } from '../../lib/db'
import {
  CONSENT_NOTE,
  GALLERY_CATEGORIES,
  IMAGE_ACCEPT,
  addPhoto,
  deletePhoto,
  fetchAllPhotos,
  galleryUrl,
  imageProblem,
  removeGalleryImage,
  reorderPlan,
  updatePhoto,
  uploadGalleryImage,
} from '../../lib/publicContent'
import { useAsyncData } from '../../hooks/useAsyncData'
import DeleteAction from '../../components/DeleteAction'

// The PUBLIC website's photo gallery (both admin tiers). Published photos are
// shown to anyone, in the order set here; unpublished ones stay hidden
// (their files have random, unlisted addresses).

export default function PublicGallery() {
  const query = useAsyncData(fetchAllPhotos, 'admin-gallery')
  const [message, setMessage] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [category, setCategory] = useState('')

  const photos = query.data ?? []
  const shown = category ? photos.filter((p) => p.category === category) : photos

  async function run(action, text) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await action()
      if (text) setMessage(text)
      query.reload()
    } catch (err) {
      setError(friendlyDbError(err))
    } finally {
      setBusy(false)
    }
  }

  // Reordering works on the whole list (the website shows all categories in one order).
  function move(photo, step) {
    const plan = reorderPlan(photos, photos.indexOf(photo), step)
    run(async () => {
      for (const p of plan) await updatePhoto(p.id, { display_order: p.display_order })
    })
  }

  return (
    <>
      <h1>Gallery</h1>
      <p className="muted">
        Photos for the school&apos;s public website. Published photos can be seen by anyone, without signing in.
      </p>
      <UploadForm
        nextOrder={Math.max(0, ...photos.map((p) => p.display_order)) + 10}
        onUploaded={(text) => {
          setMessage(text)
          query.reload()
        }}
      />
      {message && <p className="alert alert-success" role="status">{message}</p>}
      {error && <p className="alert alert-error" role="alert">{error}</p>}

      <div className="filter-bar">
        <label className="inline-field">
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {GALLERY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <span className="muted small">
          {photos.filter((p) => p.is_published).length} of {photos.length} published
        </span>
      </div>

      {query.loading ? (
        <p className="muted">Loading photos…</p>
      ) : query.error ? (
        <p className="alert alert-error" role="alert">{friendlyDbError(query.error)}</p>
      ) : shown.length === 0 ? (
        <p className="empty-state">{photos.length === 0 ? 'No photos yet.' : 'No photos in this category.'}</p>
      ) : (
        <ul className="gallery-admin">
          {shown.map((p) => {
            const index = photos.indexOf(p)
            return (
              <li key={p.id} className={`panel gallery-item${p.is_published ? '' : ' is-draft'}`}>
                <a href={galleryUrl(p.image_url)} target="_blank" rel="noreferrer">
                  <img src={galleryUrl(p.image_url)} alt={p.caption ?? ''} loading="lazy" />
                </a>
                <PhotoDetails photo={p} disabled={busy} onSave={(fields, text) => run(() => updatePhoto(p.id, fields), text)} />
                <div className="row-actions">
                  {p.is_published ? <span className="badge">Published</span> : <span className="badge badge-muted">Hidden</span>}
                  <button
                    type="button"
                    className="button-link"
                    disabled={busy}
                    onClick={() => run(() => updatePhoto(p.id, { is_published: !p.is_published }), p.is_published ? 'Photo hidden from the website.' : 'Photo published.')}
                  >
                    {p.is_published ? 'Unpublish' : 'Publish'}
                  </button>
                  <button type="button" className="button-link" disabled={busy || index === 0} onClick={() => move(p, -1)} aria-label="Move earlier">
                    ↑
                  </button>
                  <button type="button" className="button-link" disabled={busy || index === photos.length - 1} onClick={() => move(p, 1)} aria-label="Move later">
                    ↓
                  </button>
                  <DeleteAction
                    itemName={p.caption ? `"${p.caption}"` : 'this photo'}
                    dependencyChecks={[]}
                    onDelete={async () => {
                      await deletePhoto(p.id)
                      await removeGalleryImage(p.image_url)
                    }}
                    onDeleted={() => {
                      setMessage('Photo deleted.')
                      query.reload()
                    }}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

function PhotoDetails({ photo, disabled, onSave }) {
  const [caption, setCaption] = useState(photo.caption ?? '')
  const [category, setCategory] = useState(photo.category)
  const changed = caption.trim() !== (photo.caption ?? '') || category !== photo.category
  return (
    <div className="gallery-item-details">
      <input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={300} placeholder="Caption" aria-label="Caption" />
      <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
        {GALLERY_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      {changed && (
        <button type="button" className="button-secondary" disabled={disabled} onClick={() => onSave({ caption: caption.trim() || null, category }, 'Photo details saved.')}>
          Save
        </button>
      )}
    </div>
  )
}

function UploadForm({ nextOrder, onUploaded }) {
  const [file, setFile] = useState(null)
  const [caption, setCaption] = useState('')
  const [category, setCategory] = useState('Events')
  const [publish, setPublish] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [inputKey, setInputKey] = useState(0)

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    const problem = imageProblem(file)
    if (problem) return setError(problem)
    if (!confirmed) return setError('Please confirm the photo is appropriate for public display.')
    setSaving(true)
    let path = null
    try {
      path = await uploadGalleryImage('photos', file)
      await addPhoto({ image_url: path, caption: caption.trim() || null, category, is_published: publish, display_order: nextOrder })
      setFile(null)
      setCaption('')
      setPublish(false)
      setConfirmed(false)
      setInputKey((k) => k + 1)
      onUploaded(publish ? 'Photo uploaded and published.' : 'Photo uploaded (hidden until you publish it).')
    } catch (err) {
      if (path) await removeGalleryImage(path)
      setError(err.message && !err.code ? err.message : friendlyDbError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="panel form-grid" onSubmit={handleSubmit}>
      <h2>Upload a photo</h2>
      <p className="alert alert-info-plain form-note" role="note">
        ⚠️ {CONSENT_NOTE}
      </p>
      <label>
        Photo <span className="muted small">(JPEG/PNG/WebP, max 10 MB)</span>
        <input key={inputKey} type="file" accept={IMAGE_ACCEPT} onChange={(e) => setFile(e.target.files[0] ?? null)} required />
      </label>
      <label>
        Caption <span className="muted small">(optional)</span>
        <input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={300} placeholder="Inter-house sports, 2026" />
      </label>
      <label>
        Category
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {GALLERY_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label className="checkbox-field">
        <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
        Publish now
      </label>
      <label className="checkbox-field form-note">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        This photo is appropriate for public display, as described above.
      </label>
      {error && <p className="alert alert-error form-note" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="submit" disabled={saving}>
          {saving ? 'Uploading…' : 'Upload photo'}
        </button>
      </div>
    </form>
  )
}
