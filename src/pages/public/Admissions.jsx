import { useState } from 'react'
import { admissions, contact } from '../../content/siteContent'
import { fetchCatalog, publicFormError, submitAdmissionsInquiry } from '../../lib/publicSite'
import { looksLikeBot } from '../../lib/publicSiteText'
import { useAsyncData } from '../../hooks/useAsyncData'
import { Honeypot, PageHero, SectionHeading } from '../../components/public/PublicBits'

// Public "Admissions" page: information (src/content/siteContent.js,
// "admissions") and the inquiry form. Inquiries go to Admin > Admissions
// Inquiries; visitors can send one but never read any back.

const EMPTY = { parent_name: '', email: '', phone: '', child_name: '', desired_class: '', message: '' }
const NOT_SURE = 'Not sure yet'

export default function Admissions() {
  return (
    <>
      <PageHero eyebrow="Join our community" title="Admissions">
        {admissions.intro}
      </PageHero>

      <section className="pub-section">
        <div className="pub-wrap">
          <SectionHeading eyebrow="How it works" title="Four simple steps" />
          <ol className="pub-steps">
            {admissions.steps.map((s, i) => (
              <li key={s.title}>
                <span className="pub-step-number">{i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="pub-section pub-section-sand" id="inquiry">
        <div className="pub-wrap pub-admissions-grid">
          <aside className="pub-admissions-info">
            <h2>What you&apos;ll need</h2>
            <ul className="pub-checklist">
              {admissions.requirements.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <h2>Fees</h2>
            <p>{admissions.feesNote}</p>
            <h2>Prefer to talk?</h2>
            <p>
              Call <a href={`tel:${contact.phone.replace(/[^+\d]/g, '')}`}>{contact.phone}</a> or email{' '}
              <a href={`mailto:${contact.admissionsEmail}`}>{contact.admissionsEmail}</a>.
            </p>
          </aside>
          <InquiryForm />
        </div>
      </section>
    </>
  )
}

function InquiryForm() {
  const catalog = useAsyncData(fetchCatalog, 'public-catalog')
  const [fields, setFields] = useState(EMPTY)
  const [honeypot, setHoneypot] = useState('')
  const [startedAt] = useState(() => Date.now())
  const [status, setStatus] = useState('idle') // idle | sending | sent
  const [error, setError] = useState(null)

  const update = (name) => (e) => setFields((f) => ({ ...f, [name]: e.target.value }))
  const classes = catalog.data?.classes ?? []

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    // Suspected bot: pretend it worked, send nothing.
    if (looksLikeBot({ honeypot, startedAt })) {
      setStatus('sent')
      return
    }
    setStatus('sending')
    try {
      await submitAdmissionsInquiry(fields)
      setStatus('sent')
      setFields(EMPTY)
    } catch (err) {
      setError(publicFormError(err))
      setStatus('idle')
    }
  }

  if (status === 'sent') {
    return (
      <div className="pub-form-card pub-form-done" role="status">
        <h2>Inquiry received</h2>
        <p>{admissions.thankYou}</p>
      </div>
    )
  }

  return (
    <form className="pub-form-card" onSubmit={handleSubmit} noValidate={false}>
      <h2>{admissions.formTitle}</h2>
      <p className="pub-muted">{admissions.formIntro}</p>
      <div className="pub-form-grid">
        <label>
          Parent / guardian name <span className="pub-req">*</span>
          <input value={fields.parent_name} onChange={update('parent_name')} required maxLength={120} autoComplete="name" />
        </label>
        <label>
          Email <span className="pub-req">*</span>
          <input type="email" value={fields.email} onChange={update('email')} required maxLength={254} autoComplete="email" />
        </label>
        <label>
          Phone
          <input type="tel" value={fields.phone} onChange={update('phone')} maxLength={30} autoComplete="tel" />
        </label>
        <label>
          Child&apos;s name <span className="pub-req">*</span>
          <input value={fields.child_name} onChange={update('child_name')} required maxLength={120} />
        </label>
        <label className="pub-span-2">
          Class you are applying for <span className="pub-req">*</span>
          {catalog.error ? (
            // Class list unavailable: type it instead.
            <input value={fields.desired_class} onChange={update('desired_class')} required maxLength={60} placeholder="e.g. JSS1" />
          ) : (
            <select value={fields.desired_class} onChange={update('desired_class')} required disabled={catalog.loading}>
              <option value="">{catalog.loading ? 'Loading classes…' : 'Choose a class'}</option>
              {classes.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
              <option value={NOT_SURE}>{NOT_SURE}</option>
            </select>
          )}
        </label>
        <label className="pub-span-2">
          Anything you&apos;d like us to know?
          <textarea rows={5} value={fields.message} onChange={update('message')} maxLength={2000} />
        </label>
      </div>
      <Honeypot value={honeypot} onChange={setHoneypot} />
      {error && (
        <p className="pub-notice pub-notice-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="pub-btn pub-btn-green" disabled={status === 'sending'}>
        {status === 'sending' ? 'Sending…' : 'Send inquiry'}
      </button>
      <p className="pub-fineprint">
        We only use these details to respond to your inquiry. <span className="pub-req">*</span> required
      </p>
    </form>
  )
}
