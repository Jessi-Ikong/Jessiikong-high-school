export const ROLES = {
  ADMIN: 'admin',
  TEACHER: 'teacher',
  STUDENT: 'student',
  PARENT: 'parent',
}

// Where each role lands after signing in.
export const ROLE_HOME = {
  [ROLES.ADMIN]: '/admin',
  [ROLES.TEACHER]: '/teacher',
  [ROLES.STUDENT]: '/student',
  [ROLES.PARENT]: '/parent',
}
