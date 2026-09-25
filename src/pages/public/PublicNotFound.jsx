import { Link } from 'react-router-dom'
import { PageHero } from '../../components/public/PublicBits'

export default function PublicNotFound() {
  return (
    <>
      <PageHero eyebrow="Error 404" title="We couldn't find that page">
        The link may be old or mistyped.
      </PageHero>
      <section className="pub-section">
        <div className="pub-wrap pub-notfound">
          <Link to="/" className="pub-btn pub-btn-green">
            Go to the home page
          </Link>
          <Link to="/contact" className="pub-text-link">
            Contact us <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>
    </>
  )
}
