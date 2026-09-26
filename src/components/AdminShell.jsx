import AppShell from './AppShell'

// The admin portal's frame: the shared AppShell with the admin links
// (lib/adminNav.js). Kept as its own component for the dev previews.
export default function AdminShell(props) {
  return <AppShell role="admin" {...props} />
}
