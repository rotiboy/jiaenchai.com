# jiaenchai.com — Career Quest

A personal site for **Chai Jia En**, Senior Product Manager, where the résumé is also a
playable 2D pixel-art platformer. Seven levels, one per chapter of the career; each one ends
by handing you the real résumé bullets for that role.

**Live:** https://jiaenchai.com

| Chapter | Role | Ability unlocked |
|---|---|---|
| 00 · Bristol | BEng Mechanical Engineering, University of Bristol | — |
| 01 · Accenture | Consulting Analyst, Edinburgh | Sprint Dash |
| 02 · Accenture | Management Consultant, Edinburgh | Solution Design Leap (double jump) |
| 03 · HMI Group | Product Manager, Kuala Lumpur | Research Hover (glide) |
| 04 · Excelerate Asia | Product Manager, Kuala Lumpur | — |
| 05 · StashAway | Senior Product Manager, Kuala Lumpur | — |
| 06 · StoreHub | Senior Product Manager, Kuala Lumpur | Agent Skill (companion) — boss: *The Backlog* |

## Design constraints

- **Zero dependencies, zero build step.** Plain ES modules served as-is. `node_modules` never exists.
- **No binary assets.** Every sprite, tile and parallax layer is drawn procedurally on canvas;
  every sound is synthesized with WebAudio. The whole repository is text.
- **No external network requests.** No CDNs, no web fonts, no analytics.
- **The game is optional.** Every fact inside it is also written out as semantic HTML on the
  page, so a keyboard or screen-reader user misses nothing by skipping it.

## Layout

```
index.html            page shell + semantic HTML résumé
styles.css
src/engine/           constants, physics, input, loop, camera, audio   (engine is DOM-free
src/game/             player, entities, render, sprites, ui, font, state   except input/loop/audio)
src/game/levels/      one module per career chapter, ASCII tile maps
src/main.js           bootstrap + phase machine
tools/                validators, headless bot, dev server
CONTRACT.md           the spec every module was built against
```

## Development

```sh
npm run dev     # dependency-free static server on http://localhost:4321
npm test        # physics self-test, level validation, headless playthrough, DOM smoke test
```

`npm test` is the real safety net and runs entirely in Node:

- **`tools/physics-selftest.mjs`** — resting, wall stops, one-way platforms, no tunnelling at speed.
- **`tools/validate-levels.mjs`** — level geometry rules, plus a BFS over standing spots proving a
  legal P→G path exists, plus a byte-for-byte diff of every résumé bullet against `CONTRACT.md`.
- **`tools/headless-play.mjs`** — drives a bot through **all seven levels** with only the abilities
  the player actually owns at that point in the progression. Levels must be beatable, not just valid.
- **`tools/dom-smoke.mjs`** — boots `src/main.js` against a stubbed browser and walks every phase
  (title → chapter → play → pause → level select → completion → ending) asserting nothing throws.

## Controls

Move ←/→ or A/D · Jump ↑/W/Space/Z · Drop through ↓/S · Dash Shift/X · Talk E/↑ · Pause Esc/P.
Click or tap the screen to hand it the keyboard. On touch devices a D-pad and A/B buttons appear
beneath the screen.

## Deployment

Static hosting from the repository root on GitHub Pages (`CNAME` → `jiaenchai.com`,
`.nojekyll` so `src/` is served verbatim). Any static host works — there is nothing to build.
