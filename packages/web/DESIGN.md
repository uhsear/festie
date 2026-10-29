---
name: Festie
description: Real-time festival crew coordination, lit like a stage at night.
colors:
  stage-black: "#0a0a0a"
  booth-grey: "#1a1a1a"
  sticky-band: "#161616"
  card-smoke: "rgba(26, 26, 26, 0.65)"
  card-smoke-hover: "rgba(38, 38, 38, 0.8)"
  elevated-smoke: "rgba(32, 32, 32, 0.9)"
  hairline: "rgba(255, 255, 255, 0.06)"
  hairline-strong: "rgba(255, 255, 255, 0.1)"
  house-light: "#eaeaf2"
  dusk-lavender: "#9999bb"
  fog-lavender: "#8787a8"
  spotlight-aqua: "#00e8d0"
  flare-coral: "#ff3366"
  flare-coral-strong: "#c01d3a"
  marquee-amber: "#ffb020"
  live-green: "#39ff14"
  alert-red: "#f87171"
typography:
  display-xl:
    fontFamily: "'Clash Display', 'Clash Display Fallback', sans-serif"
    fontSize: "48px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  display-lg:
    fontFamily: "'Clash Display', 'Clash Display Fallback', sans-serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  heading:
    fontFamily: "'Clash Display', 'Clash Display Fallback', sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  title:
    fontFamily: "'Space Grotesk', system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "'Space Grotesk', system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  label:
    fontFamily: "'Space Grotesk', system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  caption:
    fontFamily: "'Space Grotesk', system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
  micro:
    fontFamily: "'Space Grotesk', system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.08em"
rounded:
  xs: "4px"
  sm: "8px"
  md: "10px"
  default: "12px"
  lg: "20px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "6": "24px"
  "8": "32px"
  "12": "48px"
  "20": "80px"
components:
  button-primary:
    backgroundColor: "{colors.spotlight-aqua}"
    textColor: "{colors.stage-black}"
    rounded: "{rounded.default}"
    padding: "8px 16px"
    height: "44px"
  button-danger:
    backgroundColor: "{colors.flare-coral-strong}"
    textColor: "#ffffff"
    rounded: "{rounded.default}"
    padding: "8px 16px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.card-smoke}"
    textColor: "{colors.house-light}"
    rounded: "{rounded.default}"
    padding: "8px 16px"
    height: "44px"
  card:
    backgroundColor: "{colors.card-smoke}"
    rounded: "{rounded.default}"
    padding: "16px"
  input:
    backgroundColor: "{colors.card-smoke}"
    textColor: "{colors.house-light}"
    rounded: "{rounded.default}"
    height: "44px"
---

# Design System: Festie

## Overview

**Creative North Star: "Stagelight"**

Festie is a dark venue where light marks what matters. The canvas is stage-black, and almost everything on it is quiet: near-white house light for text, two soft lavenders for secondary information, and hairline borders. Colour arrives only as a signal. Spotlight aqua marks your picks, selection and the primary action. Flare coral marks danger, SOS and a `must` pick. Marquee amber marks a `maybe`. Live green marks something happening right now.

The system serves the festival day first: a phone held in one hand, glanced at between sets, in glare or in a dark crowd. Density is moderate. Targets are large, labels are bold, and the answer to "what now, where is my crew" sits at the top of the screen. Planning views such as the Grid and Compare may run denser, but they keep the same signal language. Daylight mode, a high-contrast theme for direct sun, is a committed part of this world (see Colors).

The identity is refined, not repainted. It rejects four things outright: a generic SaaS dashboard look, the busy sponsor-heavy look of official festival apps, neon cyberpunk overload, and a childish or cartoonish feel.

**Key Characteristics:**
- Near-black canvas with tonal layers; colour only as signal.
- One primary accent (aqua); coral reserved for danger, SOS, the live exception and `must`.
- Clash Display for headings, Space Grotesk for everything else.
- Tactile, confident controls with 44 px minimum targets.
- Motion that confirms an action, never decorates.

## Colors

A monochrome venue lit by four signal colours, each with exactly one job.

### Primary
- **Spotlight Aqua** (#00e8d0): the single primary and selection accent. Primary buttons, active tabs, selected chips, focus outlines, `want-to-see` picks. Text on a filled aqua surface is stage-black.

### Secondary
- **Flare Coral** (#ff3366): danger, SOS, the live exception and the `must` priority. Borders, glows, icons and text-on-dark only.
- **Flare Coral Strong** (#c01d3a): the filled form of coral behind white text, about 6:1. Danger buttons and filled `must` badges.

### Tertiary
- **Marquee Amber** (#ffb020): the `maybe` priority, aging-data warnings and failed delivery.
- **Live Green** (#39ff14): live and fresh-data confidence only.

### Neutral
- **Stage Black** (#0a0a0a): the app background.
- **Booth Grey** (#1a1a1a) and **Sticky Band** (#161616): secondary surfaces and sticky headers.
- **Card Smoke** (rgba(26, 26, 26, 0.65)), **Card Smoke Hover**, **Elevated Smoke**: the tonal layers for cards, rows and raised panels.
- **Hairline** (rgba(255, 255, 255, 0.06)) and **Hairline Strong** (0.1): borders and dividers.
- **House Light** (#eaeaf2): primary text.
- **Dusk Lavender** (#9999bb): secondary text.
- **Fog Lavender** (#8787a8): muted text and the stale-data state.
- **Alert Red** (#f87171): inline error text.

### Named Rules
**The One Spotlight Rule.** Aqua is the only selection and primary-action colour. Anything selected or active is aqua, never coral, amber or a new hue.

**The Filled Coral Rule.** Filled coral (#ff3366) behind light text fails AA at 3.55:1. Fill with Flare Coral Strong; keep #ff3366 for borders, glows and icons.

**The Never Alone Rule.** A status or confidence colour never carries meaning alone. Pair it with a word, numeral, icon or shape.

**The Daylight Rule.** Every colour token gets a Daylight counterpart that keeps its role and reaches at least 7:1 for text under glare. A screen that only works on stage-black is unfinished. Daylight tokens live in `@festie/shared/tokens` as `colorsDaylight` (same roles, light ground, signal colours darkened to 7:1); `contrast.test.ts` holds the line. On web, a one-tap sun toggle in the header and a row in Account set it, and `/theme-init.js` applies it before first paint.

## Typography

**Display Font:** Clash Display (with 'Clash Display Fallback', sans-serif)
**Body Font:** Space Grotesk (with system-ui, sans-serif)

**Character:** Clash Display gives headings a poster-like, festival-bill confidence; Space Grotesk keeps body, labels and numbers technical and legible at a glance.

### Hierarchy
- **Display XL** (700, 48px, 1.15): Wrap and hero moments only.
- **Display LG** (700, 32px, 1.15): screen titles in Festival Mode and Wrap.
- **Heading** (700, 24px, 1.15): section and page headings.
- **Title** (600, 20px, 1.3): card titles, artist names in detail views.
- **Body** (400, 16px, 1.5): running text; 16px minimum in inputs to avoid iOS focus zoom.
- **Label** (500, 14px, 1.5): buttons, list rows, metadata.
- **Numeral** (14px, tabular figures): set times, counts, money.
- **Caption** (500, 12px): secondary metadata.
- **Micro** (600, 10px, 0.08em, uppercase): tab labels and badges only.

### Named Rules
**The Named Role Rule.** Use the `type-*` roles and token variables. Never an ad-hoc `text-[Npx]` or a raw font size.

**The Tabular Time Rule.** Every time, countdown, count and amount uses tabular numerals, so columns of times align and live counters do not jitter.

## Layout

A 4 px spacing base (steps 4, 8, 12, 16, 24, 32, 48, 80). Mobile-first single column, with breakpoints at 640, 768, 1024, 1280 and 1536 px. A bottom navigation bar serves phones; wider screens add the header and side panels. The detail panel opens as a drawer on phones and a side panel on wide screens. Layouts must hold at 320 px wide without horizontal scroll. Long schedule lists use `content-visibility: auto`.

## Elevation & Depth

Depth comes from tonal layering: each raised surface is a slightly lighter smoke over stage-black, separated by hairlines. Coloured glow (aqua, coral, amber, green, 20 to 24 px blur) marks live or selected state only. Frosted glass (backdrop blur) is reserved for chrome that floats over content: the bottom bar, sheets and overlays.

### Shadow Vocabulary
- **Sticky shadow** (`--shadow-sticky`): separates sticky headers from scrolling content.
- **State glows** (`colors.glow.*`): live, selected and SOS emphasis.

### Named Rules
**The Glow Means State Rule.** A glow says "this is live or selected". A resting element never glows.

**The Glass Is Chrome Rule.** Glass is for navigation, sheets and overlays. Content cards are tonal, not frosted, because glass reads poorly under glare and costs battery.

## Shapes

Gently rounded throughout: 12 px for cards, buttons and inputs, 8 px for chips and small controls, 20 px for sheets and large panels, and pills (999 px) for badges and segmented controls. Borders are 1 px hairlines. No sharp corners, no blobs.

## Components

### Buttons
Tactile and confident: bold labels, generous targets, a clear press response.
- **Shape:** gently rounded (12px).
- **Primary:** Spotlight Aqua fill, stage-black label, 44 px minimum height.
- **Danger:** Flare Coral Strong fill, white label.
- **Secondary:** Card Smoke fill, House Light label. **Outline:** transparent with a hairline border.
- **Hover / Focus:** 200 ms colour and transform transition with the `out` easing. Focus is a 2 px outline, offset 2 px, in the variant's accent.
- **Icon buttons:** 44 × 44 px minimum.

### Chips
- **Style:** pill or 8 px radius, Card Smoke background, hairline border.
- **State:** selected is aqua; priority chips use their priority colour as border and text, filled only with the AA-safe variant.

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** Card Smoke, Card Smoke Hover on hover.
- **Shadow Strategy:** tonal; glow only for live or selected cards.
- **Border:** hairline.
- **Internal Padding:** 12, 16 or 24 px.
- **Interactive cards:** lift 2 px on hover and scale down slightly on press.

### Inputs / Fields
- **Style:** Card Smoke background, hairline border, 12 px radius, 16 px text, 44 px height.
- **Focus:** 2 px aqua outline, offset 2 px.
- **Error:** coral border and outline, with Alert Red helper text.

### Navigation
The bottom bar is frosted chrome with micro uppercase labels. The active item turns aqua with a soft aqua glow on its icon and sets `aria-current="page"`. Every item is 44 px tall minimum.

### Set Card (signature)
The atomic unit of the schedule: artist, stage, time and priority. The priority shows as colour plus a word or shape, never colour alone. Crew overlap shows beside it. Live sets carry the live signal; past sets dim.

## Do's and Don'ts

### Do:
- **Do** answer "what now, where is my crew" in the first screenful of every day-of view.
- **Do** use token variables and `type-*` roles for every colour, size, radius and duration.
- **Do** keep text at 4.5:1 and UI components at 3:1 or better, and give every control a 44 px target.
- **Do** honour `prefers-reduced-motion`: replace movement with an instant change or a fade.
- **Do** use icons (Lucide) for UI meaning.

### Don't:
- **Don't** use emoji as UI. Ratings, placeholders and status use icons.
- **Don't** introduce a new accent hue, gradient text or a second primary colour.
- **Don't** fill large areas with coral or glow resting elements.
- **Don't** look like a generic SaaS dashboard, a sponsor-heavy official festival app, a neon cyberpunk screen or a cartoon.
- **Don't** hardcode hex values in components; add or reuse a token in `@festie/shared`.
