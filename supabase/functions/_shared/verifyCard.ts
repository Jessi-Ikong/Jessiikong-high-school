// Public ID card check, shared logic (used by the verify-card Edge Function,
// and unit-tested with Node).
//
// Input: ONLY the random token from the card's QR code. Never a photo path.
// Output: the display-safe fields of that card, plus a short-lived signed
// link to THAT card's photo - and only when the card is valid (active, owner
// active). For anything else: { valid: false }, and nothing is signed.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export const PHOTO_LINK_SECONDS = 120 // long enough to load the page, then useless
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type VerifyResult =
  | { valid: false }
  | {
      valid: true
      card: {
        full_name: string
        role: string
        class_name: string | null
        section_name: string | null
        department: string | null
        session_name: string
        card_number: string
        photo_url: string | null // signed, short-lived; never the storage path
      }
    }

export async function verifyCard(admin: SupabaseClient, token: unknown): Promise<VerifyResult> {
  if (typeof token !== 'string' || !UUID_RE.test(token)) return { valid: false }

  // verify_id_card() returns a row only for an ACTIVE card of an ACTIVE person.
  const { data, error } = await admin.rpc('verify_id_card', { p_token: token })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : null
  if (!row) return { valid: false }

  let photoUrl: string | null = null
  if (row.photo_url) {
    // Sign exactly this card's photo (the path comes from the database row,
    // not from the request).
    const { data: signed, error: signError } = await admin.storage
      .from('avatars')
      .createSignedUrl(row.photo_url, PHOTO_LINK_SECONDS)
    if (!signError) photoUrl = signed?.signedUrl ?? null
  }

  return {
    valid: true,
    card: {
      full_name: row.full_name,
      role: row.role,
      class_name: row.class_name ?? null,
      section_name: row.section_name ?? null,
      department: row.department ?? null,
      session_name: row.session_name,
      card_number: row.card_number,
      photo_url: photoUrl,
    },
  }
}
