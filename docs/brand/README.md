# Festie brand kit

This page is the first brand guide. It records what exists and the rules for using it. It does not
redesign the logo. Later work (DP-08 in the master design plan) adds the Daylight and
one-colour files and the stacked lockup.

## Master files

| File | Use |
|------|-----|
| `festie-mark.svg` | Master mark. The viewBox is 512 × 512. Every other file is derived from it. |
| `festie-lockup.svg` | Master horizontal lockup: mark plus wordmark, viewBox 853 × 199. |
| `festie-lockup.png` | Raster of the lockup, 1706 × 398, for email and other places that cannot use SVG. |

`packages/web/public/favicon.svg` is a cropped copy of `festie-mark.svg`. Change the master first,
then recrop the favicon.

## Colour values

| Part | Stage (dark ground) | Daylight |
|------|---------------------|----------|
| Pin | Spotlight Aqua `#00e8d0` | Not built yet. The Daylight token is `#00594f`. |
| Tent legs | Flare Coral `#ff3366` | Not built yet. The Daylight token is `#a8002a`. |
| Wordmark | House Light `#eaeaf2` | Not built yet. |

The mark has no Daylight file yet. Until DP-08 adds one, do not place the Stage mark on a light
ground, because the aqua pin fails contrast there.

### The coral exception

Coral in the product means danger, SOS and a `must` pick. The mark's coral is the one deliberate
exception. It applies to identity assets only: the mark, the lockup and the poster footer. Never
use it for a control or a status.

## Clear space

Keep clear space around the mark equal to the pin-hole diameter. The hole is a circle of radius 20
in the 512 unit viewBox, so the diameter is 40 units, about 8% of the mark's width.

## Minimum size

- Mark alone: 16 px wide.
- Horizontal lockup: 80 px wide. The email header shows it 110 px wide.

Below those sizes the pin gap closes. Use the mark alone when the space is narrower than 80 px.

## Approved lockups

1. **Mark alone**, 24 to 28 px, in app chrome on web and mobile. In product chrome the word
   "FESTIE" sits beside it in Clash Display 700 caps, in House Light (`text.primary`).
2. **Mixed-case "Festie" lockup** (`festie-lockup.svg` or `.png`) on OG images, email and server
   pages, such as the festival, invite and share pages. The email header uses `public/icons/email-lockup.png`.
3. **Tracked caps "FESTIE"** only in the header of the Wrap poster.

A stacked lockup is planned and is not approved yet.

## Misuse

- Do not recolour the mark outside the values above.
- Do not set the wordmark in another face.
- Do not use the coral wordmark in product chrome. The coral stays in the mark.
- Do not add effects such as a shadow, glow or outline.
