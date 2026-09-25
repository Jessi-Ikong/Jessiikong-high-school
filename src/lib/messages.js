import { supabase } from './supabaseClient'
import { run, runWrite } from './db'

// Parent-teacher messaging. The rules live in the database (migrations 7, 9,
// 13): who may open a thread / send, and read-only once the teacher no longer
// teaches the parent's child a subject in the current session. The helper
// functions (migration 30) only return the caller's own data.

// The caller's threads, newest activity first, with the other person's name,
// the children/subjects linking you, can_send, last message and unread count.
export function fetchThreads() {
  return run(supabase.rpc('my_message_threads'))
}

// People the caller may start a new conversation with (linked now, no thread yet).
export function fetchContacts() {
  return run(supabase.rpc('my_message_contacts'))
}

export function fetchMessages(threadId) {
  return run(
    supabase
      .from('messages')
      .select('id, sender_id, body, sent_at, read_at, edited_at, reply_to_message_id')
      .eq('thread_id', threadId)
      .order('sent_at', { ascending: true }),
  )
}

// Marks the other person's unread messages in this thread as read. (The
// database only lets the recipient set read_at, and doesn't audit-log it.)
export async function markThreadRead(threadId, myUserId) {
  const { error } = await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('thread_id', threadId)
    .neq('sender_id', myUserId)
    .is('read_at', null)
  if (error) throw error
}

// replyToId (optional): the message being replied to. The database only
// accepts a message from the same conversation.
export function sendMessage(threadId, myUserId, body, replyToId = null) {
  // sender_id is also forced to the signed-in user by the database.
  return runWrite(
    supabase
      .from('messages')
      .insert({ thread_id: threadId, sender_id: myUserId, body, reply_to_message_id: replyToId })
      .select('id'),
  )
}

// A one-line preview of a message for quotes: 'Ada did well in the…'
export function snippet(text, max = 90) {
  const oneLine = (text ?? '').replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine
}

// Edits the text of one of your own messages. The database only allows it
// within 1 hour of sending, in a conversation that isn't read-only, and
// sets edited_at itself.
export function editMessage(messageId, body) {
  return runWrite(supabase.from('messages').update({ body }).eq('id', messageId).select('id'))
}

export async function startThread(parentId, teacherId) {
  const rows = await runWrite(
    supabase.from('message_threads').insert({ parent_id: parentId, teacher_id: teacherId }).select('id'),
  )
  return rows[0].id
}

export const MAX_MESSAGE_LENGTH = 2000
export const EDIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour (same as the database rule)
