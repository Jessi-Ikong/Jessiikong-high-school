import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run } from '../../lib/db'
import { fullName, byName } from '../../lib/people'
import { toIsoDate } from '../../lib/dates'
import { ENTITY_LABELS, changeLines, describeAction, resolveNames, targetLabel } from '../../lib/audit'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useAuth } from '../../hooks/useAuth'

const PAGE_SIZE = 25
const NO_USER = 'none'
const ROLE_GROUPS = [
  ['admin', 'Admins'],
  ['teacher', 'Teachers'],
  ['parent', 'Parents'],
  ['student', 'Students'],
]
const dateTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

function fetchUsers() {
  return run(supabase.from('users').select('id, first_name, middle_name, last_name, role'))
}

// One page of entries (newest first) plus readable names for what they touch.
async function fetchPage({ page, entity, userId, from, to }) {
  let query = supabase
    .from('audit_log')
    .select('id, created_at, action, entity, entity_id, changes, user_id, users(first_name, last_name, role)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
  if (entity) query = query.eq('entity', entity)
  if (userId === NO_USER) query = query.is('user_id', null)
  else if (userId) query = query.eq('user_id', userId)
  // Dates are chosen in local time; convert the day boundaries to timestamps.
  if (from) query = query.gte('created_at', new Date(`${from}T00:00:00`).toISOString())
  if (to) {
    const end = new Date(`${to}T00:00:00`)
    end.setDate(end.getDate() + 1)
    query = query.lt('created_at', end.toISOString())
  }
  const { data, count, error } = await query
  if (error) throw error
  const { names, rowsByEntity } = await resolveNames(data)
  return { entries: data, count: count ?? 0, names, rowsByEntity }
}

// Every admin can open this page. What each one sees is decided by the
// database (RLS, migration 020): super admins see everything; limited admins
// see their own changes plus those by teachers, students, parents and the
// system, but not other admins' changes.
export default function AuditLog() {
  const { profile } = useAuth()
  return <AuditLogViewer profile={profile} />
}

function AuditLogViewer({ profile }) {
  const isSuperAdmin = profile.admin_level === 'super_admin'
  const usersQuery = useAsyncData(fetchUsers, 'audit-users')
  const [filters, setFilters] = useState({ entity: '', userId: '', from: '', to: '' })
  const [page, setPage] = useState(0)
  const pageQuery = useAsyncData(() => fetchPage({ page, ...filters }), `audit:${page}:${JSON.stringify(filters)}`)

  function setFilter(field, value) {
    setFilters((f) => ({ ...f, [field]: value }))
    setPage(0)
  }

  const users = (usersQuery.data ?? []).slice().sort(byName)
  const total = pageQuery.data?.count ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasFilters = Object.values(filters).some(Boolean)

  return (
    <>
      <h1>Audit log</h1>
      <p className="muted">
        Changes made in the system: who did it, when, and what changed. Newest first. Message text and raw
        payment-provider replies are never stored here.
      </p>
      <p className="alert alert-info-plain">
        {isSuperAdmin
          ? "As a super admin you see every change, including other admins' changes."
          : 'As a limited admin you see changes made by teachers, students, parents and the system, plus your own. Changes made by other admins are not shown to you.'}
      </p>

      <div className="filter-bar">
        <label className="inline-field">
          What was changed
          <select value={filters.entity} onChange={(e) => setFilter('entity', e.target.value)}>
            <option value="">Everything</option>
            {Object.entries(ENTITY_LABELS)
              .sort((a, b) => a[1][1].localeCompare(b[1][1]))
              .map(([table, [, plural]]) => (
                <option key={table} value={table}>
                  {plural.charAt(0).toUpperCase() + plural.slice(1)}
                </option>
              ))}
          </select>
        </label>
        <label className="inline-field">
          Done by
          <select value={filters.userId} onChange={(e) => setFilter('userId', e.target.value)} disabled={usersQuery.loading}>
            <option value="">Anyone</option>
            <option value={NO_USER}>No signed-in user (database / server)</option>
            {!isSuperAdmin && <option value={profile.id}>You ({fullName(profile)})</option>}
            {ROLE_GROUPS.filter(([role]) => isSuperAdmin || role !== 'admin').map(([role, label]) => (
              <optgroup key={role} label={label}>
                {users
                  .filter((u) => u.role === role)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {fullName(u)}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="inline-field">
          From
          <input type="date" value={filters.from} max={filters.to || toIsoDate(new Date())} onChange={(e) => setFilter('from', e.target.value)} />
        </label>
        <label className="inline-field">
          To
          <input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter('to', e.target.value)} />
        </label>
        {hasFilters && (
          <button
            type="button"
            className="button-link filter-reset"
            onClick={() => {
              setFilters({ entity: '', userId: '', from: '', to: '' })
              setPage(0)
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {pageQuery.loading ? (
        <p className="muted">Loading the audit log…</p>
      ) : pageQuery.error ? (
        <p className="alert alert-error" role="alert">{friendlyDbError(pageQuery.error)}</p>
      ) : pageQuery.data.entries.length === 0 ? (
        <p className="empty-state">{hasFilters ? 'No changes match these filters.' : 'Nothing has been logged yet.'}</p>
      ) : (
        <>
          <p className="muted small">
            {total} {total === 1 ? 'change' : 'changes'}
            {hasFilters ? ' match these filters' : ''} · page {page + 1} of {pages}
          </p>
          <ol className="audit-list">
            {pageQuery.data.entries.map((entry) => (
              <AuditEntry key={entry.id} entry={entry} names={pageQuery.data.names} rowsByEntity={pageQuery.data.rowsByEntity} />
            ))}
          </ol>
          <div className="pager">
            <button type="button" className="button-secondary" onClick={() => setPage((p) => p - 1)} disabled={page === 0 || pageQuery.refreshing}>
              ← Newer
            </button>
            <span className="muted small">
              Page {page + 1} of {pages}
            </span>
            <button type="button" className="button-secondary" onClick={() => setPage((p) => p + 1)} disabled={page + 1 >= pages || pageQuery.refreshing}>
              Older →
            </button>
          </div>
        </>
      )}
    </>
  )
}

function AuditEntry({ entry, names, rowsByEntity }) {
  const { verb, noun } = describeAction(entry)
  const who = entry.users ? `${entry.users.first_name} ${entry.users.last_name}` : 'No signed-in user (database / server)'
  const lines = changeLines(entry, names)
  const shown = lines.slice(0, 8)

  return (
    <li className={`audit-entry audit-${verb.toLowerCase()}`}>
      <div className="audit-head">
        <span className="audit-verb">{verb}</span>{' '}
        <span>
          {noun}: <strong>{targetLabel(entry, names, rowsByEntity)}</strong>
        </span>
      </div>
      <div className="muted small">
        {dateTime.format(new Date(entry.created_at))} · by {who}
        {entry.users?.role ? ` (${entry.users.role})` : ''}
      </div>
      {shown.length > 0 && (
        <ul className="audit-changes">
          {shown.map((line) => (
            <li key={line}>{line}</li>
          ))}
          {lines.length > shown.length && <li className="muted">…and {lines.length - shown.length} more</li>}
        </ul>
      )}
      <details className="audit-raw">
        <summary className="small">Raw data</summary>
        <pre>{JSON.stringify({ action: entry.action, entity: entry.entity, entity_id: entry.entity_id, changes: entry.changes }, null, 2)}</pre>
      </details>
    </li>
  )
}
