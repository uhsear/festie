# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Groups of friends who go to a multi-day music festival together, from a pair to a crew of up to 30.

The primary scene is the festival day itself. The user holds a phone in one hand, in bright sun or a dark crowd, often with patchy signal and a draining battery. They glance at the app between sets to see what is on now, where their crew is, and where to meet. The web app serves this scene as an installable PWA on phones.

The secondary scene is planning before the festival. The user builds picks from the lineup at home, often on a laptop, and compares them with the crew.

## Product Purpose

Festie lets a crew plan which sets to see, see where their plans collide and where they line up, and stay coordinated on the day. Success means nobody misses a set they marked `must`, the crew finds each other, and shared costs settle without a spreadsheet.

## Positioning

Festie is crew-first. Each user keeps a personal per-festival profile of picks, and Festie computes two different things from them: a **conflict**, where two of one user's own picks overlap in time, and an **overlap**, where several crew members picked the same set. Meeting points, home base, live location, polls and split expenses sit beside the schedule in the same app.

## Operating Context

- Day-of use dominates: short glances, one-handed, outdoors, loud, with unreliable connectivity. Festival Mode is the live day-of view.
- Writes made offline are queued and replayed on reconnect. The UI must say honestly what is pending, what succeeded and what failed. Nothing is dropped silently.
- Real-time updates arrive over Socket.IO, scoped to a festival.
- Push reminders fire before picked sets.
- Planning uses seven schedule views: Grid, Timeline, Cards, Picks, Compare, Festival Mode and Wrap. Wrap is the post-festival summary.
- Maps show stages and meeting points (MapLibre GL over PMTiles).
- Schedules can be exported as images.

## Capabilities and Constraints

- Terminology is binding; see `CONTEXT.md`. Use Festival, Stage, Set, Artist, Day, Pick, Priority, Note, Reminder, Rating, Conflict, Crew, Invite Code, Overlap, Home Base and Meeting Point, and avoid the listed synonyms.
- Priorities are `must`, `want-to-see` and `maybe`, in that order of importance.
- A Day can run past midnight: sets before 6 AM belong to the previous day.
- A crew has an owner, a member cap (default 30) and an invite code that expires after 7 days.
- Business logic lives in `@festie/shared` so that web and mobile behave the same. Design tokens also live there as the TypeScript source of truth.
- The web app is a React 19 + Vite + TanStack Router SPA and a PWA, served by the backend.
- Web deploys are owner-run.

## Brand Commitments

- The name is Festie, live at festie.us.
- The 2026-09-24 brand refresh (PR #41) is binding: the new logo across web, mobile and the Play listing.
- Design decisions locked on 2026-06-14 stay decided. They are recorded in `.claude/skills/festie-advancement-roadmap` §3 and carried into DESIGN.md.

## Evidence on Hand

- Real festival data is live in production, for example EDC Orlando 2026 with 105 sets.
- No testimonials, user counts, press, ratings or revenue figures exist. Never invent them.

## Product Principles

1. **Glanceable first.** The day-of question ("what now, where is my crew, where do we meet") must be answerable in one glance with one hand.
2. **The crew is the unit.** Individual plans exist to be compared and coordinated, not to sit alone.
3. **Never lose a write, and never lie about one.** Offline and sync states are visible and truthful.
4. **One product on every surface.** Web and mobile share logic and terminology; differences are deliberate, not drift.

## Accessibility & Inclusion

- WCAG 2.2 AA on every screen: 4.5:1 text contrast, 3:1 for UI components, visible focus, screen-reader labels, and 44 px minimum touch targets.
- Respect `prefers-reduced-motion`.
- Outdoor glare and dark crowds make contrast a usability requirement, not only a compliance one.
