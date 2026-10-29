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
    fontFamily: "ClashDisplay"
    fontSize: "48px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  display-lg:
    fontFamily: "ClashDisplay"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  heading:
    fontFamily: "ClashDisplay"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  title:
    fontFamily: "SpaceGrotesk"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "SpaceGrotesk"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  label:
    fontFamily: "SpaceGrotesk"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  caption:
    fontFamily: "SpaceGrotesk"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
  micro:
    fontFamily: "SpaceGrotesk"
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
- Tactile, confident controls with 44 pt / 48 dp minimum targets and haptic confirmation.
- Motion that confirms an action, never decorates.

## Colors

A monochrome venue lit by four signal colours, each with exactly one job.

### Primary
- **Spotlight Aqua** (#00e8d0): the single primary and selection accent. Primary buttons, active tabs, selected chips, focus outlines, `want-to-see` picks, the day-tab underline. Text on a filled aqua surface is stage-black.

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

**The Daylight Rule.** Every colour token gets a Daylight counterpart that keeps its role and reaches at least 7:1 for text under glare. A screen that only works on stage-black is unfinished. Daylight tokens live in `@festie/shared/tokens` as `colorsDaylight` (same roles, light ground, signal colours darkened to 7:1); `contrast.test.ts` holds the line. The web app ships the toggle first; mobile follows.

## Typography

**Display Font:** Clash Display, loaded at runtime with `expo-font` so it ships by OTA.
**Body Font:** Space Grotesk (400, 500, 600, 700 via `@expo-google-fonts/space-grotesk`)

**Character:** Clash Display gives headings a poster-like, festival-bill confidence; Space Grotesk keeps body, labels and numbers technical and legible at a glance.

### Hierarchy
- **Display XL** (700, 48 pt, 1.15): Wrap and hero moments only.
- **Display LG** (700, 32 pt, 1.15): screen titles in Festival Mode and Wrap.
- **Heading** (700, 24 pt, 1.15): section and page headings.
- **Title** (600, 20 pt, 1.3): card titles, artist names in detail views.
- **Body** (400, 16pt, 1.5): running text.
- **Label** (500, 14 pt, 1.5): buttons, list rows, metadata.
- **Numeral** (14 pt, tabular figures): set times, counts, money.
- **Caption** (500, 12 pt): secondary metadata.
- **Micro** (600, 10 pt, 0.08em, uppercase): tab labels and badges only.

### Named Rules
**The Named Role Rule.** Use `typeStyle(<role>)` from `useTokens()`. Never a raw `fontSize` or `fontFamily` in a StyleSheet.

**The Tabular Time Rule.** Every time, countdown, count and amount uses tabular numerals, so columns of times align and live counters do not jitter.

## Layout

A 4 pt spacing base (steps 4, 8, 12, 16, 24, 32, 48, 80), read through `useTokens()` and `makeStyles()`. Single-column screens inside safe areas. Navigation is native tabs (Schedule, Picks, Crew, Account) with stacks above them, and detail views push or present as native sheets. Lists use `FlatList` with `useListBottomInset` so content clears the tab bar. Text scales with the OS font size up to `MAX_FONT_SCALE` (1.4); layouts must not clip or overlap at that scale or on a 320 pt wide screen.

### Named Rules
**The Platform Shell Rule.** Structure, navigation and gestures follow the platform: iOS Human Interface Guidelines on iOS, Material 3 on Android. Festie's identity lives in colour, type, iconography and detail, never in a custom replacement for a native control.

## Elevation & Depth

Depth comes from tonal layering: each raised surface is a slightly lighter smoke over stage-black, separated by hairlines. Coloured glow (aqua, coral, amber, green, 20 to 24 pt blur) marks live or selected state only. Native chrome (tab bar, navigation bar, sheets) keeps the platform's own material. Custom blur is not used on content.

### Shadow Vocabulary
- **State glows** (`colors.glow.*`): live, selected and SOS emphasis.

### Named Rules
**The Glow Means State Rule.** A glow says "this is live or selected". A resting element never glows.

**The Native Material Rule.** Only native chrome uses blur or translucency. Content cards are tonal, because glass reads poorly under glare and costs battery.

## Shapes

Gently rounded throughout: 12 pt for cards, buttons and inputs, 8 pt for chips and small controls, 20 pt for sheets and large panels, and pills (999 pt) for badges and segmented controls. Borders are 1 pt hairlines. No sharp corners, no blobs.

## Components

### Buttons
Tactile and confident: bold labels, generous targets, a clear press response.
- **Shape:** gently rounded (12 pt).
- **Primary:** Spotlight Aqua fill, stage-black label, 44 pt minimum height.
- **Danger:** Flare Coral Strong fill, white label.
- **Secondary:** Card Smoke fill, House Light label. **Outline:** transparent with a hairline border.
- **Press:** `PressableScale` springs down slightly (`spring.touch`: mass 1, stiffness 300, damping 30) with a light haptic on meaningful actions. Reduce Motion turns the scale off.
- **Targets:** 44 × 44 pt on iOS and 48 × 48 dp on Android minimum, using `hitSlop` where the visual is smaller.
- **Accessibility:** every button sets `accessibilityRole` and an `accessibilityLabel` when its text is not self-describing.

### Chips
- **Style:** pill or 8 pt radius, Card Smoke background, hairline border.
- **State:** selected is aqua; priority chips use their priority colour as border and text, filled only with the AA-safe variant.

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** Card Smoke, Card Smoke Hover on hover.
- **Shadow Strategy:** tonal; glow only for live or selected cards.
- **Border:** hairline.
- **Internal Padding:** 12, 16 or 24 px.
- **Interactive cards:** scale down slightly on press; no hover state.

### Inputs / Fields
- **Style:** native `TextInput` on Card Smoke, hairline border, 12 pt radius, 16 pt text, 44 pt height.
- **Focus:** aqua border; the platform keyboard and selection colours stay native, tinted aqua.
- **Error:** coral border and outline, with Alert Red helper text.

### Navigation
`NativeTabs` with SF Symbols on iOS and Material icons on Android, tinted Spotlight Aqua. Headers use `ScreenHeader` / native stack titles. Back gestures, large titles and sheet detents behave as the platform does.

### Set Card (signature)
The atomic unit of the schedule: artist, stage, time and priority. The priority shows as colour plus a word or shape, never colour alone. Crew overlap shows beside it. Live sets carry the live signal; past sets dim.

## Do's and Don'ts

### Do:
- **Do** answer "what now, where is my crew" in the first screenful of every day-of view.
- **Do** read every colour, size, radius and duration from `useTokens()`.
- **Do** keep text at 4.5:1 and UI components at 3:1 or better, and give every control a 44 pt / 48 dp target.
- **Do** honour Reduce Motion through `useReduceMotion()`: replace movement with an instant change or a fade.
- **Do** use icons (SF Symbols, Ionicons) for UI meaning.

### Don't:
- **Don't** use emoji as UI. Ratings, placeholders and status use icons.
- **Don't** introduce a new accent hue, gradient text or a second primary colour.
- **Don't** fill large areas with coral or glow resting elements.
- **Don't** look like a generic SaaS dashboard, a sponsor-heavy official festival app, a neon cyberpunk screen or a cartoon.
- **Don't** hardcode hex values in components; add or reuse a token in `@festie/shared`.
- **Don't** rebuild a native control (tab bar, switch, date picker, sheet) in custom views.
