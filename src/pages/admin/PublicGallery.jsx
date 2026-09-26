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
import { Alert, Badge, Button, Card, EmptyState, LoadingState, PageHeader } from '../../components/ui/Primitives'
import { Checkbox, Field, Select, TextInput } from '../../components/ui/Form'

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
      <PageHeader title="Gallery" subtitle="Photos for the school's public website. Published photos can be seen by anyone, without signing in." />
      <UploadForm
        nextOrder={Math.max(0, ...photos.map((p) => p.display_order)) + 10}
        onUploaded={(text) => {
          setMessage(text)
          query.reload()
        }}
      />
      {message && <Alert tone="success">{message}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}

      <div className="ds-filters">
        <Field label="Category" hint={`${photos.filter((p) => p.is_published).length} of ${photos.length} published`}>
          {(p) => (
            <Select {...p} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {GALLERY_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {query.loading ? (
        <LoadingState lines={4} label="Loading photos…" />
      ) : query.error ? (
        <Alert tone="danger">{friendlyDbError(query.error)}</Alert>
      ) : shown.length === 0 ? (
        <Card>
          <EmptyState icon="grid">{photos.length === 0 ? 'No photos yet.' : 'No photos in this category.'}</EmptyState>
        </Card>
      ) : (
        <ul className="ds-gallery-grid" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {shown.map((p) => {
            const index = photos.indexOf(p)
            return (
              <li key={p.id}>
                <Card>
                  <a href={galleryUrl(p.image_url)} target="_blank" rel="noreferrer">
                    <img className="ds-thumb" src={galleryUrl(p.image_url)} alt={p.caption ?? ''} loading="lazy" style={p.is_published ? undefined : { opacity: 0.6 }} />
                  </a>
                  <PhotoDetails photo={p} disabled={busy} onSave={(fields, text) => run(() => updatePhoto(p.id, fields), text)} />
                  <div className="ds-row-actions" style={{ alignItems: 'center' }}>
                    <Badge status={p.is_published ? 'published' : 'hidden'}>{p.is_published ? 'Published' : 'Hidden'}</Badge>
                    <button
                      type="button"
                      className="ds-btn ds-btn-link"
                      disabled={busy}
                      onClick={() => run(() => updatePhoto(p.id, { is_published: !p.is_published }), p.is_published ? 'Photo hidden from the website.' : 'Photo published.')}
                    >
                      {p.is_published ? 'Unpublish' : 'Publish'}
                    </button>
                    <button type="button" className="ds-btn ds-btn-link" disabled={busy || index === 0} onClick={() => move(p, -1)} aria-label="Move earlier">
                      ↑
                    </button>
                    <button type="button" className="ds-btn ds-btn-link" disabled={busy || index === photos.length - 1} onClick={() => move(p, 1)} aria-label="Move later">
                      ↓
                    </button>
                    <DeleteAction
                      itemName={p.caption ? `"${p.caption}"` : 'this photo'}
                      buttonClassName="ds-btn ds-btn-link ds-btn-link-danger"
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
                </Card>
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
    <div className="ds-stack" style={{ margin: '12px 0' }}>
      <TextInput value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={300} placeholder="Caption" aria-label="Caption" />
      <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
        {GALLERY_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>
      {changed && (
        <Button variant="secondary" block disabled={disabled} onClick={() => onSave({ caption: caption.trim() || null, category }, 'Photo details saved.')}>
          Save
        </Button>
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
    <Card title="Upload a photo">
      <form onSubmit={handleSubmit}>
        <Alert tone="warning">⚠️ {CONSENT_NOTE}</Alert>
        <div className="ds-form-grid">
          <Field label="Photo" hint="JPEG/PNG/WebP, max 10 MB">
            {(p) => <TextInput {...p} key={inputKey} type="file" accept={IMAGE_ACCEPT} onChange={(e) => setFile(e.target.files[0] ?? null)} required />}
          </Field>
          <Field label="Caption" hint="Optional">
            {(p) => <TextInput {...p} value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={300} placeholder="Inter-house sports, 2026" />}
          </Field>
          <Field label="Category">
            {(p) => (
              <Select {...p} value={category} onChange={(e) => setCategory(e.target.value)}>
                {GALLERY_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="ds-checklist">
          <Checkbox label="Publish now" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
          <Checkbox label="This photo is appropriate for public display, as described above." checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="ds-form-actions">
          <Button type="submit" disabled={saving}>
            {saving ? 'Uploading…' : 'Upload photo'}
          </Button>
        </div>
      </form>
    </Card>
  )
}
