import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export default function SignOutButton() {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  async function handleClick() {
    setBusy(true)
    await signOut()
    navigate('/login', { replace: true, state: { message: 'You have been logged out.' } })
  }

  return (
    <button type="button" className="button-secondary" onClick={handleClick} disabled={busy}>
      {busy ? 'Logging out…' : 'Log out'}
    </button>
  )
}
