import { Link } from 'react-router-dom'
import Crest from './public/Crest'
import '../styles/app.css'

// The frame of the sign-in pages (Login, Forgot password, Set password), from
// the design system: the school's crest and name on the brand green, then a
// card with the form. Full width on phones, a centred card on larger screens.
// `as`: 'form' makes the card itself the <form> (onSubmit passed through).
export default function AuthLayout({ title, subtitle, children, as = 'div', onSubmit, footer }) {
  const Body = as
  return (
    <div className="ds ds-auth">
      <main className="ds-auth-main">
        <Link to="/" className="ds-auth-brand" aria-label="Jessiikong High School website">
          <Crest size={40} />
          <span>
            <strong>Jessiikong High School</strong>
            <span>School portal</span>
          </span>
        </Link>
        <Body className="ds-card ds-auth-card" {...(as === 'form' ? { onSubmit } : {})}>
          <div className="ds-card-body">
            <h1 className="ds-h1 ds-auth-title">{title}</h1>
            {subtitle && <p className="ds-subtitle ds-auth-subtitle">{subtitle}</p>}
            {children}
          </div>
        </Body>
        {footer && <div className="ds-auth-footer">{footer}</div>}
      </main>
    </div>
  )
}

// "Checking your link…" style messages while the session is being checked.
export function AuthLoading({ children }) {
  return (
    <div className="ds ds-auth">
      <main className="ds-auth-main">
        <p className="ds-auth-loading" role="status">
          <span className="ds-spinner" aria-hidden="true" /> {children}
        </p>
      </main>
    </div>
  )
}
