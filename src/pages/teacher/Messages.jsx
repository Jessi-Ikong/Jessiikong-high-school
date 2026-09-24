import Messaging from '../../components/Messaging'

// Teacher side of parent-teacher messaging: one conversation per parent.
export default function Messages() {
  return (
    <>
      <h1>Messages</h1>
      <p className="muted">
        Conversations with parents of the students you teach. You can message a parent while you teach one of their
        children a subject this session; older conversations stay readable.
      </p>
      <Messaging viewer="teacher" />
    </>
  )
}
