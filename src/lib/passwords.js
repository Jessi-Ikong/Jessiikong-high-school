// Password rules shared by "Set your password" (invite / reset links) and
// "Change password" (My Profile). Supabase also enforces its own minimum.
export const MIN_PASSWORD_LENGTH = 8

// The problem with a new password + its confirmation, or null if it's fine.
export function newPasswordProblem(password, confirm) {
  if (password.length < MIN_PASSWORD_LENGTH) return `Your password must be at least ${MIN_PASSWORD_LENGTH} characters long.`
  if (password !== confirm) return 'The two passwords do not match.'
  return null
}
