import { Link, useLocation } from 'react-router-dom'
import { Card, EmptyState, PageHeader } from '../components/ui/Primitives'

// Unknown address inside a portal (shown in that portal's shell).
export default function NotFound() {
  const home = `/${useLocation().pathname.split('/')[1] ?? ''}`
  return (
    <>
      <PageHeader title="Page not found" />
      <Card>
        <EmptyState icon="search" title="There's no page at this address">
          <Link to={home}>Go to your home page</Link>
        </EmptyState>
      </Card>
    </>
  )
}
