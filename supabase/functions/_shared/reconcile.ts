// The scheduled sweep for Paystack payments stuck in 'pending'.
// Each payment goes through processPaystackReference() (Paystack Verify API
// + amount/currency/reference match), so this can never mark anything paid
// without Paystack confirming it.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { processPaystackReference } from './processPayment.ts'

export type ReconcileSettings = {
  minAgeMinutes: number // leave newer payments alone (checkout may still be in progress)
  expireAfterHours: number // 0 = never auto-fail
  limit: number // most payments checked per run
}

export const DEFAULT_SETTINGS: ReconcileSettings = { minAgeMinutes: 15, expireAfterHours: 48, limit: 50 }

// Accepts { min_age_minutes, expire_after_hours, limit } (all optional) and
// keeps each inside a sensible range.
export function readSettings(body: Record<string, unknown> | null): ReconcileSettings {
  const num = (value: unknown, fallback: number, min: number, max: number) => {
    const n = Number(value)
    return Number.isFinite(n) && value !== null && value !== '' ? Math.min(Math.max(n, min), max) : fallback
  }
  return {
    minAgeMinutes: num(body?.min_age_minutes, DEFAULT_SETTINGS.minAgeMinutes, 5, 24 * 60),
    expireAfterHours: num(body?.expire_after_hours, DEFAULT_SETTINGS.expireAfterHours, 0, 24 * 30),
    limit: Math.round(num(body?.limit, DEFAULT_SETTINGS.limit, 1, 200)),
  }
}

export async function reconcilePendingPayments(
  admin: SupabaseClient,
  paystackKey: string,
  settings: ReconcileSettings,
  now = new Date(),
) {
  const olderThan = new Date(now.getTime() - settings.minAgeMinutes * 60_000)
  const expireIfCreatedBefore =
    settings.expireAfterHours > 0 ? new Date(now.getTime() - settings.expireAfterHours * 3_600_000) : undefined

  const { data: stuck, error } = await admin
    .from('payments')
    .select('provider_ref')
    .eq('status', 'pending')
    .eq('provider', 'paystack')
    .lt('created_at', olderThan.toISOString())
    .order('created_at', { ascending: true })
    .limit(settings.limit)
  if (error) throw error

  const summary = { checked: 0, successful: 0, failed: 0, expired: 0, still_pending: 0, errors: 0, other: 0 }
  // One at a time: gentle on Paystack's API, and one failure doesn't stop the rest.
  for (const { provider_ref: reference } of stuck ?? []) {
    if (!reference) continue
    summary.checked += 1
    try {
      const { outcome } = await processPaystackReference(admin, paystackKey, reference, 'reconcile', { expireIfCreatedBefore })
      if (outcome === 'successful') summary.successful += 1
      else if (outcome === 'failed' || outcome === 'mismatch') summary.failed += 1
      else if (outcome === 'expired') summary.expired += 1
      else if (outcome === 'pending') summary.still_pending += 1
      else summary.other += 1
    } catch (err) {
      summary.errors += 1
      console.error(`reconcile: checking ${reference} failed (will retry next run)`, err)
    }
  }
  return summary
}
