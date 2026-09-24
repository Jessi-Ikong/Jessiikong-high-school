import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { friendlyDbError } from '../lib/db'
import { formatDateTime } from '../lib/assignments'
import {
  EDIT_WINDOW_MS,
  MAX_MESSAGE_LENGTH,
  editMessage,
  fetchContacts,
  fetchMessages,
  fetchThreads,
  markThreadRead,
  sendMessage,
  startThread,
} from '../lib/messages'
import { useAsyncData } from '../hooks/useAsyncData'
import { useAuth } from '../hooks/useAuth'
import { usePolling } from '../hooks/usePolling'

// Thread list + conversation, shared by the parent and teacher Messages pages.
// viewer: 'parent' | 'teacher' (only changes the wording).
// The open thread is kept in the address (?thread=<id>).
export default function Messaging({ viewer }) {
  const { profile } = useAuth()
  const threadsQuery = useAsyncData(fetchThreads, `message-threads:${profile.id}`)
  const [params, setParams] = useSearchParams()
  const [showNew, setShowNew] = useState(false)
  usePolling(threadsQuery.reload)

  const openId = params.get('thread')
  function openThread(id) {
    setShowNew(false)
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (id) next.set('thread', id)
        else next.delete('thread')
        return next
      },
      { replace: !id },
    )
  }

  if (threadsQuery.loading) return <p className="muted">Loading messages…</p>
  if (threadsQuery.error) return <p className="alert alert-error" role="alert">{friendlyDbError(threadsQuery.error)}</p>

  const threads = threadsQuery.data
  const open = threads.find((t) => t.thread_id === openId) ?? null

  return (
    <div className={`messaging${open ? ' has-open-thread' : ''}`}>
      <aside className="thread-list-panel">
        <div className="thread-list-header">
          <h2>Conversations</h2>
          <button type="button" className="button-secondary" onClick={() => setShowNew((v) => !v)} aria-expanded={showNew}>
            {showNew ? 'Close' : '+ New'}
          </button>
        </div>
        {showNew && (
          <NewConversation
            viewer={viewer}
            onStarted={(id) => {
              threadsQuery.reload()
              openThread(id)
            }}
          />
        )}
        {threads.length === 0 ? (
          <p className="empty-state">
            No conversations yet.{' '}
            {viewer === 'parent' ? 'Use "+ New" to message one of your child’s teachers.' : 'Use "+ New" to message a parent.'}
          </p>
        ) : (
          <ul className="thread-list">
            {threads.map((t) => (
              <li key={t.thread_id}>
                <button
                  type="button"
                  className={`thread-item${t.thread_id === openId ? ' is-open' : ''}${t.unread_count > 0 ? ' is-unread' : ''}`}
                  onClick={() => openThread(t.thread_id)}
                  aria-current={t.thread_id === openId ? 'true' : undefined}
                >
                  <span className="thread-item-top">
                    <strong>{t.other_name}</strong>
                    {t.unread_count > 0 && (
                      <span className="badge badge-late" aria-label={`${t.unread_count} unread`}>
                        {t.unread_count}
                      </span>
                    )}
                  </span>
                  <span className="muted small">{t.links ?? 'No shared class this session (read-only)'}</span>
                  {t.last_message && (
                    <span className="thread-preview small">
                      {t.last_sender_is_me ? 'You: ' : ''}
                      {t.last_message}
                    </span>
                  )}
                  <span className="muted small">{formatDateTime(t.last_message_at ?? t.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="conversation-panel">
        {open ? (
          <Conversation
            key={open.thread_id}
            thread={open}
            viewer={viewer}
            myUserId={profile.id}
            onChanged={threadsQuery.reload}
            onBack={() => openThread(null)}
          />
        ) : (
          <p className="empty-state conversation-placeholder">Choose a conversation{threads.length ? '' : ' or start a new one'}.</p>
        )}
      </section>
    </div>
  )
}

function NewConversation({ viewer, onStarted }) {
  const contactsQuery = useAsyncData(fetchContacts, 'message-contacts')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  async function start(contact) {
    setBusy(contact.teacher_id + contact.parent_id)
    setError(null)
    try {
      const id = await startThread(contact.parent_id, contact.teacher_id)
      onStarted(id)
    } catch (err) {
      setError(friendlyDbError(err))
      setBusy(null)
    }
  }

  if (contactsQuery.loading) return <p className="muted small">Loading…</p>
  if (contactsQuery.error) return <p className="alert alert-error">{friendlyDbError(contactsQuery.error)}</p>
  const contacts = contactsQuery.data

  return (
    <div className="new-conversation">
      <p className="muted small">
        {viewer === 'parent'
          ? 'Teachers who teach your child a subject this session, that you don’t have a conversation with yet:'
          : 'Parents of students you teach this session, that you don’t have a conversation with yet:'}
      </p>
      {error && <p className="alert alert-error small">{error}</p>}
      {contacts.length === 0 ? (
        <p className="muted small">
          No one else. {viewer === 'parent' ? 'You already have a conversation with every teacher you can message.' : 'You already have a conversation with every parent you can message.'}
        </p>
      ) : (
        <ul className="contact-list">
          {contacts.map((c) => (
            <li key={c.teacher_id + c.parent_id}>
              <span>
                <strong>{c.name}</strong>
                <span className="muted small"> · {c.links}</span>
              </span>
              <button type="button" onClick={() => start(c)} disabled={busy !== null}>
                {busy === c.teacher_id + c.parent_id ? 'Starting…' : 'Start'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Conversation({ thread, viewer, myUserId, onChanged, onBack }) {
  const messagesQuery = useAsyncData(() => fetchMessages(thread.thread_id), `messages:${thread.thread_id}`)
  // "Now", refreshed with the polling, decides which messages still show "Edit".
  const [now, setNow] = useState(() => Date.now())
  usePolling(() => {
    setNow(Date.now())
    messagesQuery.reload()
  })
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState(null)
  const [sending, setSending] = useState(false)
  const endRef = useRef(null)
  const messages = messagesQuery.data

  // Opening / refreshing the thread marks the other person's messages as read.
  const unreadFromOther = (messages ?? []).filter((m) => m.sender_id !== myUserId && !m.read_at).length
  useEffect(() => {
    if (unreadFromOther === 0) return
    markThreadRead(thread.thread_id, myUserId)
      .then(() => onChanged())
      .catch((err) => console.warn('Could not mark messages as read', err))
  }, [unreadFromOther, thread.thread_id, myUserId, onChanged])

  // Keep the newest message in view.
  const lastId = messages?.at(-1)?.id
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [lastId])

  async function handleSend(event) {
    event.preventDefault()
    const body = draft.trim()
    if (!body) return
    setSending(true)
    setError(null)
    try {
      await sendMessage(thread.thread_id, myUserId, body)
      setDraft('')
      messagesQuery.reload()
      onChanged()
    } catch (err) {
      // Most likely the thread became read-only after the page loaded.
      setError(
        err.code === '42501' || err.code === 'NO_ROWS_CHANGED'
          ? 'Your message was not sent: this conversation has become read-only (there is no longer a shared class this session).'
          : friendlyDbError(err),
      )
      onChanged()
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="conversation">
      <header className="conversation-header">
        <button type="button" className="button-link conversation-back" onClick={onBack}>
          ← All conversations
        </button>
        <h2>{thread.other_name}</h2>
        <p className="muted small">{thread.links ?? 'No shared class this session'}</p>
      </header>

      <div className="message-list" aria-live="polite">
        {messagesQuery.loading ? (
          <p className="muted">Loading…</p>
        ) : messagesQuery.error ? (
          <p className="alert alert-error" role="alert">{friendlyDbError(messagesQuery.error)}</p>
        ) : messages.length === 0 ? (
          <p className="muted small">No messages yet. Say hello below.</p>
        ) : (
          messages.map((m) => {
            const mine = m.sender_id === myUserId
            // Same rule as the database: your own message, under 1 hour old, in a writable conversation.
            const canEdit = mine && thread.can_send && now - new Date(m.sent_at).getTime() < EDIT_WINDOW_MS
            return (
              <MessageItem
                key={m.id}
                message={m}
                mine={mine}
                authorName={mine ? 'You' : thread.other_name}
                canEdit={canEdit}
                editing={editingId === m.id}
                onEdit={() => setEditingId(m.id)}
                onCancel={() => setEditingId(null)}
                onSaved={() => {
                  setEditingId(null)
                  messagesQuery.reload()
                  onChanged()
                }}
              />
            )
          })
        )}
        <div ref={endRef} />
      </div>

      {thread.can_send ? (
        <form className="compose" onSubmit={handleSend}>
          {error && <p className="alert alert-error" role="alert">{error}</p>}
          <label className="visually-hidden" htmlFor={`compose-${thread.thread_id}`}>
            Message to {thread.other_name}
          </label>
          <textarea
            id={`compose-${thread.thread_id}`}
            rows={3}
            maxLength={MAX_MESSAGE_LENGTH}
            placeholder={`Write to ${thread.other_name}…`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="compose-actions">
            <span className="muted small">
              {draft.length}/{MAX_MESSAGE_LENGTH}
            </span>
            <button type="submit" disabled={sending || !draft.trim()}>
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </form>
      ) : (
        <p className="alert alert-info-plain read-only-note" role="status">
          🔒 This conversation is read-only.{' '}
          {viewer === 'parent'
            ? `${thread.other_name} doesn’t teach any of your children a subject this session, so new messages can’t be sent.`
            : `You don’t teach any of ${thread.other_name}’s children a subject this session, so new messages can’t be sent.`}{' '}
          You can still read the history.
        </p>
      )}
    </div>
  )
}

// One message. Your own recent messages can be edited in place (Save / Cancel).
function MessageItem({ message, mine, authorName, canEdit, editing, onEdit, onCancel, onSaved }) {
  const [text, setText] = useState(message.body)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  async function save(event) {
    event.preventDefault()
    const body = text.trim()
    if (!body) return setError('A message can’t be empty.')
    if (body === message.body) return onCancel()
    setSaving(true)
    setError(null)
    try {
      await editMessage(message.id, body)
      onSaved()
    } catch (err) {
      // e.g. "Messages can only be edited within 1 hour of sending." or the read-only message
      setError(friendlyDbError(err))
      setSaving(false)
    }
  }

  return (
    <div className={`message ${mine ? 'is-mine' : 'is-theirs'}${editing ? ' is-editing' : ''}`}>
      {editing ? (
        <form className="message-edit" onSubmit={save}>
          <label className="visually-hidden" htmlFor={`edit-${message.id}`}>
            Edit your message
          </label>
          <textarea
            id={`edit-${message.id}`}
            rows={3}
            maxLength={MAX_MESSAGE_LENGTH}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          {error && <p className="alert alert-error small" role="alert">{error}</p>}
          <div className="message-edit-actions">
            <span className="muted small">
              {text.length}/{MAX_MESSAGE_LENGTH}
            </span>
            <button type="button" className="button-secondary" onClick={onCancel} disabled={saving}>
              Cancel
            </button>
            <button type="submit" disabled={saving || !text.trim()}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      ) : (
        <div className="message-body">{message.body}</div>
      )}
      <div className="message-meta muted small">
        {authorName} · {formatDateTime(message.sent_at)}
        {message.edited_at && <span title={`Edited ${formatDateTime(message.edited_at)}`}> (edited)</span>}
        {mine && (message.read_at ? ` · Read ${formatDateTime(message.read_at)}` : ' · Not read yet')}
        {canEdit && !editing && (
          <>
            {' · '}
            <button type="button" className="button-link message-edit-link" onClick={onEdit}>
              Edit
            </button>
          </>
        )}
      </div>
    </div>
  )
}
