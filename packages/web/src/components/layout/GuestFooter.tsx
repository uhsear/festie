import { GUEST_LEGAL_COPY } from '@festie/shared/constants';
import { cn } from '../../lib/utils';

const linkClass = cn(
  'inline-flex min-h-11 items-center px-2 text-xs text-text-muted underline underline-offset-2',
  'hover:text-text-primary rounded-sm',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua',
);

/** Privacy, Terms and Help for signed-out visitors. Sits in the page flow, so it never overlays the tab bar or SOS. */
export default function GuestFooter() {
  const { ariaLabel, privacy, terms, help, privacyPath, termsPath, helpHref } = GUEST_LEGAL_COPY;
  return (
    <footer aria-label={ariaLabel} className="shrink-0 flex flex-wrap items-center justify-center py-4" data-guest-footer>
      <a href={privacyPath} target="_blank" rel="noopener noreferrer" className={linkClass}>
        {privacy}
      </a>
      <span aria-hidden="true" className="text-xs text-text-muted">·</span>
      <a href={termsPath} target="_blank" rel="noopener noreferrer" className={linkClass}>
        {terms}
      </a>
      <span aria-hidden="true" className="text-xs text-text-muted">·</span>
      <a href={helpHref} className={linkClass}>
        {help}
      </a>
    </footer>
  );
}
