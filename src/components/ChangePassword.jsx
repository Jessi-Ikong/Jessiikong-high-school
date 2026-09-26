import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'
import { friendlyAuthError, isNetworkError, isRateLimitError } from '../lib/authErrors'
import { MIN_PASSWORD_LENGTH, newPasswordProblem } from '../lib/passwords'
import { Alert, Button, Card } from './ui/Primitives'
import { Field, TextInput } from './ui/Form'

const EMPTY = { current: '', next: '', confirm: '' }

// "Change password" on My Profile (every role). The CURRENT password is
// checked with the server first (a fresh sign-in with it) before the new one
// is saved, so an unattended signed-in session on a shared device can't be
// used to take over the account. The same rules as "Set your password".
export default function ChangePassword() {
  const { user } = useAuth()
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)
  const [saving, setSaving] = useState(false)

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
    setError(null)
    setDone(null)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setDone(null)
    if (!form.current) return setError('Enter your current password.')
    const problem = newPasswordProblem(form.next, form.confirm)
    if (problem) return setError(problem)
    if (form.next === form.current) return setError('Your new password must be different from your current password.')
    if (!user?.email) return setError('Your account has no email address, so its password can’t be changed here. Please contact the school office.')

    setSaving(true)
    try {
      // 1. Prove it's really you: sign in again with the current password.
      //    A wrong password returns an error and leaves the session as it was.
      const { data, error: checkError } = await supabase.auth.signInWithPassword({ email: user.email, password: form.current })
      if (checkError) {
        setError(
          checkError.code === 'invalid_credentials'
            ? 'Your current password is incorrect.'
            : isNetworkError(checkError) || isRateLimitError(checkError)
              ? friendlyAuthError(checkError)
              : 'We couldn’t check your current password. Please try again.',
        )
        return
      }
      if (data.user?.id !== user.id) {
        setError('We couldn’t check your current password. Please sign out and in again, then try again.')
        return
      }
      // 2. Save the new password.
      const { error: updateError } = await supabase.auth.updateUser({ password: form.next })
      if (updateError) {
        setError(
          updateError.code === 'reauthentication_needed'
            ? 'For security, please sign out and in again, then change your password.'
            : friendlyAuthError(updateError),
        )
        return
      }
      setForm(EMPTY)
      setDone('Your password has been changed. Use the new password the next time you sign in.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card title="Change password">
      <form onSubmit={handleSubmit}>
        <p className="ds-note" style={{ marginTop: 0 }}>
          For your security you&apos;ll need your current password. You stay signed in on this device.
        </p>
        {error && <Alert tone="danger">{error}</Alert>}
        {done && <Alert tone="success">{done}</Alert>}
        {/* A hidden username helps password managers save the right account. */}
        <input type="email" name="username" autoComplete="username" value={user?.email ?? ''} readOnly hidden />
        <div className="ds-form-grid">
          <Field label="Current password" className="ds-span-2">
            {(p) => (
              <TextInput {...p} type="password" autoComplete="current-password" value={form.current} onChange={(e) => update('current', e.target.value)} required />
            )}
          </Field>
          <Field label="New password" hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
            {(p) => (
              <TextInput
                {...p}
                type="password"
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                value={form.next}
                onChange={(e) => update('next', e.target.value)}
                required
              />
            )}
          </Field>
          <Field label="Confirm new password">
            {(p) => (
              <TextInput {...p} type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => update('confirm', e.target.value)} required />
            )}
          </Field>
        </div>
        <div className="ds-form-actions">
          <Button type="submit" disabled={saving}>
            {saving ? 'Changing…' : 'Change password'}
          </Button>
        </div>
      </form>
    </Card>
  )
}
