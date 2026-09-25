import { jsPDF } from 'jspdf'
import QRCode from 'qrcode'
import { formatDate } from './format'

// Draws ID cards into a PDF: one card per page at the standard ID-1 size
// (85.6 x 54 mm, landscape). Pure drawing, no database calls, so it can be
// tested on its own. Drawn in the browser (jsPDF + qrcode): no server needed
// for a card this small, and the photo is already public (avatars bucket).
export const SCHOOL = 'Jessiikong High School'
export const CARD_W = 85.6
export const CARD_H = 54
const NAVY = [30, 58, 95]

// The address in the QR code: the public verification page for this card.
export function verifyUrl(baseUrl, token) {
  return `${baseUrl.replace(/\/$/, '')}/verify/${token}`
}

// Photo -> JPEG data URL (jsPDF can't embed WebP), cropped to the box ratio.
async function loadPhoto(src, boxW, boxH) {
  if (!src || typeof Image === 'undefined') return null
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = src
    await img.decode()
    const scale = 8 // px per mm
    const canvas = document.createElement('canvas')
    canvas.width = boxW * scale
    canvas.height = boxH * scale
    const target = boxW / boxH
    const source = img.naturalWidth / img.naturalHeight
    let sx = 0
    let sy = 0
    let sw = img.naturalWidth
    let sh = img.naturalHeight
    if (source > target) {
      sw = sh * target
      sx = (img.naturalWidth - sw) / 2
    } else {
      sh = sw / target
      sy = (img.naturalHeight - sh) / 4 // keep faces (near the top) in frame
    }
    canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.9)
  } catch {
    return null // missing / unreadable photo: initials instead
  }
}

function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('')
}

async function drawCard(doc, card, { photoSrc, baseUrl }) {
  const isStudent = card.role === 'student'
  // Header band
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, CARD_W, 11, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.text(SCHOOL, 4, 5.3)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6)
  doc.text(isStudent ? 'STUDENT IDENTITY CARD' : 'STAFF IDENTITY CARD', 4, 8.8)
  doc.text(`Session ${card.session_name}`, CARD_W - 4, 8.8, { align: 'right' })

  // Photo (or initials)
  const px = 4
  const py = 14
  const pw = 21
  const ph = 26
  const photo = await loadPhoto(photoSrc(card.photo_path), pw, ph)
  if (photo) {
    doc.addImage(photo, 'JPEG', px, py, pw, ph)
  } else {
    doc.setFillColor(228, 231, 235)
    doc.rect(px, py, pw, ph, 'F')
    doc.setTextColor(82, 96, 109)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.text(initials(card.full_name) || '?', px + pw / 2, py + ph / 2 + 2, { align: 'center' })
  }
  doc.setDrawColor(203, 210, 217)
  doc.rect(px, py, pw, ph)

  // Details
  const tx = 28
  const maxW = 31
  let y = 16.5
  doc.setTextColor(31, 41, 51)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  for (const line of doc.splitTextToSize(card.full_name, maxW).slice(0, 2)) {
    doc.text(line, tx, y)
    y += 3.6
  }
  y += 0.6
  const rows = isStudent
    ? [
        ['Admission No', card.id_number ?? '—'],
        ['Class', card.class_name ? `${card.class_name} ${card.section_name ?? ''}`.trim() : 'Not enrolled'],
      ]
    : [
        ['Staff ID', card.id_number ?? '—'],
        [card.department ? 'Department' : 'Subjects', card.department ?? card.subjects ?? '—'],
      ]
  rows.push(['Issued', formatDate(String(card.issued_at).slice(0, 10))], ['Card No', card.card_number])
  doc.setFontSize(5.8)
  for (const [label, value] of rows) {
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(82, 96, 109)
    doc.text(label.toUpperCase(), tx, y)
    y += 2.5
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(31, 41, 51)
    doc.setFontSize(7)
    // Subjects / department may need a second line; everything else fits on one.
    const lines = doc.splitTextToSize(String(value), maxW).slice(0, /Subjects|Department/.test(label) ? 2 : 1)
    lines.forEach((line, i) => doc.text(line, tx, y + i * 2.8))
    doc.setFontSize(5.8)
    y += 3.4 + (lines.length - 1) * 2.8
  }

  // QR code -> public verification page
  const qr = await QRCode.toDataURL(verifyUrl(baseUrl, card.verification_token), { margin: 1, width: 300, errorCorrectionLevel: 'M' })
  const qs = 21
  doc.addImage(qr, 'PNG', CARD_W - 4 - qs, 14, qs, qs)
  doc.setFontSize(5)
  doc.setTextColor(82, 96, 109)
  doc.text('Scan to verify', CARD_W - 4 - qs / 2, 14 + qs + 2.5, { align: 'center' })

  // Footer line
  doc.setDrawColor(...NAVY)
  doc.setLineWidth(0.8)
  doc.line(0, CARD_H - 0.4, CARD_W, CARD_H - 0.4)
  doc.setLineWidth(0.2)
}

// cards: rows from id_card_details(). photoSrc(path) -> image URL or null.
export async function buildCardsPdf(cards, { photoSrc = () => null, baseUrl }) {
  if (cards.length === 0) throw new Error('There are no ID cards to download.')
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [CARD_H, CARD_W] })
  for (let i = 0; i < cards.length; i++) {
    if (i > 0) doc.addPage([CARD_H, CARD_W], 'landscape')
    await drawCard(doc, cards[i], { photoSrc, baseUrl })
  }
  return doc
}
