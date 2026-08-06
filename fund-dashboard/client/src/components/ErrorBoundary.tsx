// React ErrorBoundary：捕获子组件渲染错误，显示降级 UI 而非整页崩溃
import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('[ErrorBoundary] caught:', error.message, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div style={{ padding: '20px', textAlign: 'center', color: '#888', fontSize: '13px' }}>
            图表渲染异常，请刷新页面或切换区间重试
            <br />
            <button
              onClick={() => this.setState({ hasError: false })}
              style={{ marginTop: '8px', padding: '4px 12px', cursor: 'pointer' }}
            >
              重试
            </button>
          </div>
        )
      )
    }
    return this.props.children
  }
}
