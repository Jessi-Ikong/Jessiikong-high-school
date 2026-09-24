-- 28. Paystack payments: only the server creates and confirms online payments.
--
-- Online payments now go through two Edge Functions (service role, which
-- bypasses RLS):
--   * initialize-payment: checks the caller is the child's parent, creates
--     the 'pending' payment row and starts the Paystack transaction.
--   * paystack-webhook: verifies Paystack's signature, re-checks the
--     transaction with Paystack's Verify API, then marks the payment
--     'successful' (or 'failed'). The existing trigger
--     (refresh_invoice_paid, migration 6) then recalculates the invoice.
--
-- So parents no longer need to write payments at all. Migration 9 let a
-- parent INSERT a 'pending' paystack/flutterwave payment for their child's
-- invoice directly; that is removed: a parent could otherwise create
-- payment rows with any amount and any reference outside the checked flow.
--
-- After this, who can write payments:
--   * the Edge Functions (service role): online payments;
--   * admins (either tier): INSERT, e.g. cash / bank transfer at the bursary
--     (unchanged, migration 9);
--   * super admins: UPDATE / DELETE corrections (unchanged).
-- Parents and students: read only (payments on invoices they can see).
-- Nobody but these can ever set a payment to 'successful'.

drop policy "payments: parents start online payments for their children" on public.payments;

-- Make the API pick up the change straight away.
notify pgrst, 'reload schema';
