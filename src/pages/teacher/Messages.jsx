import Messaging from '../../components/Messaging'
import { PageHeader } from '../../components/ui/Primitives'

// Teacher side of parent-teacher messaging: one conversation per parent.
export default function Messages() {
  return (
    <>
      <PageHeader
        title="Messages"
        subtitle="Conversations with parents of the students you teach. You can message a parent while you teach one of their children a subject this session; older conversations stay readable."
      />
      <Messaging viewer="teacher" />
    </>
  )
}
