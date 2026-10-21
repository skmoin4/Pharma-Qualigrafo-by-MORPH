import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

/** Keeps one broken view from blanking the whole application; the rest of the shell stays usable. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('View crashed:', error, info.componentStack)
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="card" role="alert" style={{ maxWidth: 640 }}>
        <h2 style={{ marginTop: 0 }}>This page could not be displayed</h2>
        <p className="muted">An unexpected error occurred. Your data is safe on the server. Reload the page; if it happens again, tell your administrator what you were doing.</p>
        <p className="muted small" style={{ wordBreak: 'break-word' }}>{this.state.error.message}</p>
        <button className="btn pri" onClick={() => window.location.reload()}>Reload</button>
      </div>
    )
  }
}
