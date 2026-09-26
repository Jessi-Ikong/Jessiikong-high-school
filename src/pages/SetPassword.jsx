import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authLinkError, supabase } from '../lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'
import { friendlyAuthError, friendlyLinkError } from '../lib/authErrors'
import { MIN_PASSWORD_LENGTH, newPasswordProblem } from '../lib/passwords'
import AuthLayout, { AuthLoading } from '../components/AuthLayout'
import { Alert, Button } from '../components/ui/Primitives'
import { Field, TextInput } from '../components/ui/Form'

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

  if (done) return <AuthLoading>Password saved. Redirecting…</AuthLoading>
  if (loading) return <AuthLoading>Checking your link…</AuthLoading>

  if (!user) {
    return (
      <AuthLayout title="Set your password">
        <Alert tone="danger">
          {friendlyLinkError(authLinkError) ?? 'This link is not valid or has expired.'} You can request a new one below.
        </Alert>
        <Link to="/forgot-password" className="ds-btn ds-btn-primary ds-btn-block">
          Request a new link
        </Link>
        <div className="ds-auth-links">
          <Link to="/login" className="ds-btn ds-btn-link">
            ← Back to sign in
          </Link>
        </div>
      </AuthLayout>
    )
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    const problem = newPasswordProblem(password, confirm)
    if (problem) {
      setError(problem)
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
    <AuthLayout as="form" onSubmit={handleSubmit} title="Set your password" subtitle={`Choose a password for ${user.email}.`}>
      {error && <Alert tone="danger">{error}</Alert>}

      <Field label="New password" hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
        {(p) => (
          <TextInput
            {...p}
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        )}
      </Field>
      <Field label="Confirm new password">
        {(p) => <TextInput {...p} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />}
      </Field>

      <Button type="submit" block disabled={submitting}>
        {submitting ? 'Saving…' : 'Save password'}
      </Button>
    </AuthLayout>
  )
}
