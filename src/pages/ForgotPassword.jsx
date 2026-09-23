import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { friendlyAuthError, isNetworkError, isRateLimitError } from '../lib/authErrors'

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
      <main className="auth-page">
        <div className="auth-card">
          <h1>Check your email</h1>
          <p className="alert alert-success" role="status">
            If an account exists for {email.trim()}, we have sent a link to reset your password.
            Check your inbox and spam folder. The link can only be used once.
          </p>
          <Link to="/login">Back to sign in</Link>
        </div>
      </main>
    )
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Forgot password</h1>
        <p className="muted">Enter your email and we&apos;ll send you a link to set a new password.</p>

        {error && <p className="alert alert-error" role="alert">{error}</p>}

        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        <button type="submit" disabled={submitting}>
          {submitting ? 'Sending…' : 'Send reset link'}
        </button>
        <Link to="/login">Back to sign in</Link>
      </form>
    </main>
  )
}
