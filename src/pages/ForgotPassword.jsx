import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { friendlyAuthError, isNetworkError, isRateLimitError } from '../lib/authErrors'
import AuthLayout from '../components/AuthLayout'
import { Alert, Button } from '../components/ui/Primitives'
import { Field, TextInput } from '../components/ui/Form'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/set-password`,
    })
    setSubmitting(false)
    // Only report problems that say nothing about whether the account exists.
    if (resetError && (isNetworkError(resetError) || isRateLimitError(resetError))) {
      setError(friendlyAuthError(resetError))
      return
    }
    setSent(true)
  }

  if (sent) {
    return (
      <AuthLayout title="Check your email">
        <Alert tone="success">
          If an account exists for {email.trim()}, we have sent a link to reset your password. Check your inbox and spam folder. The link can only be
          used once.
        </Alert>
        <Link to="/login" className="ds-btn ds-btn-link">
          ← Back to sign in
        </Link>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout as="form" onSubmit={handleSubmit} title="Forgot password" subtitle="Enter your email and we'll send you a link to set a new password.">
      {error && <Alert tone="danger">{error}</Alert>}

      <Field label="Email">
        {(p) => <TextInput {...p} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />}
      </Field>

      <Button type="submit" block disabled={submitting}>
        {submitting ? 'Sending…' : 'Send reset link'}
      </Button>
      <div className="ds-auth-links">
        <Link to="/login" className="ds-btn ds-btn-link">
          ← Back to sign in
        </Link>
      </div>
    </AuthLayout>
  )
}
