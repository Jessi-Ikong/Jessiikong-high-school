import { Link } from 'react-router-dom'
import { home, school } from '../../content/siteContent'
import { fetchLatestNews, fetchPublishedPhotos } from '../../lib/publicSite'
import { galleryUrl } from '../../lib/publicContent'
import { useAsyncData } from '../../hooks/useAsyncData'
import Crest from '../../components/public/Crest'
import { Loading, NewsCard, SectionHeading } from '../../components/public/PublicBits'

// Public home page. Words: src/content/siteContent.js ("home"). News and the
// hero photos come from what admins publish.
export default function Home() {
  const news = useAsyncData(() => fetchLatestNews(3), 'public-latest-news')
  const photos = useAsyncData(() => fetchPublishedPhotos(3), 'public-hero-photos')

  return (
    <>
      <section className="pub-hero">
        <div className="pub-wrap pub-hero-grid">
          <div className="pub-hero-copy">
            <p className="pub-eyebrow pub-eyebrow-light">{home.heroEyebrow}</p>
            <h1>{home.heroTitle}</h1>
            <p className="pub-hero-text">{home.heroText}</p>
            <div className="pub-hero-actions">
              <Link to="/admissions" className="pub-btn pub-btn-gold">
                Apply for admission
              </Link>
              <Link to="/about" className="pub-btn pub-btn-ghost">
                Discover {school.shortName}
              </Link>
            </div>
          </div>
          <HeroArt photos={photos.data ?? []} />
        </div>
      </section>

      <section className="pub-facts" aria-label="Quick facts">
        <div className="pub-wrap pub-facts-grid">
          {home.facts.map((f) => (
            <div key={f.label} className="pub-fact">
              <span className="pub-fact-value">{f.value}</span>
              <span className="pub-fact-label">{f.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="pub-section">
        <div className="pub-wrap">
          <SectionHeading eyebrow="Why families choose us" title="An education for the whole person" />
          <div className="pub-highlights">
            {home.highlights.map((h, i) => (
              <article key={h.title} className="pub-highlight">
                <span className="pub-highlight-number" aria-hidden="true">
                  0{i + 1}
                </span>
                <h3>{h.title}</h3>
                <p>{h.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="pub-section pub-section-sand">
        <div className="pub-wrap">
          <div className="pub-section-top">
            <SectionHeading eyebrow="News & events" title="Latest from the school" />
            <Link to="/news" className="pub-text-link">
              All news <span aria-hidden="true">→</span>
            </Link>
          </div>
          {news.loading ? (
            <Loading />
          ) : news.error || news.data.length === 0 ? (
            <p className="pub-muted">News and upcoming events will appear here soon.</p>
          ) : (
            <div className="pub-news-grid">
              {news.data.map((post) => (
                <NewsCard key={post.id} post={post} />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="pub-cta">
        <div className="pub-wrap pub-cta-inner">
          <div>
            <h2>{home.ctaTitle}</h2>
            <p>{home.ctaText}</p>
          </div>
          <Link to="/admissions#inquiry" className="pub-btn pub-btn-gold">
            Make an inquiry
          </Link>
        </div>
      </section>
    </>
  )
}

// Up to three published gallery photos, or the crest on a patterned panel
// until there are some.
function HeroArt({ photos }) {
  if (photos.length === 0) {
    return (
      <div className="pub-hero-art pub-hero-art-crest" aria-hidden="true">
        <Crest size={170} />
      </div>
    )
  }
  return (
    <div className={`pub-hero-art pub-hero-collage pub-collage-${photos.length}`}>
      {photos.map((p, i) => (
        <figure key={p.id} className={`pub-collage-item pub-collage-item-${i + 1}`}>
          <img src={galleryUrl(p.image_url)} alt={p.caption ?? ''} />
        </figure>
      ))}
    </div>
  )
}
