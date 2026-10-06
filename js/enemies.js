/* UNHALLOWED — enemies: the Pursuer (masked melee, two-hit combo) and the Hex Idol (floating construct:
   aimed volleys + delayed eruptions). Explicit attack states, telegraphs locked before release,
   a global limit on simultaneous attackers, per-enemy time scale for The Missing Second. */
'use strict';
(function (U) {
  const T = THREE;
  const V3 = T.Vector3;
  const E = (U.enemies = {});
  const FX = U.fx;

  E.list = [];
  E.attackers = 0;
  E.maxAttackers = 2;

  // ---------------- tuning ----------------
  const PURSUER = {
    hp: 100, speed: 4.5, radius: 0.45,
    w1: 0.62, lock1: 0.42, s1: 0.13, gap: 0.5, w2: 0.42, lock2: 0.25, s2: 0.15, rec: 1.0,
    reach1: 2.25, half1: 0.95, lunge1: 0.9, dmg1: 16,
    reach2: 2.45, half2: 0.6, lunge2: 1.35, dmg2: 22,
    engage: 2.6,
  };
  const IDOL = {
    hp: 85, speed: 2.4, radius: 0.6, hover: 1.75, keep: 8.0,
    volleyWind: 0.9, volleyLock: 0.72, volleyMid: 0.55, midLock: 0.4, volleyRec: 0.7,
    projSpeed: 9.5, projDmg: 12, fan: 0.21,
    eruptWind: 0.55, eruptDelay: 1.2, eruptR: 1.35, eruptDmg: 20, eruptRec: 0.9,
  };
  E.PURSUER = PURSUER; E.IDOL = IDOL;

  // ---------------- shared geometry ----------------
  let G = null;
  function geoms() {
    if (G) return G;
    G = {};
    G.thigh = U.taperGeom(0.48, 0.075, 0.05, 5);
    G.shin = U.taperGeom(0.47, 0.052, 0.03, 5);
    G.foot = U.taperGeom(0.22, 0.045, 0.0, 4, 1, 0.6); G.foot.rotateX(-Math.PI / 2 - 0.2);
    G.torso = U.taperGeom(0.52, 1, 1, 6, 1, 1, false);
    const tp = G.torso.attributes.position;
    for (let i = 0; i < tp.count; i++) { const k = tp.getY(i) / 0.52; tp.setX(i, tp.getX(i) * U.lerp(0.12, 0.21, k)); tp.setZ(i, tp.getZ(i) * U.lerp(0.09, 0.13, k)); }
    G.torso.computeVertexNormals();
    G.hood = new T.ConeGeometry(0.15, 0.36, 5); G.hood.translate(0, 0.12, -0.02); G.hood.rotateX(-0.35);
    // long bone-white mask: narrow, pointed, with a single slit
    G.mask = U.geomFrom([
      [0, 0.16, 0.075], [0.07, 0.05, 0.06], [-0.07, 0.05, 0.06], [0.06, -0.1, 0.06], [-0.06, -0.1, 0.06], [0, -0.24, 0.07], [0, 0.0, 0.12],
    ], [[0, 2, 6], [0, 6, 1], [2, 4, 6], [6, 3, 1], [4, 5, 6], [6, 5, 3]]);
    G.slit = new T.BoxGeometry(0.012, 0.11, 0.02);
    G.upper = U.taperGeom(0.38, 0.05, 0.036, 5);
    G.fore = U.taperGeom(0.35, 0.038, 0.028, 5);
    G.bladeR = bladeGeom(0.85, 0.055);
    G.bladeL = bladeGeom(0.58, 0.045);
    G.strip = stripGeom(0.13, 0.95);
    G.stripS = stripGeom(0.1, 0.7);
    // idol
    G.core = new T.OctahedronGeometry(0.52, 0); G.core.scale(0.72, 1.45, 0.72);
    G.coreInner = new T.OctahedronGeometry(0.3, 0); G.coreInner.scale(0.6, 1.2, 0.6);
    G.eye = new T.OctahedronGeometry(0.075, 0); G.eye.scale(0.55, 1.4, 0.3);
    G.ring = new T.TorusGeometry(0.95, 0.035, 3, 20, Math.PI * 1.55);
    G.ring2 = new T.TorusGeometry(1.2, 0.02, 3, 24, Math.PI * 0.9);
    G.frag = new T.TetrahedronGeometry(0.2, 0); G.frag.scale(0.55, 1.6, 0.45);
    G.proj = new T.OctahedronGeometry(0.16, 0); G.proj.scale(0.6, 0.6, 2.4);
    G.spike = new T.ConeGeometry(0.22, 1.5, 4); G.spike.translate(0, 0.75, 0);
    G.bar = new T.PlaneGeometry(1, 1);
    return G;
  }

  function bladeGeom(len, w) {
    // slightly curved blade hanging along -Y from the wrist, edge forward (+Z)
    const v = [], t = [];
    const n = 4;
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const y = -k * len, z = Math.sin(k * Math.PI * 0.9) * 0.08 + k * k * 0.06;
      const ww = w * (1 - k * 0.85);
      v.push([0, y, z + ww], [0.012 * (1 - k), y, z], [0, y, z - ww * 0.4], [-0.012 * (1 - k), y, z]);
    }
    for (let i = 0; i < n; i++) {
      const a = i * 4, b = a + 4;
      for (let k = 0; k < 4; k++) { const k1 = (k + 1) % 4; t.push([a + k, b + k, b + k1], [a + k, b + k1, a + k1]); }
    }
    return U.geomFrom(v, t);
  }

  function stripGeom(w, len) {
    const v = [[-w / 2, 0, 0], [w / 2, 0, 0], [w * 0.4, -len * 0.6, 0.02], [-w * 0.45, -len * 0.55, 0.02], [0.02, -len, 0.04], [-w * 0.2, -len * 0.82, 0.03]];
    return U.geomFrom(v, [[0, 3, 1], [1, 3, 2], [3, 5, 2], [5, 4, 2]]);
  }

  function addMesh(geo, mat, parent, x, y, z, rx, ry, rz) {
    const m = new T.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = true;
    m.userData.sharedGeo = true;
    parent.add(m);
    return m;
  }

  // ---------------- health bar (billboard) ----------------
  function makeBar(parent, y, w) {
    const g = geoms();
    const grp = new T.Group();
    grp.position.y = y;
    const bg = new T.Mesh(g.bar, new T.MeshBasicMaterial({ color: 0x050506, transparent: true, opacity: 0.7, depthWrite: false, depthTest: false }));
    bg.scale.set(w + 0.04, 0.085, 1);
    const fg = new T.Mesh(g.bar, new T.MeshBasicMaterial({ color: new T.Color(1.3, 1.28, 1.22), transparent: true, depthWrite: false, depthTest: false }));
    fg.scale.set(w, 0.05, 1);
    fg.position.z = 0.001;
    bg.renderOrder = 20; fg.renderOrder = 21;
    grp.add(bg); grp.add(fg);
    grp.visible = false;
    parent.add(grp);
    return { grp, fg, bg, w };
  }

  // ---------------- Pursuer ----------------
  function buildPursuer() {
    const g = geoms();
    const mats = {
      body: U.stdMat({ color: 0x26262d, roughness: 0.8, metalness: 0.1, emissive: 0x000000 }, 0.9, 2.5),
      cloth: U.stdMat({ color: 0x15151a, roughness: 0.95, side: T.DoubleSide, emissive: 0x000000 }, 0.7, 2.6),
      mask: U.stdMat({ color: 0xd8d2c4, roughness: 0.5, metalness: 0.05, emissive: 0x000000 }, 0.5, 2.4),
      blade: U.stdMat({ color: 0x8e9098, roughness: 0.3, metalness: 0.9, emissive: 0x000000, envMap: U.world.envMap, envMapIntensity: 1.0 }, 0.6, 2.0),
      eye: new T.MeshBasicMaterial({ color: new T.Color(0.9, 0.92, 1.0) }),
    };
    const root = new T.Group();
    const body = new T.Group(); root.add(body);
    const hips = new T.Group(); hips.position.y = 0.97; body.add(hips);
    const legs = [];
    for (const s of [1, -1]) {
      const leg = new T.Group(); leg.position.set(s * 0.1, 0, 0); hips.add(leg);
      addMesh(g.thigh, mats.body, leg);
      const knee = new T.Group(); knee.position.y = -0.48; leg.add(knee);
      addMesh(g.shin, mats.body, knee);
      const ankle = new T.Group(); ankle.position.y = -0.47; knee.add(ankle);
      addMesh(g.foot, mats.body, ankle, 0, -0.01, 0.02);
      legs.push({ s, leg, knee, ankle });
    }
    const spine = new T.Group(); spine.position.y = 1.0; body.add(spine);
    addMesh(g.torso, mats.body, spine);
    const chest = new T.Group(); chest.position.y = 0.48; spine.add(chest);
    const head = new T.Group(); head.position.set(0, 0.12, 0.05); chest.add(head);
    addMesh(g.hood, mats.cloth, head);
    addMesh(g.mask, mats.mask, head, 0, 0.0, 0.0);
    addMesh(g.slit, mats.eye, head, 0, 0.02, 0.115).castShadow = false;
    const arms = [];
    for (const s of [1, -1]) {
      const sh = new T.Group(); sh.position.set(s * 0.2, 0.0, 0.0); chest.add(sh);
      addMesh(g.upper, mats.body, sh);
      const el = new T.Group(); el.position.y = -0.38; sh.add(el);
      addMesh(g.fore, mats.body, el);
      const wr = new T.Group(); wr.position.y = -0.35; el.add(wr);
      addMesh(s < 0 ? g.bladeR : g.bladeL, mats.blade, wr, 0, 0, 0);
      arms.push({ s, sh, el, wr });
    }
    // ragged cloak strips hanging from the shoulders and back
    const strips = [];
    const sdefs = [[0, -0.12, Math.PI, g.strip], [0.14, -0.1, Math.PI - 0.5, g.strip], [-0.14, -0.1, Math.PI + 0.5, g.strip], [0.17, 0.02, 1.4, g.stripS], [-0.17, 0.02, -1.4, g.stripS]];
    for (const [x, z, yaw, geo] of sdefs) {
      const piv = new T.Group(); piv.position.set(x, 0.0, z); piv.rotation.y = yaw; chest.add(piv);
      const m = addMesh(geo, mats.cloth, piv);
      strips.push({ piv, m, ph: Math.random() * 6 });
    }
    root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const bar = makeBar(root, 2.25, 0.8);
    return { root, body, hips, legs, spine, chest, head, arms, strips, mats, bar };
  }

  // ---------------- Hex Idol ----------------
  function buildIdol() {
    const g = geoms();
    const mats = {
      core: U.stdMat({ color: 0x121217, roughness: 0.28, metalness: 0.75, emissive: 0x000000, envMap: U.world.envMap, envMapIntensity: 1.2 }, 0.7, 2.0),
      inner: new T.MeshBasicMaterial({ color: new T.Color(0.9, 0.25, 0.14), transparent: true, opacity: 0.0, blending: T.AdditiveBlending, depthWrite: false }),
      ring: U.stdMat({ color: 0x55565e, roughness: 0.35, metalness: 0.9, emissive: 0x000000, envMap: U.world.envMap }, 0.5, 2.0),
      frag: U.stdMat({ color: 0x1a1a20, roughness: 0.4, metalness: 0.6, emissive: new T.Color(0, 0, 0), envMap: U.world.envMap }, 0.6, 2.0),
      eye: new T.MeshBasicMaterial({ color: new T.Color(0.85, 0.88, 0.98) }),
      glow: new T.MeshBasicMaterial({ map: U.tex.glow, color: new T.Color(0.55, 0.22, 0.12), transparent: true, opacity: 0.6, blending: T.AdditiveBlending, depthWrite: false }),
    };
    const root = new T.Group();
    const float = new T.Group(); float.position.y = IDOL.hover; float.scale.setScalar(1.3); root.add(float);
    const core = addMesh(g.core, mats.core, float);
    const inner = addMesh(g.coreInner, mats.inner, float); inner.castShadow = false;
    const eye = addMesh(g.eye, mats.eye, float, 0, 0.08, 0.27); eye.castShadow = false;
    const ring = addMesh(g.ring, mats.ring, float); ring.rotation.x = Math.PI / 2 - 0.35;
    const ring2 = addMesh(g.ring2, mats.ring, float); ring2.rotation.x = Math.PI / 2 + 0.5; ring2.rotation.y = 0.6;
    const frags = [];
    for (let i = 0; i < 7; i++) {
      const m = addMesh(g.frag, mats.frag, float);
      frags.push({ m, a: (i / 7) * Math.PI * 2, r: 0.95 + (i % 3) * 0.16, h: (i % 2 ? 0.25 : -0.3) + Math.random() * 0.2, sp: 0.6 + Math.random() * 0.3, slot: -1 });
    }
    const glow = new T.Mesh(new T.PlaneGeometry(3.2, 3.2), mats.glow);
    glow.rotation.x = -Math.PI / 2; glow.position.y = 0.05; glow.renderOrder = 2;
    root.add(glow);
    const bar = makeBar(root, 3.25, 0.8);
    return { root, float, core, inner, eye, ring, ring2, frags, mats, glow, bar };
  }

  // ---------------- Enemy object ----------------
  let uid = 1;
  class Enemy {
    constructor(type) {
      this.type = type;
      this.rig = type === 'pursuer' ? buildPursuer() : buildIdol();
      this.root = this.rig.root;
      this.root.visible = false;
      E.scene.add(this.root);
      this.pos = this.root.position;
      this.vel = new V3();
      this.knock = new V3();
      this.alive = false;
      this.active = false;
    }
    spawn(pos) {
      const C = this.type === 'pursuer' ? PURSUER : IDOL;
      this.id = uid++;
      this.maxHp = C.hp; this.hp = C.hp; this.radius = C.radius;
      this.pos.set(pos.x, 0, pos.z);
      this.vel.set(0, 0, 0); this.knock.set(0, 0, 0);
      this.facing = Math.atan2(-pos.x, -pos.z);
      this.state = 'arrive'; this.st = 0;
      this.animT = Math.random() * 10;
      this.timeScale = 1;
      this.flash = 0; this.flinch = 0;
      this.rootT = 0; this.token = false;
      this.alive = true; this.active = true;
      this.flank = (this.id % 2 ? 1 : -1) * (0.8 + Math.random() * 0.35);
      this.strafeDir = Math.random() < 0.5 ? 1 : -1; this.strafeT = 2 + Math.random() * 2;
      this.cool = 1.0 + Math.random() * 1.2;
      this.nextAttack = Math.random() < 0.5 ? 'volley' : 'erupt';
      this.tele = null; this.tele2 = [];
      this.lockYaw = 0; this.lockPos = new V3();
      this.didHit = false;
      this.barShow = 0;
      this.root.visible = true;
      this.root.scale.setScalar(1);
      this.root.rotation.set(0, this.facing, 0);
      this.rig.bar.grp.visible = false;
      // arrival sigil + mist column
      FX.ring({ pos: this.pos, r0: 0.3, r1: 1.6, dur: 0.9, w0: 0.08, w1: 0.03, color: FX.AMBER, opacity: 0.7, ease: U.easeOutCubic });
      FX.ring({ pos: this.pos, r0: 1.4, r1: 1.2, dur: 1.0, w0: 0.03, w1: 0.02, color: U.fx.AMBER, opacity: 0.5, fill: 0.15 });
      FX.mist(_tmp.copy(this.pos).setY(0.3), 7, { spread: 0.7, rise: 1.6, life: 1.1, size: 1.0, a: 0.22, out: 0.3 });
      FX.sparks(_tmp.copy(this.pos).setY(0.2), 10, { speed: 3, up: 3, life: 0.8, size: 0.08, color: FX.AMBER, grav: -1, drag: 1.5 });
      U.audio.play('spawn', { gap: 0.1 });
    }
    releaseToken() { if (this.token) { this.token = false; E.attackers = Math.max(0, E.attackers - 1); } }
    tryToken() {
      if (this.token) return true;
      if (E.attackers >= E.maxAttackers) return false;
      this.token = true; E.attackers++; return true;
    }
    clearTeles() {
      if (this.tele) { this.tele.release(); this.tele = null; }
      for (const t of this.tele2) t.release();
      this.tele2.length = 0;
    }
    setState(s) { this.state = s; this.st = 0; this.didHit = false; }
  }
  const _tmp = new V3(), _tmp2 = new V3(), _tmp3 = new V3();

  // ---------------- API ----------------
  E.init = function (scene) {
    E.scene = scene;
    geoms();
    E.pool = { pursuer: [], idol: [] };
    for (let i = 0; i < 7; i++) E.pool.pursuer.push(new Enemy('pursuer'));
    for (let i = 0; i < 4; i++) E.pool.idol.push(new Enemy('idol'));
    // projectiles
    E.projectiles = [];
    const pmat = new T.MeshBasicMaterial({ color: new T.Color(1.9, 0.85, 0.38) });
    const gmat = new T.MeshBasicMaterial({ map: U.tex.glow, color: new T.Color(1.2, 0.45, 0.2), transparent: true, depthWrite: false, blending: T.AdditiveBlending });
    for (let i = 0; i < 36; i++) {
      const grp = new T.Group();
      const m = new T.Mesh(G.proj, pmat); grp.add(m);
      const glow = new T.Sprite(new T.SpriteMaterial({ map: U.tex.glow, color: new T.Color(1.3, 0.5, 0.22), transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
      glow.scale.set(0.9, 0.9, 1); grp.add(glow);
      grp.visible = false;
      scene.add(grp);
      E.projectiles.push({ grp, active: false, pos: grp.position, vel: new V3(), life: 0 });
    }
    void gmat;
    // eruptions
    E.eruptions = [];
    const smat = U.stdMat({ color: 0x17171b, roughness: 0.7, metalness: 0.3, emissive: new T.Color(0.16, 0.03, 0.022) }, 0.5, 2.0);
    for (let i = 0; i < 16; i++) {
      const grp = new T.Group();
      const spikes = [];
      for (let k = 0; k < 5; k++) {
        const s = new T.Mesh(G.spike, smat);
        s.castShadow = true;
        const a = (k / 5) * Math.PI * 2 + Math.random();
        const r = k === 0 ? 0 : 0.45 + Math.random() * 0.35;
        s.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        s.rotation.set((Math.random() - 0.5) * 0.5 + (k ? Math.sin(a) * 0.35 : 0), Math.random() * 3, (Math.random() - 0.5) * 0.5 - (k ? Math.cos(a) * 0.35 : 0));
        const sc = k === 0 ? 1.15 : 0.55 + Math.random() * 0.4;
        s.userData.sc = sc;
        grp.add(s); spikes.push(s);
      }
      grp.visible = false;
      scene.add(grp);
      E.eruptions.push({ grp, spikes, active: false, pos: new V3(), t: 0, delay: 1, tele: null, phase: 0, owner: null });
    }
  };

  E.reset = function () {
    for (const e of E.list) { e.clearTeles(); e.root.visible = false; e.alive = false; e.active = false; e.token = false; }
    E.list.length = 0;
    E.attackers = 0;
    for (const p of E.projectiles) { p.active = false; p.grp.visible = false; }
    for (const er of E.eruptions) { er.active = false; er.grp.visible = false; if (er.tele) { er.tele.release(); er.tele = null; } }
  };

  E.spawn = function (type, pos) {
    const pool = E.pool[type];
    const e = pool.find((x) => !x.active);
    if (!e) return null;
    e.spawn(pos);
    E.list.push(e);
    return e;
  };

  E.aliveCount = function () { let n = 0; for (const e of E.list) if (e.alive) n++; return n; };

  // deactivate enemy projectiles and eruptions (used when a wave is cleared)
  E.clearHazards = function () {
    for (const p of E.projectiles) {
      if (!p.active) continue;
      FX.sparks(p.pos, 5, { speed: 2, color: FX.AMBER, life: 0.3, size: 0.08 });
      p.active = false; p.grp.visible = false;
    }
    for (const er of E.eruptions) {
      if (!er.active) continue;
      if (er.tele) { er.tele.release(); er.tele = null; }
      er.active = false; er.grp.visible = false;
    }
  };

  // damage an enemy. o: {dir (V3 push direction), knock, heavy, stagger, root, quiet}
  E.hit = function (e, dmg, o) {
    if (!e.alive || e.state === 'dying') return false;
    o = o || {};
    e.hp -= dmg;
    e.flash = 1;
    e.flinch = Math.min(1, e.flinch + (o.heavy ? 1 : 0.6));
    e.barShow = 3;
    const resist = e.type === 'idol' ? 0.5 : 1;
    if (o.dir && o.knock) {
      _tmp.copy(o.dir).setY(0).normalize().multiplyScalar(o.knock * resist);
      e.knock.add(_tmp);
    }
    if (e.hp <= 0) { E.kill(e, o); return true; }
    const interruptible = ['windup1', 'windup2', 'gap', 'volleyWind', 'volleyMid', 'eruptWind', 'approach', 'strafe', 'drift'];
    if ((o.heavy || o.stagger) && interruptible.indexOf(e.state) >= 0) {
      e.clearTeles(); e.releaseToken();
      e.setState('stagger');
      e.staggerDur = o.stagger || 0.6;
    }
    if (o.root) {
      e.rootT = Math.max(e.rootT, o.root);
      if (e.state === 'windup1' || e.state === 'windup2' || e.state === 'gap') { e.clearTeles(); e.releaseToken(); e.setState('stagger'); e.staggerDur = 0.45; }
    }
    return true;
  };

  E.kill = function (e, o) {
    e.alive = false;
    e.clearTeles(); e.releaseToken();
    e.state = 'dying'; e.st = 0;
    const c = _tmp.copy(e.pos).setY(e.type === 'idol' ? IDOL.hover : 1.1);
    const dir = o && o.dir ? _tmp2.copy(o.dir).setY(0.4).normalize() : null;
    if (e.type === 'pursuer') {
      FX.shards(c, 26, { speed: 6.5, size: 0.17, life: 1.4, spread: 0.7, yspread: 2.2, colors: [COL.dark, COL.dark, COL.bone, COL.metal], dir, bias: 0.35 });
    } else {
      FX.shards(c, 24, { speed: 7, size: 0.2, life: 1.5, spread: 0.6, yspread: 1.6, colors: [COL.obsidian, COL.obsidian, COL.metal, COL.ember], dir, bias: 0.3 });
      FX.sparks(c, 18, { speed: 7, up: 0.8, life: 0.6, size: 0.1, color: FX.AMBER });
    }
    FX.shards(c, 10, { bright: true, speed: 5, size: 0.08, life: 0.5, spread: 0.5, grav: 3 });
    FX.mist(_tmp3.copy(e.pos).setY(0.6), 7, { spread: 0.6, rise: 0.8, life: 1.2, size: 1.0, a: 0.28 });
    FX.ring({ pos: e.pos, r0: 0.4, r1: 2.6, dur: 0.45, w0: 0.14, w1: 0.02, opacity: 0.8, intensity: 1.4 });
    FX.flash(c, 14, 7, 0.3);
    U.audio.play('shatter', { gap: 0.05 });
    e.root.visible = false;
    // removal from E.list is deferred to E.update so callers iterating the list never skip an enemy
    e.active = false;
    if (U.game) U.game.onEnemyKilled(e);
  };
  const COL = {
    dark: new T.Color(0.11, 0.11, 0.13), bone: new T.Color(0.62, 0.6, 0.55), metal: new T.Color(0.38, 0.39, 0.42),
    obsidian: new T.Color(0.07, 0.07, 0.09), ember: new T.Color(0.9, 0.35, 0.15),
  };

  // ---------------- per-frame ----------------
  E.update = function (dt) {
    const P = U.player;
    for (let i = E.list.length - 1; i >= 0; i--) if (!E.list[i].active) E.list.splice(i, 1);
    for (let i = E.list.length - 1; i >= 0; i--) {
      const e = E.list[i];
      if (!e.active) continue;
      e.timeScale = U.skills.timeScaleAt(e.pos);
      const edt = dt * e.timeScale;
      e.animT += edt;
      e.st += edt;
      e.flash = Math.max(0, e.flash - dt * 6);
      e.flinch = Math.max(0, e.flinch - edt * 5);
      e.rootT = Math.max(0, e.rootT - edt);
      e.barShow = Math.max(0, e.barShow - dt);
      if (e.type === 'pursuer') updatePursuer(e, edt, P);
      else updateIdol(e, edt, P);
      if (!e.active) continue;
      // knockback & separation
      e.pos.addScaledVector(e.knock, edt);
      e.knock.multiplyScalar(Math.exp(-7 * edt));
      for (const o of E.list) {
        if (o === e || !o.active) continue;
        const dx = e.pos.x - o.pos.x, dz = e.pos.z - o.pos.z;
        const d = Math.hypot(dx, dz), min = e.radius + o.radius + 0.1;
        if (d < min && d > 1e-4) { const push = (min - d) * 0.5; e.pos.x += (dx / d) * push; e.pos.z += (dz / d) * push; }
      }
      // keep inside the courtyard
      U.arenaClamp(e.pos, e.radius);
      e.root.rotation.y = e.facing;
      // hit flash & slow tint
      const fl = e.flash * e.flash;
      for (const k in e.rig.mats) {
        const m = e.rig.mats[k];
        if (k === 'blade' || k === 'frag') continue; // these carry the amber wind-up glow
        if (m.emissive && m.userData.rimStrength) m.emissive.setRGB(fl * 0.9 + (e.timeScale < 1 ? 0.03 : 0), fl * 0.9 + (e.timeScale < 1 ? 0.035 : 0), fl * 0.95 + (e.timeScale < 1 ? 0.06 : 0));
      }
      updateBar(e);
    }
    updateProjectiles(dt, P);
    updateEruptions(dt, P);
  };

  function updateBar(e) {
    const b = e.rig.bar;
    const show = e.barShow > 0 && e.alive && e.hp < e.maxHp;
    b.grp.visible = show;
    if (!show) return;
    b.grp.quaternion.copy(U.world.camera.quaternion);
    b.grp.quaternion.premultiply(_q.copy(e.root.quaternion).invert());
    const k = U.clamp(e.hp / e.maxHp, 0, 1);
    b.fg.scale.x = Math.max(0.001, b.w * k);
    b.fg.position.x = -b.w * (1 - k) / 2;
    const a = Math.min(1, e.barShow);
    b.fg.material.opacity = a; b.bg.material.opacity = a * 0.7;
  }
  const _q = new T.Quaternion();

  function faceTo(e, x, z, rate, dt) {
    const target = Math.atan2(x - e.pos.x, z - e.pos.z);
    if (rate == null) e.facing = target;
    else {
      const d = U.angleDiff(e.facing, target);
      e.facing += U.clamp(d, -rate * dt, rate * dt);
    }
  }

  // ---------------- Pursuer behaviour ----------------
  function updatePursuer(e, dt, P) {
    const C = PURSUER;
    const pp = P.pos;
    const dx = pp.x - e.pos.x, dz = pp.z - e.pos.z;
    const dist = Math.hypot(dx, dz);
    const canMove = e.rootT <= 0;
    const playerAlive = P.alive;
    let moveX = 0, moveZ = 0, speed = 0;

    switch (e.state) {
      case 'arrive': {
        const k = U.clamp(e.st / 0.9, 0, 1);
        e.rig.body.position.y = -1.7 * Math.pow(1 - k, 2);
        if (e.st >= 0.9) { e.rig.body.position.y = 0; e.setState('approach'); }
        faceTo(e, pp.x, pp.z, 4, dt);
        break;
      }
      case 'approach':
      case 'strafe': {
        if (!playerAlive) { e.setState('idle'); break; }
        // approach from an offset angle: aim at a point beside the player
        const ang = Math.atan2(e.pos.x - pp.x, e.pos.z - pp.z) + e.flank * U.clamp((dist - 2) / 5, 0, 1);
        const want = e.state === 'strafe' ? 3.4 : 1.7;
        const tx = pp.x + Math.sin(ang) * want, tz = pp.z + Math.cos(ang) * want;
        let mx = tx - e.pos.x, mz = tz - e.pos.z;
        const ml = Math.hypot(mx, mz);
        if (e.state === 'strafe') {
          // circle while waiting for an attack slot
          mx += -dz / (dist || 1) * e.strafeDir * 1.4; mz += dx / (dist || 1) * e.strafeDir * 1.4;
          e.strafeT -= dt;
          if (e.strafeT <= 0) { e.strafeDir *= -1; e.strafeT = 1.5 + Math.random() * 2; }
          if (e.st > 0.5 && E.attackers < E.maxAttackers) e.setState('approach');
        }
        const l = Math.hypot(mx, mz);
        if (l > 0.15) { moveX = mx / l; moveZ = mz / l; speed = C.speed * (e.state === 'strafe' ? 0.55 : U.clamp(ml / 1.5, 0.35, 1)); }
        faceTo(e, pp.x, pp.z, 7, dt);
        if (dist < C.engage && e.st > 0.25) {
          if (e.tryToken()) startWindup(e, 1, P);
          else if (e.state !== 'strafe') e.setState('strafe');
        } else if (e.state === 'strafe' && dist > 4.5) e.setState('approach');
        if (e.state === 'strafe' && e.st > 0.4 && dist < C.engage + 0.6 && e.tryToken()) startWindup(e, 1, P);
        break;
      }
      case 'windup1':
      case 'windup2': {
        const n = e.state === 'windup1' ? 1 : 2;
        const dur = n === 1 ? C.w1 : C.w2, lock = n === 1 ? C.lock1 : C.lock2;
        if (e.st < lock) {
          faceTo(e, pp.x, pp.z, 9, dt);
          e.lockYaw = e.facing;
          e.lockPos.copy(e.pos);
          if (canMove && dist > 1.4) { moveX = dx / dist; moveZ = dz / dist; speed = 1.0; }
          e.tele.grp.position.set(e.pos.x, 0.07, e.pos.z);
          e.tele.grp.rotation.y = e.lockYaw;
        } else {
          e.facing = e.lockYaw;
          e.tele.mat.uniforms.uLocked.value = 1;
        }
        e.tele.mat.uniforms.uProgress.value = U.clamp(e.st / dur, 0, 1);
        e.tele.mat.uniforms.uOpacity.value = U.clamp(e.st / 0.1, 0, 1);
        if (e.st >= dur) {
          e.setState(n === 1 ? 'strike1' : 'strike2');
          U.audio.play('pslash', { gap: 0.05 });
        }
        break;
      }
      case 'strike1':
      case 'strike2': {
        const n = e.state === 'strike1' ? 1 : 2;
        const dur = n === 1 ? C.s1 : C.s2, lunge = n === 1 ? C.lunge1 : C.lunge2;
        e.facing = e.lockYaw;
        if (canMove) { const f = lunge / dur; e.pos.x += Math.sin(e.lockYaw) * f * dt; e.pos.z += Math.cos(e.lockYaw) * f * dt; }
        if (e.tele) e.tele.mat.uniforms.uOpacity.value = 1.15;
        if (!e.didHit && e.st > dur * 0.35) {
          e.didHit = true;
          const reach = (n === 1 ? C.reach1 : C.reach2) + lunge * 0.5, half = n === 1 ? C.half1 : C.half2;
          if (inSector(P.pos, e.lockPos, e.lockYaw, reach + P.radius * 0.6, half + 0.08)) {
            P.takeDamage(n === 1 ? C.dmg1 : C.dmg2, e.pos);
          }
          // a visible slash arc so the strike reads even when it misses
          FX.ring({ pos: _tmp.set(e.lockPos.x + Math.sin(e.lockYaw) * 0.8, 0, e.lockPos.z + Math.cos(e.lockYaw) * 0.8), r0: 0.6, r1: 1.4, dur: 0.22, w0: 0.08, w1: 0.02, color: FX.AMBER, opacity: 0.5 });
        }
        if (e.st >= dur) {
          e.clearTeles();
          if (n === 1) e.setState('gap');
          else { e.releaseToken(); e.setState('recovery'); }
        }
        break;
      }
      case 'gap': {
        // deliberate pause before the second strike; slow re-tracking
        faceTo(e, pp.x, pp.z, 2.2, dt);
        if (e.st >= C.gap) startWindup(e, 2, P);
        break;
      }
      case 'recovery': {
        if (e.st >= C.rec) { e.setState('approach'); e.flank = -e.flank; }
        break;
      }
      case 'stagger': {
        if (e.st >= (e.staggerDur || 0.6)) e.setState('approach');
        break;
      }
      case 'idle': {
        if (playerAlive) e.setState('approach');
        break;
      }
    }
    if (!canMove) speed = 0;
    if (speed > 0) { e.pos.x += moveX * speed * dt; e.pos.z += moveZ * speed * dt; }
    e.vel.set(moveX * speed, 0, moveZ * speed);
    animatePursuer(e, dt, speed);
  }

  function startWindup(e, n, P) {
    e.setState(n === 1 ? 'windup1' : 'windup2');
    const C = PURSUER;
    const reach = (n === 1 ? C.reach1 : C.reach2) + (n === 1 ? C.lunge1 : C.lunge2) * 0.5;
    e.clearTeles();
    e.tele = FX.telegraph({ pos: e.pos, r: reach, half: n === 1 ? C.half1 : C.half2, yaw: e.facing, intensity: n === 1 ? 0.85 : 1.0 });
    e.lockYaw = e.facing; e.lockPos.copy(e.pos);
    U.audio.play('windup', { gap: 0.08 });
  }

  function inSector(p, origin, yaw, reach, half) {
    const dx = p.x - origin.x, dz = p.z - origin.z;
    const d = Math.hypot(dx, dz);
    if (d > reach) return false;
    if (d < 0.6) return true;
    return Math.abs(U.angleDiff(yaw, Math.atan2(dx, dz))) <= half;
  }

  function animatePursuer(e, dt, speed) {
    const r = e.rig, t = e.animT, C = PURSUER;
    e.runPh = (e.runPh || 0) + speed * dt * 2.9;
    const run = U.clamp(speed / C.speed, 0, 1);
    e.runBlend = U.damp(e.runBlend || 0, run, 8, dt);
    const rb = e.runBlend;
    let lean = 0.45 + rb * 0.2, twist = 0, bodyY = -0.04 * rb * Math.abs(Math.sin(e.runPh)), headX = -0.2;
    let aR = [0.35 - Math.sin(e.runPh) * 0.5 * rb, 0, -0.18], eR = 0.35;
    let aL = [0.35 + Math.sin(e.runPh) * 0.5 * rb, 0, 0.18], eL = 0.35;
    let glowR = 0, glowL = 0;
    const s = e.state, st = e.st;
    if (s === 'windup1') {
      const k = U.easeOutCubic(U.clamp(st / C.w1, 0, 1));
      lean = U.lerp(lean, 0.2, k); twist = -0.65 * k; bodyY -= 0.08 * k;
      aR = [U.lerp(0.35, 2.35, k), 0, U.lerp(-0.18, -0.65, k)]; eR = U.lerp(0.35, 1.0, k);
      aL = [0.2, 0, 0.45 * k]; glowR = k;
    } else if (s === 'strike1') {
      const k = U.easeOutCubic(U.clamp(st / C.s1, 0, 1));
      lean = U.lerp(0.2, 0.65, k); twist = U.lerp(-0.65, 0.75, k); bodyY = -0.1;
      aR = [U.lerp(2.35, -1.05, k), 0, U.lerp(-0.65, 0.95, k)]; eR = U.lerp(1.0, 0.1, k);
      aL = [0.2, 0, 0.45]; glowR = 1;
    } else if (s === 'gap') {
      const k = U.clamp(st / C.gap, 0, 1);
      lean = U.lerp(0.65, 0.4, k); twist = U.lerp(0.75, 0.35, k); bodyY = -0.1 + 0.06 * k;
      aR = [U.lerp(-1.05, -0.6, k), 0, U.lerp(0.95, 0.6, k)]; eR = 0.2;
      aL = [U.lerp(0.2, 1.4, k * k), 0, 0.3]; eL = 0.5; glowL = k * 0.4;
    } else if (s === 'windup2') {
      const k = U.easeOutCubic(U.clamp(st / C.w2, 0, 1));
      lean = U.lerp(0.4, -0.12, k); twist = U.lerp(0.35, 0.15, k); bodyY = U.lerp(-0.04, 0.05, k); headX = -0.35;
      aL = [U.lerp(1.4, 2.85, k), 0, U.lerp(0.3, 0.12, k)]; eL = U.lerp(0.5, 0.7, k);
      aR = [-0.3, 0, 0.4]; eR = 0.3; glowL = 0.4 + 0.6 * k;
    } else if (s === 'strike2') {
      const k = U.easeOutCubic(U.clamp(st / C.s2, 0, 1));
      lean = U.lerp(-0.12, 0.85, k); twist = 0.1; bodyY = U.lerp(0.05, -0.16, k);
      aL = [U.lerp(2.85, -0.9, k), 0, 0.15]; eL = U.lerp(0.7, 0.08, k);
      aR = [0.5, 0, -0.5]; eR = 0.3; glowL = 1;
    } else if (s === 'recovery') {
      const k = U.clamp(st / C.rec, 0, 1);
      const heave = Math.sin(t * 9) * 0.04 * (1 - k);
      lean = U.lerp(0.9, 0.5, k) + heave; bodyY = U.lerp(-0.16, 0, k); headX = 0.35 * (1 - k);
      aL = [U.lerp(-0.6, 0.35, k), 0, 0.15]; eL = 0.15; aR = [U.lerp(0.2, 0.35, k), 0, -0.3]; eR = 0.2;
    } else if (s === 'stagger') {
      const k = U.clamp(st / (e.staggerDur || 0.6), 0, 1);
      const w = Math.sin(k * Math.PI);
      lean = U.lerp(0.45, -0.35, w); headX = -0.6 * w;
      aR = [0.4, 0, -0.9 * w]; aL = [0.4, 0, 0.9 * w];
    }
    if (e.flinch > 0) { lean -= e.flinch * 0.3; headX -= e.flinch * 0.3; }
    if (e.rootT > 0) { bodyY -= 0.05; twist += Math.sin(t * 22) * 0.06; }
    r.body.position.y = s === 'arrive' ? r.body.position.y : bodyY;
    r.spine.rotation.set(lean * 0.6, twist * 0.5, 0);
    r.chest.rotation.set(lean * 0.4, twist * 0.5, 0);
    r.head.rotation.set(headX - lean * 0.5, -twist * 0.4, 0);
    const armR = r.arms[1], armL = r.arms[0];
    armR.sh.rotation.set(aR[0], aR[1], aR[2]); armR.el.rotation.x = -eR;
    armL.sh.rotation.set(aL[0], aL[1], aL[2]); armL.el.rotation.x = -eL;
    for (const L of r.legs) {
      const sw = Math.sin(e.runPh) * L.s * rb;
      L.leg.rotation.set(-sw * 0.75 - (s === 'strike1' || s === 'strike2' ? 0.25 * L.s : 0), 0, L.s * 0.05);
      L.knee.rotation.x = 0.25 + Math.max(0, Math.cos(e.runPh) * L.s) * 1.0 * rb + lean * 0.2;
      L.ankle.rotation.x = -0.15;
    }
    for (const st2 of r.strips) st2.piv.rotation.x = 0.15 + rb * 0.35 + Math.sin(t * 3 + st2.ph) * 0.06 + Math.max(0, lean) * 0.2;
    // amber edge glow during wind-ups (functional warning colour)
    r.mats.blade.emissive.setRGB(1.0 * Math.max(glowR, glowL), 0.42 * Math.max(glowR, glowL), 0.16 * Math.max(glowR, glowL));
    const gl = Math.max(glowR, glowL);
    r.mats.eye.color.setRGB(U.lerp(0.9, 2.6, gl), U.lerp(0.92, 1.1, gl), U.lerp(1.0, 0.4, gl));
  }

  // ---------------- Hex Idol behaviour ----------------
  function updateIdol(e, dt, P) {
    const C = IDOL;
    const pp = P.pos;
    const dx = pp.x - e.pos.x, dz = pp.z - e.pos.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    const canMove = e.rootT <= 0;
    let mx = 0, mz = 0, speed = 0;
    switch (e.state) {
      case 'arrive': {
        const k = U.clamp(e.st / 1.0, 0, 1);
        e.root.scale.setScalar(0.2 + 0.8 * U.easeOutBack(k));
        if (e.st >= 1.0) { e.root.scale.setScalar(1); e.setState('drift'); }
        break;
      }
      case 'drift': {
        // hold distance, strafe around the player
        const radial = (dist - C.keep);
        const tx = -dz / dist * e.strafeDir, tz = dx / dist * e.strafeDir;
        mx = tx * 0.8 + (dx / dist) * U.clamp(radial * 0.6, -1, 1);
        mz = tz * 0.8 + (dz / dist) * U.clamp(radial * 0.6, -1, 1);
        // avoid the rim
        const r = Math.hypot(e.pos.x, e.pos.z), lim = U.arenaMaxR(e.pos.x, e.pos.z) - 2.6;
        if (r > lim) { mx -= e.pos.x / r * (r - lim); mz -= e.pos.z / r * (r - lim); }
        const l = Math.hypot(mx, mz);
        if (l > 0.01) { mx /= l; mz /= l; speed = C.speed; }
        e.strafeT -= dt;
        if (e.strafeT <= 0) { e.strafeDir *= -1; e.strafeT = 2 + Math.random() * 2.5; }
        faceTo(e, pp.x, pp.z, 3, dt);
        e.cool -= dt;
        if (e.cool <= 0 && P.alive && dist < 15 && e.tryToken()) {
          if (e.nextAttack === 'volley') startVolley(e);
          else startErupt(e);
        }
        break;
      }
      case 'volleyWind':
      case 'volleyMid': {
        const first = e.state === 'volleyWind';
        const dur = first ? C.volleyWind : C.volleyMid, lock = first ? C.volleyLock : C.midLock;
        if (e.st < lock) {
          faceTo(e, pp.x, pp.z, 5, dt);
          e.lockYaw = Math.atan2(pp.x - e.pos.x, pp.z - e.pos.z);
        } else {
          for (const t of e.tele2) t.mat.uniforms.uLocked.value = 1;
        }
        const show = first ? U.clamp((e.st - 0.2) / 0.15, 0, 1) : U.clamp(e.st / 0.1, 0, 1);
        e.tele2.forEach((t, i) => {
          t.grp.position.set(e.pos.x, 0.07, e.pos.z);
          t.grp.rotation.y = e.lockYaw + (i - 1) * C.fan;
          t.mat.uniforms.uOpacity.value = show * 0.9;
          t.mat.uniforms.uProgress.value = U.clamp(e.st / dur, 0, 1);
        });
        if (e.st >= dur) {
          fireFan(e);
          if (first) {
            e.setState('volleyMid');
            for (const t of e.tele2) t.mat.uniforms.uLocked.value = 0;
          } else {
            e.clearTeles(); e.releaseToken();
            e.setState('recover'); e.recDur = C.volleyRec;
            e.nextAttack = 'erupt';
          }
        }
        break;
      }
      case 'eruptWind': {
        faceTo(e, pp.x, pp.z, 4, dt);
        if (e.st >= C.eruptWind) {
          placeEruptions(e, P);
          e.releaseToken();
          e.setState('recover'); e.recDur = C.eruptRec;
          e.nextAttack = 'volley';
        }
        break;
      }
      case 'recover': {
        if (e.st >= e.recDur) { e.setState('drift'); e.cool = 1.5 + Math.random() * 1.2; }
        break;
      }
      case 'stagger': {
        if (e.st >= (e.staggerDur || 0.5)) { e.setState('drift'); e.cool = 1.0; }
        break;
      }
    }
    if (!canMove) speed = 0;
    if (speed > 0) { e.pos.x += mx * speed * dt; e.pos.z += mz * speed * dt; }
    animateIdol(e, dt);
  }

  function startVolley(e) {
    e.setState('volleyWind');
    e.clearTeles();
    for (let i = 0; i < 3; i++) e.tele2.push(FX.telegraph({ pos: e.pos, r: 8.5, half: 0.022, yaw: e.facing, intensity: 0.9 }));
    for (const t of e.tele2) t.mat.uniforms.uOpacity.value = 0;
    U.audio.play('idolCharge', { gap: 0.1 });
  }
  function startErupt(e) {
    e.setState('eruptWind');
    U.audio.play('idolCharge', { gap: 0.1 });
  }

  function fireFan(e) {
    const C = IDOL;
    for (let i = -1; i <= 1; i++) {
      const p = E.projectiles.find((x) => !x.active);
      if (!p) break;
      const yaw = e.lockYaw + i * C.fan;
      p.active = true; p.life = 0;
      p.pos.set(e.pos.x + Math.sin(yaw) * 0.9, 1.25, e.pos.z + Math.cos(yaw) * 0.9);
      p.vel.set(Math.sin(yaw) * C.projSpeed, 0, Math.cos(yaw) * C.projSpeed);
      p.grp.rotation.set(0, yaw, 0);
      p.grp.visible = true;
    }
    FX.sparks(_tmp.set(e.pos.x + Math.sin(e.lockYaw) * 0.8, IDOL.hover, e.pos.z + Math.cos(e.lockYaw) * 0.8), 10, { speed: 4, color: FX.AMBER, life: 0.3, size: 0.09, grav: 0 });
    U.audio.play('idolFire', { gap: 0.04 });
  }

  function placeEruptions(e, P) {
    const C = IDOL;
    const pts = [];
    pts.push(_tmp.copy(P.pos).clone());
    const lead = _tmp2.copy(P.vel).setY(0).multiplyScalar(0.75);
    if (lead.length() > 0.5) pts.push(P.pos.clone().add(lead));
    while (pts.length < 4) {
      const a = Math.random() * Math.PI * 2, r = 1.9 + Math.random() * 1.6;
      pts.push(new V3(P.pos.x + Math.sin(a) * r, 0, P.pos.z + Math.cos(a) * r));
    }
    pts.forEach((p, i) => {
      U.arenaClamp(p, 0.5);
      const er = E.eruptions.find((x) => !x.active);
      if (!er) return;
      er.active = true; er.t = 0; er.phase = 0; er.delay = C.eruptDelay + i * 0.13; er.owner = e;
      er.pos.set(p.x, 0, p.z);
      er.tele = FX.telegraph({ pos: er.pos, r: C.eruptR, color: FX.CRIMSON, intensity: 1.0 });
      er.grp.position.copy(er.pos);
    });
    FX.ring({ pos: e.pos, r0: 0.5, r1: 2.2, dur: 0.4, w0: 0.1, w1: 0.03, color: FX.AMBER, opacity: 0.6 });
    U.audio.play('eruptMark', { gap: 0.1 });
  }

  function animateIdol(e, dt) {
    const r = e.rig, t = e.animT, C = IDOL;
    let charge = 0, lift = 0, spin = 0.6;
    if (e.state === 'volleyWind') charge = U.clamp(e.st / C.volleyWind, 0, 1);
    else if (e.state === 'volleyMid') charge = 0.6 + 0.4 * U.clamp(e.st / C.volleyMid, 0, 1);
    else if (e.state === 'eruptWind') { charge = U.clamp(e.st / C.eruptWind, 0, 1); lift = charge * 0.5; spin = 4 * charge + 0.6; }
    else if (e.state === 'stagger') { r.float.rotation.z = Math.sin(t * 30) * 0.2 * (1 - U.clamp(e.st / (e.staggerDur || 0.5), 0, 1)); }
    if (e.state !== 'stagger') r.float.rotation.z = U.damp(r.float.rotation.z, 0, 6, dt);
    r.float.position.y = C.hover + Math.sin(t * 1.6) * 0.12 + lift - e.flinch * 0.15;
    r.core.rotation.y += dt * (0.4 + charge * 2);
    r.ring.rotation.z += dt * spin;
    r.ring2.rotation.z -= dt * spin * 0.7;
    r.mats.inner.opacity = charge * 0.95;
    r.mats.eye.color.setRGB(U.lerp(0.85, 2.6, charge), U.lerp(0.88, 1.0, charge), U.lerp(0.98, 0.4, charge));
    r.mats.frag.emissive.setRGB(charge * 0.7, charge * 0.25, charge * 0.08);
    r.mats.glow.opacity = charge * 0.9;
    const volley = e.state === 'volleyWind' || e.state === 'volleyMid';
    r.frags.forEach((f, i) => {
      f.a += dt * f.sp * (1 + charge * 2);
      let x = Math.cos(f.a) * f.r, z = Math.sin(f.a) * f.r, y = f.h + Math.sin(t * 2 + i) * 0.1 + lift * (i % 2 ? 1.2 : 0.6);
      if (volley && i < 3) {
        // three fragments align into the firing fan in front of the core
        const k = U.smooth(U.clamp(charge * 1.6, 0, 1));
        const yawL = (i - 1) * C.fan;
        const fx = Math.sin(yawL) * 0.85, fz = Math.cos(yawL) * 0.85;
        x = U.lerp(x, fx, k); z = U.lerp(z, fz, k); y = U.lerp(y, -0.45, k);
        f.m.rotation.set(Math.PI / 2 * k, yawL * k + f.a * (1 - k), 0);
      } else {
        f.m.rotation.set(f.a * 0.7, f.a, 0.3);
      }
      f.m.position.set(x, y, z);
    });
  }

  // ---------------- projectiles ----------------
  function updateProjectiles(dt, P) {
    for (const p of E.projectiles) {
      if (!p.active) continue;
      p.life += dt;
      p.pos.addScaledVector(p.vel, dt);
      p.grp.children[0].rotation.z += dt * 12;
      if (Math.random() < 0.6) FX.sparks(p.pos, 1, { speed: 0.4, color: FX.AMBER, life: 0.25, size: 0.1, grav: 0, a: 0.7 });
      const dx = P.pos.x - p.pos.x, dz = P.pos.z - p.pos.z;
      if (P.alive && Math.hypot(dx, dz) < P.radius + 0.26) {
        if (P.takeDamage(IDOL.projDmg, p.pos)) {
          FX.sparks(p.pos, 12, { speed: 5, color: FX.AMBER, life: 0.35, size: 0.1 });
          p.active = false; p.grp.visible = false;
          continue;
        }
      }
      if (p.life > 2.2 || Math.hypot(p.pos.x, p.pos.z) > U.CONST.PLATFORM_R + 2) {
        FX.sparks(p.pos, 5, { speed: 2, color: FX.AMBER, life: 0.3, size: 0.08 });
        p.active = false; p.grp.visible = false;
      }
    }
  }

  function updateEruptions(dt, P) {
    const C = IDOL;
    for (const er of E.eruptions) {
      if (!er.active) continue;
      const ts = U.skills.timeScaleAt(er.pos);
      const edt = dt * ts;
      er.t += edt;
      if (er.phase === 0) {
        const k = U.clamp(er.t / er.delay, 0, 1);
        er.tele.mat.uniforms.uProgress.value = k;
        er.tele.mat.uniforms.uOpacity.value = U.clamp(er.t / 0.12, 0, 1);
        er.tele.mat.uniforms.uLocked.value = 1;
        if (er.t >= er.delay) {
          er.phase = 1; er.t = 0;
          er.tele.release(); er.tele = null;
          er.grp.visible = true;
          // damage
          const d = Math.hypot(P.pos.x - er.pos.x, P.pos.z - er.pos.z);
          if (P.alive && d < C.eruptR + P.radius * 0.5) P.takeDamage(C.eruptDmg, er.pos);
          FX.sparks(_tmp.copy(er.pos).setY(0.2), 16, { speed: 6, up: 3, color: FX.CRIMSON, life: 0.45, size: 0.11, grav: 9 });
          FX.shards(_tmp.copy(er.pos).setY(0.2), 7, { speed: 5, up: 2.5, size: 0.12, life: 0.9, colors: [COL.obsidian, COL.dark] });
          FX.mist(_tmp.copy(er.pos).setY(0.4), 4, { spread: 0.8, rise: 0.9, life: 0.9, size: 0.9, a: 0.22 });
          FX.ring({ pos: er.pos, r0: 0.3, r1: C.eruptR + 0.4, dur: 0.3, w0: 0.12, w1: 0.03, color: FX.CRIMSON, opacity: 0.8, intensity: 1.1 });
          FX.crack(er.pos, 1.6, 1.1, 0.35, FX.CRIMSON);
          FX.flash(_tmp.copy(er.pos).setY(0.8), 6, 5, 0.25, FX.AMBER);
          U.audio.play('erupt', { gap: 0.06 });
          U.world.addShake(0.08);
        }
      } else {
        // spikes thrust up, hold, sink
        const t = er.t;
        const up = t < 0.08 ? U.easeOutCubic(t / 0.08) : t < 0.45 ? 1 : 1 - U.easeInCubic(U.clamp((t - 0.45) / 0.35, 0, 1));
        for (const s of er.spikes) { const sc = s.userData.sc; s.scale.set(sc, sc * up + 0.001, sc); }
        if (t > 0.8) { er.active = false; er.grp.visible = false; }
      }
    }
  }
})(window.U);
