import { useCallback, useEffect, useState } from 'react'
import { fetchPublishedPhotos } from '../../lib/publicSite'
import { galleryUrl } from '../../lib/publicContent'
import { useAsyncData } from '../../hooks/useAsyncData'
import { LoadError, Loading, PageHero } from '../../components/public/PublicBits'

// Public photo gallery: published photos in the order admins set, filterable
// by category; click a photo to see it large (← → to browse, Esc to close).
export default function Gallery() {
  const query = useAsyncData(() => fetchPublishedPhotos(), 'public-gallery')
  const [category, setCategory] = useState('All')
  const [openIndex, setOpenIndex] = useState(null)

  const photos = query.data ?? []
  const categories = ['All', ...new Set(photos.map((p) => p.category))]
  const shown = category === 'All' ? photos : photos.filter((p) => p.category === category)

  return (
    <>
      <PageHero eyebrow="Life at school" title="Gallery">
        A glimpse of our classrooms, events, sports and facilities.
      </PageHero>
      <section className="pub-section">
        <div className="pub-wrap">
          {query.loading ? (
            <Loading />
          ) : query.error ? (
            <LoadError />
          ) : photos.length === 0 ? (
            <p className="pub-empty">Photos coming soon.</p>
          ) : (
            <>
              {categories.length > 2 && (
                <div className="pub-filter" role="group" aria-label="Filter by category">
                  {categories.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={c === category ? 'is-active' : ''}
                      aria-pressed={c === category}
                      onClick={() => {
                        setCategory(c)
                        setOpenIndex(null)
                      }}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}
              <ul className="pub-gallery">
                {shown.map((p, i) => (
                  <li key={p.id}>
                    <button type="button" className="pub-gallery-item" onClick={() => setOpenIndex(i)}>
                      <img src={galleryUrl(p.image_url)} alt={p.caption ?? `${p.category} photo`} loading="lazy" />
                      {p.caption && <span className="pub-gallery-caption">{p.caption}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>
      {openIndex !== null && shown[openIndex] && (
        <Lightbox photos={shown} index={openIndex} onChange={setOpenIndex} onClose={() => setOpenIndex(null)} />
      )}
    </>
  )
}

function Lightbox({ photos, index, onChange, onClose }) {
  const photo = photos[index]
  const step = useCallback((d) => onChange((index + d + photos.length) % photos.length), [index, photos.length, onChange])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') step(1)
      if (e.key === 'ArrowLeft') step(-1)
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose, step])

  return (
    <div className="pub-lightbox" role="dialog" aria-modal="true" aria-label={photo.caption ?? 'Photo'} onClick={onClose}>
      <figure onClick={(e) => e.stopPropagation()}>
        <img src={galleryUrl(photo.image_url)} alt={photo.caption ?? ''} />
        <figcaption>
          {photo.caption && <span>{photo.caption}</span>}
          <span className="pub-lightbox-meta">
            {photo.category} · {index + 1} / {photos.length}
          </span>
        </figcaption>
      </figure>
      {photos.length > 1 && (
        <>
          <button type="button" className="pub-lightbox-nav pub-lightbox-prev" onClick={(e) => { e.stopPropagation(); step(-1) }} aria-label="Previous photo">
            ‹
          </button>
          <button type="button" className="pub-lightbox-nav pub-lightbox-next" onClick={(e) => { e.stopPropagation(); step(1) }} aria-label="Next photo">
            ›
          </button>
        </>
      )}
      <button type="button" className="pub-lightbox-close" onClick={onClose} aria-label="Close" autoFocus>
        ×
      </button>
    </div>
  )
}
