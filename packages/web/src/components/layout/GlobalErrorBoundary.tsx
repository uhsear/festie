import { Component, type ErrorInfo, type ReactNode } from 'react';
import * as Sentry from '@sentry/react';
import Button from '../ui/Button';
import { describeError } from './RouteErrorBoundary';

/**
 * Final safety net around the whole tree, so the user never sees a white screen.
 * TanStack Router's per-route `errorComponent` handles most failures. This sits outside
 * the router, so it cannot use router hooks: it shows the classified copy from
 * RouteErrorBoundary and offers Reload only. The raw error message goes to the console
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
    const { icon, heading, description } = describeError(error);
    return (
      <div className="p-8 text-center flex flex-col items-center" role="alert">
        <div className="mb-3">{icon}</div>
        <h1>{heading}</h1>
        <p className="text-[var(--color-text-secondary)] text-sm my-2 mb-4 max-w-[400px]">{description}</p>
        <Button variant="primary" size="sm" type="button" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    );
  }
}
