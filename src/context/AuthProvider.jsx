import { AuthContext } from './AuthContext'

// Placeholder: no one is signed in yet. Supabase session + role lookup
// will be wired in here once the auth task is built.
export default function AuthProvider({ children }) {
  const value = { user: null, role: null, loading: false }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
