// Turns Supabase Auth errors into plain language for users.
// Never show error.message directly: it can leak internals.

export function isNetworkError(error) {
  return error?.name === 'AuthRetryableFetchError' || error?.status === 0
}

export function isRateLimitError(error) {
  return (
    error?.status === 429 ||
    error?.code === 'over_request_rate_limit' ||
    error?.code === 'over_email_send_rate_limit'
  )
}

export function friendlyAuthError(error) {
  if (!error) return null
  if (isNetworkError(error)) {
    return "We couldn't reach the server. Check your internet connection and try again."
  }
  if (isRateLimitError(error)) {
    return 'Too many attempts. Please wait a few minutes and try again.'
  }
  if (error.name === 'AuthSessionMissingError') {
    return 'Your link has expired. Please request a new one.'
  }

  switch (error.code) {
    case 'invalid_credentials':
      return 'Incorrect email or password.'
    case 'email_not_confirmed':
      return 'Your account is not activated yet. Open the invitation email from the school and set your password first.'
    case 'user_banned':
      return 'This account has been suspended. Please contact the school office.'
    case 'weak_password':
      return 'That password is too weak. Use at least 8 characters with a mix of letters and numbers.'
    case 'same_password':
      return 'Your new password must be different from your current password.'
    case 'session_not_found':
    case 'session_expired':
    case 'reauthentication_needed':
      return 'Your link has expired. Please request a new one.'
    default:
      return 'Something went wrong. Please try again.'
  }
}

// Errors carried in an invite / reset link (see authLinkError in supabaseClient.js).
export function friendlyLinkError(linkError) {
  if (!linkError) return null
  if (linkError.code === 'otp_expired') {
    return 'This link has expired or has already been used.'
  }
  return 'This link is not valid.'
}

// Why a signed-in user has no usable profile (set by AuthProvider).
export const PROFILE_ERRORS = {
  no_profile: 'no_profile', // auth account exists but no row in public.users
  inactive: 'inactive', // users.is_active = false
  load_failed: 'load_failed', // network / database error
}

export const PROFILE_ERROR_MESSAGES = {
  [PROFILE_ERRORS.no_profile]:
    "Your login works, but your school account hasn't been set up yet. Please contact the school office.",
  [PROFILE_ERRORS.inactive]: 'Your account has been deactivated. Please contact the school office.',
  [PROFILE_ERRORS.load_failed]: "We couldn't load your account details. Please try again in a moment.",
}
