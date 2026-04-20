import { Component } from 'react'

/**
 * ErrorBoundary — wraps the app and catches render-time errors so a
 * component bug doesn't blank the whole page. Shows a clean fallback with
 * a 'Reload' action. Logs to console for debugging.
 *
 * Usage (in main.jsx):
 *   <ErrorBoundary>
 *     <App />
 *   </ErrorBoundary>
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('ObservationPoint crash:', error, info)
    this.setState({ info })
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-[#f5f7fa] flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl shadow-md max-w-md w-full p-6 text-center">
            <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-3">
              <svg width="28" height="28" fill="none" stroke="#dc2626" strokeWidth="2"><path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" /></svg>
            </div>
            <div className="text-lg font-bold text-gray-900 mb-1">Something went wrong</div>
            <div className="text-sm text-gray-500 mb-5">
              The page hit an error. Reload to try again.
            </div>
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => { this.setState({ error: null, info: null }); window.location.reload() }}
                className="px-5 py-2.5 rounded-xl bg-fls-navy text-white font-semibold text-sm">
                Reload
              </button>
              <a href="/" className="px-5 py-2.5 rounded-xl border border-gray-200 text-gray-700 font-semibold text-sm no-underline">
                Go home
              </a>
            </div>
            {this.state.error?.message && (
              <details className="mt-4 text-left">
                <summary className="text-xs text-gray-400 cursor-pointer">Technical details</summary>
                <pre className="text-[10px] text-gray-500 bg-gray-50 p-2 rounded mt-1 overflow-auto max-h-32">
                  {String(this.state.error.message)}
                </pre>
              </details>
            )}
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
