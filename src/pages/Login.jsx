import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'
import { ROLE_HOME } from '../lib/roles'
import { friendlyAuthError, PROFILE_ERROR_MESSAGES } from '../lib/authErrors'

export default function Login() {
  const { user, profile, profileError, loading, signOut } = useAuth()
  const location = useLocation()
  const notice = location.state?.message // e.g. "You have been logged out."

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  // Signed in, but there is no usable school profile: sign them out again.
  // (profileError stays set, so the reason is still shown below.)
  useEffect(() => {
    if (user && profileError) signOut()
  }, [user, profileError, signOut])

  const shownError = error ?? PROFILE_ERROR_MESSAGES[profileError] ?? null

  // Already signed in (or just signed in): go to the right dashboard.
  if (!loading && profile) return <Navigate to={ROLE_HOME[profile.role]} replace />
  // Initial session check: don't flash the form at someone who is signed in.
  if (loading && !submitting) return <p className="page-loading">Loading…</p>

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    setSubmitting(false)
    if (signInError) setError(friendlyAuthError(signInError))
    // On success AuthProvider loads the profile and this page redirects.
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Jessiikong High School</h1>
        <p className="muted">Sign in to your account</p>

        {shownError && <p className="alert alert-error" role="alert">{shownError}</p>}
        {!shownError && notice && <p className="alert alert-success" role="status">{notice}</p>}

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
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        <button type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
        <Link to="/forgot-password">Forgot password?</Link>
        <Link to="/" className="auth-back">
          ← Back to the school website
        </Link>
      </form>
    </main>
  )
}
