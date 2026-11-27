---
name: Poker
description: A friend's kitchen table at 22:00 — walnut room, green fold-out felt, clay chips, one lamp on whoever must act.
colors:
  walnut-950: "#160f0b"
  walnut-900: "#1d1510"
  walnut-850: "#31231a"
  walnut-800: "#3b2a20"
  walnut-600: "#4d3829"
  walnut-500: "#6a4f3b"
  rail: "#24160e"
  felt-800: "#0f3322"
  felt-700: "#15432b"
  felt-600: "#1b5434"
  felt-500: "#246a43"
  felt-line: "rgba(222, 242, 228, 0.16)"
  felt-text: "#d0e3d5"
  felt-hint: "#a7c6b0"
  bone: "#efe7d6"
  bone-2: "#d9ceb8"
  muted: "#b9a78f"
  faint: "#8e7a65"
  ink: "#1d1a17"
  line: "rgba(239, 231, 214, 0.1)"
  line-2: "rgba(239, 231, 214, 0.18)"
  card-red: "#b8322a"
  chip-bone: "#e9e0cc"
  chip-red: "#c8372d"
  chip-blue: "#2f5fa8"
  chip-green: "#2f7d4a"
  chip-black: "#1b1715"
  lamp: "#f2b350"
  lamp-hi: "#ffc76a"
  lamp-ink: "#2a1a05"
  lamp-glow: "rgba(255, 190, 100, 0.34)"
  good: "#8fd1a2"
  bad: "#f0958a"
typography:
  display:
    fontFamily: "'Figtree Variable', 'Figtree', ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(30px, 4.2vw, 58px)"
    fontWeight: 800
    lineHeight: 0.95
    letterSpacing: "-0.035em"
    fontFeature: "tnum"
  headline:
    fontFamily: "'Figtree Variable', 'Figtree', ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(28px, 3vw, 44px)"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.035em"
    fontFeature: "tnum"
  title:
    fontFamily: "'Figtree Variable', 'Figtree', ui-sans-serif, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
  body:
    fontFamily: "'Figtree Variable', 'Figtree', ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
    fontFeature: "tnum"
  label:
    fontFamily: "'Figtree Variable', 'Figtree', ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "normal"
    fontFeature: "tnum"
rounded:
  tag: "6px"
  field: "8px"
  control: "10px"
  seat: "14px"
  sheet: "16px"
  pill: "999px"
  felt: "clamp(44px, 9vmin, 110px)"
spacing:
  xs: "4px"
  sm: "8px"
  md: "10px"
  lg: "14px"
  xl: "16px"
  xxl: "22px"
components:
  button-act:
    backgroundColor: "{colors.lamp}"
    textColor: "{colors.lamp-ink}"
    rounded: "{rounded.control}"
    padding: "0 18px"
    height: "44px"
  button-act-hover:
    backgroundColor: "{colors.lamp-hi}"
    textColor: "{colors.lamp-ink}"
  button-act-disabled:
    backgroundColor: "rgba(239, 231, 214, 0.08)"
    textColor: "{colors.faint}"
  button-quiet:
    backgroundColor: "rgba(239, 231, 214, 0.07)"
    textColor: "{colors.bone}"
    rounded: "{rounded.control}"
    padding: "0 18px"
    height: "44px"
  button-fold:
    backgroundColor: "transparent"
    textColor: "{colors.bone}"
    rounded: "{rounded.control}"
    padding: "0 18px"
    height: "52px"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.bad}"
    rounded: "{rounded.control}"
    padding: "0 18px"
    height: "44px"
  icon-button:
    backgroundColor: "rgba(239, 231, 214, 0.06)"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    size: "40px"
  chip-button:
    backgroundColor: "rgba(239, 231, 214, 0.07)"
    textColor: "{colors.bone-2}"
    rounded: "{rounded.pill}"
    padding: "0 11px"
    height: "30px"
  input:
    backgroundColor: "rgba(10, 6, 4, 0.35)"
    textColor: "{colors.bone}"
    rounded: "{rounded.field}"
    padding: "0 12px"
    height: "40px"
  seat-plate:
    backgroundColor: "rgba(14, 9, 6, 0.86)"
    textColor: "{colors.bone}"
    padding: "6px 10px 7px"
  seat-tag:
    backgroundColor: "rgba(14, 9, 6, 0.82)"
    textColor: "{colors.bone-2}"
    rounded: "{rounded.tag}"
    padding: "3px 8px"
  sheet:
    backgroundColor: "{colors.walnut-850}"
    textColor: "{colors.bone}"
    rounded: "{rounded.sheet}"
    padding: "22px"
  toast:
    backgroundColor: "{colors.bone}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "12px 16px"
---

# Design System: Poker

<!-- FORM: Kitchen Table Home Game · seed key a13589ed -->

## Overview

**Creative North Star: "The Kitchen Table at 22:00"**

The game is played at a friend's fold-out table. The room is a dark walnut ground (a vertical gradient with a barely visible horizontal wood grain, a broad warm light pool and darker vignetted edges), the playing surface is a green felt topper shaped as a heavily rounded square with a dashed stitch seam and a fine noise nap, and the money is clay chips seen from above. Faces sit around the felt in seats sized from the room itself, so video dominates the frame rather than hiding in thumbnails.

One lamp lights the table. A soft warm pool of light slides to whoever must act while every other occupied seat dims; the same amber is the only saturated colour on any control, and it means exactly one thing: *you can do this now*. Everything else is bone on walnut or green felt, quiet and legible at night.

Hierarchy is carried by scale, weight and position, never by colour or ornament. The pot and the amount to call are the largest things on screen; stacks, blinds and timers are set in a single workhorse sans with tabular numerals so numbers never jitter. Time is shown as exact-length bars, not rings or spinners.

**Key Characteristics:**
- Walnut room, green felt topper, clay chips, bone paper cards: four materials, nothing else.
- One amber lamp, reserved for action, the acting seat, focus and the turn timer.
- Scale-only hierarchy: pot and amount-to-call are huge, labels are small and muted.
- One sans family (Figtree Variable, self-hosted), tabular numerals everywhere.
- Container-sized seats (cq units) so faces dominate at any viewport.
- Textures are inline SVG and CSS gradients only; no shipping rasters.

## Colors

A dark warm-wood night palette with a deep green playing surface, bone paper for text and cards, five clay-chip hues kept strictly to chips, and one lamp amber held back for action.

### Primary
- **Lamp Amber** (`lamp`): the single saturated control colour. Fills primary action buttons (Check/Call, Raise, Sit down, Start, Open the table), borders the acting seat, fills the turn-timer bar, the raise-slider thumb, toggle-on track, text caret, selection and the 2px focus outline. Hover lifts to **Lamp Bright** (`lamp-hi`); text on amber is **Lamp Ink** (`lamp-ink`). **Lamp Glow** (`lamp-glow`) is the diffuse under-shadow of amber elements and the acting seat.

### Secondary
- **Green Felt** (`felt-600`, resting; `felt-700` when a turn is live, also card backs and the buy-in sheet; the lobby form is `felt-600`): the playing surface. `felt-800` and `felt-500` bound the family. **Felt Thread** (`felt-line`) draws the stitched seam, empty board slots and borders of controls set on felt. **Felt Text** (`felt-text`) and **Felt Hint** (`felt-hint`) replace bone and muted when type sits on the cloth.

### Tertiary
- **Clay Chips** (`chip-bone`, `chip-red`, `chip-blue`, `chip-green`, `chip-black`): stack and bet colours only, one colour per denomination. Low set (small blind not a multiple of 25): bone 1, red 5, green 25, black 100, blue 500. High set: bone 25, red 100, green 500, black 1000, blue 5000. Bone chips are spotted blue; all others are spotted bone. The wordmark's small red-and-bone chip mark is the only other use.
- **Card Red** (`card-red`): red suits on card faces only.

### Neutral
- **Walnut** (`walnut-950` bars and dock, `walnut-900` page and drawer, `walnut-850` sheets and room floor, `walnut-800` room top, `walnut-600` seat-frame highlight and scrollbars, `walnut-500` reserve): the room. **Rail** (`rail`) is the dark wooden edge ring around every felt surface.
- **Bone** (`bone`): primary text, card faces, dealer button, toast, winner tag. **Bone 2** (`bone-2`): secondary text, blind-clock bar, card-back inset frame. **Muted** (`muted`): labels and hints. **Faint** (`faint`): disabled text, folded tags, timestamps. **Ink** (`ink`): text on bone.
- **Lines** (`line`, `line-2`): hairline borders and dividers on walnut; `line-2` for inputs and fold buttons.
- **Good / Bad** (`good`, `bad`): ledger up/down figures, success notes and destructive buttons only.

### Themes (per person)
Each player picks a room from the palette button in the top bar (and the lobby). The choice is stored in that browser only (`homegame:room`) and set as `data-room` on `<html>` by `client/src/lib/theme.ts`; the tokens live in the Themes block of `styles.css`.
- **Rooms:** Valnøtt (default, the walnut night described above), Skifer (cool grey-blue night, same bone text), Lys eik (daylight: linen bars and drawer, oak floor, ink text, `lamp-line` deepened to `#a8680a` so focus rings and amber borders hold contrast on light ground). In Lys eik, camera tiles, the felt and everything lying on it, the lobby form and the buy-in sheet keep the dark walnut tokens, because faces on video and type on cloth need them.
- **The felt is always green** and is not a choice: the group asked for a green table, and one shared cloth keeps the table recognisable on everyone's screen.
- The felt, amber, chip hues and card paper (`paper`, `paper-2`) are identical in every theme. Room-tinted overlays use `rgb(var(--fg-rgb) / α)` and sunken fields `rgb(var(--sink-rgb) / α)`, never literal colours, so new UI themes itself.

### Named Rules
**The One Lamp Rule.** Amber appears only on something you can do now (enabled action buttons, the sit-down hover, toggles, slider thumb), on the seat that must act, on its turn timer, and on keyboard focus. Never on decoration, labels, headings or idle state. Lamp *light* (the low-alpha warm radial pool in the room, the lobby lamp that switches on over the dealt hand) is atmosphere, not paint, and never forms a solid shape.

**The Chips Are Money Rule.** Clay-chip hues belong to chips. They are never used for UI states, categories or accents (the one exception is the blind clock turning chip-green during a break).

**The Dim Room Rule.** When someone must act, every other occupied seat drops to `brightness(0.7) saturate(0.85)` and the felt deepens one step to `felt-700`. Contrast moves toward the actor; nothing else is added.

## Typography

**Display Font:** Figtree Variable (self-hosted via @fontsource, falling back to ui-sans-serif, system-ui)
**Body Font:** Figtree Variable
**Label/Mono Font:** none distinct; numerals are tabular (`font-variant-numeric: tabular-nums` on body)

**Character:** One friendly geometric workhorse doing every job. Weight and size carry hierarchy; big numbers go to 800 with tight negative tracking, labels stay small, sentence-case and muted.

### Hierarchy
- **Display** (800, clamp(30px, 4.2vw, 58px), lh 0.95, -0.035em): the pot amount. The lobby title is the largest type in the app (clamp(46px, 9.4vw, 96px), lh 0.9, -0.045em), left-aligned on two lines with the second line in `bone-2`. The guest invitation title uses the table name at clamp(30px, 4.4vw, 60px), -0.04em; the buy-in amount on the sit-down sheet is 800 at clamp(34px, 6vw, 44px).
- **Headline** (800, clamp(28px, 3vw, 44px), -0.035em): the amount to call / your status in the dock.
- **Title** (800, 22px, -0.02em): current blinds in the top bar, sheet titles; felt waiting title at clamp(22px, 2.6vw, 34px).
- **Body** (400, 15px, lh 1.45): default; seat names 650/14px, seat stacks 800/15px, buttons 650/15px (16px in the dock).
- **Label** (600, 13px; 12.5px for meta): "Pot", "Level 1", field labels, ledger headers, timestamps. Sentence case, no tracking, never uppercase.

### Named Rules
**The Scale-Only Rule.** Importance is expressed by size and weight, not by colour, boxes or ornaments. The two biggest numbers on screen are the pot and what it costs you to stay in.

**The Tabular Rule.** Every number is set with tabular numerals so stacks, timers and blinds never shift width as they change.

## Layout

The table page is a three-row grid filling `100dvh`: top bar (table name, blind clock centred, tools right), the room, and the action dock. Opening the ledger drawer adds a 360px right column; at 1280px and below the drawer overlays from the right instead (min(380px, 100%)).

The room is a size container. The felt is inset 25% / 21% / 26% / 21% of it; seats are absolutely placed around it and sized from the container: `clamp(112px, min(14cqw, (26cqh - 36px) / 0.75), 248px)`, so faces grow with the room rather than the viewport. Hole-card backs sit outside the face on the edge pointing at the felt (`data-face` up/down/left/right). Bets and dealer/blind markers sit on the felt between seat and centre.

Portrait (aspect ratio at most 4/5): the felt becomes tall (inset 17% / 23% / 19% / 23%), seats run down both sides at clamp(84px, 24cqw, 150px), card sizes step down. Below 900px the dock stacks status over a full-width button grid; below 560px the table name and wordmark text drop away and the clock leads the top bar.

Spacing is an ad hoc 4 / 8 / 10 / 14 / 16 / 22px rhythm; dock and lobby padding scale with clamp(). The lobby is one left-aligned 800px stage: headline and lede, then the form set on its own felt topper with a stitched seam. A dealt hand (two aces and the dealer button) straddles the topper's top-right rail, so the lede is held to min(44ch, 100% − 250px) to clear it (100% − 118px on phones, where the cards shrink to 62px).

## Elevation & Depth

Depth is physical and sparse: the room has subtle grain, diffuse warm lighting and vignetted edges, the felt sits on a dark rail ring with a deep drop shadow and an inset shading at its top edge, and only physical objects (cards, chips, dealer button) and floating surfaces (sheets, toasts, the overlay drawer) cast shadows. Panels and bars are flat walnut separated by hairlines.

### Shadow Vocabulary
- **Felt on rail** (`box-shadow: 0 0 0 clamp(10px,1.5vmin,18px) var(--rail), 0 0 0 calc(… + 1px) rgba(239,231,214,.08), inset 0 2px 30px rgba(0,0,0,.45), 0 40px 80px -20px rgba(0,0,0,.7)`): every felt surface, including the lobby form (14px rail) and the buy-in sheet (10px rail).
- **Card** (`0 2px 0 rgba(0,0,0,.18), 0 6px 14px -4px rgba(0,0,0,.55)`): card edge and lift.
- **Chip** (`0 2px 0 rgba(0,0,0,.35), 0 3px 6px rgba(0,0,0,.35), inset 0 0 0 1px rgba(0,0,0,.25)`): clay disc thickness.
- **Lamp lift** (`0 18px 40px -12px var(--lamp-glow)` on the acting seat; `0 6px 18px -8px var(--lamp-glow)` under amber buttons; `0 -20px 50px -30px var(--lamp-glow)` above the dock on your turn).
- **Floating** (`0 30px 70px -20px rgba(0,0,0,.8)` sheets; `0 16px 40px -12px rgba(0,0,0,.7)` toasts).

### Named Rules
**The Objects Cast Shadows Rule.** Only things that would cast a shadow on a real table (felt, cards, chips, button) or that float above it (sheets, toasts) get one. Bars, panels and seats stay flat.

## Shapes

Gently rounded controls (10px; 8px for inputs and small buttons; 6px tags), pills for presets and markers, and one big soft shape: the felt topper, a rounded square at clamp(44px, 9vmin, 110px), never an oval. Seats are a 4:3 face frame (14px top corners, 4px bottom) joined to a nameplate (4px top, 12px bottom). Chips and the dealer button are perfect circles; cards are 5:7 with a radius of 10% of their width. Dashed 1.5px strokes mean "empty or available": the felt seam, open board slots and empty seats.

## Components

### Buttons
Tactile and plain: a 1px press on `:active`, colour transitions at 160ms.
- **Shape:** 10px radius (8px on small), min-height 44px (34px small, 52px large and in the dock).
- **Act:** lamp fill, lamp-ink text, faint lamp-glow under-shadow; hover to lamp-hi. Disabled becomes a translucent bone wash with faint text and loses its glow. Keyboard hints sit inside as small outlined `kbd`.
- **Quiet:** translucent bone wash on walnut with a hairline; on felt the wash turns felt-dark with a felt-thread border.
- **Fold:** transparent with `line-2` border. Fold is never amber.
- **Danger:** transparent, `bad` text and a translucent `bad` border.
- **Icon button:** 40px square (36px on phones), muted icon, brightens on hover; `is-on` uses a stronger bone wash, not amber. Icons are inline SVG line icons.

### Chips (preset pills)
- **Style:** 30px pill, translucent bone wash, hairline, 13px/600 bone-2 text ("½ pot", "¾ pot", "Pot").
- **State:** hover brightens to bone; presets set the raise value and never take amber.

### Cards / Containers
- **Sheet:** walnut-850, 16px radius, `line-2` border, 22px padding, floating shadow, over a blurred dim scrim.
- **Felt sheet (buy-in slip):** the sit-down sheet is a small felt topper (`felt-700`, nap, 26px radius, 10px rail) instead of walnut. Seat number as title with the table name right in felt-hint; a dashed felt-thread well shows the buy-in as a spread chip stack beside the amount, updating live as a cash-game buy-in is typed. Fields switch to their on-felt treatment.
- **Toast:** bone paper with ink text, 10px radius.
- **Drawer:** walnut-900 with tabs underlined in bone (not amber); ledger and structure lists are hairline-ruled tables, right-aligned tabular numbers, up/down in good/bad.

### Inputs / Fields
- **Style:** 40px high, 8px radius, `line-2` border, dark translucent fill; label above at 13px/600 bone-2, hint below in muted; optional suffix inside right.
- **Focus:** border turns lamp and the fill darkens; no glow ring.
- **On felt:** fill becomes felt-dark and the border felt-thread; hints switch to felt-hint.
- **Toggle:** 36x21 track, bone wash off, lamp on with a lamp-ink knob.
- **Raise slider:** 6px track, 22px lamp thumb with a walnut ring.

### Navigation
The top bar is the only navigation: wordmark (800 weight, with a small red/bone chip mark) and table name left, blind clock centred, quiet small buttons and icon buttons right with a hairline separator. Drawer tabs underline in bone when selected.

### Seat (signature)
A face frame over a nameplate. The frame holds live video (mirrored for yourself) or large initials on a walnut radial. The nameplate carries name (650) and stack (800). Status tags (Fold, Check, Raise to…) are small dark pills top-right; the winner tag inverts to bone. Acting: frame and plate border turn lamp, lamp glow lifts beneath, and a 4px lamp timer bar runs under the plate. Folded: video greys and dims, name struck through. Speaking: bone border. Empty seats are dashed outlines that take a lamp border only on hover when you can sit.

### Lamp (signature)
A circular radial pool of warm light (min(64vmin, 680px)), with a soft extended falloff, screen-blended over the room, positioned 18% of the way from the acting seat toward centre. It slides over 900ms on the house ease-out and fades to 55% between turns. A quieter, stationary light pool anchors the table beneath it.

### Blind Clock (signature)
Current level and blinds (title size) beside an exact-length 5px bar that drains in bone-2, with remaining time and next level beneath. Breaks turn the bar chip-green, pauses turn it faint. The blind clock is not amber: it is not something you act on.

### Chip Stack (signature)
Top-down clay discs in up to 3–5 short columns by denomination (largest first), overlapping by 84% of their width, with the amount in a dark rounded tag beside them. A *spread* variant (the buy-in slip) hands a starting stack out the way a host would: only denominations at most a quarter of the amount, half the remainder into each, up to 4 columns of 9, so 5,000 reads as black, green, red and bone rather than one blue chip.

### Guest Invitation (signature)
A visitor opening the link who is not the host and has no seat sees the felt centre as an invitation: the table name huge, "Hosted by {host} · n of 9 seats taken", the blinds, starting stack and level length as big 800 numbers in a felt-thread-ruled row, and one large lamp button, "Take a seat", which opens the buy-in slip for the first open seat ("Table is full" disabled otherwise). In portrait the terms become a 2×2 grid and the hint drops away.

### Lobby Opening (signature, the app's one authored entrance)
On load the lamp switches on over the lobby stage with a short flicker (1.4s: on, off, on, settle) and the two aces are tossed onto the rail from the top right with heavy rotation, the dealer button dropping in after. The cards are decoration (aria-hidden), and on hover they lift apart as if someone is peeking. Reduced motion collapses all of it to the final state.

### Big moments (signature)
Three moments get more than the Dim Room Rule, all told with light, scale and pacing, never with new colours or confetti. Reduced motion collapses each to its end state.
- **All-in duel** (a called all-in with cards still to come): the felt deepens to `felt-700`, the amber lamp goes out, seats outside the hand drop to `brightness(0.45) saturate(0.6)`, and the players who are all-in scale to 1.12 (1.06 in portrait) and lean 3.5% toward the centre, each under a warm-*white* radial pool (not amber: nobody can act). Under the board, one exact-length 8px bar splits main-pot equity between them (bone and 40% bone segments, names and percentages beneath) and shifts with every card. The river lands face down, holds a breath (the server waits 1.7s before the showdown) and turns over with a lift; a soft low heartbeat runs under the run-out, and a snap sounds as the card turns. At the showdown the bar goes to the winner and the losers' lights fade. A winner who had at most 20% before the river gets a quiet line: "Bad beat · {name} hadde {x} % før river".
- **Knocked out** (tournament): the light over the seat flickers off (the lobby lamp's flicker in reverse, 1.5s) with a switch click, then the face goes grey (`grayscale(1) brightness(0.5)`) and the place tag rises. When the tournament is won, the last hand stays on the felt for 6.5s before the results take over and the room lamp switches on again over the champion.
- **Rare hand** (four of a kind, straight flush, royal flush): the winning board cards lift 16%, the rest dim, and the hand name takes over the felt at display size (clamp(32px, 4.8vw, 66px), 800) while the pot steps down to title size. Four rising notes play.

## Do's and Don'ts

### Do:
- **Do** keep amber (`lamp`) to enabled actions, the acting seat, its turn timer and focus.
- **Do** make the pot and the amount to call the largest type on screen (800 weight, tight negative tracking).
- **Do** set every number with tabular numerals.
- **Do** size seats from the room container (cq units) so faces dominate.
- **Do** draw felt as a rounded square on a dark rail ring, with the noise nap and a 1.5px dashed stitch seam.
- **Do** show time as exact-length bars that drain left to right.
- **Do** use one clay colour per denomination, choosing the low or high set from the small blind.
- **Do** build textures from inline SVG and CSS gradients; self-host the font.

### Don't:
- **Don't** put amber on decoration, headings, labels, tabs, idle states or chip denominations.
- **Don't** let the walnut grain become a high-contrast pattern; it should be barely visible, static and built from inline SVG.
- **Don't** use chip colours for UI states or categories.
- **Don't** use uppercase tracked labels; labels are sentence case at 12.5–13px.
- **Don't** ship raster textures or remote font files.
