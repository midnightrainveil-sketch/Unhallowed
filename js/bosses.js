/* UNHALLOWED — the three keepers of the seal.
   The seal on Vaust's chest has three locks, and each lock has a keeper:
     Ossarch, the Gaoler      — the lock of the body (chain and key)
     The Witness              — the lock of sight (the eye behind the broken eclipse)
     The Sealwright           — the lock of the name (the one who wrote the seal)
   Keepers live in U.enemies.list like any other enemy (so every skill touches them), but they
   resist being moved, pinned or erased, carry a stagger meter instead of being interrupted, and
   have deaths of their own. One keeper at a time. */
'use strict';
(function (U) {
  const T = THREE;
  const V3 = T.Vector3;
  const FX = U.fx;
  const E = U.enemies;
  const B = (U.bosses = {});

  B.DEFS = {
    gaoler: { name: 'Ossarch', title: 'the Gaoler · keeper of the first lock', hp: 2200, poise: 260, radius: 0.95, phases: [0.66, 0.5, 0.33], lock: 'The First Lock' },
    witness: { name: 'The Witness', title: 'beneath the eclipse · keeper of the second lock', hp: 2300, poise: 280, radius: 2.2, phases: [0.5], judgment: true, lock: 'The Second Lock' },
    sealwright: { name: 'The Sealwright', title: 'author of the seal · keeper of the last lock', hp: 2500, poise: 200, radius: 0.5, phases: [0.6, 0.25], lock: 'The Last Lock' },
  };
  B.instances = {};
  B.current = null;
  B.hazards = [];
  B.walls = [];          // Sealwright script walls: segments the player cannot cross
  B.arenaLimit = 99;     // Sealwright erasure: the courtyard shrinks

  const AMBER = new T.Color(1.0, 0.56, 0.24), CRIMSON = new T.Color(0.75, 0.16, 0.12), PALE = new T.Color(0.9, 0.92, 1.0);
  const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _q = new T.Quaternion(), _m4 = new T.Matrix4(), _e = new T.Euler();
  const lin = (x) => x;

  // ---------------- shared helpers ----------------
  const dmg = (n) => n * E.dmgMul;
  const tl = (s, b) => s * E.teleMul * (b && b.speedMul ? 1 / b.speedMul : 1);
  function hurt(n, from) { return U.player.takeDamage(dmg(n), from); }
  function addMesh(geo, mat, parent, x, y, z, rx, ry, rz) {
    const m = new T.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = true;
    parent.add(m);
    return m;
  }
  function inSector(p, o, yaw, r, half) {
    const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz);
    if (d > r) return false;
    if (d < 0.8) return true;
    return Math.abs(U.angleDiff(yaw, Math.atan2(dx, dz))) <= half;
  }
  function inLane(p, o, yaw, len, half) {
    const dx = p.x - o.x, dz = p.z - o.z;
    const f = dx * Math.sin(yaw) + dz * Math.cos(yaw), s = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    return f >= -0.4 && f <= len && Math.abs(s) <= half;
  }
  function segDist2D(p, a, b) {
    const abx = b.x - a.x, abz = b.z - a.z, l2 = abx * abx + abz * abz || 1e-6;
    const t = U.clamp(((p.x - a.x) * abx + (p.z - a.z) * abz) / l2, 0, 1);
    return Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t));
  }
  function damp(cur, tgt, rate, dt) { return cur + (tgt - cur) * (1 - Math.exp(-rate * dt)); }
  function rimPoint(angle, inset) {
    const x = Math.sin(angle), z = -Math.cos(angle);
    const R = U.arenaMaxR(x, z) - (inset || 2);
    return new V3(x * R, 0, z * R);
  }
  B.inLane = inLane; B.inSector = inSector;

  // a hazard ring the boss owns (drawn through the FX ring pool, frozen with the world)
  function heldRing(o) {
    const ro = Object.assign({ manual: true, r0: o.max, r1: o.max, w0: o.w, w1: o.w, dur: 1e9, pos: o.pos.clone() }, o);
    ro.pos = o.pos.clone ? o.pos.clone() : o.pos;
    const ring = FX.ring(ro);
    return { ring, ro, set(r, w, op) { if (this.ring.o !== this.ro) return; this.ro.r = r; this.ro.w = w; this.ro.opacity = op; }, release() { if (this.ring.o === this.ro) this.ring.release(); } };
  }
  B.heldRing = heldRing;

  // ---------------- base keeper ----------------
  class Boss {
    constructor(kind, rig) {
      this.kind = kind; this.type = kind; this.def = B.DEFS[kind]; this.isBoss = true;
      this.rig = rig; this.root = rig.root; this.pos = this.root.position;
      this.vel = new V3(); this.knock = new V3(); this.pinSnap = new V3(); this.lockPos = new V3();
      this.root.visible = false;
      E.scene.add(this.root);
      this.alive = false; this.active = false;
      this.teles = []; this.tele = null; this.tele2 = [];
      this.knockResist = 0.05; this.pinResist = 0.4;
      this.speedMul = 1;
    }
    spawn(pos) {
      const L = E.loop;
      this.maxHp = this.def.hp * E.hpMul; this.hp = this.maxHp;
      this.radius = this.def.radius;
      this.pos.set(pos.x, 0, pos.z);
      this.vel.set(0, 0, 0); this.knock.set(0, 0, 0);
      this.facing = Math.atan2(U.player.pos.x - pos.x, U.player.pos.z - pos.z);
      this.state = 'intro'; this.st = 0; this.animT = 0; this.timeScale = 1;
      this.flash = 0; this.flinch = 0; this.rootT = 0; this.token = false; this.didHit = false;
      this.mark = 0; this.pinT = 0; this.grip = null; this.under = false; this.sink = 0;
      this.splitT = 0; this.splitDmg = 0; this.splitDir = 1; this.dreadDur = 0; this.barShow = 0;
      this.poise = 0; this.poiseMax = this.def.poise * Math.pow(1.15, L - 1); this.broken = 0;
      this.phase = 1; this.vuln = 1; this.invuln = true; this.cool = 1.2; this.lastAtk = []; this.deathT = 0;
      this.speedMul = 1;
      this.alive = true; this.active = true;
      this.root.visible = true; this.root.scale.setScalar(1);
      this.rig.glyph.visible = false;
      E.list.push(this);
      B.current = this;
      U.ui.showBoss(this);
      this.onSpawn();
    }
    setState(s) { this.state = s; this.st = 0; this.didHit = false; }
    releaseToken() {}
    tryToken() { return true; }
    addTele(o) { const t = FX.telegraph(o); this.teles.push(t); return t; }
    dropTele(t) { if (!t) return; t.release(); const i = this.teles.indexOf(t); if (i >= 0) this.teles.splice(i, 1); }
    clearTeles() { for (const t of this.teles) t.release(); this.teles.length = 0; }
    // stagger meter: heavy blows fill it; full, the keeper is broken for a few seconds
    onHit(amount, o) {
      if (this.broken > 0 || this.state === 'intro' || this.state === 'phase') return;
      const k = o.heavy ? 1 : (o.poise != null ? o.poise : 0.3);
      this.poise += amount * k;
      if (this.poise >= this.poiseMax) this.breakPoise(3.0);
    }
    breakPoise(dur) {
      if (!this.alive) return;
      this.poise = this.poiseMax; this.broken = dur;
      this.clearTeles();
      if (this.onBreak) this.onBreak();
      this.setState('broken');
      U.audio.play('poiseBreak');
      const c = _a.copy(this.pos).setY(this.def.radius > 1.5 ? 3 : 1.6);
      FX.shards(c, 14, { bright: true, speed: 6, size: 0.1, life: 0.6, grav: 3 });
      FX.ring({ pos: this.pos, r0: 0.5, r1: 3.4, dur: 0.5, w0: 0.2, w1: 0.03, color: AMBER, opacity: 0.9, intensity: 1.4 });
      U.time.addHitstop(0.06); U.world.addShake(0.2);
    }
    // The Seal Objects reaches a keeper: it is not erased, but the seal tears at it
    onSeal() {
      if (!this.alive || this.state === 'intro') return;
      const keep = this.invuln; this.invuln = false;
      E.hit(this, this.maxHp * 0.12, {});
      this.invuln = keep;
      if (this.alive) this.breakPoise(3.2);
    }
    phaseCheck() {
      const k = this.hp / this.maxHp;
      const ph = this.def.phases;
      return k;
    }
    think(dt, P) {
      if (this.state === 'dying') { this.updateDeath(dt); return; }
      if (this.broken > 0) {
        this.broken -= dt;
        this.vuln = 1.3;
        this.animate(dt, P);
        if (this.broken <= 0) { this.broken = 0; this.poise = 0; this.vuln = 1; this.setState('recover'); this.cool = 0.4; }
        return;
      }
      this.ai(dt, P);
      this.animate(dt, P);
    }
    onDeath() {
      this.clearTeles();
      this.setState('dying');
      this.vuln = 1; this.invuln = true; this.broken = 0;
      this.deathT = 0;
      U.audio.play('bossDeath');
      U.time.addHitstop(0.12);
      U.world.addShake(0.4);
      if (this.onDie) this.onDie();
    }
    updateDeath(dt) {
      this.deathT += dt;
      this.animDeath(this.deathT, dt);
      if (this.deathT > 1.6 && !this.dissolved) {
        this.dissolved = true;
        FX.ghostOf(this.root, { opacity: 0.8, dur: 1.2 });
        const c = _a.copy(this.pos).setY(1.5);
        FX.shards(c, 40, { speed: 6, size: 0.2, life: 1.6, spread: 1.0, yspread: 2.5, colors: [new T.Color(0.1, 0.1, 0.12), new T.Color(0.5, 0.5, 0.55)] });
        FX.shards(c, 24, { bright: true, speed: 8, size: 0.1, life: 0.8, grav: 1 });
        FX.flash(c, 40, 14, 0.5);
        FX.ring({ pos: this.pos, r0: 0.5, r1: 8, dur: 0.9, w0: 0.4, w1: 0.03, opacity: 0.9, intensity: 1.6 });
        U.world.sealPulse = 1;
        U.audio.play('shatter');
        this.root.visible = false;
      }
      if (this.deathT > 2.8) {
        this.active = false; this.dissolved = false;
        if (B.current === this) B.current = null;
        U.ui.showBoss(null);
      }
    }
    // pick an attack by weight, avoiding the same one three times running
    choose(weights) {
      let tot = 0;
      const ks = Object.keys(weights).filter((k) => weights[k] > 0 && !(this.lastAtk.length >= 2 && this.lastAtk[0] === k && this.lastAtk[1] === k));
      for (const k of ks) tot += weights[k];
      let r = Math.random() * tot;
      for (const k of ks) { r -= weights[k]; if (r <= 0) { this.lastAtk.unshift(k); this.lastAtk.length = Math.min(this.lastAtk.length, 3); return k; } }
      return ks[0];
    }
    faceTo(x, z, rate, dt) {
      const target = Math.atan2(x - this.pos.x, z - this.pos.z);
      if (rate == null) this.facing = target;
      else this.facing += U.clamp(U.angleDiff(this.facing, target), -rate * dt, rate * dt);
    }
    hide() { this.clearTeles(); this.root.visible = false; this.alive = false; this.active = false; }
  }
  B.Boss = Boss;

  // ======================================================================================
  //  OSSARCH, THE GAOLER — the lock of the body
  //  He carries the key-blade and the chain fastened to Vaust's seal. The Pursuers wear copies of
  //  the face he gave up to take the post.
  // ======================================================================================
  const GA = {
    speed: 2.5,
    sweepR: 4.4, sweepHalf: 1.3, sweep1: 0.75, sweep1Lock: 0.55, sweep2: 0.5, sweep2Lock: 0.32, sweep3: 0.95, sweep3Lock: 0.62,
    chopLen: 5.4, chopHalf: 0.8, sweepDmg: 18, chopDmg: 28,
    chainLen: 14, chainHalf: 0.45, chainWind: 0.85, chainLock: 0.55, chainSpeed: 34, chainDmg: 10, tether: 4.0, leash: 6.0, yankDmg: 12,
    slamR: 2.6, slamCrouch: 0.45, slamAir: 0.72, slamDmg: 26, waveSpeed: 7.0, waveMax: 13, waveDmg: 14, stuck: 1.5,
    dragR: 9.0, dragWind: 1.0, dragSpeed: 1.9, dragDmg: 16,
  };
  function buildGaoler() {
    const mats = {
      body: U.stdMat({ color: 0x24242b, roughness: 0.55, metalness: 0.6, emissive: 0x000000, envMap: U.world.envMap, envMapIntensity: 0.7 }, 0.8, 2.2),
      cloth: U.stdMat({ color: 0x131317, roughness: 0.95, side: T.DoubleSide, emissive: 0x000000 }, 0.6, 2.6),
      mask: U.stdMat({ color: 0xd8d2c4, roughness: 0.5, metalness: 0.05, emissive: 0x000000 }, 0.5, 2.4),
      blade: U.stdMat({ color: 0x6a6c74, roughness: 0.3, metalness: 0.9, emissive: 0x000000, envMap: U.world.envMap, envMapIntensity: 1.0 }, 0.6, 2.0),
      eye: new T.MeshBasicMaterial({ color: new T.Color(0.9, 0.92, 1.0) }),
      crack: new T.MeshBasicMaterial({ color: new T.Color(2.6, 1.2, 0.5), transparent: true, opacity: 0 }),
    };
    const root = new T.Group();
    const body = new T.Group(); root.add(body);
    const hips = new T.Group(); hips.position.y = 1.55; body.add(hips);
    const legs = [];
    for (const s of [1, -1]) {
      const leg = new T.Group(); leg.position.set(s * 0.28, 0, 0); hips.add(leg);
      addMesh(U.taperGeom(0.8, 0.17, 0.12, 6), mats.body, leg);
      const knee = new T.Group(); knee.position.y = -0.8; leg.add(knee);
      addMesh(U.taperGeom(0.75, 0.13, 0.09, 6), mats.body, knee);
      addMesh(new T.OctahedronGeometry(0.13, 0), mats.blade, knee, 0, 0, 0.06).scale.set(1, 1.2, 0.8);
      const ankle = new T.Group(); ankle.position.y = -0.75; knee.add(ankle);
      addMesh(new T.BoxGeometry(0.24, 0.16, 0.44), mats.body, ankle, 0, -0.02, 0.08);
      legs.push({ s, leg, knee, ankle });
    }
    const skirt = addMesh(new T.CylinderGeometry(0.4, 0.78, 0.95, 7, 1, true), mats.cloth, hips, 0, -0.42, 0);
    skirt.castShadow = true;
    const spine = new T.Group(); spine.position.y = 1.58; body.add(spine);
    addMesh(U.taperGeom(0.95, 0.38, 0.64, 6, 1, 0.62, false), mats.body, spine);
    const chest = new T.Group(); chest.position.y = 0.95; spine.add(chest);
    for (const s of [1, -1]) {
      const pa = addMesh(new T.OctahedronGeometry(0.32, 0), mats.blade, chest, s * 0.66, -0.02, 0);
      pa.scale.set(1.35, 0.75, 1.1); pa.rotation.z = s * 0.35;
    }
    addMesh(new T.TorusGeometry(0.34, 0.06, 4, 10), mats.blade, chest, 0, 0.02, 0, Math.PI / 2);
    const head = new T.Group(); head.position.set(0, 0.25, 0.06); chest.add(head);
    const hood = addMesh(new T.ConeGeometry(0.34, 0.8, 6), mats.cloth, head, 0, 0.22, -0.05, -0.3);
    hood.castShadow = true;
    const maskGeo = U.geomFrom([
      [0, 0.16, 0.075], [0.07, 0.05, 0.06], [-0.07, 0.05, 0.06], [0.06, -0.1, 0.06], [-0.06, -0.1, 0.06], [0, -0.24, 0.07], [0, 0.0, 0.12],
    ], [[0, 2, 6], [0, 6, 1], [2, 4, 6], [6, 3, 1], [4, 5, 6], [6, 5, 3]]);
    const maskG = new T.Group(); maskG.position.set(0, 0.06, 0.06); maskG.scale.setScalar(2.3); head.add(maskG);
    addMesh(maskGeo, mats.mask, maskG);
    addMesh(new T.BoxGeometry(0.012, 0.11, 0.02), mats.eye, maskG, 0, 0.02, 0.115).castShadow = false;
    const crackA = addMesh(new T.BoxGeometry(0.006, 0.2, 0.01), mats.crack, maskG, 0.025, -0.05, 0.11, 0, 0, 0.35); crackA.castShadow = false;
    const crackB = addMesh(new T.BoxGeometry(0.006, 0.12, 0.01), mats.crack, maskG, -0.03, 0.06, 0.1, 0, 0, -0.6); crackB.castShadow = false;
    // a crown of keys behind the head
    const crown = new T.Group(); crown.position.set(0, 0.35, -0.32); head.add(crown);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const k = addMesh(new T.BoxGeometry(0.04, 0.42, 0.04), mats.blade, crown, Math.sin(a) * 0.48, Math.cos(a) * 0.48, 0, 0, 0, -a);
      addMesh(new T.BoxGeometry(0.1, 0.04, 0.04), mats.blade, k, 0.04, 0.16, 0);
    }
    const arms = [];
    for (const s of [1, -1]) {
      const sh = new T.Group(); sh.position.set(s * 0.72, -0.08, 0); chest.add(sh);
      addMesh(U.taperGeom(0.72, 0.15, 0.11, 6), mats.body, sh);
      const el = new T.Group(); el.position.y = -0.72; sh.add(el);
      addMesh(U.taperGeom(0.66, 0.12, 0.09, 6), mats.body, el);
      const wr = new T.Group(); wr.position.y = -0.66; el.add(wr);
      addMesh(new T.BoxGeometry(0.22, 0.26, 0.22), mats.blade, wr, 0, -0.08, 0);
      arms.push({ s, sh, el, wr });
    }
    // the key-blade in the right hand (blade along -Y of the wrist, edge forward)
    const keyB = new T.Group(); arms[1].wr.add(keyB); keyB.position.y = -0.14;
    addMesh(new T.TorusGeometry(0.17, 0.035, 4, 10), mats.blade, keyB, 0, 0.22, 0);
    addMesh(new T.BoxGeometry(0.07, 0.42, 0.07), mats.body, keyB, 0, 0, 0);
    addMesh(new T.BoxGeometry(0.36, 0.06, 0.12), mats.blade, keyB, 0, -0.22, 0);
    const bl = addMesh(new T.BoxGeometry(0.06, 2.5, 0.28), mats.blade, keyB, 0, -1.47, 0.02);
    bl.geometry.translate(0, 0, 0);
    for (let i = 0; i < 3; i++) addMesh(new T.BoxGeometry(0.06, 0.14 + i * 0.05, 0.22), mats.blade, keyB, 0, -2.45 + i * 0.22, 0.24 + i * 0.03);
    // chain coiled at the left wrist
    for (let i = 0; i < 4; i++) addMesh(new T.TorusGeometry(0.15, 0.03, 4, 8), mats.blade, arms[0].wr, 0, -0.05 - i * 0.05, 0, Math.PI / 2 + (i % 2) * 0.4, 0, 0);
    // ragged cloak
    const strips = [];
    for (let i = 0; i < 5; i++) {
      const piv = new T.Group(); piv.position.set((i - 2) * 0.22, 0.02, -0.32); piv.rotation.y = Math.PI + (i - 2) * 0.22; chest.add(piv);
      const g = U.geomFrom([[-0.14, 0, 0], [0.14, 0, 0], [0.11, -1.2, 0.03], [-0.13, -1.1, 0.03], [0.02, -1.75, 0.06]], [[0, 3, 1], [1, 3, 2], [3, 4, 2]]);
      addMesh(g, mats.cloth, piv);
      strips.push({ piv, ph: Math.random() * 6 });
    }
    // the cast chain (world space): links along a line, plus a hook
    const linkGeo = new T.TorusGeometry(0.1, 0.028, 4, 8);
    const chain = new T.InstancedMesh(linkGeo, mats.blade, 90);
    chain.count = 0; chain.frustumCulled = false; chain.castShadow = true;
    E.scene.add(chain);
    const hookGeo = new T.ConeGeometry(0.14, 0.5, 4); hookGeo.rotateX(Math.PI / 2);
    const hook = new T.Mesh(hookGeo, mats.blade); hook.visible = false; E.scene.add(hook);
    root.traverse((o) => { if (o.isMesh && o.material !== mats.crack && o.material !== mats.eye) o.castShadow = true; });
    const glyph = E.makeGlyph(root, 3.9, 1.6);
    return { root, body, hips, legs, spine, chest, head, maskG, crown, arms, keyB, strips, mats, glyph, splitNode: spine, chain, hook, cracks: [crackA, crackB] };
  }

  const _cm = new T.Matrix4(), _cq = new T.Quaternion(), _cs = new V3(1, 1, 1), _cp = new V3(), _ce = new T.Euler();
  // lay the chain's links from a to b (sag in metres at the middle)
  function layChain(im, a, b, sag, maxLinks) {
    const len = a.distanceTo(b);
    const n = Math.min(maxLinks || 90, Math.max(2, Math.round(len / 0.17)));
    const yaw = Math.atan2(b.x - a.x, b.z - a.z), pitch = Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      _cp.lerpVectors(a, b, t);
      _cp.y -= Math.sin(t * Math.PI) * sag;
      _cq.setFromEuler(_ce.set(-pitch, yaw, i % 2 ? Math.PI / 2 : 0, 'YXZ'));
      _cm.compose(_cp, _cq, _cs);
      im.setMatrixAt(i, _cm);
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
  }

  class Gaoler extends Boss {
    constructor() { super('gaoler', buildGaoler()); this.cur = {}; this.chains = []; }
    onSpawn() {
      this.setState('intro');
      this.musters = [false, false];
      this.dragAng = 0;
      this.chainT = 0;
      this.rig.mats.crack.opacity = 0;
      this.rig.maskG.visible = true;
      this.rig.maskG.position.set(0, 0.06, 0.06); this.rig.maskG.rotation.set(0, 0, 0);
      this.cur = {};
      this.dropFrom = 16; this.pos.y = 16;
      this.landed = false; this.phased = false; this.chainLock = 0; this.combo = 0;
    }
    onBreak() { this.hideChain(); if (U.player.tether && U.player.tether.owner === this) U.player.tether = null; }
    resetExtra() {
      this.hideChain();
      const m = this.rig.maskG;
      if (m.parent !== this.rig.head) this.rig.head.attach(m);
      m.position.set(0, 0.06, 0.06); m.rotation.set(0, 0, 0); m.scale.setScalar(2.3);
      this.maskFall = null; this.rig.mats.crack.opacity = 0; this.landed = false; this.phased = false;
    }
    onGrab() {
      // hands seize the chain arm: no Chain Cast for a while
      this.chainLock = 3.0;
      FX.ring({ pos: this.pos, r0: 1.4, r1: 0.9, dur: 0.4, w0: 0.08, w1: 0.03, opacity: 0.8 });
    }
    onDie() { this.hideChain(); if (U.player.tether && U.player.tether.owner === this) U.player.tether = null; this.maskFall = this.rig.maskG.getWorldPosition(new V3()); }
    hideChain() { this.rig.chain.count = 0; this.rig.hook.visible = false; this.chains.length = 0; }
    wrist(i, out) { this.root.updateMatrixWorld(true); return this.rig.arms[i].wr.getWorldPosition(out); }

    ai(dt, P) {
      const C = GA, pp = P.pos;
      const dx = pp.x - this.pos.x, dz = pp.z - this.pos.z, dist = Math.hypot(dx, dz) || 0.001;
      this.chainLock = Math.max(0, (this.chainLock || 0) - dt);
      let mv = 0;
      const st = this.st;
      // phase changes and musters
      const k = this.hp / this.maxHp;
      if (this.alive && this.state !== 'intro' && this.state !== 'phase' && !this.state.startsWith('sl')) {
        if (this.phase === 1 && k <= 0.5) {
          this.clearTeles(); this.hideChain(); this.tele = null; this.tele2.length = 0; this.ringTele = null;
          if (P.tether && P.tether.owner === this) P.tether = null;
          this.setState('phase'); U.audio.play('roar');
        }
        else if (!this.musters[0] && k <= 0.66 && this.state === 'stalk' && this.phase === 1) { this.musters[0] = true; this.setState('muster'); U.audio.play('roar'); }
        else if (!this.musters[1] && k <= 0.33 && this.state === 'stalk') { this.musters[1] = true; this.setState('muster'); U.audio.play('roar'); }
      }
      switch (this.state) {
        case 'intro': {
          // drops out of the sky in front of the eclipse
          const fall = 0.65;
          if (st < fall) { this.pos.y = this.dropFrom * (1 - U.easeInCubic(st / fall)); this.invuln = true; }
          else if (!this.landed) {
            this.landed = true; this.pos.y = 0;
            this.impact(3.2, 0);
          }
          this.faceTo(pp.x, pp.z, 2, dt);
          if (st > 2.3) { this.landed = false; this.invuln = false; this.setState('stalk'); }
          break;
        }
        case 'phase': {
          // the mask cracks: faster, and the chain doubles
          this.invuln = st < 1.6;
          this.rig.mats.crack.opacity = U.clamp(st / 0.8, 0, 1);
          if (st > 0.5 && !this.phased) {
            this.phased = true; this.phase = 2; this.speedMul = 1.15;
            U.world.addShake(0.35);
            FX.ring({ pos: this.pos, r0: 0.6, r1: 7, dur: 0.6, w0: 0.3, w1: 0.03, color: AMBER, opacity: 0.9, intensity: 1.4 });
            FX.shards(_a.copy(this.pos).setY(3.0), 12, { bright: true, speed: 5, size: 0.08, life: 0.6 });
            U.ui.banner('The Mask Cracks', 'Ossarch no longer holds back', 2.2);
          }
          if (st > 1.8) { this.phased = false; this.invuln = false; this.setState('stalk'); this.cool = 0.3; }
          break;
        }
        case 'muster': {
          if (st > 0.6 && !this.didHit) {
            this.didHit = true;
            const base = Math.atan2(this.pos.x, -this.pos.z);
            for (const s of [-1, 1]) {
              const p = rimPoint(base + s * 1.1, 2.4);
              const e = E.spawn('pursuer', p);
              if (e) { e.maxHp *= 0.8; e.hp = e.maxHp; }
            }
            FX.ring({ pos: this.pos, r0: 0.6, r1: 5, dur: 0.5, w0: 0.2, w1: 0.03, opacity: 0.6 });
          }
          if (st > 1.2) { this.setState('stalk'); this.cool = 0.6; }
          break;
        }
        case 'stalk': {
          this.faceTo(pp.x, pp.z, 3.2, dt);
          if (dist > 2.6) mv = C.speed * (this.phase === 2 ? 1.2 : 1);
          this.cool -= dt;
          if (this.cool <= 0 && P.alive) {
            const p2 = this.phase === 2;
            const w = dist < 4.6 ? { sweep: 6, slam: 1.5, drag: p2 ? 2.5 : 0, chain: 0 }
              : dist < 13 ? { chain: this.chainLock > 0 ? 0 : 5, slam: 3.5, drag: p2 ? 1.5 : 0, sweep: dist < 6 ? 2 : 0 }
              : { slam: 7, chain: this.chainLock > 0 ? 0 : 3 };
            const a = this.choose(w);
            if (a === 'sweep') { this.combo = 1; this.startSweep(1); }
            else if (a === 'chain') this.startChain();
            else if (a === 'slam') this.startSlam(P);
            else this.startDrag();
          }
          break;
        }
        // ---- Turnkey Sweep: two sweeps, then a held overhead chop that punishes rhythm-dodging
        case 'sw1w': case 'sw2w': case 'sw3w': {
          const n = +this.state[2];
          const dur = tl(n === 1 ? C.sweep1 : n === 2 ? C.sweep2 : C.sweep3, this), lock = tl(n === 1 ? C.sweep1Lock : n === 2 ? C.sweep2Lock : C.sweep3Lock, this);
          if (st < lock) {
            this.faceTo(pp.x, pp.z, 6, dt);
            this.lockYaw = this.facing; this.lockPos.copy(this.pos);
            if (dist > 2.4) mv = 1.2;
            this.tele.grp.position.set(this.pos.x, 0.07, this.pos.z);
            this.tele.grp.rotation.y = this.lockYaw;
          } else { this.facing = this.lockYaw; this.tele.mat.uniforms.uLocked.value = 1; }
          this.tele.mat.uniforms.uProgress.value = U.clamp(st / dur, 0, 1);
          this.tele.mat.uniforms.uOpacity.value = U.clamp(st / 0.1, 0, 1);
          if (st >= dur) { this.setState('sw' + n); U.audio.play(n === 3 ? 'rSlash' : 'pslash', { gap: 0.05 }); }
          break;
        }
        case 'sw1': case 'sw2': case 'sw3': {
          const n = +this.state[2], dur = 0.16;
          this.facing = this.lockYaw;
          const lunge = n === 3 ? 0.6 : 1.0;
          this.pos.x += Math.sin(this.lockYaw) * lunge / dur * dt; this.pos.z += Math.cos(this.lockYaw) * lunge / dur * dt;
          if (!this.didHit && st > dur * 0.4) {
            this.didHit = true;
            if (n < 3) {
              if (inSector(P.pos, this.lockPos, this.lockYaw, C.sweepR + P.radius * 0.6 + 0.5, C.sweepHalf + 0.06)) hurt(C.sweepDmg, this.pos);
              FX.ring({ pos: _a.set(this.lockPos.x + Math.sin(this.lockYaw) * 1.4, 0, this.lockPos.z + Math.cos(this.lockYaw) * 1.4), r0: 1.2, r1: 2.8, dur: 0.25, w0: 0.1, w1: 0.02, color: AMBER, opacity: 0.6 });
            } else {
              if (inLane(P.pos, this.lockPos, this.lockYaw, C.chopLen + 0.3, C.chopHalf + P.radius * 0.6)) hurt(C.chopDmg, this.pos);
              const tip = _a.set(this.lockPos.x + Math.sin(this.lockYaw) * 3.4, 0, this.lockPos.z + Math.cos(this.lockYaw) * 3.4);
              FX.crack(tip, 2.2, 1.6, 0.4, CRIMSON);
              FX.shards(_b.copy(tip).setY(0.2), 10, { speed: 5, up: 2.5, size: 0.14, life: 1.0, colors: [new T.Color(0.13, 0.13, 0.15)] });
              FX.sparks(_b.copy(tip).setY(0.3), 14, { speed: 6, up: 2, color: AMBER, life: 0.4, size: 0.1, grav: 8 });
              U.world.addShake(0.25); U.audio.play('slamLand', { gap: 0.1 });
            }
          }
          if (st >= dur) {
            this.dropTele(this.tele); this.tele = null;
            if (n < 3) this.startSweep(n + 1);
            else { this.setState('swRec'); }
          }
          break;
        }
        case 'swRec': {
          if (st > 1.0 / this.speedMul) { this.setState('stalk'); this.cool = this.recCool(); }
          break;
        }
        // ---- Chain Cast: a thrown chain that tethers him to Vaust
        case 'chW': {
          const dur = tl(C.chainWind, this), lock = tl(C.chainLock, this);
          if (st < lock) {
            this.faceTo(pp.x, pp.z, 8, dt);
            this.lockYaw = this.facing; this.lockPos.copy(this.pos);
          }
          this.chainYaws.forEach((off, i) => {
            const t = this.tele2[i];
            t.grp.position.set(this.pos.x, 0.07, this.pos.z);
            t.grp.rotation.y = this.lockYaw + off;
            t.mat.uniforms.uProgress.value = U.clamp(st / dur, 0, 1);
            t.mat.uniforms.uOpacity.value = U.clamp(st / 0.12, 0, 1);
            t.mat.uniforms.uLocked.value = st >= lock ? 1 : 0;
          });
          if (st >= dur) {
            this.setState('ch'); this.chainT = 0; U.audio.play('chain');
            for (const t of this.tele2) this.dropTele(t);
            this.tele2.length = 0;
          }
          break;
        }
        case 'ch': {
          this.facing = this.lockYaw;
          this.chainT = Math.min(C.chainLen, this.chainT + C.chainSpeed * dt);
          if (!this.didHit && !P.tether) {
            for (const off of this.chainYaws) {
              const yaw = this.lockYaw + off;
              if (inLane(P.pos, this.lockPos, yaw, this.chainT, C.chainHalf + P.radius * 0.5) && !P.invulnerable()) {
                this.didHit = true;
                hurt(C.chainDmg, this.pos);
                P.tether = { owner: this, anchor: this.pos, len: C.leash, t: C.tether, breaks: 0 };
                this.tetherYaw = yaw;
                U.audio.play('chainHit');
                FX.sparks(_a.copy(P.pos).setY(1.1), 14, { speed: 4, color: AMBER, life: 0.35, size: 0.09 });
                this.setState('chHold');
                break;
              }
            }
          }
          if (this.state === 'ch' && this.chainT >= C.chainLen) this.setState('chRet');
          break;
        }
        case 'chRet': {
          this.chainT = Math.max(0, C.chainLen * (1 - st / 0.4));
          if (st > 0.4) { this.hideChain(); this.setState('stalk'); this.cool = this.recCool() + 0.3; }
          break;
        }
        case 'chHold': {
          const t = P.tether;
          if (!t || t.owner !== this) { this.hideChain(); this.setState('chSnap'); break; }
          this.faceTo(pp.x, pp.z, 4, dt);
          t.t -= dt;
          if (t.breaks >= 2) {
            P.tether = null;
            U.audio.play('tetherBreak');
            const w = this.wrist(0, _a);
            FX.shards(_b.lerpVectors(w, P.pos, 0.5).setY(1.0), 16, { speed: 5, size: 0.08, life: 0.7, colors: [new T.Color(0.45, 0.46, 0.5)] });
            this.hideChain();
            this.setState('chSnap');
          } else if (t.t <= 0) {
            // reel him in, then the chop
            P.tether = null;
            const f = _a.set(Math.sin(this.facing), 0, Math.cos(this.facing));
            const to = this.pos.clone().addScaledVector(f, 2.2);
            P.yank = { from: P.pos.clone(), to, t: 0, dur: 0.32 };
            P.dodge = null;
            hurt(C.yankDmg, this.pos);
            U.audio.play('chain');
            this.hideChain();
            this.combo = 3; this.startSweep(3);
          }
          break;
        }
        case 'chSnap': {
          // the chain broke: he staggers, open to punishment
          this.vuln = 1.25;
          if (st > 1.1) { this.vuln = 1; this.setState('stalk'); this.cool = this.recCool(); }
          break;
        }
        // ---- Lockdown Slam: a leap, a landing, shockwave rings; the blade sticks in the stone
        case 'slW': {
          const dur = tl(C.slamCrouch, this);
          if (st >= dur) { this.setState('slAir'); this.jumpFrom = this.pos.clone(); U.audio.play('rWind', { gap: 0.1 }); }
          this.faceTo(this.slamAt.x, this.slamAt.z, 6, dt);
          this.tele.mat.uniforms.uProgress.value = U.clamp(st / (dur + C.slamAir), 0, 1);
          this.tele.mat.uniforms.uOpacity.value = U.clamp(st / 0.1, 0, 1);
          break;
        }
        case 'slAir': {
          const k2 = U.clamp(st / C.slamAir, 0, 1);
          this.pos.x = U.lerp(this.jumpFrom.x, this.slamAt.x, k2);
          this.pos.z = U.lerp(this.jumpFrom.z, this.slamAt.z, k2);
          this.pos.y = Math.sin(k2 * Math.PI) * 3.6;
          this.tele.mat.uniforms.uProgress.value = U.clamp((tl(C.slamCrouch, this) + st) / (tl(C.slamCrouch, this) + C.slamAir), 0, 1);
          this.tele.mat.uniforms.uLocked.value = 1;
          if (k2 >= 1) {
            this.pos.y = 0;
            this.dropTele(this.tele); this.tele = null;
            if (P.alive && Math.hypot(P.pos.x - this.pos.x, P.pos.z - this.pos.z) < C.slamR + P.radius * 0.5) hurt(C.slamDmg, this.pos);
            this.impact(C.slamR + 0.6, 1);
            this.shockwave(0);
            if (this.phase === 2 || E.loop >= 3) this.shockwave(0.55);
            this.setState('stuck');
          }
          break;
        }
        case 'stuck': {
          // the key-blade is stuck in the floor: punish him
          this.vuln = 1.5;
          if (st > C.stuck / Math.sqrt(this.speedMul)) { this.vuln = 1; this.setState('pull'); }
          break;
        }
        case 'pull': {
          if (st > 0.45) { this.setState('stalk'); this.cool = this.recCool(); }
          break;
        }
        // ---- Chain Drag (phase 2): the chain swung in a full circle
        case 'drW': {
          const dur = tl(C.dragWind, this);
          this.tele.grp.position.set(this.pos.x, 0.07, this.pos.z);
          this.tele.grp.rotation.y = this.dragAng;
          this.tele.mat.uniforms.uProgress.value = U.clamp(st / dur, 0, 1);
          this.tele.mat.uniforms.uOpacity.value = U.clamp(st / 0.1, 0, 1);
          this.tele.mat.uniforms.uLocked.value = 1;
          if (this.ringTele) { this.ringTele.grp.position.set(this.pos.x, 0.07, this.pos.z); this.ringTele.mat.uniforms.uOpacity.value = 0.45 * U.clamp(st / 0.2, 0, 1); }
          if (st >= dur) { this.dropTele(this.tele); this.tele = null; this.setState('drag'); this.dragDone = 0; this.dragHitCd = 0; U.audio.play('chain'); }
          break;
        }
        case 'drag': {
          const step = C.dragSpeed * this.speedMul * dt;
          this.dragAng += step * this.dragDir; this.dragDone += step;
          this.facing = this.dragAng;
          this.dragHitCd -= dt;
          const d2 = Math.hypot(pp.x - this.pos.x, pp.z - this.pos.z);
          const bearing = Math.atan2(pp.x - this.pos.x, pp.z - this.pos.z);
          if (this.dragHitCd <= 0 && d2 > 1.4 && d2 < C.dragR + P.radius && Math.abs(U.angleDiff(this.dragAng, bearing)) * d2 < 0.45 + P.radius) {
            if (hurt(C.dragDmg, this.pos)) { this.dragHitCd = 1.0; FX.sparks(_a.copy(pp).setY(0.6), 10, { speed: 4, color: AMBER, life: 0.3, size: 0.09 }); }
          }
          if (Math.random() < dt * 30) {
            const r = 2 + Math.random() * (C.dragR - 2);
            FX.sparks(_a.set(this.pos.x + Math.sin(this.dragAng) * r, 0.1, this.pos.z + Math.cos(this.dragAng) * r), 1, { speed: 2, up: 1.5, color: AMBER, life: 0.3, size: 0.08, grav: 6 });
          }
          if (this.ringTele) this.ringTele.grp.position.set(this.pos.x, 0.07, this.pos.z);
          if (this.dragDone >= Math.PI * 2) { this.dropTele(this.ringTele); this.ringTele = null; this.hideChain(); this.setState('swRec'); }
          break;
        }
        case 'recover': {
          if (st > 0.5) { this.setState('stalk'); this.cool = 0.4; }
          break;
        }
      }
      if (mv > 0 && this.rootT <= 0) { this.pos.x += Math.sin(this.facing) * mv * dt; this.pos.z += Math.cos(this.facing) * mv * dt; }
      this.vel.set(Math.sin(this.facing) * mv, 0, Math.cos(this.facing) * mv);
      this.moveSpeed = mv;
      this.updateChainVisual(P);
    }
    recCool() { return (this.phase === 2 ? 0.35 : 0.7) + Math.random() * 0.5; }
    startSweep(n) {
      this.setState('sw' + n + 'w');
      const C = GA;
      this.dropTele(this.tele);
      this.tele = n < 3 ? this.addTele({ pos: this.pos, r: C.sweepR, half: C.sweepHalf, yaw: this.facing, intensity: n === 2 ? 1.0 : 0.9 })
        : this.addTele({ pos: this.pos, r: C.chopLen, half: C.chopHalf, yaw: this.facing, lane: true, color: CRIMSON, intensity: 1.3 });
      this.lockYaw = this.facing; this.lockPos.copy(this.pos);
      U.audio.play('windup', { gap: 0.08 });
    }
    startChain() {
      this.setState('chW');
      const two = this.phase === 2 || E.loop >= 2;
      this.chainYaws = two ? [-0.3, 0.3] : [0];
      for (const off of this.chainYaws) this.tele2.push(this.addTele({ pos: this.pos, r: GA.chainLen, half: GA.chainHalf, yaw: this.facing + off, lane: true, intensity: 1.0 }));
      this.lockYaw = this.facing; this.lockPos.copy(this.pos);
      U.audio.play('windup', { gap: 0.08 });
    }
    startSlam(P) {
      this.setState('slW');
      const lead = _a.copy(P.vel).setY(0).multiplyScalar(0.35);
      this.slamAt = P.pos.clone().add(lead).setY(0);
      U.arenaClamp(this.slamAt, 1.6);
      this.dropTele(this.tele);
      this.tele = this.addTele({ pos: this.slamAt, r: GA.slamR, color: CRIMSON, intensity: 1.2 });
      this.tele.mat.uniforms.uLocked.value = 1;
      U.audio.play('windup', { gap: 0.08 });
    }
    startDrag() {
      this.setState('drW');
      this.dragAng = this.facing + (Math.random() < 0.5 ? 1 : -1) * 1.2;
      this.dragDir = Math.random() < 0.5 ? 1 : -1;
      this.dropTele(this.tele);
      this.tele = this.addTele({ pos: this.pos, r: GA.dragR, half: 0.45, yaw: this.dragAng, lane: true, color: CRIMSON, intensity: 1.3 });
      this.ringTele = this.addTele({ pos: this.pos, r: GA.dragR, color: CRIMSON, intensity: 0.5 });
      this.ringTele.mat.uniforms.uProgress.value = 1;
      U.audio.play('windup', { gap: 0.08 });
    }
    impact(r, strength) {
      U.world.addShake(0.3 + strength * 0.15);
      U.audio.play('slamLand');
      FX.crack(this.pos, r * 1.2, 2.0, 0.45, CRIMSON);
      FX.ring({ pos: this.pos, r0: 0.5, r1: r, dur: 0.35, w0: 0.3, w1: 0.04, color: AMBER, opacity: 0.9, intensity: 1.3 });
      FX.shards(_a.copy(this.pos).setY(0.2), 18, { speed: 6, up: 3, size: 0.15, life: 1.1, colors: [new T.Color(0.13, 0.13, 0.15), new T.Color(0.3, 0.3, 0.33)] });
      FX.mist(_a.copy(this.pos).setY(0.4), 8, { spread: 1.0, rise: 0.6, out: 2.0, life: 1.0, size: 1.2, a: 0.25 });
      FX.flash(_a.copy(this.pos).setY(1.0), 14, 9, 0.3, AMBER);
    }
    shockwave(delay) {
      const C = GA, center = this.pos.clone();
      B.hazards.push({
        t: -delay, r: C.slamR, hit: false, ring: null,
        update(dt) {
          this.t += dt;
          if (this.t < 0) return false;
          if (!this.ring) this.ring = heldRing({ pos: center, max: C.waveMax + 0.5, w: 0.3, color: AMBER, intensity: 1.4, opacity: 0.9, r: C.slamR });
          this.r += C.waveSpeed * dt;
          const fade = 1 - U.clamp((this.r - C.waveMax + 2) / 2, 0, 1);
          this.ring.set(this.r, 0.28, 0.95 * fade);
          const P = U.player;
          if (!this.hit && P.alive) {
            const d = Math.hypot(P.pos.x - center.x, P.pos.z - center.z);
            if (Math.abs(d - this.r) < 0.42 + P.radius * 0.5) { if (hurt(C.waveDmg, center)) this.hit = true; }
          }
          if (Math.random() < dt * 25) {
            const a = Math.random() * Math.PI * 2;
            FX.sparks(_a.set(center.x + Math.sin(a) * this.r, 0.1, center.z + Math.cos(a) * this.r), 1, { speed: 1.5, up: 2, color: AMBER, life: 0.3, size: 0.08, grav: 5 });
          }
          if (this.r >= C.waveMax) { this.ring.release(); return true; }
          return false;
        },
        kill() { if (this.ring) this.ring.release(); },
      });
    }
    updateChainVisual(P) {
      const C = GA, rig = this.rig;
      const w = this.wrist(0, _c);
      if (this.state === 'ch' || this.state === 'chRet') {
        // the chain(s) run out along their lanes
        const yaw = this.lockYaw + this.chainYaws[0];
        const end = _d.set(this.lockPos.x + Math.sin(yaw) * this.chainT, 1.0, this.lockPos.z + Math.cos(yaw) * this.chainT);
        layChain(rig.chain, w, end, 0.15, 90);
        rig.hook.visible = true; rig.hook.position.copy(end); rig.hook.rotation.set(0, yaw, 0);
        if (this.chainYaws.length > 1) {
          // a second chain: drawn as the hook only plus a bright trail, cheaply
          const yaw2 = this.lockYaw + this.chainYaws[1];
          const e2 = _a.set(this.lockPos.x + Math.sin(yaw2) * this.chainT, 1.0, this.lockPos.z + Math.cos(yaw2) * this.chainT);
          if (Math.random() < 0.9) FX.sparks(e2, 2, { speed: 1, life: 0.25, size: 0.09, color: AMBER, grav: 0 });
          FX.seam(_b.copy(this.lockPos), e2, 0.08, 0.06);
        }
      } else if (this.state === 'chHold' && P.tether) {
        layChain(rig.chain, w, _d.copy(P.pos).setY(1.1), 0.05 + 0.25 * Math.max(0, 1 - (P.tether.t / C.tether)), 90);
        rig.hook.visible = false;
      } else if (this.state === 'drag' || this.state === 'drW') {
        const r = this.state === 'drag' ? C.dragR : 2.0 + 1.0 * Math.sin(this.st * 14);
        layChain(rig.chain, w, _d.set(this.pos.x + Math.sin(this.dragAng) * r, 0.3, this.pos.z + Math.cos(this.dragAng) * r), 0.1, 90);
        rig.hook.visible = this.state === 'drag'; rig.hook.position.copy(_d); rig.hook.rotation.set(0, this.dragAng, 0);
      } else if (rig.chain.count) { rig.chain.count = 0; rig.hook.visible = false; }
    }

    animate(dt, P) {
      const r = this.rig, s = this.state, st = this.st, C = GA, c = this.cur;
      const t = this.animT;
      // targets (defaults: stalking)
      const mv = this.moveSpeed || 0;
      this.walkPh = (this.walkPh || 0) + mv * dt * 1.9;
      const wb = U.clamp(mv / C.speed, 0, 1);
      this.walkB = damp(this.walkB || 0, wb, 6, dt);
      const W = this.walkB;
      let lean = 0.12 + W * 0.1, twist = 0, bodyY = -0.05 * W * Math.abs(Math.sin(this.walkPh)), headX = 0;
      let aR = [0.25 - Math.sin(this.walkPh) * 0.3 * W, 0, -0.15], eR = 0.35;   // key-blade arm
      let aL = [0.2 + Math.sin(this.walkPh) * 0.3 * W, 0, 0.2], eL = 0.4;        // chain arm
      let rate = 10, crouch = 0, glow = 0;
      if (s === 'intro') {
        if (st < 0.65) { lean = -0.2; aR = [-0.6, 0, -0.9]; aL = [-0.6, 0, 0.9]; }
        else { const k = U.env(st - 0.65, 0, 0.15, 0.9, 1.6); crouch = 0.5 * (1 - U.clamp((st - 0.65) / 0.4, 0, 1)); lean = -0.35 * k; headX = -0.5 * k; aR = [U.lerp(0.25, 1.9, k), 0, -0.7 * k]; aL = [U.lerp(0.2, 1.9, k), 0, 0.7 * k]; }
        rate = 14;
      } else if (s === 'phase' || s === 'muster') {
        const k = U.env(st, 0, 0.25, s === 'phase' ? 1.2 : 0.7, s === 'phase' ? 1.8 : 1.2);
        lean = -0.35 * k; headX = -0.55 * k; aR = [U.lerp(0.25, 2.2, k), 0, -0.9 * k]; aL = [U.lerp(0.2, 2.2, k), 0, 0.9 * k];
        twist = Math.sin(t * 30) * 0.04 * k;
      } else if (s === 'sw1w' || s === 'sw2w' || s === 'sw3w') {
        const n = +s[2], dur = tl(n === 1 ? C.sweep1 : n === 2 ? C.sweep2 : C.sweep3, this);
        const k = U.easeOutCubic(U.clamp(st / dur, 0, 1));
        glow = k;
        if (n === 1) { twist = -0.8 * k; lean = 0.1; aR = [U.lerp(0.25, 1.4, k), 0, U.lerp(-0.15, -1.3, k)]; eR = 0.3; }
        else if (n === 2) { twist = 0.8 * k; aR = [U.lerp(-0.6, 1.3, k), 0, U.lerp(1.0, 0.9, k)]; eR = 0.25; }
        else { lean = -0.25 * k; headX = -0.25 * k; aR = [U.lerp(0.25, 3.0, k), 0, -0.25]; eR = U.lerp(0.35, 0.9, k); aL = [U.lerp(0.2, 2.6, k), 0, 0.3]; crouch = 0.08 * k; }
        rate = 16;
      } else if (s === 'sw1' || s === 'sw2' || s === 'sw3') {
        const n = +s[2], k = U.easeOutCubic(U.clamp(st / 0.16, 0, 1));
        glow = 1; rate = 40;
        if (n === 1) { twist = U.lerp(-0.8, 0.9, k); lean = 0.35; aR = [U.lerp(1.4, -0.6, k), 0, U.lerp(-1.3, 1.0, k)]; eR = 0.1; }
        else if (n === 2) { twist = U.lerp(0.8, -0.9, k); lean = 0.35; aR = [U.lerp(1.3, 0.2, k), 0, U.lerp(0.9, -1.4, k)]; eR = 0.1; }
        else { lean = U.lerp(-0.25, 0.75, k); crouch = 0.3 * k; aR = [U.lerp(3.0, -0.2, k), 0, -0.2]; eR = 0.1; aL = [U.lerp(2.6, 0.3, k), 0, 0.3]; }
      } else if (s === 'swRec') {
        const k = U.clamp(st / 1.0, 0, 1);
        lean = U.lerp(0.7, 0.15, k); crouch = 0.3 * (1 - k); aR = [U.lerp(-0.2, 0.25, k), 0, -0.2]; eR = 0.2; headX = 0.3 * (1 - k);
      } else if (s === 'chW') {
        const k = U.easeOutCubic(U.clamp(st / tl(C.chainWind, this), 0, 1));
        twist = 0.7 * k; aL = [U.lerp(0.2, 2.0, k), 0, U.lerp(0.2, 1.4, k)]; eL = U.lerp(0.4, 1.4, k); glow = 0;
        this.chainGlow = k;
      } else if (s === 'ch' || s === 'chRet' || s === 'chHold') {
        twist = -0.4; aL = [1.45, 0, 0.1]; eL = 0.05; lean = s === 'chHold' ? -0.25 : 0.25; rate = 25;
        if (s === 'chHold') { crouch = 0.15; aL = [1.3, 0, 0.05]; twist = -0.25 + Math.sin(t * 9) * 0.03; }
      } else if (s === 'chSnap') {
        const k = Math.sin(U.clamp(st / 1.1, 0, 1) * Math.PI);
        lean = -0.35 * k; headX = -0.4 * k; aL = [0.6, 0, 1.2 * k]; twist = 0.3 * k;
      } else if (s === 'slW') {
        const k = U.easeOutCubic(U.clamp(st / tl(C.slamCrouch, this), 0, 1));
        crouch = 0.45 * k; lean = 0.35 * k; aR = [U.lerp(0.25, 2.8, k), 0, -0.3]; aL = [U.lerp(0.2, 2.5, k), 0, 0.3]; glow = k;
      } else if (s === 'slAir') {
        lean = -0.15; aR = [2.9, 0, -0.2]; aL = [2.6, 0, 0.3]; eR = 0.6; glow = 1;
      } else if (s === 'stuck' || s === 'pull') {
        // bent over the key-blade buried in the stone
        const k = s === 'pull' ? 1 - U.clamp(st / 0.45, 0, 1) : 1;
        lean = 0.85 * k + 0.1; crouch = 0.4 * k; aR = [U.lerp(0.25, -0.15, k), 0, -0.2]; eR = 0.1; aL = [U.lerp(0.2, -0.1, k), 0, 0.5 * k]; headX = 0.25 * k;
        if (s === 'stuck') twist = Math.sin(t * 7) * 0.03;
      } else if (s === 'drW') {
        const k = U.easeOutCubic(U.clamp(st / tl(C.dragWind, this), 0, 1));
        crouch = 0.25 * k; aL = [U.lerp(0.2, 1.3, k), 0, U.lerp(0.2, 1.6, k)]; eL = 0.2; twist = -0.5 * k * this.dragDir;
      } else if (s === 'drag') {
        crouch = 0.25; aL = [1.4, 0, 1.5]; eL = 0.1; lean = -0.15;
      } else if (s === 'broken') {
        // stagger: down to one knee, like Vaust after the seal
        const k = U.env(st, 0, 0.25, 2.5, 3.0);
        crouch = 0.75 * k; lean = 0.55 * k; headX = 0.6 * k; aR = [U.lerp(0.25, -0.25, k), 0, -0.3]; aL = [U.lerp(0.2, 0.6, k), 0, 0.5];
        twist = Math.sin(t * 25) * 0.03 * k;
      } else if (s === 'recover') {
        crouch = 0.3 * (1 - U.clamp(st / 0.5, 0, 1));
      }
      if (this.flinch > 0) { lean -= this.flinch * 0.12; headX -= this.flinch * 0.15; }
      // damp toward targets
      const tgt = { lean, twist, bodyY: bodyY - crouch, headX, aR0: aR[0], aR1: aR[1], aR2: aR[2], eR, aL0: aL[0], aL1: aL[1], aL2: aL[2], eL };
      for (const k in tgt) c[k] = c[k] == null ? tgt[k] : damp(c[k], tgt[k], rate, dt);
      r.body.position.y = c.bodyY;
      r.spine.rotation.set(c.lean * 0.6, c.twist * 0.6, 0);
      r.chest.rotation.set(c.lean * 0.4, c.twist * 0.4, 0);
      r.head.rotation.set(c.headX - c.lean * 0.5, -c.twist * 0.3, 0);
      const R = r.arms[1], L = r.arms[0];
      R.sh.rotation.set(-c.aR0, c.aR1, c.aR2); R.el.rotation.x = -c.eR;
      L.sh.rotation.set(-c.aL0, c.aL1, c.aL2); L.el.rotation.x = -c.eL;
      const crouchK = U.clamp(-(c.bodyY) / 0.75, 0, 1);
      for (const Lg of r.legs) {
        const sw = Math.sin(this.walkPh) * Lg.s * W;
        Lg.leg.rotation.set(-sw * 0.55 - crouchK * 0.9, 0, Lg.s * 0.06);
        Lg.knee.rotation.x = 0.2 + Math.max(0, Math.cos(this.walkPh) * Lg.s) * 0.8 * W + crouchK * 1.7;
        Lg.ankle.rotation.x = -crouchK * 0.8;
      }
      for (const sp of r.strips) sp.piv.rotation.x = 0.12 + W * 0.25 + Math.sin(t * 2.5 + sp.ph) * 0.05 + Math.max(0, c.lean) * 0.3;
      // amber edge glow on the key-blade during wind-ups
      const g = Math.max(glow, this.chainGlow || 0);
      this.chainGlow = Math.max(0, (this.chainGlow || 0) - dt * 3);
      r.mats.blade.emissive.setRGB(0.9 * g, 0.38 * g, 0.14 * g);
      r.mats.eye.color.setRGB(U.lerp(0.9, 2.6, g), U.lerp(0.92, 1.1, g), U.lerp(1.0, 0.4, g));
      r.crown.rotation.z += dt * (0.2 + (this.phase === 2 ? 0.4 : 0));
    }
    animDeath(t, dt) {
      const r = this.rig;
      const k = U.clamp(t / 1.2, 0, 1);
      this.cur.bodyY = U.lerp(this.cur.bodyY || 0, -0.8, 1 - Math.exp(-6 * dt));
      r.body.position.y = this.cur.bodyY;
      r.spine.rotation.x = U.lerp(r.spine.rotation.x, 0.9, 1 - Math.exp(-4 * dt));
      r.head.rotation.x = U.lerp(r.head.rotation.x, 0.6, 1 - Math.exp(-4 * dt));
      for (const Lg of r.legs) { Lg.leg.rotation.x = -0.9 * k; Lg.knee.rotation.x = 1.8 * k; }
      // the mask comes loose and falls
      if (t > 0.5 && this.maskFall) {
        const m = r.maskG;
        if (m.parent !== E.scene) { E.scene.attach(m); }
        m.position.y = Math.max(0.12, m.position.y - dt * 4 * Math.min(1, (t - 0.5) * 3));
        m.rotation.x = U.lerp(m.rotation.x, -Math.PI / 2, 1 - Math.exp(-5 * dt));
      }
      if (t > 2.7 && r.maskG.parent === E.scene) {
        // put the mask back for the next time the seal is rewritten
        r.head.attach(r.maskG);
        r.maskG.position.set(0, 0.06, 0.06); r.maskG.rotation.set(0, 0, 0);
        this.maskFall = null;
      }
    }
  }

  // ======================================================================================
  //  THE SEALWRIGHT — the lock of the name
  //  He wrote the seal, and wrote Vaust out of the world. Bound by the same white strands, with a
  //  blank page for a face. He cannot truly die: the seal is made of him. His last stroke rewrites it.
  // ======================================================================================
  const SW = {
    speed: 4.0, keep: 5.5,
    slashR: 2.9, slashHalf: 1.05, slashWind: 0.48, slashLock: 0.3, slashDmg: 14,
    foldR: 1.75, foldWind: 0.65, foldLock: 0.28, foldDmg: 20, foldRange: 10,
    wallLen: 9, wallWrite: 8.5, wallTele: 0.6, wallHarden: 1.0, wallLife: 8, wallH: 2.3, penDmg: 14,
    markSpeed: 7.5, markTurn: 2.2, markLife: 3.2, markDur: 6, markDmg: 6,
    needleLen: 19, needleHalf: 0.45, needleTele: 1.2, needleDmg: 24,
    handsR: 1.6, handsTele: 1.0, handsDmg: 12, handsPin: 1.0,
    slowR: 4.2, slowTele: 0.9, slowDur: 5,
    erasureFrom: 14.5, erasureTo: 8, erasureTime: 40,
  };
  const WALL_FS = `
#define sq(x) ((x)*(x))
    uniform float uRise, uOpacity, uTime, uLen; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(41.7, 289.3))) * 43758.5453); }
    void main(){
      float y = vUv.y;
      if (y > uRise) discard;
      // rows of script: blocks of light that flicker like letters being rewritten
      vec2 g = vec2(vUv.x * uLen * 5.0, y * 9.0);
      vec2 c = floor(g); vec2 f = fract(g);
      float h = hash(c + floor(uTime * 1.5) * 0.37);
      float glyph = step(0.45, h) * step(0.15, f.x) * step(f.x, 0.85) * step(0.25, f.y) * step(f.y, 0.75);
      float stroke = glyph * (0.35 + 0.65 * step(0.5, fract(h * 7.0 + f.x * 2.0 + f.y)));
      float top = exp(-sq((y - uRise) / 0.03));
      float base = exp(-sq(y / 0.05));
      float ends = smoothstep(0.0, 0.03, vUv.x) * (1.0 - smoothstep(0.97, 1.0, vUv.x));
      float a = (stroke * 0.55 + top * 0.9 + base * 0.8 + 0.06) * ends * uOpacity;
      if (a < 0.004) discard;
      gl_FragColor = vec4(vec3(1.5, 1.52, 1.65) * (0.6 + top + stroke * 0.4), a);
    }`;
  const BLANK_FS = `
    uniform float uLimit, uOpacity, uTime; varying vec2 vP;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      float d = length(vP);
      if (d < uLimit) discard;
      // erased stone: pale, blank, with the faint ruled lines of an empty page
      float edge = exp(-(d - uLimit) * 6.0);
      float ruled = (1.0 - smoothstep(0.0, 0.04, abs(fract(vP.y * 1.2) - 0.5) - 0.46)) * 0.08;
      float grain = (hash(floor(vP * 18.0)) - 0.5) * 0.03;
      vec3 col = vec3(0.78, 0.79, 0.82) + grain + ruled + edge * vec3(1.4);
      gl_FragColor = vec4(col, uOpacity * clamp(0.85 + edge, 0.0, 1.0));
    }`;
  function buildSealwright() {
    const mats = {
      robe: U.stdMat({ color: 0x1b1b21, roughness: 0.9, side: T.DoubleSide, emissive: 0x000000 }, 0.8, 2.4),
      body: U.stdMat({ color: 0x2a2a31, roughness: 0.7, metalness: 0.1, emissive: 0x000000 }, 0.8, 2.4),
      page: new T.MeshBasicMaterial({ color: new T.Color(1.35, 1.34, 1.3), side: T.DoubleSide }),
      blade: U.stdMat({ color: 0x9a9ca4, roughness: 0.25, metalness: 0.95, emissive: 0x000000, envMap: U.world.envMap }, 0.6, 2.0),
      ink: new T.MeshBasicMaterial({ color: new T.Color(2.2, 2.25, 2.5) }),
      strand: new T.LineBasicMaterial({ color: new T.Color(2.0, 2.05, 2.3), transparent: true, opacity: 0.45, depthWrite: false, blending: T.AdditiveBlending }),
    };
    const root = new T.Group();
    const body = new T.Group(); body.position.y = 0.12; root.add(body);
    const robe = addMesh(new T.CylinderGeometry(0.17, 0.6, 1.5, 9, 1, true), mats.robe, body, 0, 0.75, 0);
    const upper = new T.Group(); upper.position.y = 1.35; body.add(upper);
    addMesh(U.taperGeom(0.55, 0.17, 0.24, 6, 1, 0.7, false), mats.body, upper);
    const cape = addMesh(new T.ConeGeometry(0.42, 0.6, 7, 1, true), mats.robe, upper, 0, 0.42, -0.02);
    const head = new T.Group(); head.position.y = 0.72; upper.add(head);
    addMesh(new T.ConeGeometry(0.19, 0.5, 6), mats.robe, head, 0, 0.12, -0.04, -0.25);
    addMesh(new T.IcosahedronGeometry(0.12, 0), mats.body, head, 0, 0.0, 0);
    const face = addMesh(new T.PlaneGeometry(0.19, 0.26), mats.page, head, 0, -0.01, 0.115); face.castShadow = false;
    const arms = [];
    for (const s of [1, -1]) {
      const sh = new T.Group(); sh.position.set(s * 0.25, 0.48, 0); upper.add(sh);
      addMesh(U.taperGeom(0.34, 0.06, 0.045, 5), mats.robe, sh);
      const el = new T.Group(); el.position.y = -0.34; sh.add(el);
      addMesh(U.taperGeom(0.32, 0.05, 0.035, 5), mats.robe, el);
      const wr = new T.Group(); wr.position.y = -0.32; el.add(wr);
      arms.push({ s, sh, el, wr });
    }
    // the pen-blade (right) and the book of the seal (left)
    const pen = new T.Group(); arms[1].wr.add(pen);
    const nib = addMesh(new T.OctahedronGeometry(1, 0), mats.blade, pen, 0, -0.55, 0.0); nib.scale.set(0.025, 0.6, 0.06);
    const nibTip = addMesh(new T.OctahedronGeometry(1, 0), mats.ink, pen, 0, -1.1, 0.0); nibTip.scale.set(0.012, 0.1, 0.02); nibTip.castShadow = false;
    const book = addMesh(new T.BoxGeometry(0.26, 0.34, 0.05), mats.body, arms[0].wr, 0, -0.12, 0.06);
    addMesh(new T.BoxGeometry(0.24, 0.32, 0.02), mats.page, book, 0, 0, 0.03).castShadow = false;
    // pages circling him
    const pages = [];
    for (let i = 0; i < 9; i++) {
      const p = addMesh(new T.PlaneGeometry(0.16, 0.22), mats.page, root, 0, 1, 0); p.castShadow = false;
      pages.push({ m: p, a: (i / 9) * Math.PI * 2, r: 0.9 + (i % 3) * 0.25, h: 0.6 + (i % 4) * 0.45, sp: 0.5 + Math.random() * 0.4 });
    }
    // white strands binding his wrists to his back (the same as Vaust's)
    const strands = [];
    for (let i = 0; i < 2; i++) {
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(new Float32Array(12 * 3), 3));
      const l = new T.Line(g, mats.strand); l.frustumCulled = false; E.scene.add(l); l.visible = false;
      strands.push(l);
    }
    root.traverse((o) => { if (o.isMesh && o.material !== mats.page && o.material !== mats.ink) o.castShadow = true; });
    const glyph = E.makeGlyph(root, 2.55, 1.0);
    return { root, body, robe, upper, head, face, arms, pen, nibTip, book, pages, strands, mats, glyph, splitNode: upper, cape };
  }

  class Sealwright extends Boss {
    constructor() {
      super('sealwright', buildSealwright());
      this.cur = {};
      this.knockResist = 0.15; this.pinResist = 0.5;
      // script walls (pooled)
      this.wallPool = [];
      for (let i = 0; i < 6; i++) {
        const mat = new T.ShaderMaterial({
          uniforms: { uRise: { value: 0 }, uOpacity: { value: 1 }, uTime: U.shared.uTime, uLen: { value: 9 } },
          vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
          fragmentShader: WALL_FS, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
        });
        const geo = new T.PlaneGeometry(1, 1); geo.translate(0.5, 0.5, 0);
        const m = new T.Mesh(geo, mat); m.visible = false; m.renderOrder = 7; m.frustumCulled = false;
        E.scene.add(m);
        this.wallPool.push({ mesh: m, mat, active: false, a: new V3(), b: new V3(), thick: 0.22, solid: false, t: 0, len: 0, grown: 0 });
      }
      // the blank page that eats the courtyard's edge
      this.blank = new T.Mesh(new T.PlaneGeometry(64, 64), new T.ShaderMaterial({
        uniforms: { uLimit: { value: 99 }, uOpacity: { value: 0 }, uTime: U.shared.uTime },
        vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: BLANK_FS, transparent: true, depthWrite: false,
      }));
      this.blank.rotation.x = -Math.PI / 2; this.blank.position.y = 0.09; this.blank.renderOrder = 3; this.blank.visible = false;
      E.scene.add(this.blank);
      // hands from above
      this.hands = [];
      for (let i = 0; i < 3; i++) { const h = new U.SpectralHand(E.scene, { mirror: i % 2 === 1, glow: 1.4, core: 0.3, fingers: 6 }); h.setOpacity(0); this.hands.push(h); }
      // written-mark projectiles
      this.marks = [];
      for (let i = 0; i < 3; i++) {
        const s = new T.Sprite(new T.SpriteMaterial({ map: U.tex.glyph, color: new T.Color(2.2, 2.25, 2.5), transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
        s.scale.set(0.9, 0.9, 1); s.visible = false; E.scene.add(s);
        this.marks.push({ s, active: false, pos: s.position, vel: new V3(), life: 0 });
      }
      this.slowF = { active: false, pos: new V3(), t: 0, rings: [] };
    }
    onSpawn() {
      this.setState('intro');
      this.cur = {};
      this.erasing = false; B.arenaLimit = 99; this.blank.visible = false;
      this.phase = 1; this.speedMul = 1;
      this.rig.root.scale.setScalar(0.01);
      for (const l of this.rig.strands) l.visible = true;
    }
    resetExtra() {
      for (const w of this.wallPool) { w.active = false; w.solid = false; w.mesh.visible = false; }
      B.walls.length = 0;
      for (const h of this.hands) h.setOpacity(0);
      for (const m of this.marks) { m.active = false; m.s.visible = false; }
      this.endSlowField();
      this.blank.visible = false; B.arenaLimit = 99; this.erasing = false;
      for (const l of this.rig.strands) l.visible = false;
      this.handsAtk = null; this.needles = null; this.foldAtk = null;
    }
    onBreak() { this.cancelAttacks(); }
    cancelAttacks() {
      this.handsAtk = null; for (const h of this.hands) h.setOpacity(0);
      if (this.foldAtk && this.foldAtk.cres) FX.crescentRelease(this.foldAtk.cres);
      this.foldAtk = null; this.needles = null; this.writing = null;
    }
    onGrab(center, hold) { this.rootT = Math.max(this.rootT, 0.6); }
    onDie() {
      this.cancelAttacks();
      this.endSlowField();
      // his last stroke: a circle around himself, the seal rewritten
      for (let i = 0; i < 12; i++) {
        const a0 = (i / 12) * Math.PI * 2, a1 = ((i + 1) / 12) * Math.PI * 2;
        FX.seam(_a.set(this.pos.x + Math.sin(a0) * 2.2, 0, this.pos.z + Math.cos(a0) * 2.2), _b.set(this.pos.x + Math.sin(a1) * 2.2, 0, this.pos.z + Math.cos(a1) * 2.2), 0.12, 2.6);
      }
    }
    // the seal objects to its author: the manuscript is erased instead of him
    onSealCast(center, R) {
      if (Math.hypot(this.pos.x - center.x, this.pos.z - center.z) > R + this.radius && !this.erasing) return;
      if (this.erasing) {
        B.arenaLimit = 99; this.erasureT = 0; this.blankRestore = 1;
        U.ui.banner('The Page Is Restored', 'the seal objects to its own author', 2.2);
      }
      for (const w of this.wallPool) if (w.active) w.t = Math.max(w.t, SW.wallLife - 0.3);
      const keep = this.invuln; this.invuln = false;
      E.hit(this, this.maxHp * 0.1, {});
      this.invuln = keep;
      if (this.alive) this.breakPoise(4.0);
    }
    blink(to) {
      FX.ghostOf(this.root, { opacity: 0.6, dur: 0.4 });
      FX.sparks(_a.copy(this.pos).setY(1.2), 10, { speed: 3, life: 0.3, size: 0.07, grav: 0 });
      this.pos.set(to.x, 0, to.z);
      U.arenaClamp(this.pos, 0.6);
      B.clampPlayer(this.pos, 0.5);
      FX.ring({ pos: this.pos, r0: 1.2, r1: 0.2, dur: 0.3, w0: 0.06, w1: 0.02, opacity: 0.7 });
      U.audio.play('pin', { gap: 0.05 });
    }

    ai(dt, P) {
      const C = SW, pp = P.pos;
      const dx = pp.x - this.pos.x, dz = pp.z - this.pos.z, dist = Math.hypot(dx, dz) || 0.001;
      const st = this.st;
      let mv = 0, mvx = 0, mvz = 0;
      const k = this.hp / this.maxHp;
      // the Sealwright moves faster inside his own missing second
      const inOwn = this.slowF.active && Math.hypot(this.pos.x - this.slowF.pos.x, this.pos.z - this.slowF.pos.z) < C.slowR;
      if (this.state !== 'intro' && this.state !== 'phase' && !this.writing) {
        if (this.phase === 1 && k <= 0.6) { this.cancelAttacks(); this.clearTeles(); this.setState('phase'); this.nextPhase = 2; }
        else if (this.phase === 2 && k <= 0.25) { this.cancelAttacks(); this.clearTeles(); this.setState('phase'); this.nextPhase = 3; }
      }
      switch (this.state) {
        case 'intro': {
          // written into the courtyard, stroke by stroke
          this.invuln = true;
          const s = U.easeOutCubic(U.clamp((st - 0.6) / 1.0, 0, 1));
          this.root.scale.set(Math.max(0.01, s), Math.max(0.01, U.clamp((st - 0.3) / 0.6, 0, 1)), Math.max(0.01, s));
          if (!this.didHit && st > 0.2) {
            this.didHit = true;
            U.audio.play('tear');
            for (let i = 0; i < 6; i++) {
              const a = (i / 6) * Math.PI * 2;
              FX.seam(_a.set(this.pos.x + Math.sin(a) * 0.6, 0, this.pos.z + Math.cos(a) * 0.6), _b.set(this.pos.x + Math.sin(a) * 3.2, 0, this.pos.z + Math.cos(a) * 3.2), 0.1, 2.0);
            }
          }
          this.faceTo(pp.x, pp.z, 3, dt);
          if (st > 2.2) { this.root.scale.setScalar(1); this.invuln = false; this.setState('idle'); this.cool = 0.6; }
          break;
        }
        case 'phase': {
          this.invuln = true;
          if (!this.didHit && st > 0.6) {
            this.didHit = true;
            this.phase = this.nextPhase;
            U.world.addShake(0.3); U.audio.play('tear');
            FX.ring({ pos: this.pos, r0: 0.5, r1: 9, dur: 0.8, w0: 0.3, w1: 0.03, opacity: 0.9, intensity: 1.4 });
            if (this.phase === 2) { this.speedMul = 1.1; U.ui.banner('Revision', 'he answers Vaust with Vaust’s own words', 2.4); }
            else {
              this.speedMul = 1.2;
              U.ui.banner('Erasure', 'the courtyard is being unwritten', 2.4);
              this.erasing = true; this.erasureT = 0; this.blank.visible = true;
            }
          }
          if (st > 1.6) { this.invuln = false; this.setState('idle'); this.cool = 0.4; }
          break;
        }
        case 'idle': {
          // glide to keep his distance, circling
          this.faceTo(pp.x, pp.z, 6, dt);
          const radial = U.clamp((dist - C.keep) * 0.8, -1, 1);
          this.circ = this.circ || 1;
          mvx = dx / dist * radial + (-dz / dist) * this.circ * 0.7; mvz = dz / dist * radial + (dx / dist) * this.circ * 0.7;
          const l = Math.hypot(mvx, mvz) || 1; mvx /= l; mvz /= l;
          mv = C.speed * (inOwn ? 1.3 : 1);
          if (Math.random() < dt * 0.4) this.circ *= -1;
          this.cool -= dt;
          if (this.cool <= 0 && P.alive) this.pickAttack(dist, P);
          break;
        }
        // ---- pen slash (close)
        case 'slW': {
          const dur = tl(C.slashWind, this), lock = tl(C.slashLock, this);
          if (st < lock) { this.faceTo(pp.x, pp.z, 10, dt); this.lockYaw = this.facing; this.lockPos.copy(this.pos); this.tele.grp.position.set(this.pos.x, 0.07, this.pos.z); this.tele.grp.rotation.y = this.lockYaw; }
          else this.tele.mat.uniforms.uLocked.value = 1;
          this.tele.mat.uniforms.uProgress.value = U.clamp(st / dur, 0, 1);
          this.tele.mat.uniforms.uOpacity.value = U.clamp(st / 0.08, 0, 1);
          if (st >= dur) { this.setState('sl'); U.audio.play('swing1'); }
          break;
        }
        case 'sl': {
          this.facing = this.lockYaw;
          if (!this.didHit && st > 0.05) {
            this.didHit = true;
            if (inSector(pp, this.lockPos, this.lockYaw, C.slashR + P.radius * 0.6, C.slashHalf + 0.06)) hurt(C.slashDmg, this.pos);
            this.root.updateMatrixWorld(true);
            const cr = FX.crescent(U.SLASH.slash1, this.rig.body.matrixWorld, { inner: 0.4, outer: 1.9, bright: 1.0, fadeTime: 0.15 });
            FX.crescentSet(cr, 1); FX.crescentRelease(cr);
          }
          if (st > 0.18) {
            this.dropTele(this.tele); this.tele = null;
            if ((this.slashes = (this.slashes || 0) + 1) < 2) this.startSlash();
            else { this.slashes = 0; this.setState('rec'); this.recT = 0.6; }
          }
          break;
        }
        // ---- mirror fold: his cut lands on Vaust
        case 'foldW': {
          const F = this.foldAtk;
          const dur = tl(C.foldWind, this), lock = tl(C.foldLock, this);
          this.faceTo(pp.x, pp.z, 8, dt);
          if (st < lock) { F.at.set(pp.x, 0, pp.z); }
          F.tele.grp.position.set(F.at.x, 0.07, F.at.z);
          F.tele.mat.uniforms.uProgress.value = U.clamp(st / dur, 0, 1);
          F.tele.mat.uniforms.uOpacity.value = U.clamp(st / 0.08, 0, 1);
          F.tele.mat.uniforms.uLocked.value = st >= lock ? 1 : 0;
          if (!F.ghost && st > lock) {
            F.ghost = true;
            // a ghost of his crescent forms around where Vaust stands
            _m4.compose(_a.set(F.at.x - Math.sin(this.facing) * 1.0, 0, F.at.z - Math.cos(this.facing) * 1.0), _q.setFromAxisAngle(_b.set(0, 1, 0), this.facing), _c.set(1, 1, 1));
            F.cres = FX.crescent(U.SLASH.slash2, _m4, { inner: 0.3, outer: 1.75, bright: 0.35, fadeTime: 0.2 });
            FX.crescentSet(F.cres, 0.15);
          }
          if (F.cres) FX.crescentSet(F.cres, 0.15 + 0.25 * U.clamp((st - lock) / (dur - lock), 0, 1));
          if (st >= dur) {
            this.setState('fold');
            U.audio.play('fold');
            if (F.cres) { F.cres.mat.uniforms.uColor.value.setRGB(2.6, 2.65, 2.9); FX.crescentSet(F.cres, 1); FX.crescentRelease(F.cres); }
            if (Math.hypot(pp.x - F.at.x, pp.z - F.at.z) < C.foldR + P.radius * 0.5) hurt(C.foldDmg, F.at);
            FX.fracture(_a.copy(F.at).setY(1.2), 1.4, 0.3);
            FX.seam(_a.copy(this.pos).setY(0), F.at, 0.09, 0.4);
            this.dropTele(F.tele);
          }
          break;
        }
        case 'fold': {
          if (st > 0.15) {
            this.foldAtk = null;
            const chain = this.phase >= 2 ? 3 : 1;
            if ((this.folds = (this.folds || 0) + 1) < chain && P.alive && !B.blocked(this.pos, pp)) this.startFold(true);
            else { this.folds = 0; this.setState('rec'); this.recT = 0.5; }
          }
          break;
        }
        // ---- script walls: writes a line across the courtyard that hardens into a wall
        case 'wrW': {
          const W = this.writing;
          for (let i = 0; i < W.lines.length; i++) {
            const t = W.lines[i].tele;
            t.mat.uniforms.uProgress.value = U.clamp(st / tl(C.wallTele, this), 0, 1);
            t.mat.uniforms.uOpacity.value = U.clamp(st / 0.1, 0, 1);
            t.mat.uniforms.uLocked.value = 1;
          }
          this.faceTo(W.lines[0].b.x, W.lines[0].b.z, 8, dt);
          if (st >= tl(C.wallTele, this)) {
            for (const L of W.lines) { this.dropTele(L.tele); L.wall = this.newWall(L.a, L.b); }
            this.setState('wr'); U.audio.play('tear', { gap: 0.2 });
          }
          break;
        }
        case 'wr': {
          const W = this.writing;
          const prog = U.clamp(st * C.wallWrite / C.wallLen, 0, 1);
          const L0 = W.lines[0];
          this.pos.lerpVectors(L0.a, L0.b, prog); this.pos.y = 0;
          this.facing = Math.atan2(L0.b.x - L0.a.x, L0.b.z - L0.a.z);
          for (const L of W.lines) {
            L.wall.grown = prog;
            const tip = _a.lerpVectors(L.a, L.b, prog);
            if (!W.hit && Math.hypot(pp.x - tip.x, pp.z - tip.z) < 0.7 + P.radius) { if (hurt(C.penDmg, tip)) W.hit = true; }
            if (Math.random() < 0.8) FX.sparks(_b.copy(tip).setY(0.1), 2, { speed: 2, up: 1.5, life: 0.35, size: 0.07, grav: 3 });
          }
          if (prog >= 1) { this.writing = null; this.setState('rec'); this.recT = 0.35; }
          break;
        }
        // ---- the written mark: a glyph that follows Vaust
        case 'mkW': {
          this.faceTo(pp.x, pp.z, 8, dt);
          if (st >= tl(0.55, this)) {
            const n = this.phase >= 3 || E.loop >= 2 ? 2 : 1;
            for (let i = 0; i < n; i++) this.throwMark(i ? 0.6 : 0);
            this.setState('rec'); this.recT = 0.4;
          }
          break;
        }
        // ---- Needle Against the Hours: lines stay visible, then strike — Vaust's Q in the right order
        case 'ndW': {
          const N = this.needles;
          for (const n of N.lanes) {
            n.tele.mat.uniforms.uProgress.value = U.clamp(st / tl(C.needleTele, this), 0, 1);
            n.tele.mat.uniforms.uOpacity.value = U.clamp(st / 0.1, 0, 1);
            n.tele.mat.uniforms.uLocked.value = 1;
          }
          if (st >= tl(C.needleTele, this)) {
            U.audio.play('q');
            for (const n of N.lanes) {
              this.dropTele(n.tele);
              const end = _a.set(N.from.x + Math.sin(n.yaw) * C.needleLen, 0, N.from.z + Math.cos(n.yaw) * C.needleLen);
              FX.seam(_b.copy(N.from), end, 0.5, 0.6);
              FX.sparks(_b.copy(N.from).setY(1.2), 8, { speed: 8, dir: _c.set(Math.sin(n.yaw), 0, Math.cos(n.yaw)), bias: 0.8, life: 0.3, size: 0.08, grav: 0 });
              if (inLane(pp, N.from, n.yaw, C.needleLen, C.needleHalf + P.radius * 0.6)) { if (hurt(C.needleDmg, N.from)) U.audio.play('qhit'); }
            }
            this.needles = null;
            this.setState('rec'); this.recT = 0.5;
          }
          break;
        }
        // ---- Hands Above: pressed down, pinned in time
        case 'haW': {
          this.faceTo(pp.x, pp.z, 4, dt);
          this.updateHandsAbove(dt, st, P);
          if (st > tl(C.handsTele, this) + 0.6) { this.handsAtk = null; for (const h of this.hands) h.setOpacity(0); this.setState('rec'); this.recT = 0.3; }
          break;
        }
        // ---- His own Missing Second
        case 'sfW': {
          this.faceTo(pp.x, pp.z, 4, dt);
          const t = this.sfTele;
          t.mat.uniforms.uProgress.value = U.clamp(st / tl(C.slowTele, this), 0, 1);
          t.mat.uniforms.uOpacity.value = U.clamp(st / 0.1, 0, 1);
          if (st >= tl(C.slowTele, this)) { this.dropTele(t); this.startSlowField(t.grp.position); this.setState('rec'); this.recT = 0.3; }
          break;
        }
        case 'rec': {
          this.faceTo(pp.x, pp.z, 4, dt);
          if (st > (this.recT || 0.5)) { this.setState('idle'); this.cool = (this.phase === 1 ? 0.7 : 0.4) + Math.random() * 0.5; }
          break;
        }
        case 'recover': {
          if (st > 0.4) { this.setState('idle'); this.cool = 0.3; }
          break;
        }
      }
      if (mv > 0 && this.rootT <= 0) {
        this.pos.x += mvx * mv * dt; this.pos.z += mvz * mv * dt;
        B.clampPlayer(this.pos, 0.5);
      }
      this.vel.set(mvx * mv, 0, mvz * mv);
      this.moveSpeed = mv;
      this.updateErasure(dt);
    }
    pickAttack(dist, P) {
      const blocked = B.blocked(this.pos, P.pos);
      const p2 = this.phase >= 2;
      const w = {
        slash: dist < 3.2 ? 6 : 0,
        fold: !blocked && dist < SW.foldRange && dist > 2.4 ? 5 : 0,
        write: B.walls.filter((x) => x.active).length < 3 ? 3 : 0,
        mark: 2,
        needle: p2 ? 3 : 0,
        hands: p2 ? 3 : 0,
        slow: p2 && !this.slowF.active ? 2 : 0,
        blink: dist > 11 ? 3 : 0,
      };
      const a = this.choose(w);
      if (a === 'slash') { this.slashes = 0; this.startSlash(); }
      else if (a === 'fold') { this.folds = 0; this.startFold(false); }
      else if (a === 'write') this.startWrite(P);
      else if (a === 'mark') { this.setState('mkW'); U.audio.play('windup', { gap: 0.08 }); }
      else if (a === 'needle') this.startNeedles(P);
      else if (a === 'hands') this.startHands(P);
      else if (a === 'slow') this.startSlowTele(P);
      else {
        const ang = Math.atan2(this.pos.x - P.pos.x, this.pos.z - P.pos.z) + (Math.random() - 0.5);
        this.blink(_a.set(P.pos.x + Math.sin(ang) * 5, 0, P.pos.z + Math.cos(ang) * 5));
        this.cool = 0.3;
      }
    }
    startSlash() {
      this.setState('slW');
      this.dropTele(this.tele);
      this.tele = this.addTele({ pos: this.pos, r: SW.slashR, half: SW.slashHalf, yaw: this.facing, intensity: 1.0 });
      this.lockYaw = this.facing; this.lockPos.copy(this.pos);
      U.audio.play('windup', { gap: 0.08 });
    }
    startFold() {
      this.setState('foldW');
      const P = U.player;
      this.foldAtk = { at: P.pos.clone().setY(0), tele: this.addTele({ pos: P.pos, r: SW.foldR, color: PALE, intensity: 0.9 }), cres: null, ghost: false };
      U.audio.play('windup', { gap: 0.08 });
    }
    startWrite(P) {
      const n = (this.phase >= 3 || E.loop >= 2) ? 2 : 1;
      const lines = [];
      const bx = P.pos.x - this.pos.x, bz = P.pos.z - this.pos.z, bl = Math.hypot(bx, bz) || 1;
      const fx = bx / bl, fz = bz / bl, px = -fz, pz = fx;
      for (let i = 0; i < n; i++) {
        // a line across the courtyard near Vaust: sometimes between them, sometimes behind him
        const off = (i === 0 ? (Math.random() < 0.5 ? -2.0 : 2.2) : -(lines[0].off) * 1.4);
        const mx = P.pos.x + fx * off, mz = P.pos.z + fz * off;
        const half = SW.wallLen / 2;
        const a = new V3(mx - px * half, 0, mz - pz * half), b = new V3(mx + px * half, 0, mz + pz * half);
        U.arenaClamp(a, 0.5); U.arenaClamp(b, 0.5);
        const yaw = Math.atan2(b.x - a.x, b.z - a.z);
        lines.push({ a, b, off, tele: this.addTele({ pos: a, r: a.distanceTo(b), half: 0.35, yaw, lane: true, color: PALE, intensity: 1.0 }) });
      }
      this.blink(lines[0].a);
      this.writing = { lines, hit: false };
      this.setState('wrW');
    }
    newWall(a, b) {
      let w = this.wallPool.find((x) => !x.active);
      if (!w) { w = this.wallPool.reduce((p, q) => (p.t > q.t ? p : q)); }
      // at most three stand at once
      const live = this.wallPool.filter((x) => x.active).sort((p, q) => q.t - p.t);
      if (live.length >= 3) live[0].t = Math.max(live[0].t, SW.wallLife - 0.3);
      w.active = true; w.solid = false; w.t = 0; w.grown = 0;
      w.a.copy(a); w.b.copy(b); w.len = a.distanceTo(b);
      w.mesh.position.set(a.x, 0, a.z);
      w.mesh.rotation.set(0, Math.atan2(-(b.z - a.z), b.x - a.x), 0);
      w.mesh.scale.set(w.len, SW.wallH, 1);
      w.mat.uniforms.uLen.value = w.len;
      w.mesh.visible = true;
      if (B.walls.indexOf(w) < 0) B.walls.push(w);
      return w;
    }
    throwMark(delay) {
      const m = this.marks.find((x) => !x.active);
      if (!m) return;
      m.active = true; m.life = -delay; m.s.visible = delay <= 0;
      this.root.updateMatrixWorld(true);
      this.rig.book.getWorldPosition(m.pos); m.pos.y = 1.4;
      const P = U.player;
      m.vel.set(P.pos.x - m.pos.x, 0, P.pos.z - m.pos.z).normalize().multiplyScalar(SW.markSpeed);
      U.audio.play('idolFire', { gap: 0.05 });
    }
    startNeedles(P) {
      this.setState('ndW');
      const yaw = Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
      const offs = E.loop >= 2 ? [-0.5, -0.17, 0.17, 0.5] : [-0.35, 0, 0.35];
      this.needles = { from: this.pos.clone(), lanes: offs.map((o) => ({ yaw: yaw + o, tele: this.addTele({ pos: this.pos, r: SW.needleLen, half: SW.needleHalf, yaw: yaw + o, lane: true, color: PALE, intensity: 1.1 }) })) };
      U.audio.play('windup', { gap: 0.08 });
    }
    startHands(P) {
      this.setState('haW');
      const pts = [P.pos.clone(), P.pos.clone().add(_a.copy(P.vel).setY(0).multiplyScalar(0.8))];
      const a = Math.random() * Math.PI * 2;
      pts.push(new V3(P.pos.x + Math.sin(a) * 2.6, 0, P.pos.z + Math.cos(a) * 2.6));
      this.handsAtk = pts.map((p, i) => {
        U.arenaClamp(p, 0.8); p.y = 0;
        return { at: p, tele: this.addTele({ pos: p, r: SW.handsR, color: PALE, intensity: 1.0 }), h: this.hands[i], slammed: false };
      });
      for (const o of this.handsAtk) { o.h.snapPose('open'); o.h.setScale(2.4); o.h.setOpacity(0); }
      U.audio.play('eRise');
    }
    updateHandsAbove(dt, st, P) {
      const C = SW, A = this.handsAtk;
      if (!A) return;
      const tt = tl(C.handsTele, this);
      for (const o of A) {
        const h = o.h;
        o.tele.mat.uniforms.uProgress.value = U.clamp(st / tt, 0, 1);
        o.tele.mat.uniforms.uOpacity.value = U.clamp(st / 0.1, 0, 1);
        o.tele.mat.uniforms.uLocked.value = 1;
        let y;
        if (st < tt) { y = U.lerp(7, 4.2, U.easeOutCubic(st / tt)); h.setOpacity(U.clamp(st / 0.3, 0, 0.8)); h.setPose('open', 6); }
        else {
          const k = U.clamp((st - tt) / 0.12, 0, 1);
          y = U.lerp(4.2, 0.35, U.easeInCubic(k)); h.setOpacity(1 - U.clamp((st - tt - 0.25) / 0.35, 0, 1)); h.setPose('claw', 20);
          if (k >= 1 && !o.slammed) {
            o.slammed = true;
            this.dropTele(o.tele);
            FX.ring({ pos: o.at, r0: 0.3, r1: C.handsR + 0.4, dur: 0.3, w0: 0.15, w1: 0.03, opacity: 0.9, intensity: 1.3 });
            FX.shards(_a.copy(o.at).setY(0.2), 6, { speed: 4, up: 2, size: 0.12, life: 0.8, colors: [new T.Color(0.15, 0.15, 0.17)] });
            U.audio.play('eGrasp', { gap: 0.03 });
            U.world.addShake(0.12);
            if (P.alive && Math.hypot(P.pos.x - o.at.x, P.pos.z - o.at.z) < C.handsR + P.radius * 0.5) {
              if (hurt(C.handsDmg, o.at)) { P.pinT = C.handsPin; FX.ghostOf(P.rig.root, { opacity: 0.4, dur: 0.6 }); U.audio.play('pin'); }
            }
          }
        }
        h.group.position.set(o.at.x, y, o.at.z);
        h.orient(_a.set(0, 0, 1), _b.set(0, -1, 0.02));
        h.update(dt);
      }
    }
    startSlowTele(P) {
      this.setState('sfW');
      this.sfTele = this.addTele({ pos: P.pos, r: SW.slowR, color: CRIMSON, intensity: 0.9 });
      U.audio.play('t');
    }
    startSlowField(at) {
      const F = this.slowF;
      this.endSlowField();
      F.active = true; F.t = 0; F.pos.set(at.x, 0, at.z);
      F.rings = [heldRing({ pos: F.pos, max: SW.slowR + 0.3, w: 0.08, color: CRIMSON, intensity: 1.6, opacity: 0.9, r: SW.slowR }), heldRing({ pos: F.pos, max: SW.slowR, w: 0.04, color: PALE, intensity: 0.8, opacity: 0.5, r: SW.slowR * 0.75 })];
      U.audio.play('tDrone');
    }
    endSlowField() {
      const F = this.slowF;
      for (const r of F.rings) r.release();
      F.rings = []; F.active = false;
    }
    updateErasure(dt) {
      const C = SW;
      if (this.erasing && this.alive) {
        this.erasureT = (this.erasureT || 0) + dt;
        B.arenaLimit = U.lerp(C.erasureFrom, C.erasureTo, U.clamp(this.erasureT / C.erasureTime, 0, 1));
      }
      if (this.blankRestore > 0) this.blankRestore = Math.max(0, this.blankRestore - dt);
    }
    // world-time effects that keep running while he is pinned (walls, marks, fields)
    global(hdt, dt) {
      const C = SW, P = U.player;
      const live = this.active || this.slowF.active || this.wallPool.some((w) => w.active);
      if (!live) return;
      // walls: ink, then harden, then fade
      for (const w of this.wallPool) {
        if (!w.active) continue;
        w.t += hdt;
        const writing = this.writing && this.writing.lines.some((L) => L.wall === w);
        const g = writing ? w.grown : 1;
        w.mesh.scale.x = Math.max(0.01, w.len * g);
        const age = writing ? 0 : w.t;
        if (!writing && !w.solid && w.t > C.wallHarden) { w.solid = true; U.audio.play('pin', { gap: 0.1 }); }
        const rise = w.solid ? U.clamp((w.t - C.wallHarden) / 0.25, 0.04, 1) : 0.04;
        w.mat.uniforms.uRise.value = rise;
        w.mat.uniforms.uOpacity.value = 1 - U.clamp((w.t - C.wallLife + 0.6) / 0.6, 0, 1);
        if (w.t >= C.wallLife || (!this.alive && w.t > 0.5 && !writing && this.state === 'dying')) {
          w.active = false; w.solid = false; w.mesh.visible = false;
          const i = B.walls.indexOf(w); if (i >= 0) B.walls.splice(i, 1);
        }
        void age;
      }
      // written marks
      for (const m of this.marks) {
        if (!m.active) continue;
        m.life += hdt;
        if (m.life < 0) continue;
        m.s.visible = true;
        const want = _a.set(P.pos.x - m.pos.x, 0, P.pos.z - m.pos.z).normalize();
        const cur = _b.copy(m.vel).normalize();
        const ang = Math.atan2(cur.x * want.z - cur.z * want.x, cur.dot(want));
        const turn = U.clamp(ang, -C.markTurn * hdt, C.markTurn * hdt);
        m.vel.applyAxisAngle(_c.set(0, -1, 0), turn);
        const prev = _d.copy(m.pos);
        m.pos.addScaledVector(m.vel, hdt);
        m.s.material.rotation += hdt * 3;
        if (Math.random() < 0.5) FX.sparks(m.pos, 1, { speed: 0.4, life: 0.3, size: 0.08, grav: 0, a: 0.7 });
        let done = m.life > C.markLife || B.blocked(prev, m.pos) || U.skills.tearSwallow(m.pos);
        if (!done && P.alive && Math.hypot(P.pos.x - m.pos.x, P.pos.z - m.pos.z) < P.radius + 0.35) {
          if (hurt(C.markDmg, m.pos)) { P.written = C.markDur; U.audio.play('pin'); FX.ring({ pos: P.pos, r0: 0.3, r1: 1.4, dur: 0.35, w0: 0.08, w1: 0.02, opacity: 0.8 }); }
          done = true;
        }
        if (done) { m.active = false; m.s.visible = false; FX.sparks(m.pos, 6, { speed: 2, life: 0.3, size: 0.07, grav: 0 }); }
      }
      // his own missing second: Vaust slowed inside, unless his own field overlaps
      const F = this.slowF;
      if (F.active) {
        F.t += hdt;
        const k = U.clamp(F.t / 0.3, 0, 1) * (1 - U.clamp((F.t - C.slowDur + 0.4) / 0.4, 0, 1));
        F.rings[0].set(C.slowR, 0.08, 0.9 * k);
        F.rings[1].set(C.slowR * (0.72 + 0.04 * Math.sin(F.t * 9)), 0.04, 0.5 * k);
        const inside = Math.hypot(P.pos.x - F.pos.x, P.pos.z - F.pos.z) < C.slowR;
        const countered = U.skills.fieldAt(P.pos);
        P.slowField = inside && !countered;
        if (inside && countered && Math.random() < dt * 8) FX.sparks(_a.copy(P.pos).setY(1.0), 1, { speed: 1, life: 0.3, size: 0.07, grav: 0 });
        if (Math.random() < hdt * 10) {
          const a = Math.random() * Math.PI * 2, r = Math.random() * C.slowR;
          FX.sparks(_a.set(F.pos.x + Math.sin(a) * r, 0.2, F.pos.z + Math.cos(a) * r), 1, { speed: 0.3, up: -1, life: 1.0, size: 0.07, grav: -0.6, color: CRIMSON });
        }
        if (F.t >= C.slowDur || !this.alive) this.endSlowField();
      }
      // the blank page at the courtyard's edge
      const lim = B.arenaLimit;
      this.blank.visible = lim < 90 || (this.blankFade || 0) > 0;
      if (lim < 90) { this.blank.material.uniforms.uLimit.value = lim; this.blank.material.uniforms.uOpacity.value = Math.min(1, (this.erasureT || 0) / 1.5); this.blankFade = 1; }
      else if (this.blankFade > 0) { this.blankFade = Math.max(0, this.blankFade - dt * 1.5); this.blank.material.uniforms.uOpacity.value = this.blankFade; this.blank.material.uniforms.uLimit.value += dt * 8; }
      // strands binding his wrists to his back
      if (this.root.visible) {
        this.root.updateMatrixWorld(true);
        const back = this.rig.upper.localToWorld(_c.set(0, 0.45, -0.18));
        this.rig.strands.forEach((l, i) => {
          const w = this.rig.arms[i].wr.getWorldPosition(_d);
          const arr = l.geometry.attributes.position.array;
          for (let k = 0; k < 12; k++) {
            const u = k / 11;
            arr[k * 3] = U.lerp(w.x, back.x, u) + Math.sin(this.animT * 3 + u * 9 + i) * 0.02;
            arr[k * 3 + 1] = U.lerp(w.y, back.y, u) - Math.sin(u * Math.PI) * 0.12;
            arr[k * 3 + 2] = U.lerp(w.z, back.z, u);
          }
          l.geometry.attributes.position.needsUpdate = true;
          l.visible = true;
        });
      } else for (const l of this.rig.strands) l.visible = false;
    }

    animate(dt, P) {
      const r = this.rig, s = this.state, st = this.st, c = this.cur, t = this.animT;
      const mv = this.moveSpeed || 0;
      let lean = 0.06 + U.clamp(mv / SW.speed, 0, 1) * 0.2, twist = 0, headX = 0, bob = Math.sin(t * 2.2) * 0.05;
      let aR = [0.2, 0, -0.2], eR = 0.3, aL = [0.5, 0, 0.3], eL = 1.2, rate = 10;
      if (s === 'slW') { const k = U.easeOutCubic(U.clamp(st / tl(SW.slashWind, this), 0, 1)); twist = -0.7 * k; aR = [1.2 * k + 0.2, 0, -1.2 * k]; rate = 18; }
      else if (s === 'sl') { twist = 0.7; aR = [0.2, 0, 1.2]; rate = 40; lean = 0.3; }
      else if (s === 'foldW' || s === 'fold') { aR = [1.6, 0, -0.3]; eR = 0.05; twist = -0.3; headX = 0.1; rate = 16; if (s === 'fold') { aR = [0.6, 0, 1.0]; twist = 0.5; } }
      else if (s === 'wrW' || s === 'wr') { lean = 0.55; aR = [0.9, 0, -0.1]; eR = 0.2; headX = 0.4; bob = 0; }
      else if (s === 'mkW') { aL = [1.5, 0, 0.1]; eL = 0.3; headX = -0.1; }
      else if (s === 'ndW') { aR = [1.55, 0, 0]; eR = 0; aL = [1.2, 0, 0.4]; twist = 0.1; }
      else if (s === 'haW' || s === 'sfW') { aR = [2.6, 0, -0.4]; aL = [2.6, 0, 0.4]; eR = eL = 0.3; headX = -0.4; }
      else if (s === 'phase' || s === 'intro') { aR = [2.2, 0, -0.9]; aL = [2.2, 0, 0.9]; headX = -0.5; lean = -0.2; }
      else if (s === 'broken') { const k = U.env(st, 0, 0.2, 3.5, 4.0); lean = 0.7 * k; headX = 0.6 * k; aR = [0.0, 0, -0.4]; aL = [0.2, 0, 0.6]; bob = -0.35 * k; }
      if (this.flinch > 0) { lean -= this.flinch * 0.2; headX -= this.flinch * 0.2; }
      const tgt = { lean, twist, headX, bob, aR0: aR[0], aR2: aR[2], eR, aL0: aL[0], aL2: aL[2], eL };
      for (const k in tgt) c[k] = c[k] == null ? tgt[k] : damp(c[k], tgt[k], rate, dt);
      r.body.position.y = 0.12 + c.bob;
      r.upper.rotation.set(c.lean, c.twist, 0);
      r.robe.rotation.x = c.lean * 0.4;
      r.head.rotation.set(c.headX, -c.twist * 0.4, 0);
      const R = r.arms[1], L = r.arms[0];
      R.sh.rotation.set(-c.aR0, 0, c.aR2); R.el.rotation.x = -c.eR;
      L.sh.rotation.set(-c.aL0, 0, c.aL2); L.el.rotation.x = -c.eL;
      for (const p of r.pages) {
        p.a += dt * p.sp * (s === 'phase' ? 4 : 1);
        p.m.position.set(Math.cos(p.a) * p.r, p.h + Math.sin(t * 1.5 + p.a) * 0.15, Math.sin(p.a) * p.r);
        p.m.rotation.set(Math.sin(p.a * 2) * 0.6, p.a * 1.3, 0.3);
      }
      r.mats.ink.color.setScalar(1.8 + Math.sin(t * 5) * 0.4);
    }
    animDeath(t, dt) {
      const r = this.rig;
      r.body.position.y = U.lerp(r.body.position.y, -0.5, 1 - Math.exp(-3 * dt));
      r.upper.rotation.x = U.lerp(r.upper.rotation.x, 0.8, 1 - Math.exp(-3 * dt));
      for (const p of r.pages) { p.r += dt * 2.5; p.h += dt * 1.5; p.m.position.set(Math.cos(p.a) * p.r, p.h, Math.sin(p.a) * p.r); }
    }
  }

  // ======================================================================================
  //  THE WITNESS BENEATH THE ECLIPSE — the lock of sight
  //  The broken eclipse is a lid that never quite closes; the Witness is the eye behind it. The seal
  //  holds as long as Vaust is watched. The Hex Idols were splinters of it. When it rises over the
  //  northern drop, pieces of the eclipse fall into the courtyard — and they cast shade.
  // ======================================================================================
  const WI = {
    watchPos: new V3(0, 0, -14.2), blinkPos: new V3(0, 0, -12.6), eyeH: 2.2, blinkH: 0.9,
    gazeR: 2.3, gazeSpeed: 2.5, judge: 2.0, judge2: 1.6, sentenceDmg: 30, lock: 3.0,
    beamHalf: 0.9, beamLen: 14, beamPivot: new V3(0, 0, -2), beamSpeedA: 0.42, beamSpeedB: -0.29,
    eyes: 4, eyes2: 3, eyeHp: 120, orbit: new V3(0, 0, -6.5), orbitR: 4.8, revive: 12,
    blink: 6.0, tearR: 1.3, tearDelay: 1.2, tearDmg: 18,
    monos: [[-5.2, -3.6], [5.0, -3.0], [0.4, 3.4]],
  };
  const EYE_VS = `varying vec3 vN; varying vec3 vV; void main(){ vN = normal; vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`;
  const EYE_FS = `
#define sq(x) ((x)*(x))
    uniform vec3 uLook; uniform float uDilate, uGlow, uTime; varying vec3 vN;
    void main(){
      vec3 n = normalize(vN);
      vec3 L = normalize(uLook);
      float c = dot(n, L);
      float ang = acos(clamp(c, -1.0, 1.0));
      vec3 sd = cross(L, vec3(0.0, 1.0, 0.0));
      sd = length(sd) > 1e-4 ? normalize(sd) : vec3(1.0, 0.0, 0.0);
      float sx = dot(n, sd);
      float iris = 1.0 - smoothstep(0.42, 0.46, ang);
      float pupil = (1.0 - smoothstep(0.035 * uDilate, 0.06 * uDilate, abs(sx))) * (1.0 - smoothstep(0.3, 0.34, ang));
      float ring = exp(-sq((ang - 0.44) / 0.02));
      float th = atan(n.y, n.x);
      float veins = pow(abs(sin(ang * 26.0 + th * 5.0 + sin(th * 13.0))), 30.0) * smoothstep(0.6, 1.4, ang) * 0.35;
      vec3 sclera = vec3(0.62, 0.61, 0.6) * (0.45 + 0.55 * max(c, 0.0)) - veins * vec3(0.1, 0.25, 0.25);
      vec3 irisCol = mix(vec3(1.7, 1.6, 1.25), vec3(0.85, 0.8, 0.62), ang / 0.46) * uGlow;
      vec3 col = mix(sclera, irisCol, iris);
      col = mix(col, vec3(0.0), pupil);
      col += ring * vec3(2.2, 2.1, 1.8) * uGlow;
      gl_FragColor = vec4(col, 1.0);
    }`;
  const SHADE_FS = `uniform float uOpacity; varying vec2 vUv; void main(){ float a = (1.0 - vUv.y) * smoothstep(0.0, 0.25, vUv.x) * (1.0 - smoothstep(0.75, 1.0, vUv.x)) * uOpacity; gl_FragColor = vec4(0.0, 0.0, 0.0, a); }`;
  const COLUMN_FS = `uniform float uOpacity; varying vec2 vUv; void main(){ float a = (1.0 - smoothstep(0.0, 0.6, vUv.y)) * uOpacity; gl_FragColor = vec4(vec3(1.3, 1.32, 1.45), a * 0.55); }`;

  function buildWitness() {
    const mats = {
      flesh: U.stdMat({ color: 0x2c2b30, roughness: 0.6, metalness: 0.2, emissive: 0x000000 }, 0.9, 2.2),
      ring: U.stdMat({ color: 0x5a5c64, roughness: 0.3, metalness: 0.9, emissive: 0x000000, envMap: U.world.envMap }, 0.6, 2.0),
      veil: U.stdMat({ color: 0x18181d, roughness: 0.9, side: T.DoubleSide, emissive: 0x000000 }, 0.7, 2.4),
      eye: new T.ShaderMaterial({ uniforms: { uLook: { value: new V3(0, 0, 1) }, uDilate: { value: 1 }, uGlow: { value: 1 }, uTime: U.shared.uTime }, vertexShader: EYE_VS, fragmentShader: EYE_FS }),
      beam: new T.MeshBasicMaterial({ color: new T.Color(1.2, 1.22, 1.3), transparent: true, opacity: 0.1, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide }),
    };
    const root = new T.Group();
    const float = new T.Group(); float.position.y = WI.eyeH; root.add(float);
    const eyeM = new T.Mesh(new T.SphereGeometry(1.9, 32, 20), mats.eye); float.add(eyeM);
    // lids: two shells that close over the eye
    const lidGeo = new T.SphereGeometry(2.0, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    const lidU = new T.Group(), lidD = new T.Group(); float.add(lidU); float.add(lidD);
    addMesh(lidGeo, mats.flesh, lidU);
    const ld = addMesh(lidGeo, mats.flesh, lidD); ld.rotation.x = Math.PI;
    // the broken halo
    const halo = new T.Group(); float.add(halo);
    for (let i = 0; i < 9; i++) {
      const m = addMesh(new T.TorusGeometry(3.3, 0.09, 4, 8, (Math.PI * 2 / 9) * 0.7), mats.ring, halo);
      m.rotation.z = (i / 9) * Math.PI * 2;
    }
    const halo2 = new T.Group(); float.add(halo2);
    for (let i = 0; i < 5; i++) {
      const m = addMesh(new T.TorusGeometry(4.1, 0.05, 3, 6, (Math.PI * 2 / 5) * 0.5), mats.ring, halo2);
      m.rotation.z = (i / 5) * Math.PI * 2 + 0.4;
    }
    // veils and long hanging tendrils down into the abyss
    const tendrils = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const piv = new T.Group(); piv.position.set(Math.cos(a) * 1.5, -1.2, Math.sin(a) * 1.5); float.add(piv);
      const len = 6 + (i % 3) * 2.2;
      addMesh(U.taperGeom(len, 0.22, 0.02, 5), i % 2 ? mats.flesh : mats.veil, piv);
      tendrils.push({ piv, a, ph: Math.random() * 6 });
    }
    // the gaze beam from the eye to the floor
    const beamGeo = new T.CylinderGeometry(0.06, 1.0, 1, 14, 1, true); beamGeo.translate(0, -0.5, 0);
    const beam = new T.Mesh(beamGeo, mats.beam); beam.renderOrder = 6; beam.visible = false; beam.frustumCulled = false;
    E.scene.add(beam);
    const beam2 = new T.Mesh(beamGeo, mats.beam); beam2.renderOrder = 6; beam2.visible = false; beam2.frustumCulled = false;
    E.scene.add(beam2);
    root.traverse((o) => { if (o.isMesh) o.castShadow = o.material !== mats.eye; });
    const glyph = E.makeGlyph(float, 3.0, 2.6);
    return { root, float, eyeM, lidU, lidD, halo, halo2, tendrils, mats, beams: [beam, beam2], glyph, splitNode: float };
  }

  // the choir: small floating eyes that orbit before it and fire volleys
  class ChoirEye {
    constructor(owner, i) {
      this.owner = owner; this.idx = i; this.type = 'eye';
      const mats = {
        core: U.stdMat({ color: 0x121217, roughness: 0.28, metalness: 0.75, emissive: 0x000000, envMap: U.world.envMap }, 0.7, 2.0),
        frag: U.stdMat({ color: 0x1a1a20, roughness: 0.4, metalness: 0.6, emissive: new T.Color(0, 0, 0) }, 0.6, 2.0),
        eye: new T.ShaderMaterial({ uniforms: { uLook: { value: new V3(0, 0, 1) }, uDilate: { value: 1.4 }, uGlow: { value: 1 }, uTime: U.shared.uTime }, vertexShader: EYE_VS, fragmentShader: EYE_FS }),
      };
      const root = new T.Group();
      const float = new T.Group(); float.position.y = 2.4; float.scale.setScalar(1.45); root.add(float);
      const core = addMesh(new T.OctahedronGeometry(0.5, 0), mats.core, float); core.scale.set(1.1, 1.3, 1.1);
      const ball = new T.Mesh(new T.SphereGeometry(0.34, 18, 12), mats.eye); ball.position.z = 0.28; float.add(ball);
      const ring = addMesh(new T.TorusGeometry(0.8, 0.03, 3, 18, Math.PI * 1.5), mats.frag, float); ring.rotation.x = Math.PI / 2 - 0.3;
      const bar = E.makeBar(root, 3.3, 0.6);
      const glyph = E.makeGlyph(root, 3.6, 0.8);
      this.rig = { root, float, core, ball, ring, mats, bar, glyph, splitNode: float };
      this.root = root; this.pos = root.position;
      this.vel = new V3(); this.knock = new V3(); this.pinSnap = new V3(); this.lockPos = new V3();
      this.tele = null; this.tele2 = [];
      root.visible = false; E.scene.add(root);
      this.alive = false; this.active = false;
    }
    spawn(ang) {
      this.ang = ang;
      this.maxHp = WI.eyeHp * E.hpMul; this.hp = this.maxHp; this.radius = 0.55;
      this.orbitPos(this.pos);
      this.facing = 0; this.state = 'arrive'; this.st = 0; this.animT = Math.random() * 6; this.timeScale = 1;
      this.flash = 0; this.flinch = 0; this.rootT = 0; this.token = false; this.didHit = false; this.barShow = 0;
      this.mark = 0; this.pinT = 0; this.grip = null; this.under = false; this.sink = 0; this.splitT = 0; this.splitDmg = 0; this.dreadDur = 0;
      this.cool = 2.2 + this.idx * 1.1 + Math.random();
      this.alive = true; this.active = true; this.root.visible = true; this.root.scale.setScalar(0.01);
      this.rig.glyph.visible = false; this.rig.bar.grp.visible = false;
      this.knock.set(0, 0, 0);
      E.list.push(this);
      FX.ring({ pos: this.pos, r0: 0.2, r1: 1.4, dur: 0.5, w0: 0.08, w1: 0.02, opacity: 0.7 });
    }
    orbitPos(out) { const o = WI.orbit; return out.set(o.x + Math.sin(this.ang) * WI.orbitR, 0, o.z + Math.cos(this.ang) * WI.orbitR * 0.75); }
    setState(s) { this.state = s; this.st = 0; this.didHit = false; }
    releaseToken() {} tryToken() { return true; }
    clearTeles() { if (this.tele) { this.tele.release(); this.tele = null; } for (const t of this.tele2) t.release(); this.tele2.length = 0; }
    think(dt, P) {
      const pp = P.pos;
      const want = this.orbitPos(_a);
      this.ang += dt * 0.16 * (this.owner.phase === 2 ? 1.4 : 1);
      if (this.rootT <= 0 && !this.grip) { this.pos.x = damp(this.pos.x, want.x, 2, dt); this.pos.z = damp(this.pos.z, want.z, 2, dt); }
      this.vel.set((want.x - this.pos.x) * 2, 0, (want.z - this.pos.z) * 2);
      this.facing = Math.atan2(pp.x - this.pos.x, pp.z - this.pos.z);
      switch (this.state) {
        case 'arrive': this.root.scale.setScalar(Math.max(0.01, U.easeOutBack(U.clamp(this.st / 0.6, 0, 1)))); if (this.st > 0.6) { this.root.scale.setScalar(1); this.setState('watch'); } break;
        case 'watch': {
          this.cool -= dt;
          if (this.cool <= 0 && P.alive && this.owner.state === 'watch') {
            this.setState('aim');
            this.lockYaw = this.facing;
            for (let i = 0; i < 3; i++) this.tele2.push(FX.telegraph({ pos: this.pos, r: 9, half: 0.03, yaw: this.facing + (i - 1) * 0.21, intensity: 0.9 }));
            U.audio.play('idolCharge', { gap: 0.1 });
          }
          break;
        }
        case 'aim': {
          const dur = 0.85 * E.teleMul, lock = 0.65 * E.teleMul;
          if (this.st < lock) this.lockYaw = this.facing;
          this.tele2.forEach((t, i) => {
            t.grp.position.set(this.pos.x, 0.07, this.pos.z); t.grp.rotation.y = this.lockYaw + (i - 1) * 0.21;
            t.mat.uniforms.uProgress.value = U.clamp(this.st / dur, 0, 1); t.mat.uniforms.uOpacity.value = 0.9 * U.clamp(this.st / 0.1, 0, 1);
            t.mat.uniforms.uLocked.value = this.st >= lock ? 1 : 0;
          });
          if (this.st >= dur) {
            this.clearTeles();
            E.fireFrom(this, this.pos, this.lockYaw, 3, 0.21);
            this.setState('watch'); this.cool = (this.owner.phase === 2 ? 3.0 : 3.8) + Math.random() * 1.5;
          }
          break;
        }
        case 'stagger': if (this.st > (this.staggerDur || 0.5)) this.setState('watch'); break;
        default: if (this.st > 1.5) this.setState('watch');
      }
      // look at Vaust
      this.rig.float.position.y = 2.4 + Math.sin(this.animT * 1.7 + this.idx) * 0.15 - this.flinch * 0.15;
      this.rig.ring.rotation.z += dt * 0.8;
      this.root.updateMatrixWorld(true);
      const look = this.rig.ball.worldToLocal(_b.copy(pp).setY(1.2)).normalize();
      this.rig.mats.eye.uniforms.uLook.value.copy(look);
      const ch = this.state === 'aim' ? U.clamp(this.st / 0.85, 0, 1) : 0;
      this.rig.mats.frag.emissive.setRGB(ch * 0.7, ch * 0.25, ch * 0.08);
      this.rig.mats.eye.uniforms.uGlow.value = 1 + ch * 1.5;
    }
    hide() { this.clearTeles(); this.root.visible = false; this.alive = false; this.active = false; }
  }

  class Witness extends Boss {
    constructor() {
      super('witness', buildWitness());
      this.cur = {};
      this.noClamp = true; this.noBlock = false;
      this.knockResist = 0; this.pinResist = 0.3;
      this.eyes = []; for (let i = 0; i < 4; i++) this.eyes.push(new ChoirEye(this, i));
      // fragments of the eclipse that fall into the courtyard
      const stone = U.stdMat({ color: 0x1d1d22, roughness: 0.55, metalness: 0.3, emissive: 0x000000, envMap: U.world.envMap }, 0.7, 2.0);
      const vein = new T.MeshBasicMaterial({ color: new T.Color(1.6, 1.62, 1.75) });
      this.monos = WI.monos.map(([x, z]) => {
        const g = new T.Group();
        const slab = addMesh(new T.BoxGeometry(1.6, 3.4, 0.6), stone, g, 0, 1.7, 0);
        slab.rotation.z = (Math.random() - 0.5) * 0.08;
        addMesh(new T.BoxGeometry(0.04, 2.6, 0.62), vein, g, 0.25, 1.6, 0, 0, 0, 0.2).castShadow = false;
        addMesh(new T.BoxGeometry(1.7, 0.08, 0.66), vein, g, 0, 3.3, 0).castShadow = false;
        const shade = new T.Mesh(new T.PlaneGeometry(1, 1), new T.ShaderMaterial({ uniforms: { uOpacity: { value: 0 } }, vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`, fragmentShader: SHADE_FS, transparent: true, depthWrite: false }));
        shade.renderOrder = 2; E.scene.add(shade); shade.visible = false;
        g.visible = false; E.scene.add(g);
        return { g, shade, home: new V3(x, 0, z), wall: { a: new V3(), b: new V3(), thick: 0.38, solid: false, active: false, monolith: true }, t: 0, tele: null, landed: false };
      });
      // tears of light: falling columns
      this.columns = [];
      for (let i = 0; i < 10; i++) {
        const geo = new T.CylinderGeometry(1, 1, 1, 18, 1, true); geo.translate(0, 0.5, 0);
        const m = new T.Mesh(geo, new T.ShaderMaterial({ uniforms: { uOpacity: { value: 0 } }, vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`, fragmentShader: COLUMN_FS, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide }));
        m.visible = false; m.renderOrder = 8; m.frustumCulled = false; E.scene.add(m);
        this.columns.push({ m, active: false });
      }
      this.gaze = { spot: new V3(), ring: null, beams: [], angA: 0, angB: Math.PI / 2 };
    }
    onSpawn() {
      this.setState('intro');
      this.cur = {}; this.judgment = 0; this.phase = 1; this.coreHurtT = 99; this.pendingPhase = false;
      this.rig.float.position.y = -14;
      this.pos.copy(WI.watchPos);
      this.tearT = 4.5;
      this.gaze.spot.set(0, 0, -4);
      for (const m of this.monos) { m.t = 0; m.landed = false; m.g.visible = false; m.wall.solid = false; }
    }
    resetExtra() {
      for (const e of this.eyes) e.hide();
      for (const m of this.monos) { m.g.visible = false; m.shade.visible = false; m.wall.solid = false; m.wall.active = false; if (m.tele) { m.tele.release(); m.tele = null; } }
      for (const c of this.columns) { c.active = false; c.m.visible = false; }
      this.endGaze();
      for (const b of this.rig.beams) b.visible = false;
      U.world.hollow = 0; U.world.wideTarget = 0;
      this.judgment = 0;
    }
    onDie() {
      this.endGaze();
      for (const e of this.eyes) if (e.alive) E.kill(e, {});
      U.ui.banner('The Lid Closes', 'nothing watches the courtyard now', 2.4);
    }
    // the seal objects to being watched: every eye is erased and it must blink
    onSealCast(center, R) {
      for (const e of this.eyes) if (e.alive) E.kill(e, { erase: true });
      if (this.state === 'watch' || this.state === 'phase') this.startBlink(true);
      else if (Math.hypot(this.pos.x - center.x, this.pos.z - center.z) <= R + this.radius) this.onSeal();
    }
    onGrab() { if (this.state === 'blink') { this.blinkExtra = (this.blinkExtra || 0) + 2; FX.ring({ pos: this.pos, r0: 3, r1: 2.2, dur: 0.4, w0: 0.1, w1: 0.03, opacity: 0.8 }); } }
    onHit(amount, o) {
      super.onHit(amount, o);
      this.coreHurtT = 0;
    }
    spawnEyes(n) {
      const base = Math.random() * Math.PI * 2;
      for (let i = 0; i < n; i++) { const e = this.eyes[i]; if (!e.alive && !e.active) { e.deadT = 0; e.spawn(base + (i / n) * Math.PI * 2); } }
      U.audio.play('spawn', { gap: 0.1 });
    }
    eyesAlive() { let n = 0; for (const e of this.eyes) if (e.alive) n++; return n; }
    startBlink(forced) {
      this.endGazeVisual();
      this.setState('blinkDown');
      this.blinkExtra = 0;
      this.judgment = Math.min(this.judgment, 0.5);
      U.audio.play('roar');
      if (forced) U.ui.banner('It Blinks', 'strike the eye while it rests on the stone', 2.2);
    }
    // is the line from the eye to p broken by a monolith or an open rift?
    hidden(p) {
      const eye = this.pos;
      for (const m of this.monos) {
        if (!m.wall.solid) continue;
        const w = m.wall;
        const ex = (w.b.x - w.a.x) * 0.12, ez = (w.b.z - w.a.z) * 0.12;
        if (segX(eye.x, eye.z, p.x, p.z, w.a.x - ex, w.a.z - ez, w.b.x + ex, w.b.z + ez)) return true;
      }
      for (const tr of U.skills.tears) {
        if (!tr.open) continue;
        // intersect segment with the rift's arc
        const dx = p.x - eye.x, dz = p.z - eye.z, fx = eye.x - tr.origin.x, fz = eye.z - tr.origin.z;
        const a = dx * dx + dz * dz, b = 2 * (fx * dx + fz * dz), c = fx * fx + fz * fz - tr.r * tr.r;
        const disc = b * b - 4 * a * c;
        if (disc < 0) continue;
        for (const s of [-1, 1]) {
          const t = (-b + s * Math.sqrt(disc)) / (2 * a);
          if (t < 0 || t > 1) continue;
          const hx = eye.x + dx * t - tr.origin.x, hz = eye.z + dz * t - tr.origin.z;
          const ang = tr.aimYaw + U.angleDiff(tr.aimYaw, Math.atan2(hx, hz));
          if (ang >= tr.y0 && ang <= tr.y1) return true;
        }
      }
      return false;
    }
    endGazeVisual() {
      const G = this.gaze;
      if (G.ring) { G.ring.release(); G.ring = null; }
      for (const t of G.beams) this.dropTele(t);
      G.beams.length = 0;
      for (const b of this.rig.beams) b.visible = false;
    }
    endGaze() { this.endGazeVisual(); this.judgment = 0; }

    ai(dt, P) {
      const C = WI, pp = P.pos, st = this.st;
      this.coreHurtT += dt;
      const k = this.hp / this.maxHp;
      if (this.phase === 1 && k <= 0.5 && !this.pendingPhase) this.pendingPhase = true;
      switch (this.state) {
        case 'intro': {
          this.invuln = true;
          const r = U.easeOutCubic(U.clamp(st / 2.4, 0, 1));
          this.rig.float.position.y = U.lerp(-14, C.eyeH, r);
          U.world.hollow = r;
          if (st > 0.3 && !this.didHit) {
            this.didHit = true;
            U.audio.play('tear');
            // the fragments fall: warned first
            for (const m of this.monos) { m.t = 0; m.landed = false; m.g.visible = false; m.tele = FX.telegraph({ pos: m.home, r: 1.4, color: PALE, intensity: 1.0 }); }
          }
          if (st > 3.2) { this.invuln = false; this.setState('watch'); this.spawnEyes(C.eyes); this.startGaze(); }
          break;
        }
        case 'watch': {
          if (this.pendingPhase) { this.pendingPhase = false; this.endGazeVisual(); this.setState('phase'); U.audio.play('roar'); break; }
          this.updateGaze(dt, P);
          // eyes revive in the second phase if the core goes untouched
          if (this.phase === 2) for (const e of this.eyes) {
            if (e.alive || e.active) continue;
            e.deadT = (e.deadT || 0) + dt;
            if (e.deadT > C.revive && this.coreHurtT > C.revive && this.eyesAlive() > 0) { e.deadT = 0; e.spawn(Math.random() * Math.PI * 2); }
          }
          if (this.eyesAlive() === 0) { this.startBlink(false); break; }
          this.tearT -= dt;
          if (this.tearT <= 0 && P.alive) { this.rainTears(P); this.tearT = (this.phase === 2 ? 4.2 : 6.0) + Math.random() * 1.5; }
          break;
        }
        case 'phase': {
          this.invuln = st < 1.6;
          if (st > 0.6 && !this.didHit) {
            this.didHit = true; this.phase = 2;
            U.world.addShake(0.3);
            U.ui.banner('The Lid Opens', 'it looks in two directions at once', 2.4);
            FX.flash(_a.set(0, 3, -11), 14, 14, 0.4);
          }
          if (st > 1.8) { this.invuln = false; this.setState('watch'); this.startGaze(); }
          break;
        }
        case 'blinkDown': {
          const r = U.easeInOutCubic ? U.easeInOutCubic(U.clamp(st / 0.8, 0, 1)) : U.smooth(U.clamp(st / 0.8, 0, 1));
          this.pos.lerpVectors(C.watchPos, C.blinkPos, r);
          this.rig.float.position.y = U.lerp(C.eyeH, C.blinkH, r);
          if (st > 0.8) { this.setState('blink'); U.world.addShake(0.3); U.audio.play('slamLand'); FX.crack(_a.set(0, 0, -11.2), 3.5, 2, 0.4); }
          break;
        }
        case 'blink': {
          this.vuln = 2;
          if (st > C.blink + (this.blinkExtra || 0)) { this.vuln = 1; this.setState('blinkUp'); }
          break;
        }
        case 'blinkUp': {
          const r = U.smooth(U.clamp(st / 0.8, 0, 1));
          this.pos.lerpVectors(C.blinkPos, C.watchPos, r);
          this.rig.float.position.y = U.lerp(C.blinkH, C.eyeH, r);
          if (st > 0.8) {
            this.setState(this.pendingPhase ? 'watch' : 'watch');
            this.spawnEyes(this.phase === 2 ? C.eyes2 : C.eyes);
            this.startGaze();
            this.tearT = 2.5;
          }
          break;
        }
        case 'recover': {
          // after being broken it drifts back up
          const r = U.smooth(U.clamp(st / 0.8, 0, 1));
          this.pos.lerpVectors(this.brokenFrom || C.watchPos, C.watchPos, r);
          this.rig.float.position.y = U.lerp(this.brokenH || C.eyeH, C.eyeH, r);
          if (st > 0.8) { this.setState('watch'); if (this.eyesAlive() === 0) this.spawnEyes(this.phase === 2 ? C.eyes2 : C.eyes); this.startGaze(); }
          break;
        }
      }
      this.vel.set(0, 0, 0);
      this.faceTo(pp.x, pp.z, 1.5, dt);
    }
    onBreak() {
      this.endGazeVisual();
      this.brokenFrom = this.pos.clone(); this.brokenH = this.rig.float.position.y;
    }
    startGaze() {
      const G = this.gaze;
      this.endGazeVisual();
      if (this.phase === 1) {
        G.ring = heldRing({ pos: G.spot, max: WI.gazeR + 0.4, w: 0.1, color: PALE, intensity: 1.2, opacity: 0, r: WI.gazeR, fill: 0.2 });
        G.ring.ro.pos = G.spot; // follow the moving spot
      } else {
        for (let i = 0; i < 4; i++) G.beams.push(this.addTele({ pos: WI.beamPivot, r: WI.beamLen, half: WI.beamHalf, yaw: 0, lane: true, color: PALE, intensity: 1.1 }));
      }
    }
    updateGaze(dt, P) {
      const C = WI, G = this.gaze, pp = P.pos;
      let inGaze = false;
      const eyeW = this.rig.float.getWorldPosition(_c);
      if (this.phase === 1) {
        // the spot follows him, a little slow
        const dx = pp.x - G.spot.x, dz = pp.z - G.spot.z, d = Math.hypot(dx, dz);
        const sp = C.gazeSpeed * (E.loop >= 2 ? 1.2 : 1);
        if (d > 0.01) { const s = Math.min(d, sp * dt); G.spot.x += dx / d * s; G.spot.z += dz / d * s; }
        inGaze = d < C.gazeR;
        if (G.ring) G.ring.set(C.gazeR, 0.1, 0.85);
        this.aimBeam(this.rig.beams[0], eyeW, G.spot, C.gazeR);
        this.rig.beams[1].visible = false;
      } else {
        // two beams sweeping like the hands of a clock
        G.angA += C.beamSpeedA * dt * (E.loop >= 2 ? 1.2 : 1); G.angB += C.beamSpeedB * dt;
        const yaws = [G.angA, G.angA + Math.PI, G.angB, G.angB + Math.PI];
        G.beams.forEach((t, i) => {
          t.grp.position.set(C.beamPivot.x, 0.07, C.beamPivot.z); t.grp.rotation.y = yaws[i];
          t.mat.uniforms.uProgress.value = 1; t.mat.uniforms.uOpacity.value = 0.9; t.mat.uniforms.uLocked.value = 1;
          if (inLane(pp, C.beamPivot, yaws[i], C.beamLen, C.beamHalf)) inGaze = true;
        });
        for (let i = 0; i < 2; i++) {
          const yaw = i ? G.angB : G.angA;
          this.aimBeam(this.rig.beams[i], eyeW, _d.set(C.beamPivot.x + Math.sin(yaw) * 6, 0, C.beamPivot.z + Math.cos(yaw) * 6), 0.9);
        }
      }
      const hid = this.hidden(pp), frozen = !!U.skills.fieldAt(pp);
      const rate = 1 / (this.phase === 2 ? C.judge2 : C.judge);
      if (P.alive && inGaze && !hid && !frozen) this.judgment += dt * rate;
      else this.judgment = Math.max(0, this.judgment - dt * 0.7);
      if (inGaze && (hid || frozen) && Math.random() < dt * 6) FX.sparks(_a.copy(pp).setY(1.6), 1, { speed: 0.6, life: 0.4, size: 0.06, grav: 0 });
      U.world.grade.uniforms.uFlash.value = Math.max(U.world.grade.uniforms.uFlash.value * 0.9, this.judgment * 0.1);
      if (this.judgment >= 1) {
        // sentence: judged, and his powers taken from him for a moment
        this.judgment = 0;
        if (hurt(C.sentenceDmg, eyeW)) {
          U.skills.lock = C.lock;
          if (U.ui.flicker) U.ui.flicker(C.lock);
          U.audio.play('sentence');
          FX.flash(_a.copy(pp).setY(2), 30, 8, 0.4);
          FX.ring({ pos: pp, r0: 0.3, r1: 2.2, dur: 0.5, w0: 0.3, w1: 0.03, opacity: 1, intensity: 1.6 });
          U.ui.banner('Judged', 'the seal takes back its gifts for a moment', 1.6);
        }
      }
    }
    aimBeam(beam, from, to, r) {
      beam.visible = true;
      const len = from.distanceTo(_b.copy(to).setY(0));
      beam.position.copy(from);
      beam.scale.set(r, len, r);
      _q.setFromUnitVectors(_a.set(0, -1, 0), _b.sub(from).normalize());
      beam.quaternion.copy(_q);
    }
    rainTears(P) {
      const C = WI, pts = [];
      const mode = Math.floor(Math.random() * 3);
      if (mode === 0) {
        // a row across the courtyard through Vaust
        const yaw = Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z) + Math.PI / 2;
        for (let i = -2; i <= 2; i++) pts.push(new V3(P.pos.x + Math.sin(yaw) * i * 2.5, 0, P.pos.z + Math.cos(yaw) * i * 2.5));
      } else if (mode === 1) {
        pts.push(P.pos.clone());
        for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; pts.push(new V3(P.pos.x + Math.sin(a) * 3.0, 0, P.pos.z + Math.cos(a) * 3.0)); }
      } else {
        for (let i = 0; i < 6; i++) { const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 5; pts.push(new V3(P.pos.x + Math.sin(a) * r, 0, P.pos.z + Math.cos(a) * r)); }
        pts.push(P.pos.clone().add(_a.copy(P.vel).setY(0).multiplyScalar(0.8)));
      }
      U.audio.play('eruptMark', { gap: 0.1 });
      pts.forEach((p, i) => {
        U.arenaClamp(p, 0.6); p.y = 0;
        const tele = FX.telegraph({ pos: p, r: C.tearR, color: PALE, intensity: 1.0 });
        const delay = C.tearDelay * E.teleMul + i * 0.08;
        const col = this.columns.find((c) => !c.active);
        if (col) col.active = true;
        B.hazards.push({
          t: 0, pos: p, timeScaled: true,
          update(dt) {
            this.t += dt;
            if (this.t < delay) {
              tele.mat.uniforms.uProgress.value = this.t / delay; tele.mat.uniforms.uOpacity.value = U.clamp(this.t / 0.1, 0, 1); tele.mat.uniforms.uLocked.value = 1;
              return false;
            }
            if (!this.struck) {
              this.struck = true; tele.release();
              const P2 = U.player;
              if (P2.alive && Math.hypot(P2.pos.x - p.x, P2.pos.z - p.z) < C.tearR + P2.radius * 0.5) hurt(C.tearDmg, p);
              FX.ring({ pos: p, r0: 0.2, r1: C.tearR + 0.5, dur: 0.35, w0: 0.2, w1: 0.03, opacity: 0.9, intensity: 1.4 });
              FX.sparks(_a.copy(p).setY(0.3), 10, { speed: 4, up: 3, life: 0.4, size: 0.08, grav: 6 });
              FX.crack(p, 1.4, 1.2, 0.3);
              U.audio.play('erupt', { gap: 0.05 });
              if (col) { col.m.visible = true; col.m.position.set(p.x, 0, p.z); col.m.scale.set(C.tearR * 0.8, 7, C.tearR * 0.8); }
            }
            const k = (this.t - delay) / 0.45;
            if (col) col.m.material.uniforms.uOpacity.value = Math.max(0, 1 - k) * 0.9;
            if (k >= 1) { if (col) { col.active = false; col.m.visible = false; } return true; }
            return false;
          },
          kill() { tele.release(); if (col) { col.active = false; col.m.visible = false; } },
        });
      });
    }
    // monoliths, eyes' upkeep and beams keep updating in world time
    global(hdt, dt) {
      if (!this.active && !this.monos.some((m) => m.g.visible)) return;
      for (const m of this.monos) {
        if (m.tele && !m.landed) {
          m.t += hdt;
          const fall = 1.3;
          m.tele.mat.uniforms.uProgress.value = U.clamp(m.t / fall, 0, 1); m.tele.mat.uniforms.uOpacity.value = 1; m.tele.mat.uniforms.uLocked.value = 1;
          const yaw = Math.atan2(m.home.x - this.pos.x, m.home.z - this.pos.z) + Math.PI / 2;
          if (m.t > fall - 0.45) {
            m.g.visible = true;
            const k = U.clamp((m.t - (fall - 0.45)) / 0.45, 0, 1);
            m.g.position.set(m.home.x, U.lerp(22, 0, U.easeInCubic(k)), m.home.z);
            m.g.rotation.set(0, yaw, 0);
          }
          if (m.t >= fall) {
            m.landed = true; m.tele.release(); m.tele = null;
            const P = U.player;
            if (P.alive && Math.hypot(P.pos.x - m.home.x, P.pos.z - m.home.z) < 1.5) hurt(20, m.home);
            U.world.addShake(0.25); U.audio.play('slamLand', { gap: 0.05 });
            FX.crack(m.home, 2.4, 3, 0.4); FX.shards(_a.copy(m.home).setY(0.3), 12, { speed: 5, up: 3, size: 0.14, life: 1.0, colors: [new T.Color(0.12, 0.12, 0.14)] });
            FX.mist(_a.copy(m.home).setY(0.4), 5, { spread: 0.8, rise: 0.5, out: 1.5, life: 1.0, size: 1.1, a: 0.22 });
            const w = m.wall, sx = Math.sin(yaw) * 0.8, sz = Math.cos(yaw) * 0.8;
            w.a.set(m.home.x - sx, 0, m.home.z - sz); w.b.set(m.home.x + sx, 0, m.home.z + sz);
            w.solid = true; w.active = true;
            if (B.walls.indexOf(w) < 0) B.walls.push(w);
            // shade on the far side, away from the eye
            const away = Math.atan2(m.home.x - this.pos.x, m.home.z - this.pos.z);
            m.shade.visible = true;
            m.shade.position.set(m.home.x + Math.sin(away) * 2.6, 0.08, m.home.z + Math.cos(away) * 2.6);
            m.shade.rotation.set(-Math.PI / 2, 0, away + Math.PI);
            m.shade.scale.set(1.9, 4.6, 1);
          }
        }
        if (m.shade.visible) m.shade.material.uniforms.uOpacity.value = this.alive ? 0.55 : Math.max(0, m.shade.material.uniforms.uOpacity.value - dt);
        // when the Witness is gone the fragments sink back into the stone
        if (!this.alive && m.landed && m.g.visible) {
          m.g.position.y -= dt * 2.2;
          if (m.wall.solid) { m.wall.solid = false; const i = B.walls.indexOf(m.wall); if (i >= 0) B.walls.splice(i, 1); }
          if (m.g.position.y < -4) { m.g.visible = false; m.shade.visible = false; }
        }
      }
      if (!this.alive) U.world.hollow = Math.max(0, U.world.hollow - dt * 0.5);
      U.world.wideTarget = this.alive ? 1 : 0;
    }

    animate(dt, P) {
      const r = this.rig, s = this.state, st = this.st, t = this.animT;
      // lids: open while watching, shut while it blinks or is broken
      const shut = s === 'blink' || s === 'broken' ? 1 : s === 'blinkDown' ? U.clamp(st / 0.5, 0, 1) : s === 'blinkUp' ? 1 - U.clamp(st / 0.6, 0, 1) : s === 'intro' ? 1 - U.clamp((st - 1.6) / 0.8, 0, 1) : 0;
      this.lid = damp(this.lid == null ? 1 : this.lid, shut, 12, dt);
      const open = 1 - this.lid;
      r.lidU.rotation.x = -U.lerp(1.15, 0.0, this.lid);
      r.lidD.rotation.x = U.lerp(1.15, 0.0, this.lid);
      r.halo.rotation.z += dt * 0.12; r.halo2.rotation.z -= dt * 0.08;
      if (s === 'broken') r.float.position.y = damp(r.float.position.y, WI.blinkH + 0.4, 3, dt);
      r.float.rotation.z = Math.sin(t * 0.4) * 0.05;
      for (const td of r.tendrils) td.piv.rotation.set(Math.sin(t * 0.7 + td.ph) * 0.15, 0, Math.cos(t * 0.5 + td.ph) * 0.15 + Math.cos(td.a) * 0.15);
      this.root.updateMatrixWorld(true);
      const look = r.eyeM.worldToLocal(_b.copy(P.pos).setY(1.2)).normalize();
      r.mats.eye.uniforms.uLook.value.lerp(look, 1 - Math.exp(-6 * dt)).normalize();
      r.mats.eye.uniforms.uDilate.value = 1 + this.judgment * 1.5;
      r.mats.eye.uniforms.uGlow.value = (1 + this.judgment * 1.2) * (0.3 + 0.7 * open);
      if (s !== 'watch') for (const b of r.beams) b.visible = false;
    }
    animDeath(t, dt) {
      const r = this.rig;
      this.lid = damp(this.lid || 0, 1, 6, dt);
      r.lidU.rotation.x = -U.lerp(1.15, 0, this.lid); r.lidD.rotation.x = U.lerp(1.15, 0, this.lid);
      r.float.position.y -= dt * 3 * Math.min(1, t);
      for (const b of r.beams) b.visible = false;
    }
  }
  function segX(ax, az, bx, bz, cx, cz, dx, dz) {
    const d = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
    if (Math.abs(d) < 1e-9) return false;
    const u = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / d;
    const v = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / d;
    return u >= 0 && u <= 1 && v >= 0 && v <= 1;
  }

  // ======================================================================================
  //  registry / lifecycle
  // ======================================================================================
  B.KINDS = { gaoler: Gaoler, witness: Witness, sealwright: Sealwright };
  B.init = function (scene) {
    B.scene = scene;
    for (const k in B.KINDS) B.instances[k] = new B.KINDS[k]();
  };
  B.spawn = function (kind) {
    const b = B.instances[kind];
    const pos = kind === 'witness' ? new V3(0, 0, -14.2) : kind === 'gaoler' ? new V3(0, 0, -5) : new V3(0, 0, -6);
    b.spawn(pos);
    return b;
  };
  B.clearHazards = function () {
    for (const h of B.hazards) if (h.kill) h.kill();
    B.hazards.length = 0;
    if (U.player.tether) U.player.tether = null;
  };
  B.reset = function () {
    B.clearHazards();
    for (const k in B.instances) {
      const b = B.instances[k];
      b.hide();
      if (b.resetExtra) b.resetExtra();
    }
    B.current = null;
    B.walls.length = 0;
    B.arenaLimit = 99;
    U.ui.showBoss(null);
  };
  B.update = function (dt) {
    const frozen = U.skills.freeze > 0;
    const hdt = frozen ? 0 : dt;
    U.player.slowField = false;
    for (let i = B.hazards.length - 1; i >= 0; i--) {
      const h = B.hazards[i];
      const ts = h.pos ? U.skills.timeScaleAt(h.pos) : 1;
      if (h.update(hdt * (h.timeScaled ? ts : 1))) B.hazards.splice(i, 1);
    }
    for (const k in B.instances) { const b = B.instances[k]; if (b.global) b.global(hdt, dt); }
  };
  B.onSealCast = function (center, R) {
    const b = B.current;
    if (!b || !b.alive) return;
    if (b.onSealCast) { b.onSealCast(center, R); return; }
    if (Math.hypot(b.pos.x - center.x, b.pos.z - center.z) <= R + b.radius) b.onSeal();
  };
  B.onTetherStrain = function (t) {
    FX.sparks(_a.copy(U.player.pos).setY(1.0), 8, { speed: 3, color: AMBER, life: 0.3, size: 0.08 });
    U.audio.play('chain', { gap: 0.05 });
    U.world.addShake(0.08);
  };
  // walls and the erased courtyard edge (Sealwright)
  B.clampPlayer = function (p, r) {
    if (B.arenaLimit < 90) {
      const d = Math.hypot(p.x, p.z), lim = B.arenaLimit - r;
      if (d > lim) { p.x *= lim / d; p.z *= lim / d; }
    }
    for (const w of B.walls) {
      if (!w.solid) continue;
      const abx = w.b.x - w.a.x, abz = w.b.z - w.a.z, l2 = abx * abx + abz * abz || 1e-6;
      const t = U.clamp(((p.x - w.a.x) * abx + (p.z - w.a.z) * abz) / l2, 0, 1);
      const cx = w.a.x + abx * t, cz = w.a.z + abz * t;
      const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz), min = r + w.thick;
      if (d < min) {
        if (d > 1e-4) { p.x = cx + dx / d * min; p.z = cz + dz / d * min; }
        else { p.x = cx - abz / Math.sqrt(l2) * min; p.z = cz + abx / Math.sqrt(l2) * min; }
      }
    }
  };
  // does a straight path from a to b cross a solid wall? (walls block the fold and projectiles)
  B.blocked = function (a, b) {
    for (const w of B.walls) {
      if (!w.solid) continue;
      if (segIntersect(a.x, a.z, b.x, b.z, w.a.x, w.a.z, w.b.x, w.b.z)) return true;
    }
    return false;
  };
  function segIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
    const d = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
    if (Math.abs(d) < 1e-9) return false;
    const u = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / d;
    const v = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / d;
    return u >= 0 && u <= 1 && v >= 0 && v <= 1;
  }
  B._h = { dmg, tl, hurt, addMesh, inSector, inLane, segDist2D, damp, rimPoint, layChain, AMBER, CRIMSON, PALE };
})(window.U);
