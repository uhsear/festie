import EmptyState, { type EmptyStateProps } from './EmptyState';

/**
 * The one "couldn't load" / offline block: the shared offline illustration over an EmptyState.
 * Pass `action` for the retry. Every screen's load error goes through here so the art, spacing and
 * large-text fallback stay in one place.
 */
export default function LoadErrorState(props: Omit<EmptyStateProps, 'icon' | 'illustration'>) {
  return <EmptyState {...props} illustration="offline" />;
}
