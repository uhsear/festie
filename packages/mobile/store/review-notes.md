# App Review notes

Festie is a festival crew-coordination app. These notes explain the features App Review may check.

## Sign-in

- Sign in with a username and password, with Sign in with Apple, or with Sign in with Google.
- A demo account is in App Store Connect under App Review Information.

## Age

- Festie is for people aged 18 or older.
- Registration asks for a date of birth and blocks anyone under 18.

## Crew location sharing

- Location sharing is off by default.
- The user turns it on for one crew at a time and picks when it stops.
- Sharing stops at the chosen time.
- Background location is used only when the user keeps sharing with the phone locked.
- To stop everything at once, open Account, then Privacy, then Stop all sharing.

## SOS

- The SOS button sends one rough position, rounded to about 11 m, to the user's crew only.
- Server code: `routes/crew-sos.ts`.

## Camera

- The camera is used only to scan a plan QR code.
- App code: `components/PlanQRScan.tsx`.

## Offline maps

- A festival can provide a downloadable offline map. Festivals without one show a pin list.

## Account deletion

- Open Account, then Delete account.

## Push notifications

- Push notifications are opt-in. The user can turn each type off in More.
