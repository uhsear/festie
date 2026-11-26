# Privacy answers for the store consoles

This file is the source for the Google Play Data safety form and the Apple App Privacy form.
Copy answers from here into the consoles. The policy at `public/privacy.html` stays the legal text.
If this file and the policy disagree, fix this file. `privacy-answers.test.ts` checks that every type in `app.json` appears in the Apple table.

Rules for this file: no secrets, no hosts, no keys. Console names are exact so the owner can match them on screen.

## Apple App Privacy

Tracking: no. `NSPrivacyTracking` is `false` and `NSPrivacyTrackingDomains` is empty. Festie uses no advertising ID.

| Apple data type | `app.json` type | What we collect | Purpose | Linked to identity | Optional | Retention | Code |
|---|---|---|---|---|---|---|---|
| Precise Location | `NSPrivacyCollectedDataTypePreciseLocation` | Status location, meeting points, live location, SOS position, check-in position | App Functionality | Yes | Yes | Live location: about 2 minutes on the server, never in the database. SOS: until the crew or account is deleted. Check-in: 1 hour after the timer ends. Status location: until a newer status replaces it or Stop all sharing | `routes/crew-live-location.ts`, `routes/crew-sos.ts`, `routes/crew-checkin.ts`, `packages/mobile/lib/backgroundShare.ts` |
| Email Address | `NSPrivacyCollectedDataTypeEmailAddress` | Email for verification, reset and notices; email from Sign in with Apple or Google | App Functionality | Yes | Required | Until the account is deleted (plus 30-day grace) | `routes/auth.ts`, `routes/oauth.ts`, `routes/email-auth.ts` |
| Name | `NSPrivacyCollectedDataTypeName` | Display name (optional). The username is also shown to others | App Functionality | Yes | Yes | Until the account is deleted | `routes/account.ts` |
| Photos or Videos | `NSPrivacyCollectedDataTypePhotosorVideos` | Profile photo upload | App Functionality | Yes | Yes | Until removed or the account is deleted | `routes/account.ts`, `packages/mobile/components/AccountIdentityCard.tsx` |
| Other User Content | `NSPrivacyCollectedDataTypeOtherUserContent` | Picks, notes, ratings, crew posts, statuses, polls, packing items, rides | App Functionality | Yes | Yes | Until the account is deleted; crew content until the crew is deleted | `routes/crews.ts`, `routes/crew-members.ts` |
| Other Financial Info | `NSPrivacyCollectedDataTypeOtherFinancialInfo` | Venmo, Cash App and PayPal names that the user adds. Festie never moves money | App Functionality | Yes | Yes | Until the account is deleted | `routes/account.ts`, `routes/expenses.ts` |
| User ID | `NSPrivacyCollectedDataTypeUserID` | Username, Apple and Google account IDs, sign-in sessions | App Functionality | Yes | Required (username) | Account: until deleted. Sessions: app refresh token up to 90 days. Security log: up to 1 year | `routes/auth.ts`, `routes/oauth.ts` |
| Device ID | `NSPrivacyCollectedDataTypeDeviceID` | Push token from the device | App Functionality | Yes | Yes | 60 days without use | `routes/notifications.ts`, `packages/mobile/hooks/useMobilePush.ts` |
| Crash Data | `NSPrivacyCollectedDataTypeCrashData` | Sentry error reports | App Functionality | No | Required | Held by Sentry; not in our database | `packages/mobile/app/_layout.tsx` |
| Performance Data | `NSPrivacyCollectedDataTypePerformanceData` | Sentry timings of a 5% sample of screens and requests (`tracesSampleRate` 0.05, `sendDefaultPii` false) | App Functionality | No | Required | Held by Sentry; not in our database | `packages/mobile/app/_layout.tsx` |
| Other Data Types | `NSPrivacyCollectedDataTypeOtherDataTypes` | Date of birth (age check, 18 or older) and battery level (only if the user turns on Show my battery level) | App Functionality | Yes | Date of birth required, battery optional | Date of birth: until the account is deleted. Battery: sent with live location, not stored | `routes/auth.ts`, `lib/schemas/auth.ts`, `packages/mobile/lib/backgroundShare.ts` |

Not collected: contacts, health, payment card or bank data, browsing history, search history, purchases, advertising data.
Product Interaction (`NSPrivacyCollectedDataTypeProductInteraction`) is declared in `app.json` but the mobile app collects no usage events. Do not declare it in App Privacy. SR-37 removes it from the manifest.
The camera scans a plan QR code and keeps nothing (`packages/mobile/components/PlanQRScan.tsx`), so it needs no row.
Apple has no date-of-birth type. Owner choice recorded here: declare it under Other Data Types.

## Google Play Data safety

| Play category and type | What we collect | Collected | Shared | Optional | Purpose | Retention | Code |
|---|---|---|---|---|---|---|---|
| Location: Precise location | Status location, meeting points, live location, SOS position, check-in position | Yes | No | Yes | App functionality | See the Apple table, row Precise Location | `routes/crew-live-location.ts`, `routes/crew-sos.ts`, `routes/crew-checkin.ts` |
| Personal info: Name | Display name | Yes | No | Yes | App functionality, Account management | Until the account is deleted | `routes/account.ts` |
| Personal info: User IDs | Username, Apple and Google account IDs | Yes | No | Username required | App functionality, Account management | Until the account is deleted | `routes/auth.ts`, `routes/oauth.ts` |
| Personal info: Email address | Email address | Yes | No | Required | App functionality, Account management | Until the account is deleted | `routes/auth.ts`, `routes/email-auth.ts` |
| Personal info: Other info | Date of birth | Yes | No | Required | Account management | Until the account is deleted | `routes/auth.ts`, `lib/schemas/auth.ts` |
| Financial info: Other financial info | Venmo, Cash App and PayPal names that the user adds. Festie never moves money | Yes | No | Yes | App functionality | Until the account is deleted | `routes/account.ts`, `routes/expenses.ts` |
| Photos and videos: Photos | Profile photo | Yes | No | Yes | App functionality | Until removed or the account is deleted | `routes/account.ts` |
| App activity: Other user-generated content | Picks, notes, ratings, crew posts, statuses | Yes | No | Yes | App functionality | Until the account is deleted | `routes/crews.ts`, `routes/crew-members.ts` |
| App info and performance: Crash logs | Sentry error reports | Yes | No | Required | Analytics, App functionality | Held by Sentry | `packages/mobile/app/_layout.tsx` |
| App info and performance: Diagnostics | Sentry timings of a 5% sample | Yes | No | Required | Analytics | Held by Sentry | `packages/mobile/app/_layout.tsx` |
| Device or other IDs | Push token | Yes | No | Yes | App functionality | 60 days without use | `routes/notifications.ts`, `packages/mobile/hooks/useMobilePush.ts` |

Not collected: contacts, calendar, messages, audio, files, health, web history.
Battery level (optional, live location only) is not a Play type. It is not stored, so leave it out of the form.
Backups: up to 13 weeks, encrypted. Security log (IP address with sign-ins): up to 1 year. Neither is an app-collected type, so the Play form needs no extra row.

### Answers that are not data types

| Question | Answer | Source |
|---|---|---|
| Data encrypted in transit | Yes, HTTPS | policy section 13 |
| Way to request deletion | Yes. In the app (Account, Delete account) and at `https://festie.us/delete-account` | `public/delete-account.html`, policy sections 8 and 14 |
| Data deleted on request | Yes. Account returns for 30 days, then deletion; backups age out within 13 weeks | policy section 8 |
| Ads | None | policy section 3 |
| Data sold | No | policy section 4 |
| Families policy | Not applicable. Festie is 18+ | policy section 12 |

### Service providers

Sentry, Firebase Cloud Messaging, Apple Push, Resend, Cloudflare and GitHub (encrypted backups only) process data for Festie under policy section 5.
Recommended answer: Play treats a provider that acts only for the developer as not "sharing", so answer Shared: No.
Mark this "confirm in console". The owner or counsel makes the final call.

## Declared in `app.json` versus collected in code

SR-37 applies this list. SR-32 does not edit `app.json`.

| Apple data type | In `app.json` `privacyManifests` | Collected in code | Status |
|---|---|---|---|
| Precise Location | Yes | Yes | match |
| Email Address | Yes | Yes | match |
| Photos or Videos | Yes | Yes | match |
| Other User Content | Yes | Yes | match |
| User ID | Yes | Yes | match |
| Device ID | Yes | Yes | match |
| Crash Data | Yes | Yes | match |
| Name | No | Yes, display name | missing from manifest: add `NSPrivacyCollectedDataTypeName`, linked, App Functionality |
| Other Data Types (date of birth, battery) | No | Yes | missing from manifest: add `NSPrivacyCollectedDataTypeOtherDataTypes`, linked, App Functionality |
| Performance Data | No | Yes, Sentry traces at 5% | missing from manifest: add `NSPrivacyCollectedDataTypePerformanceData`, not linked, App Functionality |
| Other Financial Info | No | Yes, payment handles | missing from manifest: add `NSPrivacyCollectedDataTypeOtherFinancialInfo`, linked, App Functionality |
| Product Interaction | Yes, analytics | No. The mobile app sends no usage events. Web page-speed and install-prompt counts are web only | extra in manifest: remove in SR-37 |

Tracking stays `false`. The accessed-API list (UserDefaults `CA92.1`, FileTimestamp `C617.1`, DiskSpace `E174.1`) is out of scope here.

## Open rows

After the reports and blocks feature (SR-68) merges, add a row to both tables: reports and blocks, user content, linked, optional.
