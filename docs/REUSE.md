# Reuse catalog

Before you write a new helper, component or query, check this catalog.

Each group starts from a job that a developer begins with. Each entry gives the name, the path, what it does and one example caller.
Paths are relative to the repository root. A `:line` suffix points to the definition or the call.
If web and mobile both need a new helper, add it to `@festie/shared`.

## Groups

1. [Add an authenticated route](#add-an-authenticated-route)
2. [Add a crew-scoped route](#add-a-crew-scoped-route)
3. [Add an admin or festival-scoped admin route](#add-an-admin-or-festival-scoped-admin-route)
4. [Write an audit row](#write-an-audit-row)
5. [Add a paginated list endpoint](#add-a-paginated-list-endpoint)
6. [Add a store query or a transaction](#add-a-store-query-or-a-transaction)
7. [Add a socket event](#add-a-socket-event)
8. [Connect a socket, resync on reconnect or revoke access](#connect-a-socket-resync-on-reconnect-or-revoke-access)
9. [Queue an offline write](#queue-an-offline-write)
10. [Format a set time](#format-a-set-time)
11. [Work with festival time zones and days](#work-with-festival-time-zones-and-days)
12. [Show set or festival status](#show-set-or-festival-status)
13. [Pick a set or detect clashes](#pick-a-set-or-detect-clashes)
14. [Split money](#split-money)
15. [Check crew owner, capacity or invite](#check-crew-owner-capacity-or-invite)
16. [Schedule a reminder or export a calendar](#schedule-a-reminder-or-export-a-calendar)
17. [Keep a backend copy of a shared rule in sync](#keep-a-backend-copy-of-a-shared-rule-in-sync)
18. [Add a web route or screen](#add-a-web-route-or-screen)
19. [Add a form on web](#add-a-form-on-web)
20. [Add a web button, dialog or sheet](#add-a-web-button-dialog-or-sheet)
21. [Show a toast or undo](#show-a-toast-or-undo)
22. [Use small web helpers](#use-small-web-helpers)
23. [Add a mobile screen](#add-a-mobile-screen)
24. [Style mobile text, colour and icons](#style-mobile-text-colour-and-icons)
25. [Add a mobile button, form control or sheet](#add-a-mobile-button-form-control-or-sheet)
26. [Read location or compute distance](#read-location-or-compute-distance)
27. [Add a backend integration test](#add-a-backend-integration-test)
28. [Add a test with a crew, users or a festival profile](#add-a-test-with-a-crew-users-or-a-festival-profile)
29. [Add a route or script test without a database](#add-a-route-or-script-test-without-a-database)
30. [Add a web, shared or mobile unit test](#add-a-web-shared-or-mobile-unit-test)
31. [Add an end-to-end browser test](#add-an-end-to-end-browser-test)
32. [Guard route security in tests](#guard-route-security-in-tests)

## Add an authenticated route

| Name | Path | What it does | Example caller |
|---|---|---|---|
| `userAuth` | `lib/app-context/session.ts:159` | Resolves session token, sets req.user/userToken/userAuthSource or sends 401 AUTH_REQUIRED. | `routes/crew-polls.ts:41` |
| `rateLimit(max, scope)` | `lib/rate-limiting.ts:174` | Per-user/per-IP scoped limiter; use a unique scope string per route. | `routes/crew-polls.ts:42` |
| `validate / validateQuery / validateParams` | `lib/schemas.ts:908` | Zod middleware; 400 VALIDATION_ERROR with fields; sets req.validatedBody/Query/Params. | `routes/crew-polls.ts:43` |
| `sendSuccess / sendError / ErrorCodes` | `lib/response.ts:61` | Builds the { data, error } envelope; sendError at line 85; ErrorCodes at line 7. | `routes/crew-polls.ts:51` |
| `crewIdParams, festivalIdParams, genericIdParams` | `lib/schemas.ts:1727` | Zod param schemas; festivalIdParams at 1773. | `routes/crew-polls.ts:43` |
| `Zod request schemas` | `lib/schemas.ts` | Server-side validation for every API input; web shares types via @festie/shared. | `lib/app-context/index.ts:43` |

## Add a crew-scoped route

| Name | Path | What it does | Example caller |
|---|---|---|---|
| `stores.crews.getMember + 403 'Not a crew member'` | `routes/crew-polls.ts:48` | Current hand-rolled membership gate; follow this shape. | `routes/crew-polls.ts:48` |
| `resolveCrewOwnership` | `routes/crews.ts:87` | Loads a crew, sends 404 if it is missing and 403 unless the caller owns it. Local to routes/crews.ts. | `routes/crew-invites.ts:151` |

## Add an admin or festival-scoped admin route

| Name | Path | What it does | Example caller |
|---|---|---|---|
| `adminAuth` | `lib/app-context/session.ts:110` | Session check then hasRole admin or 403; sets req.isAdmin used by audit middleware. | `routes/admin-users.ts:67` |
| `adminWriteLimit` | `routes/admin.ts:68` | Per-router const rateLimit(config.ADMIN_WRITE_RATE_LIMIT_MAX, 'admin-write'). Other route files get it from ctx. | `routes/admin-bulk.ts:132` |
| `requireRecentAuth` | `lib/app-context/session.ts:152` | 403 REAUTH_REQUIRED unless password re-entered recently. | `routes/admin-bulk.ts:131` |
| `festivalAccess({ action, param, allow })` | `lib/app-context/session.ts:129` | Admin passes everywhere. An organization member passes only on the /manage mount, by role, organization status and `allow`; others get 403 (404 on /manage). Sets req.festivalRole, req.festivalId and req.organizationId; tagged for the access-matrix test. | `routes/lineup-announce.ts:47` |
| `orgAccess({ action })` | `lib/app-context/session.ts:129` | The same rules for a create that names `organizationId` in the body. | `routes/manage.ts:140` |
| `verifiedOrganizationOnly` | `lib/app-context/session.ts` | An `allow` rule for festivalAccess: only a member of a verified organization passes. An admin always does. | `routes/lineup-announce.ts` |
| `organizerAudience / organizerEngagement` | `lib/organizer-engagement.ts` | The floor on what an organizer learns about attendees: nothing under 20 joined users, counts under 5 hidden. | `routes/manage.ts` |
| `createFestivalMounts adminGuard` | `lib/festival-mounts.ts:29` | Admin festival routers mount behind adminGuard = [deps.adminAuth]. | `lib/festival-mounts.ts:32` |
| `setNoStore` | `lib/app-context/cookies.ts:23` | Sets no-store cache headers; call on admin reads and writes. | `routes/admin-users.ts:69` |

## Write an audit row

| Name | Path | What it does | Example caller |
|---|---|---|---|
| `AUDIT_ACTIONS` | `lib/audit-actions.ts:12` | Only allowed action strings; genericAuditAction at line 83. | `routes/festivals.ts:469` |
| `createAuditMiddleware` | `lib/audit-middleware.ts:10` | Generic fallback row per mutating request unless res.locals.auditWritten. | `lib/audit-middleware.ts:25` |
| `writeAudit (local, admin-users)` | `routes/admin-users.ts:46` | Swallows failure, sets auditWritten after success. Use until a shared helper exists. | `routes/admin-users.ts:390` |

## Add a paginated list endpoint

| Name | Path | What it does | Example caller |
|---|---|---|---|
| `parsePageParams` | `lib/pagination.ts:29` | Reads limit/pageSize and cursor/after from a query, clamps limit to defaultSize and maxSize. | `routes/notifications.ts:208` |
| `paginateArray (encodeCursor, decodeCursor) / buildPaginatedResponse` | `lib/pagination.ts:47` | In-memory cursor pagination over an array for small, already-loaded lists. buildPaginatedResponse at :85 builds the paginated response. | `routes/profiles.ts:71` |
| `DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MAX_PUBLIC_PAGE_SIZE` | `lib/pagination.ts:7` | Named page-size constants: default 50, admin cap 200, public cap 100. | `lib/schemas.ts:1651` |
| `paginationQuery, adminAuditQuery` | `lib/schemas.ts:1649` | Zod query schemas for cursor and limit, including the NUL-byte cursor check that prevents a 500. | `routes/activity.ts:10` |
| `Keyset pattern: activity.getByCrew` | `lib/db/stores/activity.ts:33` | Reference store query: limit+1, (created_at, id) < cursor, nextCursor from the last row. | `routes/activity.ts:17` |

## Add a store query or a transaction

| Name | Path | What it does | Example caller |
|---|---|---|---|
| `withTransaction` | `lib/db/connection.ts:19` | Runs fn(client) between BEGIN and COMMIT, rolls back on error without masking it, and releases the client. | `lib/db/stores/crews.ts:177` |
| `withTransactionRetry` | `lib/db/connection.ts:49` | withTransaction retried up to 3 times on deadlock (40P01) or serialization failure (40001); fn must touch only the database. | `lib/db/stores/festivals.ts:791` |
| `lockFestivalAny` | `lib/db/stores/festival-lock.ts:11` | SELECT ... FOR UPDATE on a festival row including soft-deleted ones. Global lock order is festivals by id, then artists by id. | `lib/db/stores/artists.ts:693` |
| `festivalIdsUsing / festivalIdsUsingAny` | `lib/db/stores/artists.ts:265` | Lists the festivals (archived included) that list the given artists, in id order, taking no locks, so they can be locked in the right order. festivalIdsUsingAny is at :265, festivalIdsUsing (one artist) at :274; both are file-private. | `lib/db/stores/artists.ts:692` |
| `createStores` | `lib/db/index.ts:51` | Wires every store factory to the pool and returns the stores object; a new store is registered here. | `lib/app-context/index.ts:136` |
| `createUtils (mapProfileRow, parseMessageRow, toISOString, buildFestivalRecords)` | `lib/db/utils.ts:10` | Shared row mappers and the single-query festival tree (stages, days, sets) built with json_agg. | `lib/db/stores/profiles.ts:148` |
| `parseJsonObject / serializeJson` | `lib/db/connection.ts:61` | Reads a JSON or JSONB column into an object with a fallback and a small cache, and writes one back as a string. | `lib/db/utils.ts:23` |
| `createDbLatencyTracker` | `lib/db/latency.ts:10` | Records per-query latency for the pool. | `lib/app-context/index.ts:137` |
| `buildFestivalRecords` | `lib/db/utils.ts:37` | Returns every non-deleted festival with stages, days and sets in one query. | `lib/db/stores/festivals.ts:447` |
| `splitSqlStatements` | `lib/db/sql-split.ts:35` | Splits a migration file into statements for the runner; also exports stripSqlComments and usesConcurrently. | `lib/planner-db-pg.ts:204` |
| `isoOrNull` | `lib/account-export-records.ts:19` | Date or string to ISO string, or null when falsy. | `lib/account-export-records.ts:60` |

## Add a socket event

| Name | Path | What it does | Example caller |
|---|---|---|---|
| `createSocketEmitter (crewExpenseAdded and siblings)` | `lib/emitter.ts:25` | Central broadcast layer that stamps _v and batches profile events; crew helpers at :296-306. Add new crew/festival events here, not inline in a route. | `routes/expenses.ts:135` |
| `ServerToClientEvents typed event map` | `packages/shared/src/types/socket-events.ts:305` | Names every server-to-client event and its payload type; add the event and payload interface here first. | `packages/shared/src/hooks/useCrewRealtime.ts:235` |
| `route* pure routers (crewEventRouter)` | `packages/shared/src/realtime/crewEventRouter.ts:289` | Turns a raw payload into an intent after the active-crew guard; add a routeX plus an intent type per event. | `packages/shared/src/hooks/useCrewRealtime.ts:31` |
| `CrewRealtimeSink and createStoreSink` | `packages/shared/src/realtime/crewRealtimeSink.ts:62` | Destination seam; implement the new method in the store sink (mobile, createStoreSink at :114) and the query sink (web). | `packages/mobile/hooks/useRealtimeSync.ts:84` |
| `useCrewRealtime` | `packages/shared/src/hooks/useCrewRealtime.ts:81` | Registers all crew:*, location:* and sos:* listeners, owns join:crew/leave:crew and the reconnect resync. | `packages/mobile/hooks/useRealtimeSync.ts:75` |

## Connect a socket, resync on reconnect or revoke access

| Name | Path | What it does | Example caller |
|---|---|---|---|
| `createSocket` | `packages/shared/src/services/socket.ts:16` | Builds the socket with SOCKET_RECONNECTION_CONFIG, 401/403 handling and online/visibility revive on the web. | `packages/shared/src/hooks/useSocket.ts:50` |
| `SOCKET_RECONNECTION_CONFIG` | `packages/shared/src/constants/config.ts:506` | Single reconnection backoff setting for every client. | `packages/shared/src/services/socket.ts:27` |
| `setLiveSocket / useLiveSocket` | `packages/mobile/lib/liveSocket.ts:28` | Module-level holder so the live-location publisher can read the one socket useRealtimeSync owns. | `packages/mobile/hooks/useRealtimeSync.ts:149` |
| `onReconnectResync / onSosResync sink hooks` | `packages/shared/src/hooks/useCrewRealtime.ts:254` | Re-read crew data on a reconnect (connectedBefore flag); sinks skip while offline writes are queued. | `packages/web/src/hooks/useCrewQuerySink.ts:99` |
| `RECONNECT_FESTIVAL_RELOAD_GAP_MS pattern` | `packages/web/src/hooks/useRealtimeSync.ts:24` | Profiles and crews reload on every reconnect; the full festival reloads only after a 60 s gap. Mobile has its own copy of this logic. | `packages/web/src/hooks/useRealtimeSync.ts:222` |
| `removeProfileSockets / removeFestivalSockets / disconnectUserSockets` | `lib/presence.ts:131` | Server-side socket revocation helpers for festival presence and sessions. | `routes/profiles.ts:270` |
| `useRevocationRealtime and applyCrewAccessRevoked` | `packages/shared/src/hooks/useRevocationRealtime.ts:42` | Handles session:revoked, crew:access-revoked, crew:member-kicked; the caller supplies only navigation or toast. | `packages/web/src/hooks/useRealtimeSync.ts:87` |
| `useLiveLocationPublisher` | `packages/shared/src/hooks/useLiveLocationPublisher.ts:99` | Emits location:share/update/stop on the shared socket with ack handling. | `packages/shared/src/hooks/useLiveShareSession.ts:37` |

## Queue an offline write

| Name | Path | What it does | Example caller |
|---|---|---|---|
| `api.post/put/patch/delete options clientId, offlineLabel, onOptimisticCreate` | `packages/shared/src/services/api.ts:22` | Eligible writes are queued automatically when offline and return an optimistic result; coalescing key is clientId. | `packages/shared/src/services/caught.ts:11` |
| `isOfflineEligible / OFFLINE_ELIGIBLE_PATTERNS` | `packages/shared/src/services/api.ts:97` | Whitelist of replay-safe paths; SOS, check-in and live-location are deliberately absent. Add new offline-safe paths here. | `packages/shared/src/services/api.ts:246` |
| `canQueueOnEdgeError` | `packages/shared/src/services/errors.ts:97` | Decides whether a mutation that got a Cloudflare edge 5xx may be queued (POST only if the origin certainly did not run it). | `packages/shared/src/services/api.ts:4` |
| `Idempotency-Key header and createIdempotencyMiddleware` | `lib/middleware.ts:34` | Mounted on /api/v1. The server caches the JSON response per principal and key within IDEMPOTENCY_TTL and replays it; 5xx is never cached. | `packages/shared/src/services/offlineQueue.ts:319` |
| `drainQueue (native)` | `packages/shared/src/services/offlineQueue.ts:370` | Oldest-first, re-entrancy-guarded replay with no-silent-drops handling. | `packages/mobile/components/OfflineBanner.tsx:93` |
| `useOfflineQueueBridge (web) / window.__festieQueue` | `packages/web/src/hooks/useOfflineQueueBridge.ts:24` | Installs the web IndexedDB queue bridge and drains on mount and on the online event. | `packages/shared/src/services/api.ts:228` |
| `registerCreateReconciler and extractRealId` | `packages/shared/src/services/offlineQueue.ts:303` | Swaps the optimistic placeholder for the server entity after a replayed POST; extractRealId reads the id from envelopes. | `packages/shared/src/stores/crewStore.ts:2066` |
| `surfaceFailedSync, hydrateFailedSync, retryFailed` | `packages/shared/src/services/offlineQueue.ts:141` | Persists failed items so they survive a restart and supports retry or dismiss; retryFailed (:467) re-enqueues and drains. | `packages/mobile/components/OfflineBanner.tsx:20` |
| `parseRetryAfterMs, isEdgeUnavailable` | `packages/shared/src/services/errors.ts:25` | Shared retry vocabulary; isEdgeUnavailable at :87. MAX_RETRIES and MAX_QUEUE_AGE_MS are exported from offlineQueue.ts:24-30, not errors.ts. | `packages/shared/src/hooks/useCrewSections.ts:3` |
| `useOffline` | `packages/shared/src/hooks/useOffline.ts:9` | Seeds and tracks uiStore.offlineMode from window online/offline events (web); mobile uses NetInfo in OfflineBanner. | `packages/web/src/components/layout/AppShell.tsx:94` |

## Format a set time

| Name | Path | What it does | Example caller |
|---|---|---|---|
| `formatTime` | `packages/shared/src/utils/format.ts:64` | Turns an HH:MM string into a 12-hour label for the UI. | `packages/web/src/components/account/NotificationSection.tsx:47` |
| `formatClock12 (backend)` | `lib/time-zone.ts:96` | Backend 12-hour clock label for emails, reminders and public pages (mirror of shared formatTime). | `lib/reminder-scheduler.ts:18` |
| `scheduleFormat helpers` | `packages/shared/src/utils/scheduleFormat.ts:23` | Formats countdowns, durations and start-time order for schedule views and images. | `packages/shared/src/utils/myDay.ts:15` |
| `meetAtFromWallInput / meetAtToWallInput / meetingTimeDisplay` | `packages/shared/src/utils/meetingTime.ts:132` | Converts between festival wall time inputs and stored ISO meet-at times. | `packages/web/src/components/crew/MeetingPointsTab.tsx:337` |

## Work with festival time zones and days

| Name | Path | What it does | Example caller |
|---|---|---|---|
| `resolveFestivalTimeZone` | `packages/shared/src/utils/festivalTime.ts:42` | Returns the festival valid IANA zone or undefined for device-local. | `packages/web/src/components/crew/ActivityTab.tsx:31` |
| `zonedWallTimeToMs (shared)` | `packages/shared/src/utils/setStatus.ts:127` | DST-safe epoch ms for a date string and time in an IANA zone. | `packages/shared/src/utils/offlineReminder.ts:57` |
| `zonedWallTimeToMs (backend)` | `lib/time-zone.ts:44` | Backend mirror taking year, month, day, hour, minute, zone; returns NaN on bad input. No parity test yet. | `lib/reminder-scheduler.ts:73` |
| `festivalStartMinutes / setMinuteRange` | `packages/shared/src/utils/setStatus.ts:13` | Minutes from the logical day midnight; starts before 06:00 count as after midnight and ends roll forward. | `packages/web/src/components/features/TimelineGrid.tsx:181` |
| `FESTIVAL_DAY_START_HOUR / startsAfterMidnight` | `packages/shared/src/utils/setStatus.ts:6` | The 06:00 day boundary constant and an after-midnight test for a start time. | `packages/web/src/components/admin/SetEditor.tsx:279` |
| `festivalStartMinutes / setMinuteRange (backend)` | `lib/time-zone.ts:73` | Backend mirror, parity-tested against shared in tests/time-zone.test.ts. | `lib/festival-page.ts:64` |
| `getSetTimeBounds / isSetScheduled / isAfterMidnight` | `packages/shared/src/utils/setStatus.ts:164` | Epoch bounds for a set from its day and zone; checks the set dayIndex is a real day. | `packages/web/src/components/crew/SchedulePollComposer.tsx:129` |
| `logicalDayIndexAt` | `packages/shared/src/utils/dayOf.ts:72` | Index of the logical festival day that holds a given instant in the festival zone. | `packages/web/src/components/layout/SubHeader.tsx:130` |
| `computeSetStartMs (in reminder-scheduler)` | `lib/reminder-scheduler.ts:63` | Set start epoch in the festival zone with the 06:00 next-day rule. | `lib/reminder-scheduler.ts:73` |

## Show set or festival status

| Name | Path | What it does | Example caller |
|---|---|---|---|
| `getSetStatus` | `packages/shared/src/utils/setStatus.ts:255` | Returns past, live, upcoming, soon, later or tba for a set at a given instant and festival zone. | `packages/web/src/hooks/useSetStatus.ts:82` |
| `useSetStatus (mobile hook)` | `packages/mobile/hooks/useSetStatus.ts:14` | Feeds getSetStatus with the store days, festival zone and shared clock. Returns live, soon, upcoming or past for a set. | `packages/mobile/components/SetCardMobile.tsx:216` |
| `useSetStatus / getStageName` | `packages/web/src/hooks/useSetStatus.ts, packages/shared/src/hooks/useFestival.ts:67` | Live/upcoming/past set state; stage name lookup (returns undefined when unknown). | `packages/web/src/components/features/SetCard.tsx:8` |
| `festivalStatus / isFestivalOver / festivalPhase / hasSetStarted` | `packages/shared/src/utils/festivalTime.ts:86` | Festival-level upcoming/ongoing/past state and whether a given set has started. | `packages/web/src/components/layout/SubHeader.tsx:154` |
| `useNow` | `packages/mobile/hooks/useNow.ts` | One shared interval clock that snaps to real time on app foreground. Use it instead of per-component setInterval. | `packages/mobile/hooks/useSetStatus.ts:15` |
| `useNowNext` | `packages/mobile/hooks/useNowNext.ts` | Current and upcoming picked sets, using shared getSetTimeBounds (rollover-safe). | `packages/mobile/components/NowNextStrip.tsx:43` |
| `freshnessFor / FreshnessChip` | `packages/mobile/lib/freshness.ts` | Maps cache age to live, aging or stale (5 and 60 minute thresholds). | `packages/mobile/components/FreshnessChip.tsx:54` |
| `shared time and set maths` | `packages/shared/src/utils/festivalTime.ts` | getSetTimeBounds, getSetStatus, resolveFestivalTimeZone, timeAgo and related helpers. The one place for time rules. | `packages/mobile/components/CrewPolls.tsx:171` |

## Pick a set or detect clashes

| Name | Path | What it does | Example caller |
|---|---|---|---|
| `detectConflicts / clashBadgeBySetId` | `packages/shared/src/utils/conflicts.ts:28` | Finds overlapping picked sets on the same day, with must-vs-must flag and per-set badges. | `packages/web/src/routes/cards.tsx:145` |
| `buildPickConflicts / buildCrewSplits` | `packages/shared/src/utils/pickConflicts.ts:114` | Groups overlapping picks and finds tight changes; crew version lists who splits up. | `packages/web/src/components/features/PickConflicts.tsx:80` |
| `overlappingClashes` | `lib/helpers/pick-clashes.ts:22` | Backend filter of co-picked pairs that overlap in festival minutes, ranked by people. | `routes/admin-status.ts:435` |
| `stageOverlapWarnings` | `lib/helpers/validation.ts:271` | Messages for sets that overlap on one stage when a festival is saved. | `lib/helpers/validation.ts:492` |
| `PRIORITY_WEIGHT / PRIORITY_RANK` | `packages/shared/src/utils/crewNudges.ts:30` | Numeric order must > want-to-see > maybe (3/2/1 weight, 0/1/2 rank). Also exported from constants/index.ts. Reuse these instead of a new table. | `packages/mobile/components/SetCardMobile.tsx:18` |
| `PRIORITY_SYMBOLS` | `packages/shared/src/constants/config.ts:47` | The one icon key, long and short label and colour token per priority. | `packages/web/src/components/features/SetCard.tsx:4` |
| `PRIORITY_LABEL / PRIORITY_OPTIONS / PRIORITY_LABELS` | `packages/shared/src/constants/config.ts:12` | Short label, ordered option list with sort, and full labels. | `packages/mobile/app/friend-picks.tsx:295` |
| `useQuickPick / quickPick` | `packages/mobile/hooks/useQuickPick.ts` | Hold-to-pick gesture and screen-reader actions (QUICK_PICK_ACTIONS, priorityForAction). | `packages/mobile/app/grid.tsx:119` |
| `shared picks and clash hooks` | `packages/shared/src/hooks/usePicks.ts` | Picks state with offline queue. Business logic lives in shared. | `packages/mobile/app/(tabs)/picks.tsx:162` |

## Split money

| Name | Path | What it does | Example caller |
|---|---|---|---|
| `toCents` | `packages/shared/src/utils/money.ts:64` | Decimal string or number to integer cents; 0 when not finite. | `packages/web/src/components/crew/ExpenseForm.tsx:78` |
| `formatCents / formatAmount / formatBalance` | `packages/shared/src/utils/money.ts:59` | Currency strings for cents, plain amounts and signed balances with a 0.01 settled threshold. | `packages/web/src/components/crew/ExpensesTab.tsx:361` |
| `evenShares / sharesByDays / sharesError` | `packages/shared/src/utils/expenseSplit.ts:17` | Even split with leftover cents to first ids; split by days attended; validation of typed shares. | `packages/web/src/components/crew/ExpenseForm.tsx:93` |
| `owedShares (backend ledger)` | `lib/db/stores/expenses.ts:128` | What each current member owes for one expense; pools shares of members who left. | `lib/db/stores/expenses.ts:349` |
| `expenseShareCents` | `packages/shared/src/utils/expenseSplit.ts:76` | Client copy of owedShares for one user; null if not in the split or planned. | `packages/web/src/components/crew/ExpensesTab.tsx:615` |
| `simplifyDebts` | `lib/db/stores/expenses.ts:39` | Turns per-member cent balances into the minimum settle-up transfers. | `routes/expenses.ts:347` |
| `payOptionsFor / settlementSentence / createSettleUpFlow` | `packages/shared/src/utils/crewWrites.ts:118` | Payment-app links and sentences for a settlement; shared flow for settle-up. | `packages/web/src/components/crew/ExpensesTab.tsx:487` |
| `spendingExpenses / settlementPayments / isSettlement / ledgerRows` | `packages/shared/src/utils/money.ts:74` | Separates real spending from planned rows and settle-up payments. | `packages/mobile/lib/expenseView.ts:50` |

## Check crew owner, capacity or invite

| Name | Path | What it does | Example caller |
|---|---|---|---|
| `crewOwnerInfo` | `packages/shared/src/utils/crewPlan.ts:196` | Returns isOwner and owner name from crew owner id and member roles. | `packages/shared/src/hooks/useCrewHub.ts:85` |
| `crewCapState / memberCountLabel` | `packages/shared/src/utils/crewManage.ts:123` | Per-festival crew cap state with text, and the N of M members label. | `packages/web/src/components/crew/CreateCrewDialog.tsx:40` |
| `addMember with maxMembers (server)` | `lib/db/stores/crews.ts:404` | Atomic insert that returns full or locked under a row lock. | `routes/crew-invites.ts:103` |
| `parseInviteCode / inviteShareMessage` | `packages/shared/src/utils/invite.ts:11` | Extracts a code from a raw code or invite link; builds the share message. | `packages/web/src/routes/crew.tsx:164` |
| `generateUniqueInviteCode / inviteExpiryFor` | `lib/invite-code.ts:46` | Server-side random code (32-char alphabet) and expiry = max(now+7d, last day+2d). | `routes/crews.ts:306` |

## Schedule a reminder or export a calendar

| Name | Path | What it does | Example caller |
|---|---|---|---|
| `buildReminderPlan / DEFAULT_REMINDER_LEAD_MINUTES` | `packages/shared/src/utils/reminderSchedule.ts:92` | Turns the reminders map into fire times (start minus lead), capped at 64. | `packages/mobile/hooks/useLocalReminders.ts:105` |
| `buildPicksIcsExport (client) and ics-builder (server)` | `packages/shared/src/utils/ics.ts:154` | ICS for picks with reminders; the backend copy in lib/helpers/ics-builder.ts is guarded by tests/ics-parity.test.ts. | `tests/ics-parity.test.ts:68` |

## Keep a backend copy of a shared rule in sync

| Name | Path | What it does | Example caller |
|---|---|---|---|
| `parity tests` | `tests/time-zone.test.ts` | Pattern: import the shared file by relative path via tsx register and compare outputs (also tests/ics-parity.test.ts, tests/constants-parity.test.ts, tests/invite-copy-parity.test.ts). | `tests/time-zone.test.ts:11` |
| `coverLineup / lineupNameKey / entryDayIndex` | `packages/shared/src/utils/lineupCover.ts:68` | Client cover rule; backend copy in lib/lineup.ts:197 shares tests/fixtures/lineup-cover.json. | `lib/lineup.ts:229` |

## Add a web route or screen

| Name | Path | What it does | Example caller |
|---|---|---|---|
| `TanStack route table` | `packages/web/src/router.tsx` | createRoute entries with validateSearch (festivalSearch), beforeLoad redirects, RouteErrorBoundary. | `packages/web/src/router.tsx:182` |
| `authReady` | `packages/web/src/routes/auth-guard.ts:16` | Awaits auth hydration before a guarded route renders. | `packages/web/src/router.tsx:193` |
| `useFestivalLoader` | `packages/web/src/hooks/useFestivalLoader.ts:56` | App-shell loader: session check, festival load, ?joinCrew= and ?ref= capture, profile refetch on login. Not a per-route loader. | `packages/web/src/components/layout/AppShell.tsx:99` |
| `festivalLoadState` | `packages/shared/src/utils/festivalTime.ts` | Derives loading/error/empty state from the festival store for skeleton/error/empty branching. | `packages/web/src/routes/picks.tsx:167` |
| `EmptyState` | `packages/web/src/components/ui/EmptyState.tsx` | Title/description/CTA with themed illustration. | `packages/web/src/components/crew/PollsTab.tsx:390` |
| `FestivalLoadError` | `packages/web/src/components/features/FestivalLoadError.tsx` | Retryable festival-load failure panel. | `packages/web/src/routes/picks.tsx:171` |
| `Skeleton and route skeletons` | `packages/web/src/components/ui/Skeleton.tsx, packages/web/src/components/ui/skeletons/` | Shimmer primitive with role=status plus per-screen skeletons. | `packages/web/src/routes/crew.tsx:297` |
| `Card (Header/Body)` | `packages/web/src/components/ui/Card.tsx` | Surface with default/elevated/interactive/flush variants and padding scale. | `packages/web/src/routes/crew-plan.tsx:172` |
| `Badge / StageBadge / Avatar / PriorityIcon` | `packages/web/src/components/ui/Badge.tsx, StageBadge.tsx, Avatar.tsx, PriorityIcon.tsx` | Pills, stage colour chip, user avatar, priority glyph. | `packages/web/src/components/features/MyDayList.tsx:119` |
| `RefreshableView` | `packages/web/src/components/layout/RefreshableView.tsx` | Pull-to-refresh wrapper that invalidates the given query keys. | `packages/web/src/routes/picks.tsx:225` |
| `useRovingTabs` | `packages/web/src/hooks/useRovingTabs.ts` | Arrow-key roving focus for a role=tablist element. | `packages/web/src/components/crew/CrewTabBar.tsx:26` |
| `useMediaQuery` | `packages/web/src/hooks/useMediaQuery.ts` | useSyncExternalStore over matchMedia with a window guard; use for min-width and prefers-reduced-motion. | `packages/web/src/components/features/DetailPanel.tsx:43` |
| `adminKeys / ADMIN_QUERY_OPTIONS / useAdminSearch` | `packages/web/src/components/admin/adminQueries.ts, packages/web/src/components/admin/useAdminSearch.ts` | Query-key factory, shared react-query options and URL-backed search state. | `packages/web/src/components/admin/AdminDashboard.tsx:15` |
| `AdminFestivals mode='organizer' / FestivalScope` | `packages/web/src/components/admin/AdminFestivals.tsx, packages/shared/src/services/festivalAdmin.ts` | The /manage festival editor. It reuses the admin editor over the organizer API (scope `manage`) and leaves out the admin-only panels. | `packages/web/src/routes/manage.tsx:63` |

## Add a form on web

| Name | Path | What it does | Example caller |
|---|---|---|---|
| `Input` | `packages/web/src/components/ui/Input.tsx` | Labelled text input with error/helperText, password toggle, search variant and aria wiring. | `packages/web/src/components/crew/PollsTab.tsx:304` |
| `inputBase` | `packages/web/src/lib/styles.ts:1` | Shared class string for raw input/select/textarea when ui/Input does not fit (no ui/Select yet). | `packages/web/src/components/crew/CreateCrewDialog.tsx:74` |
| `Switch` | `packages/web/src/components/ui/Switch.tsx` | Accessible on/off toggle with 44px target. | `packages/web/src/components/crew/LiveLocationControls.tsx:211` |

## Add a web button, dialog or sheet

| Name | Path | What it does | Example caller |
|---|---|---|---|
| `Button / IconButton` | `packages/web/src/components/ui/Button.tsx, packages/web/src/components/ui/IconButton.tsx` | Variant/size buttons with isLoading; IconButton requires a label for a11y. | `packages/web/src/components/crew/PollsTab.tsx:265` |
| `Dialog` | `packages/web/src/components/ui/Dialog.tsx` | Centred modal shell: Radix focus trap, overlay, title/description, close, focus return. | `packages/web/src/components/crew/HandOverDialog.tsx:34` |
| `ConfirmDialog` | `packages/web/src/components/ui/ConfirmDialog.tsx` | Styled confirm (replaces window.confirm) built on Dialog. | `packages/web/src/components/crew/CrewInviteBar.tsx:180` |
| `PromptDialog` | `packages/web/src/components/ui/PromptDialog.tsx` | Single text-input prompt dialog built on Dialog. | `packages/web/src/components/admin/AdminUsers.tsx:404` |
| `Sheet` | `packages/web/src/components/ui/Sheet.tsx` | vaul bottom sheet with drag-dismiss, modal or non-modal, icon, focus return. | `packages/web/src/components/features/PendingSyncSheet.tsx:75` |
| `useReturnFocus / useKeyboardTrap` | `packages/web/src/hooks/useReturnFocus.ts, packages/web/src/hooks/useKeyboardTrap.ts` | Restore focus after a Radix dialog; trap focus and Escape for a custom overlay. | `packages/web/src/components/features/Onboarding.tsx:102` |

## Show a toast or undo

| Name | Path | What it does | Example caller |
|---|---|---|---|
| `useToast` | `packages/web/src/lib/toastContext.tsx:144` | toast(msg,type), toastError(err,fallback), toastUndo. | `packages/web/src/components/crew/HomeBaseCard.tsx:33` |
| `useUndoNotifier` | `packages/web/src/hooks/useUndoNotifier.ts` | Adapts the toast host to the shared pick hooks. | `packages/web/src/components/features/SetCard.tsx:71` |
| `useUndoableRemove (web wrapper)` | `packages/web/src/components/crew/useUndoableRemove.ts` | One-tap remove with Undo toast; logic lives in the shared hook. | `packages/web/src/components/crew/PackingTab.tsx:64` |
| `useUIStore.showToast / Toaster` | `packages/mobile/components/Toaster.tsx` | Toast queue rendered by Toaster. Call useUIStore.getState().showToast(msg,{kind,onUndo}). | `packages/mobile/components/AccountDataSection.tsx:32` |
| `useUndoableRemove` | `packages/mobile/hooks/useUndoableRemove.ts` | One-tap remove with an Undo toast. It hides the row at once and sends the delete after the shared undo window. | `packages/mobile/components/CrewMeetingPoints.tsx:100` |

## Use small web helpers

| Name | Path | What it does | Example caller |
|---|---|---|---|
| `cn` | `packages/web/src/lib/utils.ts:4` | clsx + merge class helper used by all ui/ components. | `packages/web/src/components/ui/Switch.tsx:1` |
| `downloadExport` | `packages/web/src/lib/downloadExport.ts` | Saves the account export JSON. | `packages/web/src/components/account/DataExportSection.tsx:6` |

## Add a mobile screen

| Name | Path | What it does | Example caller |
|---|---|---|---|
| `ScreenHeader` | `packages/mobile/components/ScreenHeader.tsx` | Standard title, subtitle and icon header. It owns the top safe-area inset and reads TopBannerContext so it does not add the inset twice under OfflineBanner. | `packages/mobile/app/(tabs)/account.tsx:405` |
| `EmptyState` | `packages/mobile/components/EmptyState.tsx` | Centred icon or shared illustration, title, message and up to two Button actions. Set the insets prop when the screen has no native header. | `packages/mobile/app/(tabs)/crew.tsx:662` |
| `Skeleton / LoadingState` | `packages/mobile/components/Skeleton.tsx` | Placeholder blocks and a standard loading view for first load. | `packages/mobile/app/(tabs)/crew.tsx:698` |
| `ErrorBoundary` | `packages/mobile/components/ErrorBoundary.tsx` | Render-error fallback wrapper for screens and routes. | `packages/mobile/app/_layout.tsx:408` |
| `useListBottomInset` | `packages/mobile/hooks/useListBottomInset.ts` | Bottom padding that clears the tab bar and safe area, for list contentContainerStyle. | `packages/mobile/app/set/[setId].tsx:136` |
| `SectionLabel` | `packages/mobile/components/SectionLabel.tsx` | The one uppercase, caps-tracked group title. The tone prop is secondary or muted. | `packages/mobile/app/(tabs)/account.tsx:433` |
| `SetCardMobile / LiveBadge` | `packages/mobile/components/SetCardMobile.tsx` | Set row card with priority, status badge and quick-pick gesture. | `packages/mobile/app/(tabs)/picks.tsx:489` |
| `returnTo / pendingInvite / pushRoutes` | `packages/mobile/lib/returnTo.ts` | In-memory return path through sign-in, built on the shared safeReturnPath. Push tap routing is in pushRoutes.ts, pending invite state in pendingInvite.ts. | `packages/mobile/app/(auth)/complete-signup.tsx:177` |

## Style mobile text, colour and icons

| Name | Path | What it does | Example caller |
|---|---|---|---|
| `typeStyle / makeStyles / useTokens` | `packages/mobile/hooks/useTokens.ts` | typeStyle(role) spreads a shared type role into a style. makeStyles((t)=>...) builds theme-aware StyleSheets. useTokens() returns the Stage or Daylight palette. Never import tokens directly. | `packages/mobile/components/SectionLabel.tsx:30` |
| `iconSize / MAX_FONT_SCALE / useLargeText` | `packages/mobile/hooks/useTokens.ts` | The icon-size scale, the font-scale cap, and a large-text flag. Use these instead of literals. | `packages/mobile/components/AnnouncementBanner.tsx:9` |
| `inkOnFill` | `packages/mobile/lib/inkOnFill.ts` | Picks the higher-contrast ink between two colours for a solid fill. | `packages/mobile/components/Button.tsx:127` |
| `ensureStageTextContrast` | `packages/mobile/lib/stageTextContrast.ts` | Shifts a server-supplied stage colour to at least 4.6:1 on the sheet background, for use as text. | `packages/mobile/app/set/[setId].tsx:71` |
| `shared colour maths` | `packages/shared/src/utils/contrast.ts` | parseHex, toHex, relativeLuminance, srgbToLinear, linearToSrgb and ensureWhiteContrast. The home for WCAG colour maths; contrastRatio still has copies in packages/mobile/lib/inkOnFill.ts and packages/shared/src/utils/lockscreenModel.ts. | `packages/mobile/lib/inkOnFill.ts:1` |
| `@festie/shared/tokens` | `packages/shared/src/tokens/index.ts` | colors, colorsDaylight, spacing, radii, typography, motion and buttons tokens, shared by web and mobile. | `packages/mobile/hooks/useTokens.ts:4` |
| `CONCEPT_IONICON` | `packages/mobile/lib/conceptIcons.ts` | Ionicons for each shared ConceptIconKey. The web twin uses Lucide. | `packages/mobile/components/CrewMeetingPoints.tsx:478` |
| `EXPENSE_IONICON / RATING_IONICON / priorityIconName` | `packages/mobile/lib/expenseIcon.ts, ratingIcon.ts, prioritySymbol.ts` | Mobile Ionicons mapping for expense categories, ratings and priorities. | `packages/mobile/components/CrewExpenses.tsx:685` |

## Add a mobile button, form control or sheet

| Name | Path | What it does | Example caller |
|---|---|---|---|
| `Button` | `packages/mobile/components/Button.tsx` | Canonical primary, secondary, ghost, danger and utility button. It handles loading, icon and AA ink. | `packages/mobile/components/AccountEmailSection.tsx:170` |
| `AppPressable / PressableScale` | `packages/mobile/components/AppPressable.tsx` | Pressable with house ripple, hit-slop and a11y defaults. PressableScale adds a press-scale animation. | `packages/mobile/components/ScreenHeader.tsx:117` |
| `haptic / useHaptics` | `packages/mobile/hooks/useHaptics.ts` | Fire-and-forget haptic feedback by kind. Call haptic(kind) outside React. | `packages/mobile/components/Toaster.tsx:38` |
| `AppSwitch / SegmentedControl` | `packages/mobile/components/AppSwitch.tsx` | House toggle and segmented picker with AA track colours. | `packages/mobile/components/AccountNotificationPrefsSection.tsx:112` |
| `AdminFields (LabeledTextInput, ModalSelect, TimeField, isValidTime)` | `packages/mobile/components/admin/AdminFields.tsx` | Admin form primitives that are core-RN only so they stay OTA-able. They cover text input, option picker, time and hex fields. | `packages/mobile/app/admin/festival-edit.tsx:870` |
| `sanitizeAmountInput / parseHomeBaseTime` | `packages/mobile/lib/expenseView.ts` | Input sanitising and validation for money and clock text fields. parseHomeBaseTime is in lib/homeBaseTime.ts. | `packages/mobile/components/CrewHomeBase.tsx:57` |
| `Sheet pattern (to be BottomSheet)` | `packages/mobile/components/FestivalChoiceSheet.tsx` | The reference bottom sheet: Modal slide, shade[9] backdrop, paddingBottom spacing[5]+insets.bottom. Copy this shape until a shared BottomSheet exists. Do not copy the OfflineBanner sheet. | `packages/mobile/components/FestivalChoiceSheet.tsx:21` |
| `ConfirmDialog` | `packages/mobile/components/admin/ConfirmDialog.tsx` | Centred confirm or cancel dialog on core Modal, with a sibling backdrop for a11y. | `packages/mobile/app/admin/users.tsx:520` |
| `useReauthPrompt / ReauthDialog` | `packages/mobile/components/admin/ReauthDialog.tsx` | Re-authentication prompt. useReauthPrompt() returns ask() and a reauthDialog node to render once. | `packages/mobile/components/AccountDangerSection.tsx:57` |

## Read location or compute distance

| Name | Path | What it does | Example caller |
|---|---|---|---|
| `useCurrentPosition` | `packages/shared/src/hooks/useCurrentPosition.ts:26` | One-shot geolocation with locating flag and error callback. | `packages/web/src/components/crew/CrewStatus.tsx:106` |
| `shared geo` | `packages/shared/src/utils/geo.ts` | haversineDistance, bearing, etaMinutes, formatDistance, compass8, nearestPin. Mobile lib/compass.ts only adds heading smoothing. | `packages/mobile/components/MeetingPointCompass.tsx:244` |

## Add a backend integration test

| Name | Path | What it does | Example caller |
|---|---|---|---|
| `createFestivalPlanner boot helpers: startServer, ensureTestSchema, truncateAllTables, seedTestData, createFestivalFixture` | `tests/_integration-helpers.ts:74` | Boots the app on port 0 against TEST_DATABASE_URL with a seeded two-set fixture and returns { baseUrl, planner, request, close }; exits the process unless the database URL contains _test. Use the local test database, never production. | `tests/integration-festivals.test.ts:11` |
| `ensureTestSchema(databaseUrl)` | `tests/_test-schema.ts:20` | Runs the migrations once per URL and throws unless the database name ends in _test. | `tests/account-lifecycle.test.ts:79` |
| `markTrustedMutation(requestBuilder) and TRUSTED_MUTATION_HEADER` | `tests/_integration-helpers.ts:248` | Adds the x-festie-request header that mutating routes require. | `tests/integration-auth.test.ts:17` |
| `connectSocket, waitForEvent` | `tests/_integration-helpers.ts:217` | Opens a socket.io client against a started server and awaits one matching event with a timeout. | `tests/draft-leak.test.ts:153` |
| `startArtistServer, seedFestival, createArtist, setRow, festivalRow, formBody, dropFestivalCache, withPool, skip` | `tests/_artist-helpers.ts:39` | Seeds a typed festival with days and sets, boots the artist API server and reads rows back; exports the DB skip flag and a short-lived pool. | `tests/artists-routes.test.ts:8` |
| `Pool on TEST_DATABASE_URL with a skip guard (per-file)` | `tests/migration-104.test.ts:14` | Pattern for running a migration against a private test database. Prefer the endsWith _test rule from _test-schema.ts. | `tests/migration-104.test.ts:14` |

## Add a test with a crew, users or a festival profile

| Name | Path | What it does | Example caller |
|---|---|---|---|
| `registerUser, loginUser, loginAdmin, joinFestivalProfile, uploadAvatar` | `tests/_integration-helpers.ts:166` | Registers or logs in a user through the real API and returns the response data. The shared registerUser does not send the trusted-mutation header. | `tests/integration-admin.test.ts:12` |

## Add a route or script test without a database

| Name | Path | What it does | Example caller |
|---|---|---|---|
| `makeFakeRedis()` | `tests/_fake-redis.ts:9` | In-memory ioredis stand-in for strings, sorted sets, hashes (no hdel) and multi().exec(); TTLs are recorded, not enforced. | `tests/battery-low.test.ts:12` |
| `per-file makeDeps(overrides) pattern with node:test mock.fn stores, makeIo(), noopLog` | `tests/crew-members.test.ts:53` | Builds the deps object a route module factory takes; copy the structure, not the file. | `tests/crew-members.test.ts:53` |
| `makeTempDir, writeStub, stubEnv, runScript, startScript, hasCommand` | `tests/_backup-stubs.ts:14` | Creates a temp bin directory with stub commands and runs the script with PATH pointing to it. | `tests/backup-pg-lock.test.ts:5` |

## Add a web, shared or mobile unit test

| Name | Path | What it does | Example caller |
|---|---|---|---|
| `pickInsightFixture, lockscreen fixture` | `packages/shared/src/utils/pickInsight.fixture.ts:4` | Typed fixture objects imported by shared and web tests as @festie/shared/utils/pickInsight.fixture. | `packages/web/src/components/admin/FestivalPickInsight.test.tsx:7` |
| `web test-setup.ts global stubs and the toBeAccessible matcher` | `packages/web/src/test-setup.ts:1` | Loads jest-dom, registers sa11y toBeAccessible and stubs browser APIs jsdom lacks. | `packages/web/src/components/ui/Button.a11y.test.tsx:21` |
| `QueryClientProvider wrapper with retry:false (per-file renderX helper)` | `packages/web/src/components/crew/PollsTab.test.tsx:43` | Renders the component inside a fresh QueryClient with retries off. Copy this form until a shared helper exists. | `packages/web/src/components/crew/PollsTab.test.tsx:43` |
| `makeSet(overrides) FestivalSet factory (per-file)` | `packages/shared/src/utils/conflicts.test.ts:5` | Returns a valid FestivalSet with default 14:00-15:00 times and fixed timestamps. Copy it until a shared factory exists. | `packages/shared/src/utils/conflicts.test.ts:19` |
| `raw-colour-guard with raw-colour-allowlist.json` | `packages/mobile/__tests__/raw-colour-guard.test.ts:1` | Scans mobile source files for raw colour literals against an allowlist; the model for a repo-scanning guard test. | `packages/mobile/__tests__/raw-colour-guard.test.ts:1` |
| `Existing socket and queue test suites to copy fixtures from` | `packages/shared/src/hooks/useCrewRealtime.test.ts:1` | Fake-socket patterns for hooks; see also services/__tests__/socket.test.ts, offlineQueue.test.ts, apiOffline.test.ts, web hooks/useRealtimeSync.test.ts and tests/middleware.test.ts. | `packages/web/src/hooks/useRealtimeSync.test.ts:1` |

## Add an end-to-end browser test

| Name | Path | What it does | Example caller |
|---|---|---|---|
| `Playwright fixtures: resolveTestDatabaseUrl, seeded fest-1/fest-2, app fixture` | `tests/e2e/fixtures.ts:36` | Seeds a deterministic two-festival database and provides the app fixture for specs. | `tests/e2e/festival-planner.spec.ts:1` |

## Guard route security in tests

| Name | Path | What it does | Example caller |
|---|---|---|---|
| `route-security-inventory.test.ts` | `tests/route-security-inventory.test.ts` | Scanner requiring userAuth/adminAuth, Zod validation, scoped rate limit; PUBLIC_ROUTES lists exceptions. | `tests/route-security-inventory.test.ts:28` |
| `festival-access-matrix.test.ts` | `tests/festival-access-matrix.test.ts` | Checks festivalAccess-tagged routes against the access matrix. | `tests/festival-access-matrix.test.ts:6` |
