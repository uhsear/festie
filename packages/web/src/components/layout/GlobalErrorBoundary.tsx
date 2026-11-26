import { Component, type ErrorInfo, type ReactNode } from 'react';
import * as Sentry from '@sentry/react';
import ErrorState from './ErrorState';
import { describeError } from './RouteErrorBoundary';

/**
 * Final safety net around the whole tree, so the user never sees a white screen.
 * TanStack Router's per-route `errorComponent` handles most failures. This sits outside
 * the router, so it cannot use router hooks: it shows the classified copy from
 * RouteErrorBoundary in the shared ErrorState and offers Reload only. The raw error message goes to the console
 * and Sentry, never to the screen.
 */
export default class GlobalErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled error:', error, info);
    Sentry.captureException(error, { contexts: { react: { componentStack: info.componentStack } } });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { heading, description } = describeError(error);
    return (
      <ErrorState
        heading={heading}
        description={description}
        action={{ label: 'Reload', onClick: () => window.location.reload() }}
        headingLevel={1}
      />
    );
  }
}
