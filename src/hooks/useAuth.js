import { createContext, useContext } from 'react'

// Provided by <AuthProvider> in src/context/AuthContext.jsx.
export const AuthContext = createContext(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
