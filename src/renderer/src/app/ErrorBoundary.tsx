import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Последний рубеж renderer: без него любое исключение в фазе рендера (например, недописанное
 * регулярное выражение в мастере импорта) размонтировало всё дерево, и окно становилось
 * белым — без единого сообщения и без способа вернуться, кроме перезапуска приложения.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Необработанная ошибка интерфейса', error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="card" style={{ margin: 24, maxWidth: 720 }}>
        <h2>Что-то пошло не так</h2>
        <p>Раздел не удалось отобразить. Данные в базе не пострадали — можно вернуться и продолжить работу.</p>
        <pre className="history-empty" style={{ whiteSpace: 'pre-wrap' }}>
          {error.message}
        </pre>
        <div className="dialog-actions">
          <button type="button" className="btn btn-primary" onClick={() => this.setState({ error: null })}>
            Вернуться
          </button>
          <button type="button" className="btn" onClick={() => window.location.reload()}>
            Перезагрузить окно
          </button>
        </div>
      </div>
    )
  }
}
