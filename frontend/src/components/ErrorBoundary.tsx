import { Component, type ReactNode } from 'react'

/** Keeps one broken view from blanking the whole app; offers a retry. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    console.error('[wfm] view crashed', error)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="state" role="alert">
        Something went wrong showing this view.{' '}
        <button className="ghost" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    )
  }
}
