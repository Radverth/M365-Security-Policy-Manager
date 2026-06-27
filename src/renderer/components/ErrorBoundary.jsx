import React from 'react'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const label = this.props.label || 'This section'

    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[300px] p-8 text-center">
        <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mb-4">
          <svg className="w-7 h-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>
        <h2 className="text-base font-semibold text-gray-900 mb-1">{label} encountered an error</h2>
        <p className="text-sm text-gray-500 mb-1 max-w-sm leading-relaxed">
          Something went wrong rendering this page. The rest of the app is unaffected.
        </p>
        <p className="text-xs font-mono text-red-600 bg-red-50 border border-red-100 rounded px-3 py-2 mb-5 max-w-md break-all">
          {error.message}
        </p>
        <button
          onClick={() => this.setState({ error: null })}
          className="px-4 py-2 rounded-lg bg-navy text-white text-sm font-medium hover:bg-navy/90 transition-colors"
        >
          Try again
        </button>
      </div>
    )
  }
}
