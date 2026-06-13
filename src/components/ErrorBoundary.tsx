import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  isChunkError: boolean;
}

function isChunkLoadError(error: Error): boolean {
  return /Failed to fetch dynamically imported module|Loading chunk|ChunkLoadError/i.test(error.message ?? '');
}

function AlertCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </svg>
  );
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    isChunkError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, isChunkError: isChunkLoadError(error) };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (isChunkLoadError(error)) {
      const reloadKey = 'gp-chunk-reload';
      if (!sessionStorage.getItem(reloadKey)) {
        sessionStorage.setItem(reloadKey, '1');
        window.location.reload();
        return;
      }
    }
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      if (this.state.isChunkError) {
        return (
          <div className="min-h-screen bg-[#0F172A] flex items-center justify-center p-6">
            <div className="bg-[#111827] border border-blue-500/20 p-8 rounded-2xl max-w-md w-full text-center">
              <div className="w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
              </div>
              <h2 className="text-xl font-bold text-white mb-2">Обновление приложения</h2>
              <p className="text-blue-400 text-sm mb-6">Загружается новая версия...</p>
              <button
                onClick={() => { sessionStorage.removeItem('gp-chunk-reload'); window.location.reload(); }}
                className="px-6 py-2 bg-blue-500 hover:bg-blue-400 text-white rounded-xl font-bold transition-all"
              >
                Обновить сейчас
              </button>
            </div>
          </div>
        );
      }

      return (
        <div className="min-h-screen bg-[#0F172A] flex items-center justify-center p-6">
          <div className="bg-[#111827] border border-red-500/20 p-8 rounded-2xl max-w-md w-full text-center">
            <AlertCircleIcon className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Something went wrong</h2>
            <p className="text-red-400 text-sm mb-6">{this.state.error?.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-red-500 hover:bg-red-400 text-white rounded-xl font-bold transition-all"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
