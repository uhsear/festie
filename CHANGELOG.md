# Changelog

All notable changes to Festie are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Merged to `main` but not yet deployed to production.

### Added
- Design tokens for colour, type, motion and spacing, with drift guards in CI so web and mobile cannot stray from them.
- A brand guide, and a fictional demo festival for store screenshots.

### Changed
- The server-rendered pages, email and the shared primitives use the new brand tokens, and the email header uses the new lockup.
- Share posters (Wrap, crew Wrap, schedule), link previews and notifications use the brand. Posters have one dominant object, a time column and one festival-colour band that falls back to the stage colour when it would read as danger or as the accent. The Wrap push uses the Festival Wrap name.
- The Now & Next widget and Live Activity show one lead object per state.
- SOS is one press-and-hold control on web and mobile, and the incoming SOS banner floats over the page instead of pushing it down. Keyboard and screen-reader users open the same confirm without the hold.
- The donation pill and the shrinking header are gone; support stays under Account help. The connection dot shows only when offline.

## [2026-11-24] deploy-20261124-025224

This deploy carried the 11-21 to 11-24 work: the full UI sweep and pre-deploy device test fixes, the offline map, legal compliance code and the legal page dates. It ran migrations 121 to 123.

### Added
- **Offline map**: self-hosted PMTiles archives for true offline festival maps, with no 24 MiB limit and range reads. The app checks free space before saving a map and recovers a map whose first load failed.
- **Admin**: an Artist review tab. Import a JSON batch of researched link, merge and rename proposals, then approve or reject each one. An approval uses the same edit and merge code as the Artists tab.
- A public `/delete-account` page explains how to delete an account, for the App Store and Google Play. A DMCA page joins the legal pages, and the Privacy and Terms pages carry effective dates. Signed-out visitors see links to Privacy, Terms and Help.
- Every marketing email carries a signed one-click unsubscribe link (`List-Unsubscribe` and `List-Unsubscribe-Post`). These emails are not sent while `EMAIL_POSTAL_ADDRESS` is unset.
- The Spotify logo and a link to the artist's Spotify page show next to Spotify photos and genres, on web and mobile. Stored Spotify photos and genres are re-read after 30 days (`scripts/spotify-refresh-stale.ts`, admin route `POST /api/v1/admin/artists/spotify-refresh-stale`, migration 122).
- **Mobile**: the theme follows the OS when Match system is chosen.
- Email confirmation by button, guest export of picks, My day filters, and a warning that shows what leaving or removing a crew member forgives before it happens.
- Deploys are smoke-checked, and Sentry releases and source maps are wired in.

### Changed
- `GET /profiles/:festivalId` lists only your own profile and the profiles of people who share a crew with you for that festival. Other attendees are not in that list; their picks show only as the anonymous per-set counts in `meta.pickCounts`. The socket events `presence:update`, `profile:created` and `profile:identity` follow the same rule: you receive them only for yourself and your crew mates, not for the whole festival room.
- A set reminder due in quiet hours now lands in the inbox without a push, once.
- Announcements, schedule-change alerts, crew pick updates and re-engagement messages write their inbox rows even when no push provider is configured.
- Login failures are counted per account and IP, and a reused refresh token revokes its whole family.
- Log retention is 14 days across log rotation and log cleanup.
- Space Grotesk is self-hosted on web; no page loads fonts from Google any more.
- Pending organization invitations expire after 90 days and are deleted after 120, so an owner still sees them as expired in between.
- On-host database dumps are GPG-encrypted with `BACKUP_GPG_PASSPHRASE`, and nothing in the backup directory outlives 13 weeks. `backup-pg.sh` refuses to run without the passphrase.
- The accepted Terms version comes from one `TOS_VERSION` constant, and the legal pages match the code.
- Festival profiles are paged in SQL, and page parameters are parsed with Zod.
- The artists-per-set limit is 8.
- The artist sheet opens from every artist name on web and mobile. The schedule shows its real age when a cached response is served.
- The first-run intro reads well with VoiceOver and TalkBack, content stays visible with animations off, and input contrast and touch targets are larger.

### Fixed
- Sweep and pre-deploy test fixes across sign-in and account, lineup, grid and artist sheet, picks, plan sharing, ratings and Wrap, crew real-time updates, crew Plan, Money and compare, map and offline, admin and organizer, inbox, public pages, accessibility and Android and iOS device issues.
- Unannounced artist names no longer cross organizations through a shared creator.
- The crew's festival is selected after sign-in when none is selected.
- Email delivery, unsubscribe and calendar issues from the email sweep.
- The push budget check is atomic per user, and Redis presence entries stay alive while a user is online.
- Role grants and revokes reach every worker through the cache bus.
- A bulk add undo keeps picks that were changed by hand, and guest picks merge per set on rehydrate.
- Local reminder titles show `1h 30m` instead of `2h`.
- API input, log, rating and Sentry hardening from the security sweep.

## [2026-11-21] deploy-20261121-112919

Gap batches 1 to 10 and the organizer platform. It ran migrations 108 to 110.

### Added
- **Organizer platform**: organizations, a `/manage` area, review and held alerts.
- Web and mobile parity gaps are closed, and festival editions are grouped by series.
- Web shows a reload message when the app fails to boot, and explains crew-tab load failures.
- Avatars are backed up, and restored dumps are boot-checked.

### Changed
- Ratings, Wrap, lifetime and expense views run through shared code on web and mobile.
- Input contrast and touch targets are larger, and more routes are audited with Lighthouse.
- The deprecated Button aliases are gone.

### Fixed
- Time-zone and after-midnight ordering in exports, polls and reminders.
- Deleting a provider-only account works, and the password meter and account copy are shared.

## [2026-11-20] deploy-20261120-172533

Artist sheet and photo fill.

### Added
- Photos and genres of linked artists are filled from Spotify.
- Attendees open announced artists and mark interest on mobile.

### Fixed
- Replacing an artist's Spotify link drops its old Spotify photo and genres.

## [2026-11-20] deploy-20261120-124118

### Added
- An anonymous web load smoke test runs every 30 minutes.

### Changed
- Ops scripts take the server user, hosts and backup repo from the environment.
- `lib/schemas.ts` is split into per-domain modules.

### Fixed
- Lifetime stats no longer run concurrent queries on one database client.
- The Android CI version code offset sits above the last published code.

## [2026-11-20] deploy-20261120-115031

Hotfix for an 11-hour web outage where the app stayed on "Loading Festie...".

### Fixed
- Motion's internal packages stay in the same chunk as the animation library, so the web app boots again.
- The metrics listener port is read from `METRICS_PORT`.

## [2026-11-20] deploy-20261120-085335

### Changed
- The default festival room capacity is 2000.
- Every socket failure carries an error and a stable code, and poll, status and meeting-point events carry `crewId`.
- Live-location socket cap, expiry and rate limits are enforced, and session revokes reach every socket, not only local ones.
- Email dedupe and per-email limiters moved to Redis, and migration runs are keyed per pool.
- Retention cleanup purges notification log rows and orphan crew rows.
- Artist search, deleted-user email lookup and per-user audit list use indexes.
- Internal typing, store and wiring cleanups across the backend.

### Fixed
- Hard-deleting a user keeps the expenses that user paid.

## [2026-11-20] deploy-20261120-001221

Security hotfix and the tech-debt train. It ran migrations 113, 114 and 118.

### Security
- Password sign-in is rejected for accounts that have no password hash.
- Idempotency keys are scoped by method and path, rate-limit entries evict by least recent use, and rotated tokens share a per-IP global cap.
- Session revoke and user update are single atomic statements, and socket handshake tokens are validated in middleware.

### Added
- An admin-only, idempotent policy-notice email sender.
- A staging build profile for the staging update channel.

### Changed
- The offline queue expires after 7 days, queued temporary ids are remapped in bodies and URLs, and the web offline queue uses a shared registry.
- Realtime sync, crew helpers and offline-queue classification are shared between web and mobile.
- Reminder dedup is seeded from the notification log so a restart cannot re-send, and notification rows are once per event.
- Artist lookups use indexes, and artist sync and merge updates are batched.
- Deploys install with `npm ci`, take a lock and require a CI-green ref.
- Health monitors have one role each, and `/ready` returns an error envelope on 503.
- Dependency upgrades: Sentry on web to 11, motion to 14.13, and patched transitive advisories.

### Fixed
- Presence teardown and email send failures are logged instead of swallowed.
- A crew hard delete skips soft-deleted members when it picks a new owner.
- Expired device tokens are purged, and live-location cleanup runs when the server forces a disconnect.
- The terms minimum age matches the enforced 18+ check.

## [2026-11-19]

This entry summarises the work shipped to production between 2026-11-17 and 2026-11-19. The mobile app is at 1.5.0 (the `packages/mobile/package.json` version now matches `app.json`).

### Added
- **Announced lineups**: storage, web admin, public festival page and mobile home and grid, with interest marks, follow-loop alerts, data-quality warnings in the publish checklist, and per-date release of set times.
- **Artist identity**: an artists table with a name key, one place to edit artists everywhere, Spotify candidate picking, duplicate merge, and an admin backfill endpoint and panel.
- **Lineup tools**: CSV round trip, Copy to day, Matches set, a cancel alert, and lineup import upgrades for announced rows, artist matching and day moves.
- **Series**: a festival series id and series picker.
- **Offline**: pick writes are sent as deltas, and edge 5xx responses queue the write.
- **Operations**: hardened backups with a weekly restore drill, per-kind alerts, and a festival hourly backup.

### Changed
- Boot migrations retry on refused connections, and a dump is taken before each deploy.

### Fixed
- Draft festivals no longer leak through weather, crews, invite preview or locate-set.

## [3.0.0] - 2026-11-10

Entries below this one describe the earlier JavaScript layout (`server.js`, `lib/*.js`). The backend is now TypeScript, bundled with esbuild into `dist/server.js` for production, and the mobile app runs on Expo SDK 58. This entry summarises the work from 2026-10-29 to 2026-11-10.

### Added
- **Crews**: polls with auto-close and nudges, an activity feed, invite lock, Plan B home base, meet-up edits, day-by-day attendance, and a find-your-crew view with compass, nudge and low-battery alerts.
- **Map**: a field map with an offline basemap, a festival site-plan overlay, background live location sharing, honest compass directions, and clear messages when a location fix is far from the festival.
- **Schedule**: a day grid that fits one festival day on one image, lock-screen and poster images for picks, the full lineup, stages and crew, friend-pick views, moved-set marks and shift alerts, and a "caught" checklist with a most-seen list.
- **Sharing and discovery**: a public festival page, an opt-in public schedule, festival announcements, and following festivals.
- **Accounts**: Sign in with Google and Apple, a notification inbox with a push budget, and a view of your own data.
- **Try first**: guests can pick sets before signing up and keep their place when they become members.
- **Admin**: festival drafts, publish, archive and restore, a lineup import wizard with undo and B2B editing, audit search, and pick insight per festival without user ids.
- **Privacy**: a published privacy policy and a daily retention cleanup.

### Changed
- Web and mobile share one set of toast, dialog, button and empty-state components, and one wording for each concept.
- Festival times follow the festival's own time zone and the 6 AM rule.
- Backend CI runs as four parallel shards, with new gates for public-text leaks, docs drift, bundle growth and accessibility regressions.
- Production runs the esbuild bundle `dist/server.js`; local development still runs `tsx`.

### Fixed
- Picks, notes and reminders no longer get lost, and offline edits are queued per change so a second edit is not dropped.
- SOS and meet-ups are more reliable across the crew, including on weak signal.
- Invite links, sign-in and recovery flows no longer dead-end.
- Many layout, text-clipping and accessibility problems across web and mobile, including large text sizes, TalkBack, voice control and focus handling.
- Rate limits for sign-in, registration and password reset are keyed by IP plus account, and `?token=` values are kept out of error reports.

## [1.10.2] - 2026-03-22

### Changed
- **Server modularization (Phase 3)**: Extracted 5 focused modules from server.js monolith, reducing it from 2,662 to 2,154 lines (-19%)
  - `lib/logger.js` — structured logging with sensitive field sanitization
  - `lib/crypto-auth.js` — scrypt password hashing, session token hashing, timing-safe comparison
  - `lib/reset-pages.js` — password reset HTML form and error page generators
  - `lib/presence.js` — Socket.IO presence management (13 functions via factory pattern)
  - `lib/rate-limiting.js` — rate limiter factories (written, pending integration)
- **webhook automation (Phase 2)**: Deploy pipeline, monitoring, and FCM retry queue 
  - GitHub webhook triggers automated deploy pipeline
  - Health monitoring workflow with ntfy.sh alerts
  - Persistent FCM retry queue for failed push notifications
- **FCM retry integration**: Fire-and-forget POST to webhook alongside in-memory retry queue in lib/notifications.js

### Removed
- Backup files: server.js.pre-phase3, server.js.bak, lib/notifications.js.bak

### Fixed
- All 236 tests passing (106 unit + 91 integration + 31 critical paths + 8 e2e)

## [1.10.1] - 2026-03-21

### Added
- **Email change UI**: Account menu displays current email with verified/unverified badge, supports changing email with password confirmation
- **Resend verification**: One-click resend of email verification from account menu
- **Account settings layout**: Reorganized account section into Photo / Email / Password rows with inline actions
- **Install App button**: Cross-platform PWA install — uses native beforeinstallprompt on Chromium, shows platform-specific instructions (iOS, Android, Firefox, Samsung) on all other browsers
- **Support Me button**: PayPal.me tip link in header below logo
- **WCAG 2.2 compliance**: 44px touch targets (2.5.8), aria-controls on tabs (4.1.2), role=alert on auth errors, aria-describedby on cookie consent
- **Cross-browser E2E tests**: WebKit and Firefox Playwright projects
- **E2E test coverage**: 7 new tests — guest browsing, share links, forgot password, WCAG touch targets, aria-controls, role=alert, email change flow

### Fixed
- **Offline mode**: Added helpers.js and timeline.js to service worker SHELL_URLS — app now works fully offline when installed as PWA
- **FCM push notifications**: Added fcmregistrations.googleapis.com to CSP connect-src — push token registration no longer fails silently
- **Manifest icons**: Split "any maskable" icon purpose into separate entries for Chrome installability; added id and scope fields

### Changed
- Service worker cache bumped to v117
- Version bump to 1.10.1

## [1.10.0] - 2026-03-20

### Removed
- **Chat feature**: Removed in-app chat entirely — chat:send, chat:react socket events, message loading endpoint, SSE fallback, chat UI panel, chat rate limiting, and all associated CSS. Users coordinate via existing messaging apps (WhatsApp, iMessage, Discord). DB tables retained for data preservation.
- **Chat reactions**: Removed emoji reaction system (reaction picker, reaction pill UI, per-emoji caps)
- **Chat push notifications**: Removed FCM push for chat messages (crew update and schedule change push notifications remain)
- **Chat rate limiting**: Removed dedicated chat rate limit map and Redis rate limiter
- **Chat config**: Removed CHAT_MAX_MESSAGES, CHAT_RATE_LIMIT, CHAT_MAX_LENGTH, SOCKET_REACT_RATE_LIMIT config constants
- **Chat tests**: Removed ~120 lines of chat-specific integration tests

### Changed
- **Socket.IO**: Simplified to presence and crew updates only (chat events removed)
- **Reconnect handler**: No longer performs message gap-fill on reconnect:restore
- **Emitter**: Removed chatMessage() and chatReaction() broadcast functions
- **Frontend**: ~3,700 bytes smaller (chat UI, handlers, state removed)
- **CSS**: ~8,000 bytes smaller (chat panel, messages, reactions, date separators removed)
- Version bump to 1.10.0

## [1.9.1] - 2026-03-21

### Fixed
- **Socket.IO reconnect bug**: Fixed undefined `validatedFestivalId` reference in `reconnect:restore` handler that caused runtime errors when room was full
- **N+1 avatar query**: Batch-resolve user avatars on reconnect gap-fill instead of sequential per-message queries (up to 200x fewer DB calls)
- **Rate limit cleanup**: Consolidated 8 separate rate-limit cleanup loops into single unified iteration in server.js
- **Export worker**: Removed redundant hard-coded concurrent export limit (20) that conflicted with configurable MAX_CONCURRENT_EXPORTS
- **Batch eviction**: Optimized emitter batch eviction from O(n) scan to O(1) using Map insertion order
- **CSS**: Fixed undefined `--bg-hover` variable causing broken hover states on now/next strip; removed duplicate `slideUp` keyframe animation

### Added
- **Pick save debounce**: Prevents double-click/rapid-tap race conditions on priority buttons with 350ms cooldown per set
- **Loading skeleton**: CSS skeleton placeholder cards shown while festival data loads
- **Profiles route documentation**: Added TODO annotations for future N+1 query optimization in profiles route

### Changed
- **Version header**: Corrected server.js header comment from v1.3.0 to v1.9.0
- **Cache bust**: Updated frontend asset version query strings
- **CSS variables**: Added `--bg-hover` and `--bg-elevated` to dark theme root

## [1.9.0] - 2026-03-20

### Added
- **Real-time Crew Synchronization**: Live updates across all team members with optimized Socket.IO events
- **Priority-based Event Picks**: Three-tier system (must-see, interested, skip) with conflict resolution
- **Automatic Conflict Detection**: Real-time alerts when crew members pick overlapping events
- **Live Crew Chat**: In-app messaging with real-time delivery and read receipts
- **Calendar Export**: ICS format for one-click integration with calendar applications
- **Offline Support**: Local-first architecture with automatic sync on reconnection
- **Push Notifications**: Firebase Cloud Messaging for desktop and mobile alerts
- **Admin Dashboard**: Comprehensive event management, user analytics, and moderation tools
- **Public Share Pages**: Festival-specific URLs for sharing schedules with non-authenticated users
- **Avatar Upload System**: User profile customization with image validation and CDN delivery
- **OpenAPI Specification**: Interactive API documentation at `/api/docs`
- **Comprehensive Test Suite**: 236 tests covering unit, integration, and critical user paths
- **Enhanced Security**: SHA-256 session tokens, Scrypt password hashing, CSP with per-script hashing
- **Session Management**: Secure refresh token rotation with 90-day TTL and account lockout protection
- **Rate Limiting**: Multi-tier per-endpoint and per-user limiting to prevent abuse
- **GDPR Compliance**: Data export, account self-deletion with 30-day grace period, ToS acceptance tracking
- **Database Migrations**: Full migration chain (004-008) with 20+ optimized tables
- **Production Deployment**: nginx reverse proxy, Let's Encrypt TLS integration
- **Health Endpoints**: `/health/live` for liveness and `/api/health` for readiness probes
- **Comprehensive Documentation**: README, deployment guide, configuration reference, and security policies

### Changed
- **Database Schema**: Expanded from 15 to 20+ tables for scalability and performance
- **Authentication Flow**: Token-based with refresh rotation replacing simple session tokens
- **API Response Format**: Standardized error responses with ISO 8601 timestamps
- **Logging System**: Structured logging with configurable verbosity levels

### Fixed
- Memory leak in Socket.IO connection handling
- Race condition in concurrent event pick updates
- Incorrect timezone handling in calendar export
- Session token expiration edge cases

### Security
- Implemented parameterized SQL queries preventing injection attacks
- Added CSRF protection via origin enforcement
- Enforced Content Security Policy with per-script nonce hashing
- Implemented session token refresh rotation (90-day TTL)
- Added account lockout after 10 failed login attempts
- Rate limiting on login endpoints (5 attempts per 5 minutes)
- Secure password hashing with Scrypt (12 rounds default)

## [1.8.0] - 2026-02-15

### Added
- **Refresh Token System**: Automatic token rotation with 90-day expiration
- **Account Lockout Protection**: Account locks after 10 failed login attempts
- **OpenAPI Specification**: Machine-readable API documentation with Swagger UI
- **Metrics Rollups**: Historical metrics aggregation for performance analysis
- **Redis Caching**: Optional Redis integration for improved session performance
- **Backup Automation**: Database backup scripts with restoration testing
- **Monitoring Endpoints**: `/api/health` endpoint for readiness checks

### Changed
- Upgraded to Node.js 22 LTS
- Improved database query performance with connection pooling
- Enhanced error messages for debugging

### Fixed
- Session timeout race conditions
- WebSocket reconnection issues on network interruption

## [1.7.3] - 2026-01-10

### Added
- Initial stable release
- Core crew synchronization features
- Basic event scheduling with picks
- Chat messaging system
- User authentication with sessions
- PostgreSQL database with migrations
- Express.js REST API
- Socket.IO real-time updates

### Known Limitations
- Limited to 500 events per festival
- Maximum 1000 concurrent users
- No offline support in this version
- Avatar uploads not yet supported

## [1.7.0] - 2025-12-20

### Added
- Initial beta release
- Event picking system
- User management
- Basic API endpoints

---

## Upgrading

Earlier upgrade recipes were removed. Run `npm ci` and restart; migrations apply at boot.

## Version Numbering

- **MAJOR**: Breaking API or database changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes and security updates

Festie follows continuous deployment practices. All releases are tagged in Git.

## Security Updates

Security patches are released as patch versions and are mandatory. Subscribe to [GitHub Releases](https://github.com/uhsear/festie/releases) for notifications.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for information on reporting issues and contributing features.

## Support

For version-specific support:
- Open an issue on [GitHub](https://github.com/uhsear/festie/issues)

---

**Current version**: see `package.json`.
