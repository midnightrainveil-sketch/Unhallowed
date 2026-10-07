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
| **Left mouse** | Two-hit sword combo — hold to repeat. The blade also *folds space*: aim at an enemy up to 14 m away and the cut lands on it anyway (less damage the farther it is). The second cut leaves the sword hanging in the air, and it swings again on its own 0.5 s later |
| **Shift** (or Space) | Spectral dash — 3 charges, one recharges every 3 s |
| **Q** | Needle Through Hours — the lance has *already* struck: everything on the line is hit at once, pinned in time for 0.6 s and marked; only then does the slit open and the lance fly backwards into it. 2 s later the line strikes again at half damage (4 s) |
| **E** | Hands Beneath — hold to preview, release to cast. Many-fingered hands drag enemies waist-deep into the floor (+35% damage taken, can only strike forward), then pull them under and spit them out elsewhere, disoriented. Hands that catch nothing wait 3 s as traps (8 s) |
| **R** | Sever the Veil — a giant blade, its shadow crossing the ground first. The cut stays open for 3 s: a rift with stars and an eye behind it that re-cuts anything crossing it and swallows Hex Idol shots. Cut bodies come apart and rejoin with a second wound (10 s) |
| **T** | The Missing Second — hold to preview, release. Inside, time crawls then skips forward (≈ half speed overall), leaving afterimages; enemy shots stop dead. When it collapses, everything inside relives its last wound and the stopped shots fly back at whoever fired them (14 s) |
| **1** | The Seal Objects — the seal refuses: the world freezes for 1 s as a photographic negative and every mask turns to Vaust; then everything inside the ring is erased, leaving only burned silhouettes. Survivors back away. It costs him — he is pressed to one knee (30 s, ready at start) |
| **Right mouse** | Cancel an E/T preview |
| **Esc** | Pause |
| **1 / 2 / 3** | Choose an upgrade card |

## The run

Three waves of **Pursuers** (masked melee, offset approach, two-hit combo with a deliberate pause)
and **Hex Idols** (floating constructs with aimed volleys and delayed ground eruptions).
Every enemy attack is telegraphed in amber/crimson and its direction or position locks before it
lands.

Vaust's power is wrong in ways the courtyard remembers. **Marked** enemies (a pale glyph) take +30%
damage, and a heavy blow detonates the mark. The floor stays damaged where he struck — floating
slabs, cracks, mist running backwards — and enemies that witness the worst of it back away for a
moment. Each cast flares the seal on his chest; using too much at once darkens the edges of the
world and brings whispering (flavour only).

After waves one and two, pick one of three upgrades (each can be taken twice):

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
js/skills.js          Q E R T 1 (Y)
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
