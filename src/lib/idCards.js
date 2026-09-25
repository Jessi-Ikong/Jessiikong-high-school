import { supabase } from './supabaseClient'
import { run } from './db'
import { photoUrl } from './avatars'
import { buildCardsPdf } from './idCardPdf'

// Issuing / fetching ID cards (database) + downloading them as a PDF.
// Loaded on demand: the PDF and QR code libraries are large.

// Card ids -> the details to print (only cards the caller may see).
export async function fetchCardDetails(cardIds) {
  if (cardIds.length === 0) return []
  const rows = await run(supabase.rpc('id_card_details', { p_card_ids: cardIds }))
  return rows.sort((a, b) => a.full_name.localeCompare(b.full_name))
}

// A teacher / student: my card for the current session (reused or issued).
export async function issueMyCard() {
  const cardId = await run(supabase.rpc('issue_my_id_card'))
  return fetchCardDetails([cardId])
}

// Admins: cards for these people (reused where they exist).
export async function issueCards(userIds) {
  const ids = await run(supabase.rpc('issue_id_cards', { p_user_ids: userIds }))
  return fetchCardDetails(ids)
}

// The QR code points at VITE_PUBLIC_APP_URL (the public site address) if set,
// otherwise at the address this app is running on.
export async function downloadCardsPdf(cards, fileName) {
  const baseUrl = import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin
  const doc = await buildCardsPdf(cards, { photoSrc: photoUrl, baseUrl })
  doc.save(fileName)
}
