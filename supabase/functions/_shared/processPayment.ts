// The ONE place that decides what a Paystack transaction means for our
// payment row. Used by paystack-webhook (Paystack calls us), verify-payment
// (the callback page / an admin asks us to re-check) and
// reconcile-pending-payments (the scheduled sweep), so all of them go through
// exactly the same checks:
//   * ask Paystack's Verify Transaction API ourselves (never trust a payload);
//   * mark 'successful' only if Paystack says success AND amount (kobo),
//     currency and reference match our row;
//   * never touch a payment that is already 'successful' (idempotent).
// Every check leaves a trace in provider_response.last_check (when, by what,
// what Paystack said, how many checks so far), so a payment stuck in
// 'pending' shows why. If Paystack can't be reached, that is recorded too.
//
// Optional expiry (used by the scheduled sweep only): a payment that Paystack
// itself still reports as NOT completed (e.g. 'abandoned') and that was
// created before `expireIfCreatedBefore` is marked 'failed' with an
// "expired" note. Never when Paystack couldn't be reached, and never when
// Paystack reports success.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { classifyVerifiedTransaction, paystackRequest, toKobo } from './paystack.ts'

export type ProcessResult = {
  outcome: 'unknown-reference' | 'already-successful' | 'successful' | 'failed' | 'mismatch' | 'pending' | 'expired'
  paystackStatus?: string
  gatewayResponse?: string
}

export type ProcessOptions = {
  // Only the scheduled sweep passes this.
  expireIfCreatedBefore?: Date
}

export async function processPaystackReference(
  admin: SupabaseClient,
  paystackKey: string,
  reference: string,
  source: 'webhook' | 'verify-payment' | 'reconcile',
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  const { data: payment, error } = await admin
    .from('payments')
    .select('id, amount, status, created_at, provider_response')
    .eq('provider', 'paystack')
    .eq('provider_ref', reference)
    .maybeSingle()
  if (error) throw error
  if (!payment) return { outcome: 'unknown-reference' }
  if (payment.status === 'successful') return { outcome: 'already-successful' }

  const previous = (payment.provider_response?.last_check ?? {}) as Record<string, unknown>
  const now = new Date().toISOString()
  const history = {
    check_count: Number(previous.check_count ?? 0) + 1,
    first_checked_at: (previous.first_checked_at as string | undefined) ?? now,
  }

  // Ask Paystack directly. If it can't be reached, record that (without
  // touching the status) and re-throw so the caller can retry / report it.
  let transaction: Record<string, any>
  try {
    const verified = await paystackRequest(paystackKey, `/transaction/verify/${encodeURIComponent(reference)}`)
    transaction = verified.data ?? {}
  } catch (err) {
    await admin
      .from('payments')
      .update({
        provider_response: {
          ...(payment.provider_response ?? {}),
          last_check: { at: now, source, outcome: 'paystack-unreachable', error: String((err as Error).message ?? err), ...history },
        },
      })
      .eq('id', payment.id)
      .neq('status', 'successful')
    throw err
  }

  let outcome: ProcessResult['outcome'] = classifyVerifiedTransaction(transaction, {
    amountKobo: toKobo(payment.amount),
    reference,
    currency: 'NGN',
  })
  // Expire only a payment Paystack itself says was never completed.
  if (
    outcome === 'pending' &&
    options.expireIfCreatedBefore &&
    new Date(payment.created_at) < options.expireIfCreatedBefore
  ) {
    outcome = 'expired'
  }

  const lastCheck = {
    at: now,
    source,
    paystack_status: transaction.status ?? null,
    gateway_response: transaction.gateway_response ?? null,
    paystack_amount_kobo: transaction.amount ?? null,
    expected_amount_kobo: toKobo(payment.amount),
    currency: transaction.currency ?? null,
    outcome,
    ...history,
  }
  const result = { outcome, paystackStatus: transaction.status, gatewayResponse: transaction.gateway_response }

  let update: Record<string, unknown>
  if (outcome === 'successful') {
    update = {
      status: 'successful',
      paid_at: transaction.paid_at ?? now,
      provider_response: { ...transaction, last_check: lastCheck },
    }
  } else if (outcome === 'failed' || outcome === 'mismatch') {
    // Never mark paid. A mismatch (success, but not what we asked for) is kept
    // as 'failed' with Paystack's details for an admin to review.
    update = {
      status: 'failed',
      provider_response:
        outcome === 'mismatch'
          ? { review: 'Paystack reported success but the amount/currency/reference did not match', transaction, last_check: lastCheck }
          : { ...transaction, last_check: lastCheck },
    }
  } else if (outcome === 'expired') {
    update = {
      status: 'failed',
      provider_response: {
        expired: `Never completed on Paystack (last status: ${transaction.status ?? 'unknown'}); marked failed automatically. Paystack can still confirm it later.`,
        last_check: lastCheck,
      },
    }
  } else {
    // Not final yet: stay pending, but record what Paystack said.
    update = { provider_response: { last_check: lastCheck } }
  }

  const { error: updateError } = await admin
    .from('payments')
    .update(update)
    .eq('id', payment.id)
    .neq('status', 'successful') // idempotent even if two checks race
  if (updateError) throw updateError
  return result
}
