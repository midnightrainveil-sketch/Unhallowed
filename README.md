# UNHALLOWED

A focused 3D dark-fantasy action prototype in the browser. You play **Vaust**, an ancient war-mage
held beneath a seal, in a ruined ritual courtyard beneath a broken white eclipse.
One arena, five skills, two enemy types, three waves, and a small upgrade loop.

Built with plain HTML/CSS/JavaScript and **three.js r170** (vendored, no network needed at runtime).

## Launch

The game is fully static. Any of these work:

- **Double-click `index.html`** (works from `file://` in Chrome, Edge and Firefox; all scripts are classic
  scripts and all textures are generated procedurally, so no CORS issues).
- Or serve the folder, e.g. `python3 -m http.server 8000` then open <http://localhost:8000>.
  (`npx serve .` works too.)

A desktop browser with WebGL2 is required. Use a mouse and keyboard.

## Controls

| Input | Action |
|---|---|
| **W A S D** | Move (relative to the fixed camera; diagonals normalized) |
| **Mouse** | Aim (ray onto the floor; facing is independent of movement) |
| **Left mouse** | Two-hit sword combo — hold to repeat |
| **Shift** (or Space) | Spectral dash — 3 charges, one recharges every 3 s |
| **Q** | Needle Through Hours — piercing lance (4 s) |
| **E** | Hands Beneath — hold to preview the area, release to cast (8 s) |
| **R** | Sever the Veil — giant spectral blade sweeps a wide cone (10 s) |
| **T** | The Missing Second — hold to preview, release: time field at half speed for 4 s (14 s) |
| **Y** | The Seal Objects — one massive radial rupture after a 1 s build-up (30 s, ready at start) |
| **Right mouse** | Cancel an E/T preview |
| **Esc** | Pause |
| **1 / 2 / 3** | Choose an upgrade card |

## The run

Three waves of **Pursuers** (masked melee, offset approach, two-hit combo with a deliberate pause)
and **Hex Idols** (floating constructs with aimed volleys and delayed ground eruptions).
Every enemy attack is telegraphed in amber/crimson and its direction or position locks before it
lands. After waves one and two, pick one of three upgrades (each can be taken twice):

- **Widen the Wound** — Q is 25% wider and deals 20% more damage.
- **More Hands Below** — E radius +25% (preview and hand ring included).
- **A Shorter Absence** — dodge recharge −20%.

## Files

```
index.html            page shell: title screen, character panel, HUD, overlays
css/style.css         interface styles
js/core.js            namespace, math helpers, input, arena bounds
js/audio.js           synthesized sound set (WebAudio, unlocked on first click)
js/materials.js       materials, rim lighting, procedural textures
js/world.js           renderer, post-processing, lighting, sky/eclipse, courtyard, mist
js/hands.js           articulated spectral hands (skinned, posable)
js/vaust.js           Vaust model, procedural animation, cloth/hair, arm IK
js/fx.js              pooled effects, sword crescents, afterimages, telegraphs
js/enemies.js         Pursuer, Hex Idol, projectiles, eruptions
js/skills.js          Q E R T Y
js/player.js          movement, aim, dodge, combo, damage
js/ui.js              HUD and overlays
js/main.js            game states, waves, upgrade loop, frame loop
vendor/three-r170.min.js   three.js 0.170.0 + post-processing addons as one global bundle
assets/               GameSplash.png, CharSplashFull.png, CharSplashLite.png, char.png, fonts
```

### Artwork

`assets/GameSplash.png` (title background), `assets/CharSplashFull.png` (character panel),
`assets/CharSplashLite.png` (HUD portrait, cropped by CSS using image-relative percentages) and
`assets/char.png` (model reference). They were converted from the attachments as received; to use
your originals, overwrite these files with the same names. Crops are resolution-independent as long
as the aspect ratios match.

Fonts: Cinzel and Cormorant Garamond (SIL Open Font License), bundled in `assets/fonts`.
