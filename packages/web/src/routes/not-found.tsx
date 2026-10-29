import { Link } from '@tanstack/react-router';
import { Compass } from 'lucide-react';

/** Rendered for unknown URLs. SubHeader hides itself on unknown paths, so no schedule controls sit above this. */
export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-12 text-center min-h-[320px]" data-testid="not-found">
      <Compass className="w-12 h-12 text-text-muted" aria-hidden="true" />
      <h1 className="type-heading text-text-primary">Page not found</h1>
      <p className="text-[length:var(--font-size-14)] text-text-secondary max-w-[320px]">
        That link does not match anything in Festie. It may have moved, or the address has a typo.
      </p>
      <Link
        to="/"
        className="inline-flex items-center justify-center min-h-11 min-w-11 px-6 rounded-lg bg-accent-aqua text-[var(--text-on-light-accent)] text-[length:var(--font-size-14)] font-semibold no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua"
      >
        Back to the schedule
      </Link>
    </div>
  );
}
