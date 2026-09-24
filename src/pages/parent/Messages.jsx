import Messaging from '../../components/Messaging'

// Parent side of parent-teacher messaging: one conversation per teacher who
// teaches (or taught) one of your children.
export default function Messages() {
  return (
    <>
      <h1>Messages</h1>
      <p className="muted">
        Write to your children&apos;s teachers. You can message a teacher while they teach one of your children a subject
        this session; older conversations stay readable.
      </p>
      <Messaging viewer="parent" />
    </>
  )
}
