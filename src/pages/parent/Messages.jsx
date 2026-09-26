import Messaging from '../../components/Messaging'
import { PageHeader } from '../../components/ui/Primitives'

// Parent side of parent-teacher messaging: one conversation per teacher who
// teaches (or taught) one of your children.
export default function Messages() {
  return (
    <>
      <PageHeader
        title="Messages"
        subtitle="Write to your children's teachers. You can message a teacher while they teach one of your children a subject this session; older conversations stay readable."
      />
      <Messaging viewer="parent" />
    </>
  )
}
