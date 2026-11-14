import React from 'react';

/**
 * Where render crashes are sent, if anywhere. Unset (the default) reports
 * nothing. Set VITE_ERROR_REPORT_URL to an endpoint you operate (or a Sentry
 * tunnel) to receive a small JSON body; no user identifiers are included.
 */
const REPORT_URL = import.meta.env.VITE_ERROR_REPORT_URL as string | undefined;

export function reportClientError(error: unknown, componentStack?: string | null): void {
  if (!REPORT_URL) return;
  try {
    const body = JSON.stringify({
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? (error.stack ?? '').slice(0, 4000) : undefined,
      componentStack: (componentStack ?? '').slice(0, 2000),
      // Path only: a query string can carry a share token.
      path: window.location.pathname,
      userAgent: navigator.userAgent,
      at: new Date().toISOString(),
    });
    if (navigator.sendBeacon) navigator.sendBeacon(REPORT_URL, new Blob([body], { type: 'application/json' }));
    else void fetch(REPORT_URL, { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true });
  } catch {
    // Reporting must never be the second failure.
  }
}

interface State {
  failed: boolean;
}

/**
 * The last line of defence. Without it a render error leaves a white page, and
 * this is an app people open when they are stranded: the fallback keeps the
 * emergency number and a way back in reach.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary]', error);
    reportClientError(error, info.componentStack);
  }

  render(): React.ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main role="alert" className="min-h-screen flex items-center justify-center px-4 bg-white">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-2xl font-bold text-ink">Something went wrong on this page</h1>
          <p className="text-ink-soft">
            Your request, if you made one, is not affected. Reload to continue. In an emergency, call 112.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="min-h-[48px] px-5 rounded-control bg-brand-700 text-white font-semibold"
            >
              Reload
            </button>
            <a href="tel:112" className="min-h-[48px] px-5 inline-flex items-center rounded-control border border-line font-semibold text-ink">
              Call 112
            </a>
          </div>
        </div>
      </main>
    );
  }
}
