import { useState } from 'react'
import { Link } from 'react-router-dom'
import { contact, contactPage } from '../../content/siteContent'
import { publicFormError, submitContactMessage } from '../../lib/publicSite'
import { looksLikeBot } from '../../lib/publicSiteText'
import { Honeypot, PageHero } from '../../components/public/PublicBits'

// Public "Contact" page: the school's details (src/content/siteContent.js,
// "contact") and a general message form. Messages go to Admin > Contact
// Messages (a separate inbox from admissions inquiries).

const EMPTY = { name: '', email: '', phone: '', subject: '', message: '' }
const telHref = (phone) => `tel:${phone.replace(/[^+\d]/g, '')}`

export default function Contact() {
  return (
    <>
      <PageHero eyebrow="We're here to help" title="Contact us">
        {contactPage.intro}
      </PageHero>
      <section className="pub-section">
        <div className="pub-wrap pub-contact-grid">
          <div className="pub-contact-cards">
            <article className="pub-contact-card">
              <h2>Visit</h2>
              <address>
                {contact.addressLines.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </address>
              <a className="pub-text-link" href={contact.mapLink} target="_blank" rel="noreferrer">
                Get directions <span aria-hidden="true">↗</span>
              </a>
            </article>
            <article className="pub-contact-card">
              <h2>Call or message</h2>
              <p>
                <a href={telHref(contact.phone)}>{contact.phone}</a>
                {contact.whatsapp && (
                  <>
                    <br />
                    WhatsApp: <a href={`https://wa.me/${contact.whatsapp.replace(/\D/g, '')}`}>{contact.whatsapp}</a>
                  </>
                )}
              </p>
            </article>
            <article className="pub-contact-card">
              <h2>Email</h2>
              <p>
                <a href={`mailto:${contact.email}`}>{contact.email}</a>
                <br />
                Admissions: <a href={`mailto:${contact.admissionsEmail}`}>{contact.admissionsEmail}</a>
              </p>
            </article>
            <article className="pub-contact-card">
              <h2>Office hours</h2>
              <p>
                {contact.officeHours.map((line) => (
                  <span key={line} className="pub-block">
                    {line}
                  </span>
                ))}
              </p>
            </article>
          </div>
          <ContactForm />
        </div>
      </section>
    </>
  )
}

function ContactForm() {
  const [fields, setFields] = useState(EMPTY)
  const [honeypot, setHoneypot] = useState('')
  const [startedAt] = useState(() => Date.now())
  const [status, setStatus] = useState('idle') // idle | sending | sent
  const [error, setError] = useState(null)
  const update = (name) => (e) => setFields((f) => ({ ...f, [name]: e.target.value }))

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    if (looksLikeBot({ honeypot, startedAt })) {
      setStatus('sent') // pretend; nothing is sent
      return
    }
    setStatus('sending')
    try {
      await submitContactMessage(fields)
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
        <h2>Message sent</h2>
        <p>{contactPage.thankYou}</p>
      </div>
    )
  }

  return (
    <form className="pub-form-card" onSubmit={handleSubmit}>
      <h2>{contactPage.formTitle}</h2>
      <p className="pub-muted">
        For admissions, please use the <Link to="/admissions#inquiry">admissions inquiry form</Link> so it reaches the right team.
      </p>
      <div className="pub-form-grid">
        <label>
          Your name <span className="pub-req">*</span>
          <input value={fields.name} onChange={update('name')} required maxLength={120} autoComplete="name" />
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
          Subject
          <input value={fields.subject} onChange={update('subject')} maxLength={150} />
        </label>
        <label className="pub-span-2">
          Message <span className="pub-req">*</span>
          <textarea rows={6} value={fields.message} onChange={update('message')} required maxLength={3000} />
        </label>
      </div>
      <Honeypot value={honeypot} onChange={setHoneypot} />
      {error && (
        <p className="pub-notice pub-notice-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="pub-btn pub-btn-green" disabled={status === 'sending'}>
        {status === 'sending' ? 'Sending…' : 'Send message'}
      </button>
      <p className="pub-fineprint">We only use these details to reply to you.</p>
    </form>
  )
}
