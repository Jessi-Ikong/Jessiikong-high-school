import { useEffect, useRef, useState } from 'react'
import { friendlyDbError } from '../lib/db'
import { PHOTO_ACCEPT, getSignedPhotoUrl, setPhoto } from '../lib/avatars'

// The photo's signed link (private bucket), or null while loading / if it
// can't be signed (e.g. not allowed to see it).
function useSignedPhoto(path) {
  const [signed, setSigned] = useState({ path: null, url: null })
  useEffect(() => {
    if (!path) return undefined
    let alive = true
    getSignedPhotoUrl(path)
      .then((url) => alive && setSigned({ path, url }))
      .catch(() => alive && setSigned({ path, url: null }))
    return () => {
      alive = false
    }
  }, [path])
  return signed.path === path ? signed.url : null
}

// Round photo, or initials when there's none (or while it loads).
export function Avatar({ path, name, size = 40 }) {
  const url = useSignedPhoto(path)
  const initials = (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('')
  const style = { width: size, height: size, fontSize: size * 0.38 }
  return url ? (
    <img className="ds-photo" src={url} alt={name ? `Photo of ${name}` : 'Photo'} style={style} />
  ) : (
    <span className="ds-photo ds-photo-initials" style={style} aria-hidden="true">
      {initials || '?'}
    </span>
  )
}

// Photo + a "Change photo" button (JPG / PNG / WebP, up to 5 MB).
export default function PhotoUpload({ userId, name, path, size = 40, label = 'Change photo', onChanged }) {
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function handleFile(event) {
    const file = event.target.files[0]
    event.target.value = ''
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const newPath = await setPhoto(userId, file, path)
      onChanged?.(newPath)
    } catch (err) {
      setError(err.code ? friendlyDbError(err) : err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="ds-photo-upload">
      <Avatar path={path} name={name} size={size} />
      <span className="ds-photo-upload-actions">
        <button type="button" className="ds-btn ds-btn-link" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? 'Uploading…' : path ? label : 'Add photo'}
        </button>
        <input ref={inputRef} type="file" accept={PHOTO_ACCEPT} onChange={handleFile} hidden />
        {error && (
          <span className="ds-small ds-text-danger" role="alert">
            {error}
          </span>
        )}
      </span>
    </span>
  )
}
