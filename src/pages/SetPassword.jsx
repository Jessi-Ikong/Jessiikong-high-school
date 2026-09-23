import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authLinkError, supabase } from '../lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'
import { friendlyAuthError, friendlyLinkError } from '../lib/authErrors'

const MIN_LENGTH = 8

// Landing page for BOTH admin invite links and password-reset links.
// Supabase signs the user in from the link, then they choose a password here.
export default function SetPassword() {
  const { user, loading, signOut } = useAuth()
  const navigate = useNavigate()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  if (done) return <p className="page-loading">Password saved. Redirecting…</p>
  if (loading) return <p className="page-loading">Checking your link…</p>

  if (!user) {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <h1>Set your password</h1>
          <p className="alert alert-error" role="alert">
            {friendlyLinkError(authLinkError) ?? 'This link is not valid or has expired.'} You can
            request a new one below.
          </p>
          <Link to="/forgot-password">Request a new link</Link>
          <Link to="/login">Back to sign in</Link>
        </div>
      </main>
    )
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    if (password.length < MIN_LENGTH) {
      setError(`Your password must be at least ${MIN_LENGTH} characters long.`)
      return
    }
    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }

    setSubmitting(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      setError(friendlyAuthError(updateError))
      setSubmitting(false)
      return
    }

    // Sign out so they log in with the new password, confirming it works.
    setDone(true)
    await signOut()
    navigate('/login', {
      replace: true,
      state: { message: 'Your password has been set. Please sign in with your new password.' },
    })
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Set your password</h1>
        <p className="muted">Choose a password for {user.email}.</p>

        {error && <p className="alert alert-error" role="alert">{error}</p>}

        <label>
          New password
          <input
            type="password"
            autoComplete="new-password"
            minLength={MIN_LENGTH}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <label>
          Confirm new password
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </label>
        <p className="muted small">At least {MIN_LENGTH} characters.</p>

        <button type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </main>
  )
}
