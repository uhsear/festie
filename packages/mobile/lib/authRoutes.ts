// Guests may browse the schedule, set detail, festival-mode, map, compass,
// find, privacy, and the /cards + /timeline deep-link shims — these stay
// open so cold deep-links and casual browsing work without an account.
// Everything that exposes another user's data or admin surface is gated to
// match the web router's guards: wrap, crew-plan, crew-compare, admin, and
// the account tab. (Web /compare === mobile crew-compare; the segment is
// 'crew-compare', not 'compare'.) The picks and crew tabs show a sign-in
// teaser in place, so they are not gated here. A signed-in non-admin who
// reaches admin is bounced to the tabs, mirroring web bouncing them to /.
export function isGuestBlocked(segments: string[]): boolean {
  return (
    segments[0] === 'wrap' ||
    segments[0] === 'crew-plan' ||
    segments[0] === 'crew-compare' ||
    segments[0] === 'admin' ||
    segments[1] === 'account'
  );
}
