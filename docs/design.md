# Vitruvius Loom — Design File

Written by Natalie Walker

**Source of truth for how the product looks, moves and is controlled.** Code that disagrees with this file is wrong; change this file first, then the code.

Owner: Natalie Walker · Version 1.1 · November 14, 2026
Companion documents: `docs/Vitruvius_Loom_Manny_MVP_PRD_V1.md` (what it does), `docs/Vitruvius_Loom_Full_Product_PRD_V1.md` (where it goes), `docs/PLAN.md` (who builds what tonight).

Status marks: **Built** = in the running app tonight. **Planned** = intended look for work in progress; build it this way.

---

## 1. The one idea

**You are wearing smart glasses.** Natalie's reference is a city street seen through AR glasses: a compass strip across the top, boxes drawn around the things the glasses recognise, an arrow drawn in perspective on the ground. Every screen in this product is that view, pointed at the Moon.

The test for any element: **what depth is it at?** If the answer is "it's just on the page", it does not belong.

## 2. Hard rules

These are Natalie's. Do not revert them, restyle around them, or "improve" them without her.

1. **No buttons.** Not pills, chips or icon buttons. You act on the world, with a gesture, or with a key (section 9).
2. **White page by default.** Dark only when the visitor picks ☾, never because of the computer's setting.
3. **The name is always top centre**: "VITRUVIUS LOOM", with "Abandoned, but not forgotten" beneath it, on every page.
4. **Settings are symbols kids know**: one ☀ / ☾ symbol for the page, **A A A** for smaller / original / bigger text.
5. **Bigger text over smaller.** When in doubt, go up a size.
6. **It must feel 3D.** Every element sits at a depth and moves like it (section 3). Flat UI is a bug.
7. **Ginny talks to capable 10–13-year-olds.** She uses the correct technical names (Lunar Module *Eagle*, descent stage, multilayer insulation, regolith, Passive Seismic Experiment, Laser Ranging Retroreflector) and is never babyish.
8. **Machines visibly work where that is true.** If a machine still operates, show it operating (the Laser Ranging Retroreflector is the first case).

## 3. Depth layers

Three layers, front to back. Each moves by a different amount when the view moves. That difference is what makes it feel 3D.

| Layer | What lives there | How it is drawn |
|---|---|---|
| **World** | Sky, stars, Moon, Mars, real terrain tiles, lunar surface, machines, Ginny, 3D Manny | WebGL (React Three Fiber), true perspective camera |
| **Projection** | What the glasses draw *onto* the world: corner-bracket boxes, distance labels, edge arrows, the site pin, AR chevrons, captions | DOM or WebGL placed from 3D positions every frame, so it sticks to its object |
| **Glass** | Title, settings, compass, readouts, hints, dialogue and answer panes | DOM, fixed to the screen, drifting against the pointer (parallax) and angled in perspective |

The eyepiece rim is the one glass element drawn in WebGL (drei `Hud`, orthographic camera), because it has to be real metal.

**Parallax (Built).** Source: pointer position, or device tilt on phone and iPad (`gamma / 25`, `(beta − 45) / 25`), eased 8% per frame, written to `--px` / `--py` in −1…1. It settles when still, and it is zero under `prefers-reduced-motion`. Amounts are pixels at full deflection, applied with `translate` (opposite to the pointer):

| Element | x | y |
|---|---|---|
| Dialogue, ask and answer panes | −12 | −8 |
| Manny's caption (landing) | −10 | −6 |
| Page title | −9 | −6 |
| Hint lines (telescope, flight) | −7 | −4 |
| Settings, compass, HUD keys, flight readout | −5 | −4 |
| Frame corner marks | −3 | −2 |
| Surface camera (world) | ±0.8 m | ∓0.35 m, look target ±0.25 / ∓0.12 |

The floating panes move most and the frame marks barely move. Keep that order when adding elements.

**Perspective panes (Built).** Glass panes lean in toward you like panes floating in AR glasses: `perspective(1100px) rotateY(±11deg)`, hinged on their *outer* edge (`transform-origin: left center` for a left pane, `right center` for a right pane). Manny's landing caption uses 10°. Never more than 12°.

## 4. The journey

**Telescope → flight → surface.** One continuous zoom, the "Prezi" feel: the view never cuts. It only keeps going in. A white fade (`--bg`, 1.2 s) covers each handoff.

### 4.1 Telescope (Built)

- **Real sky tonight**: Moon, Mars and Sun from NASA JPL Horizons; 9,096 stars from the NASA HEASARC catalogue, at their real sizes and phase. The camera never moves. It turns (aim) and narrows its field of view (magnify, 1× to 600×, base vertical FOV 70°), the way a real eyepiece works.
- **Eyepiece**: `apertureRadius = min(36% of width, 26.5% of height)`, centred at **52.5% of height** (`APERTURE_CY` in `SpaceScene.tsx`; `.reticle { top: 52.5% }` must match). The camera's view offset moves the optical centre down to the eyepiece. Rim: silver torus bevel, brushed flange, dark inner lip, glass falloff inside, telescope body in `--barrel`.
- **Reticle**: crosshair `min(14vmin, 120px)` with a gap in the middle, and a zoom ring that fills on a log scale toward the landing magnification. Dim (35%) when searching, 70% when a world is in view, full and cyan when locked.
- **Recognition**: a world inside the eyepiece gets white corner brackets (10 px stubs, 1.5 px) and `NAME · DISTANCE` beneath in mono. A world outside gets an edge arrow on the telescope body at `R × 1.1615 + 64 px`, rotated toward it; the Mars arrow is `#c2552f`. Both glow cyan on hover.
- **Click to fly**: click a world's box, label or edge arrow and the telescope aims, zooms and starts the flight by itself. Drag, arrows, pinch and wheel still work. The cursor is a crosshair (move while dragging).
- **Lock-on**: at ≥ 3× with a world under the reticle, the mount follows it gently. Dragging always wins. The Moon starts the dive at 80×.
- **Hint line** (bottom centre, 4.5 vh up) uses exactly the kicker's type: Plex Mono, same size, 0.34em tracking, ink at 72%. The copy changes with state: CLICK THE MOON OR MARS TO FLY THERE → CLICK *X* TO FLY THERE → KEEP ZOOMING IN… → FLYING TO *X*….
- **Real-sky credit**: one quiet line bottom-left, in local time: `REAL SKY · SAT, 7:27 PM EST · NASA JPL · NASA HEASARC`. Hidden at ≤ 720 px.
- The corner readouts (RA/DEC, zoom, key list) are **removed**. Keep the landing quiet.

### 4.2 Manny on the landing page (Planned, in progress)

- 3D Manny (the same model as the surface) stands **beside** the telescope on the left, looking over at the eyepiece, breathing, and nodding while he talks.
- **Placement rule**: his whole figure stays between 24 px from the left edge and 24 px outside the flange (`cx − R × 1.16 − 24`), below the kicker and above the hint. He never overlaps the eyepiece, the name, the hint or the credit. Height is about `1.55 R`, with his head near the eyepiece centre. Below 900 px wide there is no room: the figure is hidden and only his caption shows.
- **Captions**: a glass pane beside him, angled 10°, with an amber dot (`#e0a43a`) and `MANNY` in mono. The lines: "Whoa… this is cool."; then the draft Lakota lines from the PRD, each shown with the tag *LAKOTA LINES IN REVIEW WITH A LAKOTA READER* until they are approved; then "Let's go." when you click the Moon. On phones the caption is one compact pane above the hint and never covers the eyepiece.

### 4.3 The flight onto real terrain (Built)

- Inside the **framed glasses window** (same frame as the surface). The zoom continues onto **Cesium Moon / Cesium Mars 3D tiles** (NASA and USGS Astrogeology data). The access token stays on the server, which hands out short-lived passes at `/api/tiles/<world>`.
- 11 s flight. Altitude falls exponentially (every second covers the same zoom ratio) from 2.1 planet radii down to the site. In the last stretch the camera slides south of the site and tilts toward the horizon.
- **Site pin**: a pulsing cyan ring (32 px, `--holo`, glow) pinned to the site, with mono text beside it: name, mission and date, coordinates (for example `TRANQUILITY BASE · APOLLO 11 · 20 JULY 1969 · 0.674°N · 23.473°E`).
- **Readout** top-left: `ALTITUDE` (km, then m) and `WORLD`, with a 180 × 2 px progress line in `--holo`.
- **Terrain credit** top-right: `REAL TERRAIN · NASA and the USGS Astrogeology Science Center · VIA CESIUM ION`.
- **Hint** bottom centre: `FLYING DOWN TO <SITE> · SPACE · FASTER`. **Space** = ×6 faster, **T** = back to the telescope.
- **Moon** → Tranquility Base, then white fade to the surface. **Mars** → Jezero Crater, and it holds there: *INGENUITY — THE REAL GINNY — IS STILL DOWN THERE · THE MARS CHAPTER COMES NEXT*.
- If the tiles fail, say so in the hint and offer Space to go straight on. Never show a blank window without words.

### 4.4 The surface (Built)

- **Framed glasses window**: the world sits in a rounded window on the page. Inset 112 / 20 / 20 / 20 px, radius 26, shadow `0 30px 80px --shadow` plus a 1 px `--hair` ring. White L-shaped corner marks (34 px, 1.5 px, 75% white) sit 18 px inside the frame. The page band above holds the name and settings.
- **Compass strip** at the top of the window: `min(520px, 44vw)` wide, 46 px tall, 4 px per degree. Ticks every 15°, numbers every 30°, cardinal letters, faded edges, cyan needle and a three-digit heading beneath.
- **AR chevrons on the ground**: cyan (`#22d3ee`) chevrons every 0.95 m from Manny's start toward the descent stage. They lie flat on the terrain, so they shrink into the distance in true perspective, and a pulse runs along them toward the machine. They are hidden while a panel is open.
- **Object marks**: corner brackets (22 px, 3 px) around each machine (Descent stage · 1969, Seismometer, and the Laser Ranging Retroreflector next), with the name beneath in 30 px mono. Drawn in 3D space, so they scale with distance. Tap the object, or Tab + Enter.
- **Ground**: neutral lunar grey with a speckled regolith texture and scattered rocks, as in the Apollo surface photos. Not beige.
- **HUD keys** top-right inside the window: the context key first (`SPACE CONTINUE` / `ESC CLOSE` / `T TELESCOPE`), then `C CREDITS · M SOUND ON/OFF`.
- **Panes**: Ginny's dialogue bottom-left (angled +11°). The Ask card bottom-right (angled −11°) has five question lines, *What did the seismometers record?*, and the **Ask Ginny anything** line. Answer panes replace the Ask card in the same place.

### 4.5 What happens on the surface (Built unless marked)

- **3D Manny**: made with Meshy from Natalie's own drawings, 1.45 m tall, never redrawn or costumed. Nobody steers him. He walks a scripted route on his own at 0.85 m/s along the chevrons: start → beside the descent stage → beside the seismometer → back, pausing at each stop. While Ginny gives her intro he stands and faces her (he listens). When a panel is open he stops and turns to you.
- **Ginny**: a stylised Ingenuity hovering in the world. Her cyan nav light is where the hologram colour comes from. Her voice is **Kokoro "Heart"**: pre-recorded lines, plus live spoken answers made on the server. Never the browser's robot voice. Sound is off until the visitor turns it on (M, or tapping the moonquake wave).
- **Ask Ginny anything**: one text line inside the Ask card. **Enter** sends; there is no send button. The answer appears in the card, tagged `AI ANSWER · FROM NASA FACTS`, with each source as a link (44 px tall), and is spoken when sound is on. While typing, the app's single-key shortcuts are off; Esc leaves the field.
- **Moonquake, real data**: the Apollo 12 Passive Seismic Experiment recording of 20 November 1969. Cyan waveform, a red **IMPACT** marker (`#e0603a`) where *Intrepid* hit, and speed words **100× · 200× · 400×** (a list you tap, not buttons). Tap the wave to play. While it plays, a 1969 clock runs (`HH:MM:SS UTC · 20 NOV 1969`).
- **Dust, the NASA way**: when you ask about dust, the descent engine's blast throws regolith out in **flat, fast, straight streaks** in a thin sheet 1–3° above the ground, on all sides. Paths are ballistic in vacuum under 1.62 m/s². There is no drag, no swirl, no wind and no hanging cloud. Shown 200× slower, labelled `SIMULATION · physics from NASA studies`.
- **Temperature**: the sun swings between harsh light and low shadow. Daytime +250 °F / after nightfall −208 °F.
- **Laser Ranging Retroreflector (Planned, in progress)**: still working. Laser pulses from Earth arrive as thin beams, the 10 × 10 corner-cube panel flashes on each hit, and the return goes back up the same line. *Is anything here still working?* flies the camera to it.

## 5. Composition of a screen

```
┌──────────────────────────────────────────────────────────────────────┐
│                         VITRUVIUS LOOM                   ☀ │ A A A   │  ← name top centre · settings top right
│                  ABANDONED, BUT NOT FORGOTTEN                        │  ← kicker beneath, always
│ ╭──────────────────────────────────────────────────────────────────╮ │
│ │⌜          NW   330    N    30   NE          T TELESCOPE · C · M ⌝│ │  ← framed window · compass · HUD keys
│ │                         ▲ 357°                                   │ │
│ │        ⌜SEISMOMETER⌟           ⌜DESCENT STAGE · 1969⌟            │ │  ← projection: boxes on real objects
│ │   Manny →   › › › › › › › › › ›                                  │ │  ← AR chevrons on the ground, in perspective
│ │ ╱‾‾‾‾‾‾‾‾‾‾‾‾‾‾╲                               ╱‾‾‾‾‾‾‾‾‾‾‾‾‾‾╲  │ │
│ │ │ ● GINNY      │                               │ ASK GINNY    │  │ │  ← glass panes angled in, ±11°
│ │⌞╲______________╱                               ╲______________╱ ⌟│ │
│ ╰──────────────────────────────────────────────────────────────────╯ │
└──────────────────────────────────────────────────────────────────────┘
```

## 6. Material and light

- **Eyepiece rim**: real metal in WebGL, lit by the same studio environment. Never a CSS gradient.
- **Glass panes**: `--glass` fill, 1 px `--hair` border, 10 px blur, 20 px radius (18 px for captions), shadow `0 18px 50px --shadow`. White glass in light mode, smoked glass in dark mode.
- **Gold foil** must read as gold, not brown: metal needs an environment to reflect.
- **The world is real-coloured.** Grey Moon, hard black sky (`#030304`), warm sun. Never tint the world to match the UI.

## 7. Colour

Tokens live on `:root` in `src/styles.css`; the 3D rim reads `--barrel`. Light is the default. Dark applies only with `data-theme="dark"`, set by the ☀/☾ symbol, saved per device, and applied before first paint in `index.html`. All text must reach 4.5:1 (3:1 at 24 px+), measured against what is actually behind it.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#fafafa` | `#09090b` | page, white fade between scenes |
| `--paper` | `#ffffff` | `#131316` | credits drawer, solid surfaces |
| `--ink` | `#0a0a0a` | `#f4f4f5` | text |
| `--mute` | `#6b7280` | `#9ca3af` | secondary text, labels |
| `--hair` | `rgba(10,10,10,.14)` | `rgba(244,244,245,.16)` | 1 px lines, borders |
| `--barrel` | `#ececef` | `#0a0a0c` | telescope body around the eyepiece |
| `--glass` | `rgba(255,255,255,.86)` | `rgba(19,19,22,.82)` | glass panes |
| `--shadow` | `rgba(10,10,12,.16)` | `rgba(0,0,0,.5)` | pane and frame shadows |
| `--holo` | `#22d3ee` | same | hologram, lock state, chevrons, site pin, Ginny's light |
| `--holo-deep` | `#0e7490` | `#67e8f9` | cyan text on glass |
| `--gold` | `#b8862b` | same | lander foil accents only |

Fixed colours outside the tokens: sky `#030304`, Mars arrow `#c2552f`, IMPACT marker `#e0603a`, Manny's dot `#e0a43a`.

Text that sits over the world (not on glass) is white with a dark text shadow in both modes, because the world is dark in both.

## 8. Type

Every size below is multiplied by `--ts`: **0.85 / 1 / 1.25** for A / A / A. **Nothing renders smaller than 12 px after that scaling**; write `max(12px, calc(<size> * var(--ts)))` for small type.

- **Display**: Space Grotesk 500. Name `clamp(28px, 3.4vw, 46px)`, tracking 0.02em; in the flight and on the surface `clamp(22px, 2.6vw, 34px)`. Dialogue 22 px / 1.45 (18 px on phones), answers 18.5 px / 1.5, question lines 18 px, Ask line 17 px (never under 16 px on touch devices, or iOS zooms the page).
- **Kicker**: IBM Plex Mono 400, `clamp(13px, 1.45vw, 17px)`, tracking 0.34em, uppercase, ink at 72%. The telescope hint matches it exactly.
- **Readouts, labels, sources**: Plex Mono 400/500, 12–16 px, tracking 0.1–0.3em, uppercase. Labels in `--mute`, values in `--ink`, or white over the world.
- **Object labels** in the world: Plex Mono 30 px, 0.3em tracking.
- **Text never sits on the eyepiece rim.** If text and the rim would overlap, the rim shrinks or the text moves inside; the text never shrinks.

## 9. No buttons: how you act

Clickable things look like things: a world, a question line with `›`, a waveform, a word that changes state, a symbol. A hover glow tells you they respond.

| Intention | Gesture | Key |
|---|---|---|
| Fly to the Moon or Mars | Click its box, label or edge arrow | Aim + zoom in, then `Enter` when locked |
| Aim / look around | Drag | Arrow keys |
| Magnify | Pinch, scroll, two-finger pinch | `+` `−` |
| Faster flight | — | `Space` |
| Back to the telescope | — | `T` |
| Continue Ginny's dialogue | Tap anywhere | `Space` / `Enter` |
| Ask a question | Tap a question line, or tap the machine | `Tab` + `Enter` |
| Ask your own question | Type in the Ask line | `Enter` sends |
| Play the moonquake | Tap the waveform | `Enter` on it |
| Close a panel | Tap the world | `Esc` |
| Credits & data | — | `C` |
| Sound on / off | — | `M` |
| Page light / dark, text size | Tap ☀ / ☾, tap an A | `Tab` + `Enter` |

The keys are always shown in a mono line somewhere in the view, never hidden in a menu.

## 10. Motion

- Everything eases. Camera moves use critically damped lerp (`1 − k^dt`), never linear.
- Aim has inertia after a flick (damping `0.004^dt`). Lock-on follow is `1 − 0.3^dt`. Dragging always wins.
- Dive: 2 s smoothstep down the line of sight. Flight: 11 s, cubic ease-in-out. White fades: 1.2 s.
- Typewriter: 22 ms per character (Ginny), 32 ms (Manny).
- **`prefers-reduced-motion`**: no parallax (built), no typewriter (whole line at once), no aim inertia, no pulsing (site ring, chevrons, dots). Flights still play, because they are the content, and Space skips them.

## 11. Honesty labels

The glasses label what they show. Anything rendered that is not a measurement carries a mono tag: `ILLUSTRATIVE`, `SIMULATION`, `STYLISED`, `FICTIONAL`. Real NASA data carries `NASA · <product>` (for example `NASA NSSDCA · Apollo Passive Seismic Experiment`). AI answers say `AI ANSWER`. Cultural lines not yet approved carry the in-review tag. These come from content files, not component code. The credits drawer must match what is on screen tonight.

## 12. Accessibility

- Every gesture has a key (section 9).
- **44 × 44 px minimum** hit area on anything you can tap, including symbols, speed words and picks. The visible glyph can stay smaller; the hit area cannot.
- **Visible focus** on everything you can reach with Tab: a 2 px ring at 3:1 or better against what is behind it. Tab order follows reading order: settings, world marks, panes.
- Status is never shown by colour alone: every state change also changes a word, a shape or a size.
- All speech is also text. Sound is off by default. Live regions announce sentences, never numbers that change every frame.
- WebGL failure: the text journey still works, with a plain message that the 3D view is unavailable.

## 13. Sizes we design for

| Size | Notes |
|---|---|
| Phone 390 × 844 | ≤ 720 px: frame inset 92 / 10 / 10 / 10, radius 18. Panes flat and full width. Compass 70vw at top 100 px. HUD keys and sky credit hidden. ≤ 900 px: landing Manny figure hidden, caption only. |
| iPad 1024 × 1366 and 1366 × 1024 | Full layout. Touch: hints say "tap", not "click". |
| Desktop 1440 × 860 | Reference layout. |

Nothing scrolls horizontally, at any size or text scale.

## 14. What this file does not decide

Content, science claims, cultural lines and sources are governed by the PRDs and the content files. This file decides only how things look, move and respond.

## Change log

| Version | Date | Change |
|---|---|---|
| 1.0 | Nov 14, 2026 | First design file: smart-glasses view, three depth layers, no-buttons rule, telescope mechanics, tokens. |
| 1.1 | Nov 14, 2026 | Brought up to date with the build: hard-rules list (incl. Ginny's tone, working machines); glass is DOM with measured parallax and ±11° panes; landing cleanup (name without slashes, one ☀/☾ symbol, readouts removed, eyepiece `min(36% W, 26.5% H)` at 52.5%, click-to-fly, sky credit); flight onto Cesium terrain; framed surface, compass, AR chevrons, regolith ground; 3D Manny, Kokoro voice, Ask line, real moonquake, NASA-physics dust; planned landing Manny and retroreflector; dark by choice only; 12 px floor after text scaling. |
