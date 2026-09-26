import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

// className: lets a layout style it (defaults to a secondary button).
export default function SignOutButton({ className = 'ds-btn ds-btn-secondary' }) {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  async function handleClick() {
    setBusy(true)
    await signOut()
    navigate('/login', { replace: true, state: { message: 'You have been logged out.' } })
  }

  return (
    <button type="button" className={className} onClick={handleClick} disabled={busy}>
      {busy ? 'Logging out…' : 'Log out'}
    </button>
  )
}
