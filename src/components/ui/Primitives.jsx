import { Link } from 'react-router-dom'
import { toneFor } from '../../lib/statusTones'
import Icon from './Icon'
import '../../styles/app.css'

// Core dashboard building blocks (design system: styles/app.css).

// variant: primary | secondary | danger | ghost; size: md (44px tap) | sm (desktop toolbars)
export function Button({ variant = 'primary', size = 'md', block = false, className = '', type = 'button', ...props }) {
  return (
    <button
      type={type}
      className={`ds-btn ds-btn-${variant}${size === 'sm' ? ' ds-btn-sm' : ''}${block ? ' ds-btn-block' : ''} ${className}`.trim()}
      {...props}
    />
  )
}

export function ButtonLink({ variant = 'secondary', size = 'md', className = '', ...props }) {
  return <Link className={`ds-btn ds-btn-${variant}${size === 'sm' ? ' ds-btn-sm' : ''} ${className}`.trim()} {...props} />
}

// Page title + optional subtitle and actions (right on wide screens, below on phones).
export function PageHeader({ title, subtitle, children }) {
  return (
    <header className="ds-page-header">
      <div>
        <h1 className="ds-h1">{title}</h1>
        {subtitle && <p className="ds-subtitle">{subtitle}</p>}
      </div>
      {children}
    </header>
  )
}

// title, optional action (e.g. a "See all" link), flush = no body padding (tables, lists)
export function Card({ title, action, flush = false, children, className = '', headingLevel = 2 }) {
  const Heading = `h${headingLevel}`
  return (
    <section className={`ds-card ${className}`.trim()}>
      {(title || action) && (
        <header className="ds-card-header">
          {title && <Heading className="ds-h2">{title}</Heading>}
          {action}
        </header>
      )}
      <div className={flush ? 'ds-card-body-flush' : 'ds-card-body'}>{children}</div>
    </section>
  )
}

// tone: undefined | 'warning' | 'danger' (a coloured edge). exact: the full value
// when `value` is shortened (e.g. ₦6.2M), shown on hover and read by screen readers.
export function StatCard({ label, value, hint, tone, exact }) {
  return (
    <div className={`ds-stat${tone ? ` ds-stat-${tone}` : ''}`}>
      <span className="ds-stat-label">{label}</span>
      <span className="ds-stat-value" title={exact}>
        {exact ? (
          <>
            <span aria-hidden="true">{value}</span>
            <span className="ds-visually-hidden">{exact}</span>
          </>
        ) : (
          value
        )}
      </span>
      {hint && <span className="ds-stat-hint">{hint}</span>}
    </div>
  )
}

// <Badge status="overdue" /> picks the colour from the shared status map;
// <Badge tone="info">Custom</Badge> sets it directly.
export function Badge({ status, tone, dot = false, children }) {
  const t = tone ?? toneFor(status)
  return <span className={`ds-badge ds-badge-${t}${dot ? ' ds-badge-dot' : ''}`}>{children ?? status}</span>
}

// ---------- States ----------
export function LoadingState({ lines = 3, label = 'Loading…' }) {
  return (
    <div className="ds-skeleton" role="status" aria-live="polite">
      <span className="ds-visually-hidden">{label}</span>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  )
}

export function EmptyState({ icon = 'inbox', title, children }) {
  return (
    <div className="ds-empty">
      <Icon name={icon} size={28} />
      {title && <strong>{title}</strong>}
      {children && <span>{children}</span>}
    </div>
  )
}

// tone: danger (errors) | warning | info | success
export function Alert({ tone = 'info', children }) {
  const icon = { danger: 'alert', warning: 'alert', success: 'check', info: 'info' }[tone]
  return (
    <div className={`ds-alert ds-alert-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon name={icon} size={18} />
      <div>{children}</div>
    </div>
  )
}

export function ErrorState({ children = 'This could not be loaded. Check your connection and try again.', onRetry }) {
  return (
    <div className="ds-card-body">
      <Alert tone="danger">
        {children}
        {onRetry && (
          <>
            {' '}
            <button type="button" className="ds-btn ds-btn-ghost ds-btn-sm" onClick={onRetry}>
              Try again
            </button>
          </>
        )}
      </Alert>
    </div>
  )
}

// Loading / error / data for one useAsyncData query.
export function QueryState({ query, lines, children }) {
  if (query.loading) return <LoadingState lines={lines} />
  if (query.error) return <ErrorState onRetry={query.reload} />
  return children(query.data)
}
