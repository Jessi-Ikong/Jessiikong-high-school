import { Link } from 'react-router-dom'
import { galleryUrl } from '../../lib/publicContent'
import { HONEYPOT_FIELD, excerpt, formatLongDate } from '../../lib/publicSiteText'

// Small building blocks shared by the public pages.

// The banner at the top of each inner page.
export function PageHero({ eyebrow, title, children }) {
  return (
    <section className="pub-page-hero">
      <div className="pub-wrap">
        {eyebrow && <p className="pub-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {children && <p className="pub-page-hero-text">{children}</p>}
      </div>
    </section>
  )
}

export function SectionHeading({ eyebrow, title, children, align = 'left' }) {
  return (
    <div className={`pub-section-heading pub-align-${align}`}>
      {eyebrow && <p className="pub-eyebrow">{eyebrow}</p>}
      <h2>{title}</h2>
      {children && <p className="pub-lead">{children}</p>}
    </div>
  )
}

export function NewsCard({ post, headingLevel = 3 }) {
  const Heading = `h${headingLevel}`
  return (
    <article className="pub-news-card">
      <Link to={`/news/${post.id}`} className="pub-news-card-media" tabIndex={-1} aria-hidden="true">
        {post.cover_image_url ? (
          <img src={galleryUrl(post.cover_image_url)} alt="" loading="lazy" />
        ) : (
          <span className="pub-news-card-placeholder" />
        )}
      </Link>
      <div className="pub-news-card-body">
        <time dateTime={post.published_at}>{formatLongDate(post.published_at)}</time>
        <Heading>
          <Link to={`/news/${post.id}`}>{post.title}</Link>
        </Heading>
        <p>{excerpt(post.body, 160)}</p>
        <Link to={`/news/${post.id}`} className="pub-text-link">
          Read more <span aria-hidden="true">→</span>
        </Link>
      </div>
    </article>
  )
}

// Invisible to people (and to screen readers); bots filling every field fill it in.
export function Honeypot({ value, onChange }) {
  return (
    <div className="pub-hp" aria-hidden="true">
      <label>
        Leave this empty
        <input type="text" name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  )
}

export function Loading({ children = 'Loading…' }) {
  return <p className="pub-muted pub-loading">{children}</p>
}

export function LoadError() {
  return (
    <p className="pub-notice pub-notice-error" role="alert">
      Sorry, this couldn&apos;t be loaded right now. Please refresh the page or try again later.
    </p>
  )
}
