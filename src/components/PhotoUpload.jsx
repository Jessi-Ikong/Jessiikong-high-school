import { useRef, useState } from 'react'
import { friendlyDbError } from '../lib/db'
import { PHOTO_ACCEPT, photoUrl, setPhoto } from '../lib/avatars'

// Round photo, or initials when there's none.
export function Avatar({ path, name, size = 40 }) {
  const initials = (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('')
  const style = { width: size, height: size, fontSize: size * 0.38 }
  return path ? (
    <img className="avatar" src={photoUrl(path)} alt={name ? `Photo of ${name}` : 'Photo'} style={style} />
  ) : (
    <span className="avatar avatar-initials" style={style} aria-hidden="true">
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
    <span className="photo-upload">
      <Avatar path={path} name={name} size={size} />
      <span className="photo-upload-actions">
        <button type="button" className="button-link" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? 'Uploading…' : path ? label : 'Add photo'}
        </button>
        <input ref={inputRef} type="file" accept={PHOTO_ACCEPT} onChange={handleFile} hidden />
        {error && (
          <span className="small late-text" role="alert">
            {error}
          </span>
        )}
      </span>
    </span>
  )
}
