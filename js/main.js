/* UNHALLOWED — game state, waves, upgrade loop and the main frame loop. */
'use strict';
(function (U) {
  const IN = U.input;
  const G = (U.game = { state: 'loading' });

  // Three compact waves. Each group spawns when the living count drops to `when` (or after `after` seconds).
  const WAVES = [
    { attackers: 2, sub: 'Masked hunters climb from the ruin',
      groups: [{ when: null, spawns: ['pursuer', 'pursuer'] }, { when: 1, after: 13, spawns: ['idol', 'pursuer'] }] },
    { attackers: 2, sub: 'The idols wake',
      groups: [{ when: null, spawns: ['pursuer', 'idol', 'pursuer'] }, { when: 2, after: 15, spawns: ['pursuer', 'idol', 'pursuer'] }] },
    { attackers: 3, sub: 'Everything beneath the eclipse answers',
      groups: [{ when: null, spawns: ['pursuer', 'pursuer', 'idol', 'pursuer'] }, { when: 3, after: 14, spawns: ['idol', 'pursuer', 'pursuer', 'idol'] }] },
  ];
  G.WAVES = WAVES;
  const HEAL_BETWEEN = 35;

  function init() {
    try {
      U.buildTextures();
      U.buildMaterials();
      const canvas = document.getElementById('scene');
      U.world.init(canvas);
      U.input.init(canvas);
      const scene = U.world.scene;
      U.fx.init(scene);
      U.enemies.init(scene);
      U.player.init(scene);
      U.skills.init(scene);
      U.fx.initAfterimages(U.player.rig);
      U.world.resize();
      U.ui.init();
      warmup();
      G.state = 'title';
      U.ui.setLoaded();
      IN.onKey(onKey);
      // losing focus pauses the run (held inputs are already cleared by the input module)
      window.addEventListener('blur', () => { if (G.state === 'playing') G.pause(); });
      document.addEventListener('visibilitychange', () => { if (document.hidden && G.state === 'playing') G.pause(); });
      requestAnimationFrame(frame);
    } catch (err) {
      console.error(err);
      U.showError('Failed to start: ' + (err && err.message ? err.message : err));
    }
  }

  // compile every shader up front so the first spell doesn't hitch
  function warmup() {
    const W = U.world;
    const hidden = [];
    W.scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
    W.renderer.compile(W.scene, W.camera);
    W.followCamera(U.player.pos, 0, true);
    W.update(0, 0);
    W.render(0);
    for (const o of hidden) o.visible = false;
  }

  // ---------------- state transitions ----------------
  G.start = function () {
    U.audio.unlock();
    U.audio.startAmbient();
    U.audio.play('ui');
    U.ui.closeChar();
    U.ui.showTitle(false);
    G.resetRun();
    G.state = 'playing';
    U.ui.showHud(true);
    document.getElementById('scene').focus({ preventScroll: true });
  };

  G.resetRun = function () {
    U.time.hitstop = 0;
    U.fx.reset();
    U.enemies.reset();
    U.skills.reset();
    U.player.reset();
    U.world.dim = 0;
    U.world.followCamera(U.player.pos, 0, true);
    U.world.shake.trauma = 0;
    U.ui.resetHud();
    U.ui.hideUpgrades(); U.ui.showPause(false); U.ui.hideEnd();
    U.audio.setAmbient(1);
    G.wave = 0; G.waveState = null; G.endTimer = -1; G.clearTimer = -1;
    G.startWave(1);
  };

  G.restart = function () {
    U.audio.play('ui');
    G.resetRun();
    G.state = 'playing';
    U.ui.showHud(true);
    IN.clear();
  };

  G.toTitle = function () {
    U.audio.play('ui');
    U.ui.showPause(false); U.ui.hideEnd(); U.ui.hideUpgrades();
    U.ui.showHud(false);
    G.state = 'title';
    U.audio.setAmbient(0.5);
    U.ui.showTitle(true);
  };

  G.pause = function () {
    if (G.state !== 'playing') return;
    G.state = 'paused';
    IN.clear();
    U.skills.hidePreview(); U.player.aiming = null;
    U.ui.showPause(true);
    U.audio.setAmbient(0.4);
  };
  G.resume = function () {
    if (G.state !== 'paused') return;
    U.ui.showPause(false);
    G.state = 'playing';
    IN.clear();
    U.audio.setAmbient(1);
    document.getElementById('scene').focus({ preventScroll: true });
  };

  function onKey(code) {
    if (code === 'Escape') {
      if (U.ui.charOpen) { U.ui.closeChar(); return; }
      if (G.state === 'playing') G.pause();
      else if (G.state === 'paused') G.resume();
      return;
    }
    if (G.state === 'upgrade' && U.ui.cardHandlers) {
      const idx = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 }[code];
      if (idx != null && U.ui.cardHandlers[idx]) U.ui.cardHandlers[idx]();
    }
    if (G.state === 'title' && code === 'Enter' && !U.ui.charOpen) G.start();
  }

  // ---------------- waves ----------------
  G.startWave = function (n) {
    const def = WAVES[n - 1];
    G.wave = n;
    U.enemies.maxAttackers = def.attackers;
    const total = def.groups.reduce((s, g) => s + g.spawns.length, 0);
    G.waveState = { def, total, killed: 0, group: 0, groupT: 0, queue: [], spawnT: 0, started: false, introT: 1.4 };
    U.ui.setWave(n, total);
    U.ui.banner('Wave ' + U.ui.roman(n), def.sub, 2.4);
    U.audio.play('wave');
  };

  function updateWave(dt) {
    const ws = G.waveState;
    if (!ws) return;
    if (ws.introT > 0) { ws.introT -= dt; if (ws.introT <= 0) queueGroup(ws, 0); return; }
    // next group trigger
    ws.groupT += dt;
    const next = ws.def.groups[ws.group + 1];
    if (next) {
      const living = U.enemies.aliveCount() + ws.queue.length;
      if (living <= next.when || (next.after && ws.groupT > next.after)) queueGroup(ws, ws.group + 1);
    }
    // staggered spawns
    if (ws.queue.length) {
      ws.spawnT -= dt;
      if (ws.spawnT <= 0 && U.enemies.aliveCount() < 6) {
        const type = ws.queue.shift();
        U.enemies.spawn(type, pickSpawnPoint());
        ws.spawnT = 0.5;
      }
    }
  }

  function queueGroup(ws, i) {
    ws.group = i; ws.groupT = 0;
    ws.queue.push(...ws.def.groups[i].spawns);
    ws.spawnT = 0;
  }

  const _p = new THREE.Vector3();
  // Prefer rim points the player can see (arrival effect on screen); never closer than 6.5 m.
  function pickSpawnPoint() {
    const P = U.player.pos, cam = U.world.camera;
    cam.updateMatrixWorld();
    let best = null;
    for (let ring = 0; ring < 2; ring++) {
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2 + ring * 0.065;
        const R = U.arenaMaxR(Math.sin(a), -Math.cos(a)) - (ring ? 3.4 : 1.2);
        const x = Math.sin(a) * R, z = -Math.cos(a) * R;
        const d = Math.hypot(x - P.x, z - P.z);
        if (d < 6.5) continue;
        let crowd = 0;
        for (const e of U.enemies.list) if (e.alive && Math.hypot(e.pos.x - x, e.pos.z - z) < 2.0) crowd++;
        _p.set(x, 0.5, z).project(cam);
        // how far outside the safe screen box the point lands (0 = fully visible)
        const over = Math.max(0, Math.abs(_p.x) - 0.85) + Math.max(0, _p.y - 0.78) + Math.max(0, -0.8 - _p.y) + (_p.z > 1 ? 5 : 0);
        const score = -over * 20 - crowd * 6 - Math.abs(d - 9) * 0.25 + Math.random() * 2;
        if (!best || score > best.score) best = { x, z, score };
      }
    }
    return new THREE.Vector3(best ? best.x : 0, 0, best ? best.z : -10);
  }

  G.onEnemyKilled = function () {
    const ws = G.waveState;
    if (!ws) return;
    ws.killed++;
    const remaining = ws.total - ws.killed;
    U.ui.setWave(G.wave, Math.max(0, remaining));
    if (remaining <= 0 && U.player.alive) {
      G.clearTimer = 1.5;
      U.enemies.clearHazards(); // stray volleys and eruptions vanish with the last enemy
    }
  };

  G.onPlayerDeath = function () { G.endTimer = 2.2; G.clearTimer = -1; };

  function waveCleared() {
    if (!U.player.alive) return;
    G.waveState = null;
    if (G.wave >= WAVES.length) {
      G.state = 'victory';
      U.audio.play('victory');
      U.ui.showEnd(true);
      return;
    }
    G.state = 'upgrade';
    IN.clear();
    U.skills.hidePreview(); U.player.aiming = null;
    U.ui.showUpgrades(G.wave, (id) => {
      U.player.upgrades[id] = Math.min(2, U.player.upgrades[id] + 1);
      U.player.heal(HEAL_BETWEEN);
      U.audio.play('choose');
      U.ui.hideUpgrades();
      G.state = 'playing';
      IN.clear();
      G.startWave(G.wave + 1);
      document.getElementById('scene').focus({ preventScroll: true });
    });
  }

  // ---------------- frame loop ----------------
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const realDt = Math.max(0, (now - last) / 1000);
    const rawDt = Math.min(0.05, realDt);
    last = now;
    if (realDt > 0) U.time.fps = U.time.fps ? U.time.fps * 0.95 + (1 / realDt) * 0.05 : 1 / realDt;
    U.time.real += rawDt;
    if (G.state === 'playing') {
      try { step(rawDt); } catch (err) { console.error(err); U.showError('Runtime error: ' + err.message); G.state = 'paused'; }
      U.world.render(U.time.real);
    } else if (G.state === 'paused' || G.state === 'upgrade' || G.state === 'victory' || G.state === 'dead') {
      // simulation frozen; keep the last frame (render occasionally for resize correctness)
      if ((G.idleFrames = (G.idleFrames || 0) + 1) % 30 === 0) U.world.render(U.time.real);
    }
    IN.endFrame();
  }

  function step(rawDt) {
    // hit-stop: brief simulation freeze on heavy impacts (camera shake keeps running)
    let dt = rawDt;
    if (U.time.hitstop > 0) { U.time.hitstop -= rawDt; dt = rawDt * U.time.hitstopScale; }
    U.time.now += dt;
    U.player.update(dt);
    U.skills.update(dt);
    U.enemies.update(dt);
    U.fx.update(dt);
    updateWave(dt);
    U.world.update(dt, U.time.now);
    U.world.followCamera(U.player.pos, rawDt);
    U.world.camera.updateMatrixWorld(); // keep the aim raycast in sync even when stepping without rendering
    U.ui.update(rawDt);
    if (G.clearTimer > 0) { G.clearTimer -= dt; if (G.clearTimer <= 0) { G.clearTimer = -1; waveCleared(); } }
    if (G.endTimer > 0) {
      G.endTimer -= rawDt;
      if (G.endTimer <= 0) { G.endTimer = -1; G.state = 'dead'; U.ui.showEnd(false); }
    }
  }

  // Test/debug hooks (harmless in play): advance the simulation deterministically at a fixed
  // step regardless of display frame rate, then render one frame.
  G.simulate = function (seconds, stepDt) {
    const h = stepDt || 1 / 60;
    let t = 0;
    while (t < seconds - 1e-9 && G.state === 'playing') {
      step(h);
      IN.endFrame();
      t += h;
    }
    U.world.render(U.time.real);
    return G.state;
  };
  window.UNHALLOWED = U;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window.U);
