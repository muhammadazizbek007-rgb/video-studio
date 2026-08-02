import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  isChunkError: boolean;
}

const CHUNK_RELOAD_KEY = 'vs.chunk-reload';
const CHUNK_ERROR_PATTERN =
  /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError/i;

function isChunkLoadError(error: Error): boolean {
  return CHUNK_ERROR_PATTERN.test(error.message ?? '');
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, isChunkError: false };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error, isChunkError: isChunkLoadError(error) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // A stale index.html pointing at a hash that no longer exists is fixed by one reload;
    // the session flag keeps that from turning into a reload loop.
    if (isChunkLoadError(error) && !sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
      sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
      window.location.reload();
      return;
    }
    console.error('[error-boundary]', error, info.componentStack);
  }

  private readonly handleReload = (): void => {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    window.location.reload();
  };

  override render(): ReactNode {
    const { error, isChunkError } = this.state;
    if (!error) return this.props.children;

    const title = isChunkError ? 'Обновление приложения' : 'Что-то пошло не так';
    const detail = isChunkError ? 'Загружается новая версия…' : error.message;
    const action = isChunkError ? 'Обновить сейчас' : 'Перезагрузить страницу';

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6 dark:bg-slate-950">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-lg dark:bg-slate-900">
          <h1 className="mb-2 text-xl font-semibold text-slate-900 dark:text-slate-50">{title}</h1>
          <p className="mb-6 text-sm break-words text-slate-500 dark:text-slate-400">{detail}</p>
          <button
            type="button"
            onClick={this.handleReload}
            className="rounded-xl bg-slate-900 px-6 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            {action}
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
