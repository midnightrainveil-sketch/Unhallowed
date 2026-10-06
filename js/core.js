/* UNHALLOWED — core: namespace, math helpers, input, shared constants. */
'use strict';
window.U = window.U || {};
(function (U) {
  const T = THREE;

  // ---------- Tunables shared across modules ----------
  U.CONST = {
    ARENA_R: 14.2,          // playable radius (entity centres are clamped inside this minus their radius)
    PLATFORM_R: 15.4,       // visual radius of the courtyard platform
    CAM_PITCH: 38 * Math.PI / 180,
    CAM_DIST: 12.4,
    CAM_FOV: 41,
    NORTH_R: 11.4,          // the courtyard is a terrace: its northern edge drops into the abyss
  };

  // Playable radius at a given position's azimuth (0 = north, toward the eclipse).
  U.arenaMaxR = function (x, z) {
    const az = Math.abs(Math.atan2(x, -z));
    const f = U.smooth(U.clamp((0.95 - az) / 0.5, 0, 1));
    return U.lerp(U.CONST.ARENA_R, U.CONST.NORTH_R, f);
  };
  // keep an entity (radius r) inside the courtyard
  U.arenaClamp = function (p, r) {
    const max = U.arenaMaxR(p.x, p.z) - (r || 0);
    const d = Math.hypot(p.x, p.z);
    if (d > max && d > 1e-6) { p.x *= max / d; p.z *= max / d; }
    return p;
  };

  // ---------- Math helpers ----------
  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.inv = (a, b, v) => U.clamp((v - a) / (b - a), 0, 1);
  U.damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
  U.smooth = (t) => t * t * (3 - 2 * t);
  U.easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  U.easeInCubic = (t) => t * t * t;
  U.easeInQuad = (t) => t * t;
  U.easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
  U.easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
  U.easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
  U.easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  U.wrapAngle = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
  U.angleDiff = (a, b) => U.wrapAngle(b - a);
  U.dampAngle = (a, b, lambda, dt) => a + U.angleDiff(a, b) * (1 - Math.exp(-lambda * dt));
  U.rand = (a, b) => a + Math.random() * (b - a);
  U.randInt = (a, b) => Math.floor(U.rand(a, b + 1));
  U.pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  U.sign = (v) => (v < 0 ? -1 : 1);
  // facing angle convention: forward = (sin a, 0, cos a)
  U.dirFromAngle = (a, out) => (out || new T.Vector3()).set(Math.sin(a), 0, Math.cos(a));
  U.angleOf = (x, z) => Math.atan2(x, z);
  U.dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

  // deterministic rng for world generation
  U.rng = function (seed) {
    let s = seed >>> 0;
    return function () {
      s += 0x6D2B79F5;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // phase envelope: 0 before a, rises to 1 at b, holds, falls to 0 by d (c..d)
  U.env = (t, a, b, c, d) => {
    if (t <= a || t >= d) return 0;
    if (t < b) return (t - a) / (b - a);
    if (t <= c) return 1;
    return 1 - (t - c) / (d - c);
  };

  // ---------- Time ----------
  U.time = {
    now: 0,          // simulation time (s), frozen during pause/hitstop slow-down
    real: 0,         // real elapsed time (s)
    hitstop: 0,      // remaining real seconds of hit-stop
    hitstopScale: 0.04,
    addHitstop(sec) { this.hitstop = Math.max(this.hitstop, sec); },
  };

  // ---------- Input ----------
  const GAME_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyT', 'KeyY',
    'ShiftLeft', 'ShiftRight', 'Escape', 'Digit1', 'Digit2', 'Digit3', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

  U.input = {
    keys: Object.create(null),
    pressed: Object.create(null),
    released: Object.create(null),
    mouse: { x: 0, y: 0, ndcX: 0, ndcY: 0, down: false, pressed: false, rightPressed: false, seen: false },
    listeners: [],

    init(canvas) {
      const self = this;
      window.addEventListener('keydown', (e) => {
        if (GAME_CODES.has(e.code) && U.game && U.game.state === 'playing') e.preventDefault();
        if (e.repeat) return;
        if (!self.keys[e.code]) self.pressed[e.code] = true;
        self.keys[e.code] = true;
        for (const fn of self.listeners) fn(e.code, e);
      });
      window.addEventListener('keyup', (e) => {
        if (self.keys[e.code]) self.released[e.code] = true;
        self.keys[e.code] = false;
      });
      const move = (e) => {
        self.mouse.x = e.clientX; self.mouse.y = e.clientY; self.mouse.seen = true;
        self.mouse.ndcX = (e.clientX / window.innerWidth) * 2 - 1;
        self.mouse.ndcY = -(e.clientY / window.innerHeight) * 2 + 1;
      };
      window.addEventListener('pointermove', move, { passive: true });
      // Pointer events fire down/up only for the first/last button of a chord, so track the button mask.
      const buttons = (e, allowPress) => {
        const left = (e.buttons & 1) !== 0, right = (e.buttons & 2) !== 0;
        if (left && !self.mouse.down && allowPress) { self.mouse.pressed = true; self.mouse.down = true; }
        if (!left) self.mouse.down = false;
        if (right && !self.mouse.right && allowPress) self.mouse.rightPressed = true;
        self.mouse.right = right;
      };
      canvas.addEventListener('pointerdown', (e) => { move(e); buttons(e, true); });
      // chorded presses/releases arrive as pointermove; only presses over the game canvas count
      window.addEventListener('pointermove', (e) => buttons(e, e.target === canvas), { passive: true });
      window.addEventListener('pointerup', (e) => buttons(e, false));
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      window.addEventListener('blur', () => self.clear());
      document.addEventListener('visibilitychange', () => { if (document.hidden) self.clear(); });
    },
    onKey(fn) { this.listeners.push(fn); },
    down(code) { return !!this.keys[code]; },
    hit(code) { return !!this.pressed[code]; },
    up(code) { return !!this.released[code]; },
    endFrame() {
      for (const k in this.pressed) delete this.pressed[k];
      for (const k in this.released) delete this.released[k];
      this.mouse.pressed = false;
      this.mouse.rightPressed = false;
    },
    clear() {
      for (const k in this.keys) {
        if (this.keys[k]) this.released[k] = true;
        this.keys[k] = false;
      }
      this.mouse.down = false;
      this.mouse.right = false;
    },
  };

  // ---------- Small object pool ----------
  U.Pool = class {
    constructor(create, size) {
      this.items = [];
      for (let i = 0; i < size; i++) this.items.push(create(i));
      this.cursor = 0;
    }
    // returns a free item (active === false) or recycles the oldest
    get() {
      const n = this.items.length;
      for (let i = 0; i < n; i++) {
        const it = this.items[(this.cursor + i) % n];
        if (!it.active) { this.cursor = (this.cursor + i + 1) % n; return it; }
      }
      const it = this.items[this.cursor];
      this.cursor = (this.cursor + 1) % n;
      if (it.release) it.release();
      return it;
    }
    forEachActive(fn) { for (const it of this.items) if (it.active) fn(it); }
  };

  // ---------- Geometry helpers ----------
  // Build a non-indexed BufferGeometry from an array of [x,y,z] points and triangle index triples.
  U.geomFrom = function (verts, tris, uvs) {
    const pos = [];
    const uv = [];
    for (const [a, b, c] of tris) {
      pos.push(...verts[a], ...verts[b], ...verts[c]);
      if (uvs) uv.push(...uvs[a], ...uvs[b], ...uvs[c]);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    if (uvs) g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  };

  // A tapered prism along -Y (from y=0 down to y=-len), n sides, radii r0 (top) -> r1 (bottom).
  // sx/sz scale the cross-section to get flattened shapes.
  U.taperGeom = function (len, r0, r1, sides, sx, sz, down) {
    sides = sides || 5; sx = sx || 1; sz = sz || 1;
    const dir = down === false ? 1 : -1;
    const verts = [], tris = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + Math.PI / sides;
      verts.push([Math.cos(a) * r0 * sx, 0, Math.sin(a) * r0 * sz]);
    }
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + Math.PI / sides;
      verts.push([Math.cos(a) * r1 * sx, dir * len, Math.sin(a) * r1 * sz]);
    }
    const top = verts.length; verts.push([0, 0, 0]);
    const bot = verts.length; verts.push([0, dir * len, 0]);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      if (dir < 0) {
        tris.push([i, j, sides + j], [i, sides + j, sides + i]);
        tris.push([top, j, i]);
        if (r1 > 0.0001) tris.push([bot, sides + i, sides + j]);
      } else {
        tris.push([i, sides + j, j], [i, sides + i, sides + j]);
        tris.push([top, i, j]);
        if (r1 > 0.0001) tris.push([bot, sides + j, sides + i]);
      }
    }
    return U.geomFrom(verts, tris);
  };

  // Merge direct child meshes of `group` that share a material into single meshes (static parts only).
  U.mergeChildren = function (group, opts) {
    opts = opts || {};
    const byMat = new Map();
    const kids = group.children.slice();
    for (const c of kids) {
      if (!c.isMesh || c.userData.noMerge || c.children.length) continue;
      if (!byMat.has(c.material)) byMat.set(c.material, []);
      byMat.get(c.material).push(c);
    }
    for (const [mat, list] of byMat) {
      if (list.length < 2) continue;
      const geos = [];
      for (const m of list) {
        m.updateMatrix();
        let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        g.applyMatrix4(m.matrix);
        for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
        if (!g.attributes.uv) {
          const n = g.attributes.position.count;
          g.setAttribute('uv', new T.Float32BufferAttribute(new Float32Array(n * 2), 2));
        }
        geos.push(g);
        group.remove(m);
      }
      const merged = THREE.BufferGeometryUtils.mergeGeometries(geos, false);
      const mesh = new T.Mesh(merged, mat);
      mesh.castShadow = opts.castShadow !== false;
      mesh.receiveShadow = !!opts.receiveShadow;
      group.add(mesh);
    }
  };

  U.disposeTree = function (obj) {
    obj.traverse((o) => {
      if (o.geometry && !o.userData.sharedGeo) o.geometry.dispose();
    });
  };

  U.showError = function (msg) {
    const box = document.getElementById('error-box');
    if (!box) return;
    box.textContent = msg;
    box.classList.remove('hidden');
  };
  window.addEventListener('error', (e) => {
    console.error(e.error || e.message);
    U.showError('Error: ' + (e.message || e.error));
  });
})(window.U);
