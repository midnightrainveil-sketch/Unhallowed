# UNHALLOWED

A focused 3D dark-fantasy action prototype in the browser. You play **Vaust**, an ancient war-mage
held beneath a seal, in a ruined ritual courtyard beneath a broken white eclipse.
One arena, five skills, two enemy types, three keepers of the seal, and an endless loop chasing a high score.

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
| **1 / 2 / 3** | Choose a gift or relic card |

## The run

The seal on Vaust's chest has three locks, and each lock has a keeper. A run is an endless loop:

**Wave → Ossarch, the Gaoler → Wave → The Witness → Wave → The Sealwright → the seal is rewritten → next loop**

Waves bring **Pursuers** (masked melee, offset approach, two-hit combo with a deliberate pause) and
**Hex Idols** (floating constructs with aimed volleys and delayed ground eruptions). Every enemy
attack is telegraphed in amber/crimson/white and its direction or position locks before it lands.

Each loop the seal is rewritten and its servants return stronger: +35% health and +15% damage per
loop, wind-ups 8% quicker (never below 85% of the original warning), and each keeper learns one more
trick. The broken eclipse gains a visible crack every loop.

### The keepers (one at a time)

Keepers have a large health bar with phase marks and an amber **stagger meter**: heavy blows (R, the
second sword cut, mark detonations, the Seal) fill it, and a full meter drops the keeper for 3 s,
taking extra damage. Keepers resist being moved and pinned, and **cannot be erased** by The Seal
Objects — it tears at them instead (12% of their health and an instant stagger).

- **Ossarch, the Gaoler** — the lock of the body. A three-swing key-blade combo whose last, overhead
  chop is held back to punish rhythm-dodging; **Chain Cast** (a lane-telegraphed chain that tethers
  Vaust within 6 m — dodge away twice to snap it, or be reeled in for the chop); **Lockdown Slam** (a
  leap with expanding shockwave rings — dodge through them; the blade sticks in the stone for 1.5 s
  and he takes +50% damage); calls in Pursuers at 66% and 33%. Below 50% the mask cracks: faster, a
  double chain, a second shockwave, and a full-circle **Chain Drag** (dodge through it, or stay close).
  Hands Beneath seizes his chain arm and stops Chain Cast for 3 s.
- **The Witness Beneath the Eclipse** — the lock of sight. It hangs over the northern drop; three
  fragments of the eclipse fall into the courtyard as monoliths. Its **gaze** follows Vaust and fills
  a **Judgment** meter; when it fills he is hit for 30 and his skills are locked for 3 s. Break its
  sight behind a monolith, behind an open R rift, or inside your own Missing Second. Four **choir eyes**
  fire volleys; kill them all and it **blinks**, resting on the rim for 6 s and taking double damage.
  Outside the blink it is out of sword reach — the fold strike is how you hurt it. Below 50% its gaze
  becomes two sweeping beams and dead eyes revive if the core is left alone. The Seal Objects erases
  every eye and forces a blink; Hands Beneath holds its head on the rim 2 s longer.
- **The Sealwright** — the lock of the name, who wrote the seal. **Script walls** (written lines that
  harden into walls for 8 s; they block movement, shots and the fold — in both directions);
  **Mirror Fold** (his cut lands on Vaust; a ghost crescent warns 0.6 s ahead); a homing **written
  mark** (+30% damage taken; dodging clears it). Below 60%, *Revision*: Vaust's own skills turned
  around — lines that strike after they appear, hands that press down from above and pin him for 1 s,
  and his own Missing Second that slows Vaust (cast your T over it to cancel it). Below 25%,
  *Erasure*: the courtyard is unwritten from the edge inward; casting The Seal Objects restores it and
  staggers him for 4 s.

Defeat a keeper: full heal and a choice of **relics** (three per keeper; once owned, a stackable
*Scar of the Lock*, +15 max health). Gaoler: a fourth dodge charge · kills heal 5 · take 15% less
damage. Witness: fold reach +4 m and far cuts keep 65% damage · Q cooldown −1.5 s and longer pins ·
The Seal Objects cooldown −8 s. Sealwright: marks last twice as long and detonate for +40 · heal 5/s
inside your own Missing Second · rift lasts +2 s and re-cuts ×1.5.

Clear a wave: heal 35 and choose one of three random **gifts** (each up to three times): Widen the
Wound (Q), More Hands Below (E), A Shorter Absence (dodge), The Fold Deepens (sword damage and fold
reach), The Cut Stays (R rift), A Longer Second (T field), or Hardened Seal (+20 max health, any number
of times).

Vaust's power is wrong in ways the courtyard remembers. **Marked** enemies (a pale glyph) take +30%
damage, and a heavy blow detonates the mark. The floor stays damaged where he struck — floating
slabs, cracks, mist running backwards — and enemies that witness the worst of it back away for a
moment. Each cast flares the seal on his chest; using too much at once darkens the edges of the
world and brings whispering (flavour only).

### Score and saving

Kills, cleared waves and fallen keepers score points, multiplied by the loop (+50% per loop); a
keeper beaten while taking less than 30 damage adds an *Untouched* bonus. Progress is saved in the
browser (localStorage) at the start of every wave and every keeper — **Continue** on the title screen
resumes there with your health, gifts, relics and score. Dying ends the run, records it in the local
top-five table, and clears the save.

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
js/enemies.js         Pursuer, Hex Idol, projectiles, eruptions, loop scaling
js/bosses.js          the three keepers: Gaoler, Witness, Sealwright (+ choir eyes, walls, monoliths)
js/skills.js          Q E R T 1 (Y)
js/player.js          movement, aim, dodge, combo, damage
js/ui.js              HUD and overlays
js/main.js            game states, stage loop (waves and keepers), score, save/continue, high scores, frame loop
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
