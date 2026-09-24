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
      .select('id, sender_id, body, sent_at, read_at')
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

export function sendMessage(threadId, myUserId, body) {
  // sender_id is also forced to the signed-in user by the database.
  return runWrite(supabase.from('messages').insert({ thread_id: threadId, sender_id: myUserId, body }).select('id'))
}

export async function startThread(parentId, teacherId) {
  const rows = await runWrite(
    supabase.from('message_threads').insert({ parent_id: parentId, teacher_id: teacherId }).select('id'),
  )
  return rows[0].id
}

export const MAX_MESSAGE_LENGTH = 2000
