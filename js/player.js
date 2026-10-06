/* UNHALLOWED — player controller: camera-relative movement, cursor aiming, spectral dash,
   two-hit sword combo with swept hit arcs, skill input, damage and death. */
'use strict';
(function (U) {
  const T = THREE;
  const V3 = T.Vector3;
  const FX = U.fx;
  const IN = U.input;

  const P = (U.player = {});
  P.TUNE = {
    maxHp: 150, speed: 5.6, radius: 0.4,
    dodgeDist: 5.0, dodgeDur: 0.28, dodgeIframe: 0.2, dodgeRecharge: 3.0, maxCharges: 3,
    hurtProtect: 0.6,
    s1Dmg: 16, s1Range: 2.7, s2Dmg: 25, s2Range: 2.95, handDmg: 10,
    comboReset: 0.45,
  };

  P.init = function (scene) {
    P.rig = new U.Vaust(scene);
    P.pos = new V3();
    P.vel = new V3();
    P.aim = new V3(0, 0, -5);
    P.upgrades = { widen: 0, hands: 0, absence: 0 };
    P.reset();
  };

  P.reset = function () {
    const Tn = P.TUNE;
    P.pos.set(0, 0, 2.5);
    P.vel.set(0, 0, 0);
    P.facing = Math.PI; // facing north (-Z), toward the eclipse
    P.radius = Tn.radius;
    P.hp = Tn.maxHp; P.maxHp = Tn.maxHp;
    P.alive = true; P.deadT = -1;
    P.charges = Tn.maxCharges; P.chargeT = 0;
    P.dodge = null; P.dodgeCooldown = 0;
    P.protect = 0; P.hurt = 0;
    P.attack = null; P.combo = 0; P.comboTimer = 0; P.queued = false;
    P.gesture = null;
    P.aiming = null; // E/T held for preview
    P.buffer = null; // buffered skill during dodge
    P.upgrades.widen = 0; P.upgrades.hands = 0; P.upgrades.absence = 0;
    P.lastMove = new V3(0, 0, -1);
    P.rig.reset(P.pos);
    P.rig.setVisible(true);
    P.stepT = 0;
  };

  P.rechargeTime = function () { return P.TUNE.dodgeRecharge * Math.pow(0.8, P.upgrades.absence); };
  P.invulnerable = function () { return (P.dodge && P.dodge.t < P.TUNE.dodgeIframe) || P.protect > 0; };

  P.setGesture = function (g) { g.t = 0; P.gesture = g; };

  const _mv = new V3(), _aimDir = new V3(), _tmp = new V3(), _tmp2 = new V3();

  P.update = function (dt) {
    const Tn = P.TUNE;
    const W = U.world;
    // ---- aim: ray from cursor onto the floor ----
    if (IN.mouse.seen) W.mouseGround(IN.mouse.ndcX, IN.mouse.ndcY, 0, P.aim);
    W.reticle.position.set(P.aim.x, 0.07, P.aim.z);
    W.reticle.visible = P.alive && IN.mouse.seen;
    W.reticle.rotation.z += dt * 0.6;
    W.heroLight.position.set(P.pos.x + Math.sin(P.facing) * 0.6, 2.3, P.pos.z + Math.cos(P.facing) * 0.6 + 0.4);

    P.protect = Math.max(0, P.protect - dt);
    P.hurt = Math.max(0, P.hurt - dt);

    // ---- dodge charges recharge sequentially ----
    if (P.charges < Tn.maxCharges) {
      P.chargeT += dt / P.rechargeTime();
      if (P.chargeT >= 1) { P.charges++; P.chargeT = P.charges < Tn.maxCharges ? P.chargeT - 1 : 0; if (U.ui) U.ui.onCharge(); }
    } else P.chargeT = 0;

    if (!P.alive) {
      P.deadT += dt;
      P.vel.multiplyScalar(Math.exp(-8 * dt));
      animate(dt);
      return;
    }

    // ---- movement input (camera is fixed facing north: W = -Z) ----
    let ix = 0, iz = 0;
    if (IN.down('KeyW') || IN.down('ArrowUp')) iz -= 1;
    if (IN.down('KeyS') || IN.down('ArrowDown')) iz += 1;
    if (IN.down('KeyA') || IN.down('ArrowLeft')) ix -= 1;
    if (IN.down('KeyD') || IN.down('ArrowRight')) ix += 1;
    const il = Math.hypot(ix, iz);
    if (il > 0) { ix /= il; iz /= il; P.lastMove.set(ix, 0, iz); }

    _aimDir.set(P.aim.x - P.pos.x, 0, P.aim.z - P.pos.z);
    const aimLen = _aimDir.length();
    if (aimLen > 0.05) _aimDir.multiplyScalar(1 / aimLen); else U.dirFromAngle(P.facing, _aimDir);
    const aimYaw = Math.atan2(_aimDir.x, _aimDir.z);

    // ---- dodge ----
    if (IN.hit('ShiftLeft') || IN.hit('ShiftRight') || IN.hit('Space')) tryDodge(ix, iz, il);

    if (P.dodge) {
      const d = P.dodge;
      d.t += dt;
      const p = U.clamp(d.t / Tn.dodgeDur, 0, 1);
      const e = 1 - Math.pow(1 - p, 3);
      const target = _tmp.copy(d.from).addScaledVector(d.dir, Tn.dodgeDist * e);
      P.vel.copy(target).sub(P.pos).divideScalar(Math.max(dt, 1e-4));
      P.pos.copy(target);
      clampArena(P.pos, P.radius);
      // afterimages and a trailing white wake
      d.ghostT -= dt;
      if (d.ghostT <= 0 && p < 0.85) { d.ghostT = 0.05; FX.afterimage(0.55 * (1 - p * 0.6), 0.36); }
      FX.mist(_tmp2.copy(P.pos).setY(0.5), 1, { spread: 0.25, rise: 0.2, out: 0.1, life: 0.5, size: 0.7, a: 0.16, vel: _tmp.copy(d.dir).multiplyScalar(-1.5) });
      if (Math.random() < 0.7) FX.sparks(_tmp2.copy(P.pos).setY(0.4 + Math.random() * 1.4), 1, { speed: 1.5, dir: _tmp.copy(d.dir).negate(), bias: 0.7, life: 0.3, size: 0.07, grav: 0 });
      P.facing = U.dampAngle(P.facing, Math.atan2(d.dir.x, d.dir.z), 30, dt);
      if (d.t >= Tn.dodgeDur) {
        P.dodge = null;
        P.vel.multiplyScalar(0.25);
        if (P.buffer && P.buffer.t > 0) { const b = P.buffer; P.buffer = null; castSkill(b.key); }
      }
    } else {
      // ---- normal movement ----
      let speedMul = 1;
      if (P.attack) {
        const S = U.SLASH[P.attack.kind];
        const p = P.attack.t / S.dur;
        speedMul = p < S.b ? 0.5 : 0.72;
      }
      if (P.gesture && (P.gesture.kind === 'R' || P.gesture.kind === 'Y') && P.gesture.t < P.gesture.holdT) speedMul = Math.min(speedMul, 0.6);
      const sp = Tn.speed * speedMul;
      _mv.set(ix * sp, 0, iz * sp);
      const k = 1 - Math.exp(-22 * dt);
      P.vel.x += (_mv.x - P.vel.x) * k;
      P.vel.z += (_mv.z - P.vel.z) * k;
      P.pos.addScaledVector(P.vel, dt);
      clampArena(P.pos, P.radius);
      // body blocking: don't walk through enemies
      for (const e of U.enemies.list) {
        if (!e.alive || e.state === 'arrive') continue;
        const dx = P.pos.x - e.pos.x, dz = P.pos.z - e.pos.z;
        const d = Math.hypot(dx, dz), min = P.radius + e.radius;
        if (d < min && d > 1e-4) { P.pos.x += (dx / d) * (min - d); P.pos.z += (dz / d) * (min - d); }
      }
      // facing follows the cursor; locked during the active part of a swing
      const locked = P.attack && P.attack.t >= U.SLASH[P.attack.kind].dur * U.SLASH[P.attack.kind].a && P.attack.t < U.SLASH[P.attack.kind].dur * U.SLASH[P.attack.kind].b;
      if (!locked) P.facing = U.dampAngle(P.facing, aimYaw, 28, dt);
    }

    if (P.buffer) { P.buffer.t -= dt; if (P.buffer.t <= 0) P.buffer = null; }

    // ---- skills ----
    handleSkills(dt);

    // ---- basic attack ----
    P.comboTimer += dt;
    const busy = P.gesture && (P.gesture.kind === 'R' || P.gesture.kind === 'Y') && P.gesture.t < P.gesture.holdT;
    if (!P.dodge && !busy) {
      const want = IN.mouse.down || IN.mouse.pressed;
      if (!P.attack) {
        if (want) startAttack(aimYaw);
      } else {
        const S = U.SLASH[P.attack.kind];
        const p = P.attack.t / S.dur;
        if (IN.mouse.pressed && p > S.a) P.queued = true;
        if ((want || P.queued) && p >= (P.attack.kind === 'slash1' ? 0.62 : 0.8)) startAttack(aimYaw);
      }
    }
    updateAttack(dt);

    if (P.gesture) { P.gesture.t += dt; if (P.gesture.t > (P.gesture.outT || 0.6)) P.gesture = null; }
    animate(dt);
    footsteps(dt);
  };

  function clampArena(p, r) { U.arenaClamp(p, r); }
  P.clampArena = clampArena;

  function tryDodge(ix, iz, il) {
    if (P.dodge || P.charges <= 0) return;
    const Tn = P.TUNE;
    const dir = new V3();
    if (il > 0) dir.set(ix, 0, iz);
    else dir.set(P.aim.x - P.pos.x, 0, P.aim.z - P.pos.z);
    if (dir.lengthSq() < 1e-4) U.dirFromAngle(P.facing, dir);
    dir.normalize();
    if (P.charges === Tn.maxCharges) P.chargeT = 0;
    P.charges--;
    // cancel attack / recovery
    if (P.attack) { FX.crescentRelease(P.attack.cres); P.attack = null; }
    P.queued = false;
    P.dodge = { t: 0, dir, from: P.pos.clone(), ghostT: 0 };
    FX.afterimage(0.75, 0.42);
    FX.ring({ pos: P.pos, r0: 0.3, r1: 1.4, dur: 0.3, w0: 0.1, w1: 0.02, opacity: 0.7 });
    FX.mist(_tmp.copy(P.pos).setY(0.3), 4, { spread: 0.4, rise: 0.3, out: 0.8, life: 0.6, size: 0.9, a: 0.2 });
    U.audio.play('dodge');
    if (U.ui) U.ui.onDodge();
  }

  // ---------------- skills input ----------------
  const TARGETED = { E: true, T: true };
  function handleSkills(dt) {
    const S = U.skills;
    // right click cancels a held E/T preview
    if (P.aiming && IN.mouse.rightPressed) { P.aiming = null; S.hidePreview(); }
    for (const key of S.KEYS) {
      const code = 'Key' + key;
      if (TARGETED[key]) {
        if (IN.hit(code) && !P.aiming) {
          if (S.ready(key)) P.aiming = { key, t: 0 };
          else if (U.ui) U.ui.onNotReady(key);
        }
        if (P.aiming && P.aiming.key === key) {
          P.aiming.t += dt;
          S.showPreview(key, P.aim);
          if (IN.up(code) || !IN.down(code)) {
            P.aiming = null; S.hidePreview();
            castSkill(key);
          }
        }
      } else if (IN.hit(code)) {
        if (!S.ready(key)) { if (U.ui) U.ui.onNotReady(key); continue; }
        castSkill(key);
      }
    }
  }

  function castSkill(key) {
    const S = U.skills;
    if (!P.alive || !S.ready(key)) return;
    if (P.dodge) { P.buffer = { key, t: 0.3 }; return; }
    const heavy = key === 'R' || key === 'Y';
    if (P.gesture && (P.gesture.kind === 'R' || P.gesture.kind === 'Y') && P.gesture.t < P.gesture.holdT) { P.buffer = { key, t: 0.4 }; return; }
    if (heavy && P.attack) { FX.crescentRelease(P.attack.cres); P.attack = null; }
    // face the cursor immediately for directional casts
    P.facing = Math.atan2(P.aim.x - P.pos.x, P.aim.z - P.pos.z);
    S.cast(key, P.aim);
  }
  P.castSkill = castSkill;

  // ---------------- basic attack ----------------
  function startAttack(aimYaw) {
    if (P.comboTimer > P.TUNE.comboReset && !P.attack) P.combo = 0;
    const kind = P.combo === 0 ? 'slash1' : 'slash2';
    P.combo = (P.combo + 1) % 2;
    if (P.attack) FX.crescentRelease(P.attack.cres);
    P.facing = aimYaw;
    P.attack = { kind, t: 0, hit: new Set(), handHit: new Set(), cres: null, swung: false, prevYaw: null, handDone: false };
    P.queued = false;
  }

  const _R = new V3();
  function bladeYawBody(S, theta) {
    _R.set(-1, S.tilt, 0).normalize();
    return Math.atan2(Math.cos(theta) * _R.x, Math.sin(theta));
  }

  function updateAttack(dt) {
    const a = P.attack;
    if (!a) return;
    const S = U.SLASH[a.kind];
    a.t += dt;
    const p = a.t / S.dur;
    const heavy = a.kind === 'slash2';
    if (p >= S.a && !a.swung) {
      a.swung = true;
      P.rig.root.updateMatrixWorld(true);
      a.cres = FX.crescent(S, P.rig.body.matrixWorld, heavy ? { inner: 0.2, outer: 1.22, bright: 1.25, fadeTime: 0.2 } : { inner: 0.38, outer: 1.18, bright: 1.0, fadeTime: 0.14 });
      a.swingYaw = P.facing;
      U.audio.play(heavy ? 'swing2' : 'swing1');
      if (heavy) {
        // spectral hand strike accompanies the reverse slash
        const d = U.dirFromAngle(P.facing, new V3());
        const strike = P.pos.clone().addScaledVector(d, 1.9).setY(1.05);
        a.strikePos = strike;
        const right = new V3(-d.z, 0, d.x);
        P.rig.command(2, { pos: strike.clone().addScaledVector(right, 0.25), up: d.clone().setY(0.15), palm: right.clone().negate(), pose: 'clench', dur: 0.32, follow: 26, turn: 26, glow: 1.9, scale: 1.45 });
      }
    }
    if (a.swung && p <= S.b + 0.02) {
      const k = U.clamp((p - S.a) / (S.b - S.a), 0, 1);
      const e = 1 - Math.pow(1 - k, 2.2);
      FX.crescentSet(a.cres, e);
      const theta = U.lerp(S.th0, S.th1, e);
      const yawB = bladeYawBody(S, theta);
      if (a.prevYaw == null) a.prevYaw = bladeYawBody(S, S.th0);
      const lo = Math.min(a.prevYaw, yawB) - 0.12, hi = Math.max(a.prevYaw, yawB) + 0.12;
      const range = heavy ? P.TUNE.s2Range : P.TUNE.s1Range;
      for (const en of U.enemies.list) {
        if (a.hit.has(en) || !en.alive) continue;
        const dx = en.pos.x - P.pos.x, dz = en.pos.z - P.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > range + en.radius) continue;
        const rel = U.angleDiff(a.swingYaw, Math.atan2(dx, dz));
        if ((rel >= lo && rel <= hi) || (d < 1.0 + en.radius && Math.abs(rel) < 1.2 && k > 0.4)) {
          a.hit.add(en);
          landHit(en, heavy, dx / (d || 1), dz / (d || 1));
        }
      }
      a.prevYaw = yawB;
    }
    if (heavy && a.swung && !a.handDone && p >= S.b) {
      a.handDone = true;
      const sp = a.strikePos;
      FX.ring({ pos: sp, r0: 0.2, r1: 1.3, dur: 0.25, w0: 0.12, w1: 0.03, opacity: 0.8 });
      FX.sparks(sp, 10, { speed: 4, life: 0.3, size: 0.08, grav: 2 });
      for (const en of U.enemies.list) {
        if (!en.alive) continue;
        const d = Math.hypot(en.pos.x - sp.x, en.pos.z - sp.z);
        if (d < 1.25 + en.radius) {
          const dir = _tmp.set(en.pos.x - P.pos.x, 0, en.pos.z - P.pos.z).normalize();
          U.enemies.hit(en, P.TUNE.handDmg, { dir, knock: 4 });
          FX.shards(_tmp2.copy(en.pos).setY(1.1), 3, { bright: true, speed: 4, size: 0.07, life: 0.4 });
        }
      }
    }
    if (a.swung && p > S.b + 0.02 && a.cres && !a.released) { a.released = true; FX.crescentRelease(a.cres); }
    if (p >= 1) { if (a.cres && !a.released) FX.crescentRelease(a.cres); P.attack = null; P.comboTimer = 0; }
  }

  function landHit(en, heavy, nx, nz) {
    const dir = _tmp.set(nx, 0, nz);
    U.enemies.hit(en, heavy ? P.TUNE.s2Dmg : P.TUNE.s1Dmg, { dir, knock: heavy ? 4.2 : 2.4 });
    const hp = _tmp2.set(en.pos.x - nx * en.radius * 0.6, en.type === 'idol' ? 1.7 : 1.15, en.pos.z - nz * en.radius * 0.6);
    FX.sparks(hp, heavy ? 22 : 12, { speed: heavy ? 8 : 6, dir, bias: 0.5, life: 0.3, size: heavy ? 0.11 : 0.09, grav: 4 });
    FX.shards(hp, heavy ? 5 : 2, { bright: true, speed: 5, size: 0.07, life: 0.4, dir, bias: 0.4 });
    FX.flash(hp, heavy ? 12 : 7, 5, 0.16);
    if (heavy) FX.ring({ pos: en.pos, r0: 0.4, r1: 1.5, dur: 0.22, w0: 0.1, w1: 0.02, opacity: 0.7 });
    U.audio.play('hit', { heavy, gap: 0.02 });
    U.time.addHitstop(heavy ? 0.06 : 0.035);
    U.world.addShake(heavy ? 0.13 : 0.06);
  }

  // ---------------- damage ----------------
  P.takeDamage = function (amount, from) {
    if (!P.alive || P.invulnerable()) return false;
    P.hp = Math.max(0, P.hp - amount);
    P.protect = P.TUNE.hurtProtect;
    P.hurt = 0.3;
    U.world.addShake(0.2);
    U.audio.play('hurt');
    const hp = _tmp.copy(P.pos).setY(1.2);
    FX.sparks(hp, 12, { speed: 4, life: 0.35, size: 0.08, color: FX.CRIMSON });
    FX.shards(hp, 4, { speed: 3, size: 0.08, life: 0.6, colors: [new T.Color(0.1, 0.1, 0.12)] });
    if (U.ui) U.ui.onHurt(amount);
    if (P.hp <= 0) die();
    return true;
  };

  function die() {
    P.alive = false; P.deadT = 0;
    if (P.attack) { FX.crescentRelease(P.attack.cres); P.attack = null; }
    P.dodge = null; P.aiming = null; U.skills.hidePreview();
    U.audio.play('death');
    FX.mist(_tmp.copy(P.pos).setY(0.6), 8, { spread: 0.6, rise: 0.5, life: 1.6, size: 1.2, a: 0.25 });
    if (U.game) U.game.onPlayerDeath();
  }

  P.heal = function (amount) { P.hp = Math.min(P.maxHp, P.hp + amount); };

  // ---------------- animation bridge ----------------
  const _st = { pos: null, facing: 0, vel: null, action: null, gesture: null, dodge: null, hurt: 0, dead: -1 };
  function animate(dt) {
    _st.pos = P.pos; _st.facing = P.facing; _st.vel = P.vel;
    _st.action = P.attack; _st.gesture = P.gesture; _st.dodge = P.dodge;
    _st.hurt = P.hurt; _st.dead = P.alive ? -1 : P.deadT;
    P.rig.update(dt, _st);
  }

  function footsteps(dt) {
    const sp = Math.hypot(P.vel.x, P.vel.z);
    if (sp < 1 || P.dodge) return;
    P.stepT += dt * sp / 1.15;
    if (P.stepT > 1) {
      P.stepT -= 1;
      FX.mist(_tmp.copy(P.pos).setY(0.1), 1, { spread: 0.2, rise: 0.1, out: 0.3, life: 0.5, size: 0.45, a: 0.07 });
    }
  }
})(window.U);
