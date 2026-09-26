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
  snippet,
  startThread,
} from '../lib/messages'
import { useAsyncData } from '../hooks/useAsyncData'
import { useAuth } from '../hooks/useAuth'
import { usePolling } from '../hooks/usePolling'
import { Alert, Badge, Button, EmptyState, LoadingState } from './ui/Primitives'

// Thread list + conversation, shared by the parent and teacher Messages pages.
// viewer: 'parent' | 'teacher' (only changes the wording).
// The open thread is kept in the address (?thread=<id>).
// Layout (styles/app.css, .ds-messaging): when the component is narrower than
// 720px (phones, and tablets beside the sidebar) it shows EITHER the thread
// list OR the open conversation, with "← All conversations" to go back; wider,
// both side by side.
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

  if (threadsQuery.loading) return <LoadingState lines={4} label="Loading messages…" />
  if (threadsQuery.error) return <Alert tone="danger">{friendlyDbError(threadsQuery.error)}</Alert>

  const threads = threadsQuery.data
  const open = threads.find((t) => t.thread_id === openId) ?? null

  return (
    <div className="ds-messaging">
      <div className={`ds-messaging-grid${open ? ' has-open-thread' : ''}`}>
      <aside className="ds-card ds-thread-panel">
        <header className="ds-card-header">
          <h2 className="ds-h2">Conversations</h2>
          <Button variant="secondary" onClick={() => setShowNew((v) => !v)} aria-expanded={showNew}>
            {showNew ? 'Close' : '+ New'}
          </Button>
        </header>
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
          <EmptyState icon="inbox">
            No conversations yet.{' '}
            {viewer === 'parent' ? 'Use "+ New" to message one of your child’s teachers.' : 'Use "+ New" to message a parent.'}
          </EmptyState>
        ) : (
          <ul className="ds-thread-list">
            {threads.map((t) => (
              <li key={t.thread_id}>
                <button
                  type="button"
                  className={`ds-thread-item${t.thread_id === openId ? ' is-open' : ''}${t.unread_count > 0 ? ' is-unread' : ''}`}
                  onClick={() => openThread(t.thread_id)}
                  aria-current={t.thread_id === openId ? 'true' : undefined}
                >
                  <span className="ds-thread-item-top">
                    <strong>{t.other_name}</strong>
                    {t.unread_count > 0 && (
                      <span aria-label={`${t.unread_count} unread`}>
                        <Badge status="unread">{t.unread_count}</Badge>
                      </span>
                    )}
                  </span>
                  <span className="ds-muted ds-small">{t.links ?? 'No shared class this session (read-only)'}</span>
                  {t.last_message && (
                    <span className="ds-thread-preview ds-small">
                      {t.last_sender_is_me ? 'You: ' : ''}
                      {t.last_message}
                    </span>
                  )}
                  <span className="ds-muted ds-small">{formatDateTime(t.last_message_at ?? t.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="ds-card ds-conversation-panel">
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
          <EmptyState icon="inbox">Choose a conversation{threads.length ? '' : ' or start a new one'}.</EmptyState>
        )}
      </section>
      </div>
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

  if (contactsQuery.loading) return <LoadingState lines={2} />
  if (contactsQuery.error) return <Alert tone="danger">{friendlyDbError(contactsQuery.error)}</Alert>
  const contacts = contactsQuery.data

  return (
    <div className="ds-new-conversation">
      <p className="ds-note">
        {viewer === 'parent'
          ? 'Teachers who teach your child a subject this session, that you don’t have a conversation with yet:'
          : 'Parents of students you teach this session, that you don’t have a conversation with yet:'}
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
      {contacts.length === 0 ? (
        <p className="ds-note">
          No one else. {viewer === 'parent' ? 'You already have a conversation with every teacher you can message.' : 'You already have a conversation with every parent you can message.'}
        </p>
      ) : (
        <ul className="ds-contact-list">
          {contacts.map((c) => (
            <li key={c.teacher_id + c.parent_id}>
              <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                <strong>{c.name}</strong>
                <span className="ds-muted ds-small"> · {c.links}</span>
              </span>
              <Button onClick={() => start(c)} disabled={busy !== null}>
                {busy === c.teacher_id + c.parent_id ? 'Starting…' : 'Start'}
              </Button>
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
  const [replyToId, setReplyToId] = useState(null) // message being replied to
  const [highlightId, setHighlightId] = useState(null) // briefly highlighted after jumping to it
  const composeRef = useRef(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState(null)
  const [sending, setSending] = useState(false)
  const endRef = useRef(null)
  const messages = messagesQuery.data
  const byId = Object.fromEntries((messages ?? []).map((m) => [m.id, m]))
  const authorOf = (m) => (m.sender_id === myUserId ? 'You' : thread.other_name)
  const replyingTo = replyToId ? byId[replyToId] : null

  function startReply(message) {
    setReplyToId(message.id)
    composeRef.current?.focus()
  }

  // Clicking a quote: scroll to the original and highlight it for a moment.
  function jumpTo(id) {
    document.getElementById(`msg-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightId(id)
    setTimeout(() => setHighlightId((current) => (current === id ? null : current)), 2000)
  }

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
      await sendMessage(thread.thread_id, myUserId, body, replyingTo ? replyingTo.id : null)
      setDraft('')
      setReplyToId(null)
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
    <div className="ds-conversation">
      <header className="ds-conversation-header">
        <button type="button" className="ds-btn ds-btn-link ds-conversation-back" onClick={onBack}>
          ← All conversations
        </button>
        <h2 className="ds-h2">{thread.other_name}</h2>
        <p className="ds-muted ds-small">{thread.links ?? 'No shared class this session'}</p>
      </header>

      <div className="ds-message-list" aria-live="polite">
        {messagesQuery.loading ? (
          <LoadingState lines={3} />
        ) : messagesQuery.error ? (
          <Alert tone="danger">{friendlyDbError(messagesQuery.error)}</Alert>
        ) : messages.length === 0 ? (
          <p className="ds-note">No messages yet. Say hello below.</p>
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
                quoted={m.reply_to_message_id ? (byId[m.reply_to_message_id] ?? null) : null}
                quotedAuthor={m.reply_to_message_id && byId[m.reply_to_message_id] ? authorOf(byId[m.reply_to_message_id]) : null}
                highlighted={highlightId === m.id}
                onJump={jumpTo}
                canReply={thread.can_send}
                onReply={() => startReply(m)}
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
        <form className="ds-compose" onSubmit={handleSend}>
          {error && <Alert tone="danger">{error}</Alert>}
          {replyingTo && (
            <div className="ds-reply-bar">
              <button type="button" className="ds-quote" onClick={() => jumpTo(replyingTo.id)}>
                <span className="ds-quote-author">Replying to {authorOf(replyingTo)}</span>
                <span className="ds-quote-text">{snippet(replyingTo.body)}</span>
              </button>
              <button type="button" className="ds-btn ds-btn-secondary ds-reply-clear" onClick={() => setReplyToId(null)} aria-label="Cancel reply" title="Cancel reply">
                ✕
              </button>
            </div>
          )}
          <label className="ds-visually-hidden" htmlFor={`compose-${thread.thread_id}`}>
            Message to {thread.other_name}
          </label>
          <textarea
            className="ds-textarea"
            id={`compose-${thread.thread_id}`}
            ref={composeRef}
            rows={3}
            maxLength={MAX_MESSAGE_LENGTH}
            placeholder={`Write to ${thread.other_name}…`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="ds-compose-actions">
            <span className="ds-muted ds-small">
              {draft.length}/{MAX_MESSAGE_LENGTH}
            </span>
            <Button type="submit" disabled={sending || !draft.trim()}>
              {sending ? 'Sending…' : 'Send'}
            </Button>
          </div>
        </form>
      ) : (
        <Alert tone="info">
          🔒 This conversation is read-only.{' '}
          {viewer === 'parent'
            ? `${thread.other_name} doesn’t teach any of your children a subject this session, so new messages can’t be sent.`
            : `You don’t teach any of ${thread.other_name}’s children a subject this session, so new messages can’t be sent.`}{' '}
          You can still read the history.
        </Alert>
      )}
    </div>
  )
}

// One message. Your own recent messages can be edited in place (Save / Cancel).
function MessageItem({
  message,
  mine,
  authorName,
  quoted,
  quotedAuthor,
  highlighted,
  onJump,
  canReply,
  onReply,
  canEdit,
  editing,
  onEdit,
  onCancel,
  onSaved,
}) {
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
    <div
      id={`msg-${message.id}`}
      className={`ds-message ${mine ? 'is-mine' : 'is-theirs'}${editing ? ' is-editing' : ''}${highlighted ? ' is-highlighted' : ''}`}
    >
      {/* The quote shows the original's CURRENT text; no quote if it isn't there. */}
      {quoted && !editing && (
        <button type="button" className="ds-quote" onClick={() => onJump(quoted.id)} title="Go to the original message">
          <span className="ds-quote-author">{quotedAuthor}</span>
          <span className="ds-quote-text">
            {snippet(quoted.body)}
            {quoted.edited_at && <span className="ds-muted"> (edited)</span>}
          </span>
        </button>
      )}
      {editing ? (
        <form className="ds-message-edit" onSubmit={save}>
          <label className="ds-visually-hidden" htmlFor={`edit-${message.id}`}>
            Edit your message
          </label>
          <textarea
            className="ds-textarea"
            id={`edit-${message.id}`}
            rows={3}
            maxLength={MAX_MESSAGE_LENGTH}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="ds-compose-actions">
            <span className="ds-muted ds-small">
              {text.length}/{MAX_MESSAGE_LENGTH}
            </span>
            <span className="ds-inline">
              <Button variant="secondary" onClick={onCancel} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !text.trim()}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </span>
          </div>
        </form>
      ) : (
        <div className="ds-message-body">{message.body}</div>
      )}
      <div className="ds-message-meta ds-muted ds-small">
        {authorName} · {formatDateTime(message.sent_at)}
        {message.edited_at && <span title={`Edited ${formatDateTime(message.edited_at)}`}> (edited)</span>}
        {mine && (message.read_at ? ` · Read ${formatDateTime(message.read_at)}` : ' · Not read yet')}
        {canReply && !editing && (
          <>
            {' · '}
            <button type="button" className="ds-message-action" onClick={onReply}>
              Reply
            </button>
          </>
        )}
        {canEdit && !editing && (
          <>
            {' · '}
            <button type="button" className="ds-message-action" onClick={onEdit}>
              Edit
            </button>
          </>
        )}
      </div>
    </div>
  )
}
