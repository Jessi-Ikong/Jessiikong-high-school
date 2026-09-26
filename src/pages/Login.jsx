import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'
import { ROLE_HOME } from '../lib/roles'
import { friendlyAuthError, PROFILE_ERROR_MESSAGES } from '../lib/authErrors'
import AuthLayout, { AuthLoading } from '../components/AuthLayout'
import { Alert, Button } from '../components/ui/Primitives'
import { Field, TextInput } from '../components/ui/Form'

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
  if (loading && !submitting) return <AuthLoading>Loading…</AuthLoading>

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
    <AuthLayout
      as="form"
      onSubmit={handleSubmit}
      title="Sign in"
      subtitle="Sign in to your account."
      footer={
        <Link to="/" className="ds-btn ds-btn-link">
          ← Back to the school website
        </Link>
      }
    >
      {shownError && <Alert tone="danger">{shownError}</Alert>}
      {!shownError && notice && <Alert tone="success">{notice}</Alert>}

      <Field label="Email">
        {(p) => <TextInput {...p} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />}
      </Field>
      <Field label="Password">
        {(p) => (
          <TextInput {...p} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        )}
      </Field>

      <Button type="submit" block disabled={submitting}>
        {submitting ? 'Signing in…' : 'Sign in'}
      </Button>
      <div className="ds-auth-links">
        <Link to="/forgot-password" className="ds-btn ds-btn-link">
          Forgot password?
        </Link>
      </div>
    </AuthLayout>
  )
}
