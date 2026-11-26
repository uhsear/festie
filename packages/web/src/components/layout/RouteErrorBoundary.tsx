import { Component, useEffect, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import ErrorState from './ErrorState';

// ---------------------------------------------------------------------------
// Error classification helpers
// ---------------------------------------------------------------------------

/** Matches the `ApiClientError` shape from `@festie/shared/services/api`. */
interface ApiErrorLike {
  status: number;
  code?: string;
  isNetworkError?: boolean;
}

function isApiError(err: unknown): err is Error & ApiErrorLike {
  return err instanceof Error && typeof (err as unknown as ApiErrorLike).status === 'number';
}

type ErrorKind = 'network' | 'update' | 'not-found' | 'server' | 'generic';

/** A failed lazy route chunk: the browser caches the rejected import, so only a reload can recover. */
function isChunkLoadError(error: Error): boolean {
  return /dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError/i.test(
    `${error.name} ${error.message}`,
  );
}

function classifyError(error: Error): ErrorKind {
  // Before the TypeError branch below: Chromium words a missing chunk as "Failed to fetch ...".
  if (isChunkLoadError(error) && navigator.onLine !== false) return 'update';

  // ApiClientError from shared/services/api
  if (isApiError(error)) {
    if (error.isNetworkError || error.status === 0) return 'network';
    if (error.status === 404) return 'not-found';
    if (error.status >= 500) return 'server';
  }

  // Raw fetch / network failures (no response received)
  if (
    error instanceof TypeError &&
    (error.message.includes('fetch') ||
      error.message.includes('network') ||
      error.message.includes('Failed to fetch') ||
      error.message.includes('NetworkError') ||
      error.message.includes('Load failed'))
  ) {
    return 'network';
  }

  return 'generic';
}

// ---------------------------------------------------------------------------
// Per-kind presentation data
// ---------------------------------------------------------------------------

interface ErrorPresentation {
  heading: string;
  description: string;
}

function presentationFor(kind: ErrorKind, error: Error): ErrorPresentation {
  const errorId = isApiError(error) && error.code ? error.code : undefined;

  switch (kind) {
    case 'network':
      return {
        heading: 'You appear to be offline',
        description: 'Check your connection and try again. Your data is safe; we’ll sync it when you reconnect.',
      };
    case 'update':
      return {
        heading: 'Festie was updated',
        description: 'A new version is available. Reload to continue.',
      };
    case 'not-found':
      return {
        heading: 'Page not found',
        description: 'The page you’re looking for doesn’t exist or may have been moved.',
      };
    case 'server':
      return {
        heading: 'Server error',
        description: errorId
          ? `Our server hit an error (ref: ${errorId}). Try again shortly.`
          : 'Our server hit an error. Try again shortly.',
      };
    case 'generic':
    default:
      return {
        heading: 'Something broke',
        description: 'Reload the page to try again.',
      };
  }
}

/**
 * Classify `error` and return the copy to show for it. Never includes the raw
 * `error.message`, so a boundary can render it without leaking internals.
 */
export function describeError(error: Error): ErrorPresentation & { kind: ErrorKind } {
  const kind = classifyError(error);
  return { kind, ...presentationFor(kind, error) };
}

// ---------------------------------------------------------------------------
// RouteErrorBoundary — functional component for TanStack Router errorComponent
// ---------------------------------------------------------------------------

export interface RouteErrorBoundaryProps {
  error: Error;
  reset: () => void;
  /** Optional per-route message shown below the default description. */
  contextMessage?: string;
}

/**
 * Contextual error fallback for TanStack Router's `errorComponent` prop.
 *
 * Classifies the error (network / 404 / 5xx / generic) and shows the shared
 * ErrorState: mark, heading, one sentence and one action. Routes can pass an
 * optional `contextMessage`, shown inside the same sentence block.
 */
export default function RouteErrorBoundary({ error, reset, contextMessage }: RouteErrorBoundaryProps) {
  const navigate = useNavigate();
  const { kind, heading, description } = describeError(error);

  useEffect(() => {
    console.error('[route error]', error);
  }, [error]);

  const action =
    kind === 'update'
      ? { label: 'Reload', onClick: () => window.location.reload() }
      : kind === 'not-found'
        ? { label: 'Go home', onClick: () => void navigate({ to: '/' }) }
        : { label: 'Retry', onClick: reset };

  return (
    <ErrorState
      heading={heading}
      description={
        <>
          {description}
          {contextMessage && <span className="block mt-1 italic">{contextMessage}</span>}
        </>
      }
      action={action}
    />
  );
}

/**
 * Factory that returns an `errorComponent` with a baked-in context message.
 * Use in individual route definitions:
 *
 * ```ts
 * const crewRoute = new Route({
 *   errorComponent: withContextMessage('Could not load your crew.'),
 *   ...
 * });
 * ```
 */
export function withContextMessage(contextMessage: string): (props: { error: Error; reset: () => void }) => ReactNode {
  return function ContextualErrorBoundary({ error, reset }) {
    return <RouteErrorBoundary error={error} reset={reset} contextMessage={contextMessage} />;
  };
}

/**
 * Class-based React error boundary for wrapping route component JSX.
 * Unlike the functional RouteErrorBoundary above (which is for TanStack
 * Router's `errorComponent` prop), this catches render-time throws from
 * child components and shows an inline recovery card.
 *
 * Usage: <RenderErrorBoundary name="timeline">...</RenderErrorBoundary>
 */
export class RenderErrorBoundary extends Component<{ children: ReactNode; name: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[${this.props.name}] render failed:`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorState
          heading="This view failed to load"
          description="Try again to reload this view."
          action={{ label: 'Try again', onClick: () => this.setState({ error: null }) }}
          aria-label={`${this.props.name} view error`}
        />
      );
    }
    return this.props.children;
  }
}
