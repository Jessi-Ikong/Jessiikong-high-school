import { Link } from 'react-router-dom'
import { academics } from '../../content/siteContent'
import { fetchCatalog } from '../../lib/publicSite'
import { useAsyncData } from '../../hooks/useAsyncData'
import { LoadError, Loading, PageHero, SectionHeading } from '../../components/public/PublicBits'

// Public "Academics" page. The classes and subjects come straight from the
// school's records (Admin > Classes & Sections, Admin > Subjects), so the
// page stays accurate as offerings change. Other words:
// src/content/siteContent.js ("academics").

// JSS1-3 = junior secondary, SS1-3 = senior secondary; anything else "Other".
function stageOf(name) {
  if (/^j\.?s\.?s/i.test(name)) return 'Junior Secondary'
  if (/^s\.?s/i.test(name)) return 'Senior Secondary'
  return 'Other classes'
}

export default function Academics() {
  const catalog = useAsyncData(fetchCatalog, 'public-catalog')

  const stages = {}
  for (const c of catalog.data?.classes ?? []) (stages[stageOf(c.name)] ??= []).push(c)

  return (
    <>
      <PageHero eyebrow="Learning at Jessiikong" title="Academics">
        {academics.intro}
      </PageHero>

      <section className="pub-section">
        <div className="pub-wrap">
          <div className="pub-approach">
            {academics.approach.map((a) => (
              <article key={a.title}>
                <h3>{a.title}</h3>
                <p>{a.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="pub-section pub-section-sand">
        <div className="pub-wrap">
          <SectionHeading eyebrow="Our classes" title={academics.classesNote} />
          {catalog.loading ? (
            <Loading />
          ) : catalog.error ? (
            <LoadError />
          ) : catalog.data.classes.length === 0 ? (
            <p className="pub-muted">Class information will be published soon.</p>
          ) : (
            <div className="pub-stages">
              {Object.entries(stages).map(([stage, list]) => (
                <article key={stage} className="pub-stage">
                  <h3>{stage}</h3>
                  <ul className="pub-chip-list">
                    {list.map((c) => (
                      <li key={c.id}>{c.name}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="pub-section">
        <div className="pub-wrap">
          <SectionHeading eyebrow="Our subjects" title={academics.subjectsNote} />
          {catalog.loading ? (
            <Loading />
          ) : catalog.error ? (
            <LoadError />
          ) : catalog.data.subjects.length === 0 ? (
            <p className="pub-muted">Subject information will be published soon.</p>
          ) : (
            <ul className="pub-subjects">
              {catalog.data.subjects.map((s) => (
                <li key={s.id}>
                  <span className="pub-subject-name">{s.name}</span>
                  {s.code && <span className="pub-subject-code">{s.code}</span>}
                  {s.description && <span className="pub-subject-desc">{s.description}</span>}
                </li>
              ))}
            </ul>
          )}
          <p className="pub-after-list">
            Want to know more about a particular subject or class? <Link to="/contact">Get in touch</Link> or{' '}
            <Link to="/admissions">start an admissions inquiry</Link>.
          </p>
        </div>
      </section>
    </>
  )
}
