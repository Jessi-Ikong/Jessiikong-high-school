import { Link } from 'react-router-dom'
import { about, school } from '../../content/siteContent'
import { PageHero, SectionHeading } from '../../components/public/PublicBits'

// Public "About" page. All words: src/content/siteContent.js ("about").
export default function About() {
  return (
    <>
      <PageHero eyebrow={`Since ${school.founded}`} title={`About ${school.name}`}>
        {about.intro}
      </PageHero>

      <section className="pub-section">
        <div className="pub-wrap pub-two-col">
          <article className="pub-statement">
            <p className="pub-eyebrow">Our mission</p>
            <p className="pub-statement-text">{about.mission}</p>
          </article>
          <article className="pub-statement pub-statement-alt">
            <p className="pub-eyebrow">Our vision</p>
            <p className="pub-statement-text">{about.vision}</p>
          </article>
        </div>
      </section>

      <section className="pub-section pub-section-sand">
        <div className="pub-wrap pub-story">
          <SectionHeading eyebrow="Our story" title="Where we come from" />
          <div className="pub-prose">
            {about.history.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </div>
      </section>

      <section className="pub-section">
        <div className="pub-wrap">
          <SectionHeading eyebrow="What we stand for" title="Our values" align="center" />
          <div className="pub-values">
            {about.values.map((v) => (
              <article key={v.title} className="pub-value">
                <h3>{v.title}</h3>
                <p>{v.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="pub-section pub-section-green">
        <div className="pub-wrap pub-quote">
          <blockquote>
            <p>“{about.principal.message}”</p>
            <footer>— {about.principal.name}</footer>
          </blockquote>
          <Link to="/contact" className="pub-btn pub-btn-gold">
            Book a visit
          </Link>
        </div>
      </section>
    </>
  )
}
