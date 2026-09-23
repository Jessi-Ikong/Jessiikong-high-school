import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { AuthContext } from '../hooks/useAuth'
import { PROFILE_ERRORS } from '../lib/authErrors'

const PROFILE_COLUMNS = 'id, role, admin_level, first_name, last_name, email, photo_url, is_active'

export default function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [sessionChecked, setSessionChecked] = useState(false)
  // Tagged with the auth user it was loaded for, so a profile is never
  // shown for the wrong user while a new one is loading.
  const [profileState, setProfileState] = useState({ authId: null, profile: null, error: null })

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setSessionChecked(true)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      // Keep this callback synchronous: awaiting other Supabase calls inside
      // it can deadlock the client. The profile is fetched in the effect below.
      setSession(newSession)
      setSessionChecked(true)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const authId = session?.user?.id ?? null

  useEffect(() => {
    if (!authId) return
    let active = true

    supabase
      .from('users')
      .select(PROFILE_COLUMNS)
      .eq('auth_id', authId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return
        let profileError = null
        if (error) profileError = PROFILE_ERRORS.load_failed
        else if (!data) profileError = PROFILE_ERRORS.no_profile
        else if (!data.is_active) profileError = PROFILE_ERRORS.inactive
        setProfileState({ authId, profile: profileError ? null : data, error: profileError })
      })

    return () => {
      active = false
    }
  }, [authId])

  const profileLoaded = authId !== null && profileState.authId === authId
  const loading = !sessionChecked || (authId !== null && !profileLoaded)

  const signOut = useCallback(async () => {
    // Clears the local session even if the network call fails.
    await supabase.auth.signOut()
  }, [])

  const value = useMemo(
    () => ({
      user: session?.user ?? null,
      profile: profileLoaded ? profileState.profile : null,
      // Why the signed-in user can't use the app (no profile / deactivated /
      // failed to load). Kept after sign-out so the login page can explain it.
      profileError: profileLoaded || authId === null ? profileState.error : null,
      loading,
      signOut,
    }),
    [session, authId, profileLoaded, profileState, loading, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
