# CONTRACT — "Career Quest: The Chai Jia En Story"

A 2D pixel-art platformer where each level is one chapter of Chai Jia En's real career.
Static site, **zero dependencies, zero build step**. Deployed to Vercel, served at jiaenchai.com.

Every agent MUST follow this contract exactly. Do not invent new module paths, exports, or
data shapes. Do not add npm dependencies. Do not add a bundler.

---

## 0. Hard rules

1. **Vanilla JS ES modules only.** `<script type="module" src="/src/main.js">`. No TS, no JSX, no npm packages, no CDN imports (CSP-hostile and offline-hostile).
2. **No image/audio binary assets.** All art is drawn procedurally on canvas. All sound is
   synthesized with WebAudio. This keeps the repo text-only and deploy trivial.
3. **DOM-free core.** `src/engine/physics.js`, `src/game/player.js`, `src/game/entities.js`
   and everything under `src/game/levels/` MUST NOT reference `window`, `document`, `Audio`,
   `Image`, or `canvas`. They must be importable in plain Node.js. This is enforced by an
   automated headless test. Rendering and input live in separate modules.
4. **File ownership is exclusive.** Only write the files assigned to you. Never edit another
   agent's files. If you need something from another module, import it per this contract and
   trust the signature.
5. All units are **pixels** and **seconds** unless stated. `dt` is seconds (clamped ≤ 1/30).
6. Use `export function` / `export const` named exports. No default exports anywhere.
7. British/neutral tone in copy; the résumé facts must be **verbatim-accurate** (see §7).

---

## 1. Display & world constants

Defined once in `src/engine/constants.js` (owned by the engine agent), imported everywhere:

```js
export const TILE = 16;
export const VIEW_W = 480;      // internal canvas resolution
export const VIEW_H = 270;      // 16:9, 30 x 16.875 tiles
export const GRAVITY = 1200;
export const MAX_FALL = 420;
export const RUN_SPEED = 132;
export const RUN_ACCEL = 1000;
export const RUN_FRICTION = 1400;
export const AIR_ACCEL = 700;
export const JUMP_V = -372;         // ~3.6 tiles of clearance
export const JUMP_CUT = 0.45;       // vy *= this when jump released early
export const COYOTE = 0.10;
export const JUMP_BUFFER = 0.12;
export const DASH_SPEED = 300;
export const DASH_TIME = 0.16;
export const DASH_COOLDOWN = 0.5;
export const GLIDE_FALL = 70;       // max fall speed while gliding
export const PLAYER_W = 10;
export const PLAYER_H = 14;
```

Canvas is upscaled with `image-rendering: pixelated` and `ctx.imageSmoothingEnabled = false`.

---

## 2. Level data format

Each level is its own module under `src/game/levels/<id>.js` exporting `export const level = {...}`.

```js
{
  id: 'accenture-analyst',          // kebab-case, matches filename
  index: 1,                          // 0-based order
  company: 'Accenture',
  role: 'Consulting Analyst',
  location: 'Edinburgh, Scotland (UK)',
  period: 'FEB 2017 – MAY 2019',
  theme: 'edinburgh',                // key into THEMES (§4)
  tagline: 'One line of flavour shown on the level intro card.',
  unlocks: 'dash' | 'doubleJump' | 'glide' | 'companion' | null,
  unlockLabel: 'Sprint Dash',        // human name shown when granted; null if unlocks is null
  collectibleName: 'Burndown Point', // singular noun for the HUD
  bullets: [                          // VERBATIM résumé bullets, shown on the completion card
    'Delivered end-to-end solution designs for a major UK investment management client...',
  ],
  npcs: [                             // one entry per 'N' tile, in left-to-right order
    { name: 'Delivery Lead', lines: ['...', '...'] },
  ],
  signs: [                            // one entry per '?' tile, in left-to-right order
    'Text revealed when the player bumps the block from below.',
  ],
  rows: [ /* array of equal-length strings, see legend */ ],
}
```

### Tile legend (one char per tile)

| char | meaning |
|---|---|
| `.` | empty (use `.` not space — makes alignment auditable) |
| `#` | solid block |
| `=` | one-way platform (solid from above only, drop through with Down+Jump) |
| `^` | hazard spike (damage on touch) |
| `~` | hazard pool, fills the tile (damage on touch) |
| `o` | collectible (small) |
| `*` | key artifact (large collectible, worth 5) |
| `E` | walker enemy (patrols its platform, turns at ledges/walls, stompable) |
| `F` | flyer enemy (sine-wave vertical hover, moves slowly toward player horizontally, stompable) |
| `H` | horizontal moving platform (travels ±3 tiles from spawn) |
| `V` | vertical moving platform (travels ±3 tiles from spawn) |
| `N` | NPC — stands still, shows dialogue when player is near and presses Up/E |
| `?` | info block — solid; reveals a `signs[]` line when bumped from below |
| `C` | checkpoint flag |
| `P` | player spawn (**exactly one per level**) |
| `G` | goal door (**exactly one per level**) |
| `B` | boss spawn (**only** in the final level) |

### Level authoring rules (validated automatically — a violation fails the build)

- All strings in `rows` are the **same length**. Width 150–190 tiles, height **exactly 20**.
- Exactly one `P`, exactly one `G`. `G` is in the right-hand 12% of the map.
- The bottom row (index 19) is entirely `#` or `~` — no falling out of the world.
- Horizontal gaps in the walkable path ≤ **6 tiles**; a step up ≤ **3 tiles** in one jump.
- ≥ 12 and ≤ 30 collectibles (`o` + `*`) per level. `*` count is 1–3.
- `N` count matches `npcs.length`; `?` count matches `signs.length`.
- No `^`/`~` directly under a required jump landing spot that is unreachable otherwise.
- Every level must be completable by the headless bot (§6).

Aggregator `src/game/levels/index.js` (integration agent) exports:
```js
export const LEVELS = [ /* level objects in index order */ ];
export function getLevel(idOrIndex)
```

---

## 3. Engine API — `src/engine/*` (engine agent)

### `src/engine/physics.js`
```js
export function tileAt(level, tx, ty)          // char, '#' for out-of-bounds sides, '.' above
export function isSolid(ch)                    // '#','?' → true
export function isOneWay(ch)                   // '=' → true
export function isHazard(ch)                   // '^','~' → true
export function aabb(a, b)                     // overlap test on {x,y,w,h}
// Sweeps body along X then Y with tile collision. Mutates body.
// body: {x,y,w,h,vx,vy,onGround,hitCeiling,hitWallL,hitWallR,dropTimer}
// Returns {bumpedTile: {tx,ty,ch}|null} for '?' blocks hit from below.
export function moveAndCollide(body, level, dt)
export function overlappingTiles(body, level)  // array of {tx,ty,ch}
```
One-way platforms: only collide when `body.vy >= 0` AND the body's previous bottom edge was
above the platform top AND `body.dropTimer <= 0`.

### `src/engine/input.js` (DOM — keyboard, touch, gamepad-agnostic)
```js
export const input = { left, right, up, down, jump, dash, action, pause,   // booleans
                       jumpPressed, dashPressed, actionPressed, pausePressed,  // edge-triggered
                       anyPressed };
export function initInput(canvasEl)   // attaches listeners, sets up on-screen touch buttons
export function endInputFrame()       // clears the *Pressed edges; called at end of each frame
```
Bindings: ←/→/A/D move, ↑/W/Space/Z jump, ↓/S drop, Shift/X dash, E/↑ action, Esc/P pause.
Arrow keys and Space must `preventDefault()` so the page never scrolls.
Touch: on-screen D-pad + A/B buttons, shown only when `matchMedia('(pointer: coarse)')`.

### `src/engine/loop.js`
```js
export function startLoop(update /* (dt) => void */, render /* (alpha) => void */)
export function stopLoop()
```
Fixed timestep 1/60 with accumulator, max 5 catch-up steps, `requestAnimationFrame`.

### `src/engine/camera.js`
```js
export function createCamera(level)
export function updateCamera(cam, targetX, targetY, dt, level)  // smooth follow + clamp to level bounds
// cam = {x, y, shake, shakeT}
export function shake(cam, amount)
```

### `src/engine/audio.js` (audio agent) — WebAudio, lazily unlocked on first input
```js
export function initAudio()                  // safe to call repeatedly; resumes AudioContext
export function playSfx(name)                // 'jump','dash','coin','artifact','hurt','stomp','
                                             // 'checkpoint','door','select','unlock','boss','win'
export function playMusic(themeKey)          // starts/crossfades a looping chiptune for a theme
export function stopMusic()
export function setMuted(bool)
export function isMuted()
```
Music: simple square/triangle/noise sequencer, ≤ 32-step patterns, one pattern per theme.
Must never throw if AudioContext is unavailable — degrade to no-ops.

---

## 4. Rendering — `src/game/render.js` + `src/game/sprites.js` (art agent)

```js
// sprites.js — pure procedural drawing helpers, each takes (ctx, x, y, ...) in world px
export function drawPlayer(ctx, x, y, state)   // state: {facing:1|-1, anim:'idle'|'run'|'jump'|'fall'|'dash'|'glide'|'hurt', t}
export function drawWalker(ctx, x, y, t, facing)
export function drawFlyer(ctx, x, y, t)
export function drawCoin(ctx, x, y, t)
export function drawArtifact(ctx, x, y, t)
export function drawNpc(ctx, x, y, t, kind)    // kind: index for palette variety
export function drawDoor(ctx, x, y, t, open)
export function drawCheckpoint(ctx, x, y, active, t)
export function drawBoss(ctx, x, y, t, hp, maxHp, flash)
export function drawCompanion(ctx, x, y, t)
export const THEMES = { bristol:{...}, edinburgh:{...}, kl:{...}, hospital:{...},
                        classroom:{...}, fintech:{...}, salon:{...} }
// Each theme: { sky:[topColor,bottomColor], far, mid, near, block, blockTop, blockShade,
//               platform, hazard, accent, particle, name }
```

```js
// render.js
export function initRenderer(canvasEl)             // sizes canvas, returns ctx
export function renderWorld(ctx, game, cam, alpha) // sky, parallax, tiles, entities, player, particles
export function resizeCanvas(canvasEl)             // integer-scale letterbox to fit window
```
Art direction: crisp 16-bit pixel look, limited palette per theme, 3 parallax layers per theme
that reflect the place (Bristol: Clifton bridge + Suspension valley; Edinburgh: castle rock,
crow-step gables; KL: Petronas Towers skyline; hospital: clean wards; classroom: whiteboards;
fintech: candlestick charts; salon: Tokyo neon + torii). Subtle animation (parallax scroll,
sway, twinkle). No text baked into the world art — text belongs to the UI layer.

---

## 5. Game logic

### `src/game/player.js` (gameplay agent) — DOM-free
```js
export function createPlayer(level)
export function updatePlayer(p, level, controls, dt, game)
// controls: {left,right,up,down,jump,jumpPressed,down,dash,dashPressed} — a plain object, so
// the headless bot can drive it without any DOM.
export function hurtPlayer(p, game)
export function respawnPlayer(p, game)
```
Player state: `{x,y,w,h,vx,vy,onGround,facing,anim,animT,coyote,buffer,jumps,maxJumps,
dashT,dashCd,gliding,invuln,dead,deadT}`.
Abilities gate on `game.abilities = {dash:false, doubleJump:false, glide:false, companion:false}`.

### `src/game/entities.js` (gameplay agent) — DOM-free
```js
export function spawnEntities(level)   // reads level.rows, returns {coins,enemies,platforms,npcs,signs,checkpoints,door,boss}
export function updateEntities(game, dt)
export function collideEntities(game, dt)  // coin pickup, enemy stomp/damage, platform riding, checkpoint, door
export function updateBoss(game, dt)
```
Enemy stomp: player bottom within 6px of enemy top and `vy > 0` → enemy dies, `p.vy = -240`.
Otherwise contact damages the player. Player has 3 hearts; damage → knockback + 1.2s invuln.
Death → respawn at last checkpoint (level restart if none), lose a life; 0 lives → level restart
with collectibles reset. No game-over screen — this is a portfolio, keep it forgiving.

Boss (final level only): "The Backlog" — 5 HP, hovers, periodically spawns 3 lobbed
`ticket` projectiles. Stomp to damage. On death it drops the level's `*` artifact and opens the door.

### `src/game/state.js` (integration agent)
```js
export function createGame()
export function loadLevel(game, index)
export function updateGame(game, controls, dt)
export const SAVE_KEY = 'cjen-career-quest-v1';
export function saveProgress(game)   // {maxLevel, best:{[levelId]:{coins,timeMs}}, muted}
export function loadProgress()
```
`game = {level, levelIndex, player, entities, particles, abilities, hearts, lives, coins,
coinsTotal, timeMs, phase, cam, save, dialogue, toast}`
`phase`: `'title' | 'levelIntro' | 'playing' | 'dialogue' | 'levelComplete' | 'paused' | 'ending'`.

### `src/game/ui.js` (UI agent)
```js
export function drawHud(ctx, game)               // hearts, collectible count, level chip, timer
export function drawTitle(ctx, game, t)          // title screen: name, tagline, Press Enter
export function drawLevelIntro(ctx, level, t)    // company / role / period / tagline card
export function drawLevelComplete(ctx, game, t)  // stats + verbatim résumé bullets + Enter to continue
export function drawDialogue(ctx, dialogue, t)   // NPC speech box with typewriter effect
export function drawPause(ctx, game)             // resume / restart level / level select / mute
export function drawLevelSelect(ctx, game, sel)
export function drawEnding(ctx, game, t)         // "Present day" card + links + total stats
export function drawToast(ctx, toast, t)         // ability unlocked / sign text
export function drawText(ctx, str, x, y, opts)   // 5x7 bitmap font, opts:{color,align,scale,shadow,maxWidth}
export function wrapText(str, maxChars)          // → array of lines
```
**The bitmap font is owned by the UI agent** and lives in `src/game/font.js`
(`export const GLYPHS` — a 5x7 pixel font covering A–Z a–z 0–9 and `.,:;!?'"-–—()/&%+@#`).
All in-canvas text goes through `drawText`. Never use `ctx.fillText` (it breaks the pixel look).

---

## 6. Automated verification (integration agent owns `tools/`)

`tools/validate-levels.mjs` — asserts every rule in §2 for every level. Exits non-zero on failure.

`tools/headless-play.mjs` — imports `physics.js`, `player.js`, `entities.js`, `levels/index.js`
in **Node** (no DOM) and runs a scripted bot per level: holds right, jumps when a wall is ahead
or a gap/hazard is within 2 tiles, dashes when available and the gap is > 4 tiles, retries with
jitter up to 40 attempts × 90 simulated seconds. **Asserts the goal is reached on every level.**
This is the primary proof the game is actually playable.

`package.json` — no dependencies, just:
```json
{ "scripts": { "test": "node tools/validate-levels.mjs && node tools/headless-play.mjs",
               "dev": "node tools/serve.mjs" } }
```
`tools/serve.mjs` — dependency-free static file server on :4321 for local dev.

---

## 7. Career content — VERBATIM source of truth

Levels, in order. Bullets on the completion cards must match this text exactly.

**0. `bristol` — University of Bristol, BEng Mechanical Engineering, 2013 – 2016.** Theme `bristol`.
Tutorial. Unlocks nothing. Collectible: "Credit".
- Graduated with upper second class (2:1) honours.
- Final year dissertation on Experimental Study of a Vortex Ring ranked amongst top 5 within the cohort.

**1. `accenture-analyst` — Consulting Analyst, Accenture, Edinburgh, Scotland (UK), FEB 2017 – MAY 2019.**
Theme `edinburgh`. Unlocks `dash` ("Sprint Dash"). Collectible: "Burndown Point".
- Delivered end-to-end solution designs for a major UK investment management client, collaborating with multi-disciplinary journey teams to build and launch digital products across web and mobile.
- Supported project management for a 10-person delivery team, including backlog coordination, burndown reporting, and dependency tracking across multiple squads.
- Member of the UK Blockchain & Digital Identity innovation practice, producing research and POVs on emerging technologies for internal and client-facing publications.

**2. `accenture-consultant` — Management Consultant, Accenture, Edinburgh, Scotland (UK), JUNE 2019 – MAR 2021.**
Theme `edinburgh`. Unlocks `doubleJump` ("Solution Design Leap"). Collectible: "Journey Map".
- Embedded within the client customer journey team at a UK retail bank, helping to define end-to-end journey design and the development of a digital reinvestment solution for the client's new financial product.
- Acted as integration solution designer at a UK investment management firm, working across several customer journeys to produce detailed E2E designs for high-complexity agile-at-scale delivery.
- Deputy Lead of the Scotland Corporate Citizenship team with efforts in grant making, employee volunteering and supporting pro-bono opportunities.

**3. `hmi` — Product Manager, HMI Group, Kuala Lumpur, Malaysia, JUNE 2021 – SEP 2022.**
Theme `hospital`. Unlocks `glide` ("Research Hover"). Collectible: "Patient Record".
- Defined features and user stories for an online patient portal, allowing users to make appointments online and attend virtual consultations.
- Developed a digital product roadmap which builds upon business requirements put forth by group leadership and strategy consultants (McKinsey & Co).
- Oversaw new website design and development for 2 major hospitals of the group (Melaka & Johor Bahru).
- Integrated usability studies and research into product requirements to enhance user satisfaction and ensure customer-driven design.

**4. `excelerate` — Product Manager, Excelerate Asia / General Assembly Malaysia, Kuala Lumpur, OCT 2022 – JUL 2023.**
Theme `classroom`. Unlocks nothing. Collectible: "Insight".
- Defined product roadmap and strategy in alignment with vision established by company leadership. This included creating product strategy documents that describe the business case, high-level use cases and technical requirements.
- Conducted UX research with stakeholders across 3 industries to validate product hypotheses, ultimately resulting in a pilot program for the early stage of a learning experience platform.
- Independently designed and implemented the pilot program end-to-end.
- Managed UI/UX resource to deliver the product design prototype, including running regular product review sessions with company leadership.

**5. `stashaway` — Senior Product Manager, StashAway, Kuala Lumpur, Malaysia, NOV 2023 – JAN 2024.**
Theme `fintech`. Unlocks nothing (level is short and dense — mirrors the 3-month tenure).
Collectible: "Ticket".
- Led the Funding squad (5 engineers and 1 product designer) overseeing features within the payments domain of the product.
- Managed end-to-end enhancement of the deposit flow experience via collaboration across design, engineering, and data domains.
- Refined backlog of over 200+ tickets to effectively prioritize and improve team efficiency.

**6. `storehub` — Senior Product Manager, StoreHub, Kuala Lumpur, Malaysia, APR 2024 – PRESENT.**
Theme `salon`. Unlocks `companion` ("Agent Skill" — a small drone that auto-collects nearby items).
Collectible: "Release". **Final level, contains the boss `B` ("The Backlog").**
- Sole PM of salonx.jp, an all-in-one salon operations platform for the Japanese market. Responsible for product, design, delivery and analytics across web admin, POS, staff app and consumer booking.
- Shipped 23 releases in six months (one per 7.6 days) across all four interfaces, every one scoped, spec-ed and documented single-handedly; monthly bookings on the platform grew from 42 in February to 3,400+ in July 2026.
- Built an AI-native PM operating model (30 agent skills, 7 one-command pipelines, 208 scripts with unit tests) covering triage, research, spec drafting and prototyping — tripled specification throughput and made one-person coverage of a four-surface product viable.
- Owned the BackOffice product roadmap used by ~18k merchants / ~180k users, prioritizing merchant activation and subscription renewals to improve retention and monetisation.
- Owned the design and delivery of StoreHub's e-Invoice stack, from BackOffice configuration and merchant issuance features to internal compliance operations, NetSuite invoice handling, and automated payout fee e-invoice submission.
- Led onboarding enhancement that reduced average time-to-activation from up to 3 days to instant activation through the introduction of new self-activation flows for Malaysian merchants.

### Profile (for the title screen and the HTML résumé section)
> Senior Product Manager with 9 years across fintech, retail tech and digital transformation.
> Currently holds a full product function solo — PM, design, delivery mgmt. and analytics for a
> four-interface SaaS platform serving the Japanese beauty market. Builds AI-native product
> operations that multiply the team's output and merges production code alongside the specs.
> Background spans cross-system solution design, third-party integrations, and onboarding,
> billing and compliance initiatives for 18,000+ merchants in SEA.

Contact: Kuala Lumpur, Malaysia · jiaenchai@gmail.com
(The phone number from the source PDF is deliberately omitted from the site and this repo,
since the repo is public. Email only.)
Skills: Product strategy (Roadmapping, OKRs) · Execution & delivery (Agile/PSM 1 trained,
Stakeholder alignment, Cross-functional leadership) · Data & tooling (JIRA, Mixpanel, Metabase,
Chargebee, NetSuite, Salesforce, AI tooling — Claude Code, Cursor) · AI & automation (Prompt
engineering, Process automation, Rapid prototyping)
Languages: English, Malay, Mandarin, Cantonese
Interests: Basketball, culinary, hiking (recently completed ABC trek), stand-up comedy,
psychology & philosophy
Education: University of Bristol, BEng Mechanical Engineering (2013–2016);
Methodist College Kuala Lumpur, A-Level — Mathematics (A), Physics (A), Chemistry (A),
Further Mathematics (A) (2012–2013)

---

## 8. Page shell — `index.html`, `styles.css` (shell agent)

- Dark, tasteful, modern portfolio page. The canvas is the hero, centred, integer-scaled,
  with a subtle CRT/vignette treatment. Above it: name + role. Below the canvas: controls
  legend, then a **real, semantic, accessible HTML résumé** (`<main>` with sections for
  profile, experience, education, skills) — so recruiters who never press Start still get
  everything, and so the page is indexable. Content must match §7 verbatim.
- Full SEO/social head: title, description, canonical `https://jiaenchai.com/`, Open Graph,
  Twitter card, `application/ld+json` `Person` + `ProfilePage` schema.
- Inline SVG favicon via data URI. No external fonts, no external requests at all.
- Responsive: canvas scales down on mobile; touch controls appear on coarse pointers.
- `prefers-reduced-motion`: disable page-level animation (the game itself still runs).
- A "Skip to résumé" link as the first focusable element.
