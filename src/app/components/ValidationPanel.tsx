type Props = { messages: string[] }

export function ValidationPanel({ messages }: Props) {
  if (messages.length === 0)
    return (
      <aside className="validation valid" aria-live="polite">
        Schema checks are clean.
      </aside>
    )
  return (
    <aside className="validation invalid" aria-live="polite">
      <h3>Validation</h3>
      <ul>
        {messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </aside>
  )
}
