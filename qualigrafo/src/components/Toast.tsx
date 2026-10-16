import { useStore } from '../store'

export function Toast() {
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={`toastmsg ${t.tone}`}>{t.text}</div>)}
    </div>
  )
}
