# Copy and Voice

One name for each thing. Web and mobile read the shared words from `COPY` in
`packages/shared/src/constants/copy.ts`. Icons come from `packages/web/src/lib/conceptIcons.ts`
and `packages/mobile/lib/conceptIcons.ts`.

## Voice

- Write short, warm, concrete sentences in the second person.
- Name the thing and the next step.
- Make button labels verbs.
- Say what failed and what to do in every error.
- Avoid jargon.

## Casing

Proper names of features use title case: Now & Next, Festival Wrap, Crew Wrap, Home Base.
Everything else uses sentence case.

## Words

| Concept | Say | Do not say | Icon (web / mobile) | Where it lives |
|---|---|---|---|---|
| Live-day screen | Now & Next; button "Open Now & Next" | Festival Mode, Now (as a destination), live mode | Zap / flash | `COPY.nowNext` |
| Timeline scroll button | Jump to now | Now (alone) | Clock / time-outline | `COPY.jumpToNow` |
| Your picked sets | Tab "Picks"; title, chip, home action "My picks" | My Picks, plan, favourites | ListChecks / list | `COPY.picks` |
| Priority | Buttons: Must / Want / Maybe. Headings and screen readers: Must See / Want to See / Maybe | MUST SEE on a button, diamond | Star / heart / circle | `PRIORITY_SYMBOLS` |
| The star | Must See only | Picks, Wrap, owner, rating | Star / star | `PRIORITY_SYMBOLS` |
| Crew's combined schedule | Crew plan | Plan (alone) | unchanged | n/a |
| Share your picks as a link | Share picks | Share plan | unchanged | `COPY.picks.share` |
| Offline QR or text handoff | Web: Share by QR. Mobile: Share offline | Share plan, Share plan (QR) | QrCode / qr-code-outline | `COPY.picks` |
| Post-festival summary | Festival Wrap; tab "Wrap"; Crew Wrap | Festival wrap, wrap-up, recap, Your Festival Wrap | Gift / gift | `COPY.wrap` |
| Map, compass, live location, meeting points | Find; button "Find your crew" | Find each other | MapPin / location | `COPY.find` |
| Crew's main meeting spot | Home Base | home base, HQ, camp | Home / home | `COPY.homeBase` |
| Any member's meeting place | Meeting point: Meet-up, Emergency spot | Pre-show, During, Post-show, After, General | Flag, AlertTriangle / flag, warning | `MEETING_POINT_KINDS` |
| Two picks overlap | Clash; "Clashes with X" | conflict, time conflict | TriangleAlert / warning-outline | `COPY.clash`, `clashCount` |
| Festival running now | Happening now | Live | n/a | `FESTIVAL_STATUS_LABEL` |
| Set on stage now | Playing (screen reader: Playing now) | LIVE | coral dot | `COPY.status` |
| Location sharing | Live (only this) | | coral or green dot | `COPY.status.liveLocation` |
| Account | Sign in, Create account, Sign out; "Sign in to ..." | Log in, Logout, Sign up, Sign Up Free, Create Account, Sign Out | n/a | `COPY.auth`, `signInTo` |
| Live colour | Coral for anything playing now (dot, rail, pill) | Aqua for a NOW dot | n/a | `accent.coral` token |

Code names do not change: `Conflict`, `FestivalMode`, `festival-mode` and the meeting-point type enum stay as they are.

## Adding a string

- Put a user-facing word for a named concept in `COPY`.
- Keep screen-specific sentences in the screen.
- If a word is in the "Do not say" column, the vocabulary test fails.
