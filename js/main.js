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
  // One loop: waves and the three keepers of the seal, in turn. After the Sealwright the seal is rewritten
  // and the loop begins again, harder.
  const STAGES = [
    { type: 'wave', w: 0 }, { type: 'boss', boss: 'gaoler' },
    { type: 'wave', w: 1 }, { type: 'boss', boss: 'witness' },
    { type: 'wave', w: 2 }, { type: 'boss', boss: 'sealwright' },
  ];
  G.STAGES = STAGES;
  const HEAL_BETWEEN = 35;
  const SCORE = { pursuer: 100, idol: 150, eye: 80, wave: 250, boss: 2500, clean: 1500 };
  G.loopMult = function () { return 1 + 0.5 * ((G.run ? G.run.loop : 1) - 1); };

  // ---------------- persistence ----------------
  const SAVE_KEY = 'unhallowed.save.v1', SCORES_KEY = 'unhallowed.scores.v1';
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
  function load(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  G.loadSave = function () {
    const s = load(SAVE_KEY);
    return s && s.v === 1 && s.loop >= 1 && s.stage >= 0 && s.stage < STAGES.length ? s : null;
  };
  G.save = function () {
    const P = U.player, r = G.run;
    store(SAVE_KEY, { v: 1, loop: r.loop, stage: r.stage, score: r.score, kills: r.kills, hp: Math.max(1, Math.round(P.hp)), upgrades: Object.assign({}, P.upgrades), relics: P.relics.slice(), date: Date.now() });
  };
  G.clearSave = function () { store(SAVE_KEY, null); };
  G.highScores = function () { const a = load(SCORES_KEY); return Array.isArray(a) ? a : []; };
  // record the finished run; returns its rank (0-based) or -1
  G.recordScore = function () {
    const r = G.run;
    if (!r || r.recorded) return -1;
    r.recorded = true;
    const list = G.highScores();
    const entry = { score: Math.round(r.score), loop: r.loop, stage: G.stageLabel(r.stage), date: Date.now() };
    list.push(entry);
    list.sort((a, b) => b.score - a.score);
    const top = list.slice(0, 5);
    store(SCORES_KEY, top);
    return top.indexOf(entry);
  };
  G.stageLabel = function (i) {
    const st = STAGES[i];
    return st.type === 'wave' ? 'Wave ' + U.ui.roman(st.w + 1) : U.bosses.DEFS[st.boss].name;
  };
  G.addScore = function (n) {
    if (!G.run || !U.player.alive) return;
    G.run.score += n * G.loopMult();
    U.ui.setScore(G.run.score, n * G.loopMult());
  };

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
      U.bosses.init(scene);
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
  G.start = function (save) {
    U.audio.unlock();
    U.audio.startAmbient();
    U.audio.play('ui');
    U.ui.closeChar();
    U.ui.showTitle(false);
    G.resetRun(save || null);
    G.state = 'playing';
    U.ui.showHud(true);
    document.getElementById('scene').focus({ preventScroll: true });
  };
  G.continueRun = function () { const s = G.loadSave(); if (s) G.start(s); };

  G.resetRun = function (save) {
    U.time.hitstop = 0;
    U.fx.reset();
    U.enemies.reset();
    U.bosses.reset();
    U.skills.reset();
    U.player.reset();
    U.world.dim = 0;
    U.world.followCamera(U.player.pos, 0, true);
    U.world.shake.trauma = 0;
    U.ui.resetHud();
    U.ui.hideUpgrades(); U.ui.showPause(false); U.ui.hideEnd();
    U.audio.setAmbient(1);
    G.wave = 0; G.waveState = null; G.endTimer = -1; G.clearTimer = -1; G.loopPause = 0;
    G.run = { loop: 1, stage: 0, score: 0, kills: 0, recorded: false };
    if (save) {
      G.run.loop = save.loop; G.run.stage = save.stage; G.run.score = save.score || 0; G.run.kills = save.kills || 0;
      U.player.restore(save);
    }
    G.applyLoop();
    U.ui.setScore(G.run.score, 0);
    G.startStage(G.run.stage);
  };
  // enemy scaling and the eclipse's cracks follow the loop count
  G.applyLoop = function () {
    U.enemies.setLoop(G.run.loop);
    U.world.setCracks(G.run.loop - 1);
    U.ui.setLoop(G.run.loop);
  };

  G.restart = function () {
    U.audio.play('ui');
    if (G.run && !U.player.alive) G.recordScore();
    G.resetRun(null);
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
    if (G.state === 'title' && code === 'Enter' && !U.ui.charOpen) { if (G.loadSave()) G.continueRun(); else G.start(); }
  }

  // ---------------- stages ----------------
  G.startStage = function (i) {
    G.run.stage = i;
    G.save(); // checkpoint: a continued run resumes at the start of this stage
    const st = STAGES[i];
    if (st.type === 'wave') G.startWave(st.w + 1);
    else G.startBoss(st.boss);
  };

  G.startWave = function (n) {
    const def = WAVES[n - 1];
    G.wave = n;
    U.enemies.maxAttackers = def.attackers + (G.run && G.run.loop >= 3 ? 1 : 0);
    const total = def.groups.reduce((s, g) => s + g.spawns.length, 0);
    G.waveState = { def, total, killed: 0, group: 0, groupT: 0, queue: [], spawnT: 0, started: false, introT: 1.4 };
    U.ui.setWave('Wave ' + U.ui.roman(n), total);
    U.ui.showBoss(null);
    U.ui.banner('Wave ' + U.ui.roman(n), def.sub, 2.4);
    U.audio.play('wave');
  };

  G.startBoss = function (kind) {
    const def = U.bosses.DEFS[kind];
    U.enemies.maxAttackers = 2;
    G.waveState = { boss: kind, total: 1, killed: 0, introT: 2.2, spawned: false, hurt: 0 };
    U.ui.setWave(def.lock, -1);
    U.ui.banner(def.name, def.title, 3.0);
    U.audio.play('bossIntro');
  };

  function updateWave(dt) {
    const ws = G.waveState;
    if (!ws) return;
    if (ws.boss) {
      if (ws.introT > 0) { ws.introT -= dt; if (ws.introT <= 0) { ws.spawned = true; U.bosses.spawn(ws.boss); } }
      return;
    }
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

  G.onEnemyKilled = function (e) {
    const ws = G.waveState;
    if (e && G.run) { G.run.kills++; if (!e.isBoss) G.addScore(SCORE[e.type] || 100); }
    if (U.player.alive && U.player.hasRelic('chain')) U.player.heal(5);
    if (!ws) return;
    if (ws.boss) {
      if (!e || !e.isBoss) return; // the keeper's servants don't end the fight
      G.addScore(SCORE.boss);
      if (ws.hurt < 30) { G.addScore(SCORE.clean); U.ui.banner('Untouched', 'The lock never laid a hand on him', 2.2); }
      G.clearTimer = 3.2; // let the death play out
      U.enemies.clearHazards();
      for (const o of U.enemies.list) if (o.alive && !o.isBoss) U.enemies.kill(o, {});
      return;
    }
    ws.killed++;
    const remaining = ws.total - ws.killed;
    U.ui.setWave('Wave ' + U.ui.roman(G.wave), Math.max(0, remaining));
    if (remaining <= 0 && U.player.alive) {
      G.clearTimer = 1.5;
      U.enemies.clearHazards(); // stray volleys and eruptions vanish with the last enemy
    }
  };
  G.onPlayerHurt = function (amount) { if (G.waveState && G.waveState.boss) G.waveState.hurt += amount; };

  G.onPlayerDeath = function () { G.endTimer = 2.2; G.clearTimer = -1; };

  function waveCleared() {
    if (!U.player.alive) return;
    const st = STAGES[G.run.stage];
    G.waveState = null;
    G.state = 'upgrade';
    IN.clear();
    U.skills.hidePreview(); U.player.aiming = null;
    const advance = () => {
      U.ui.hideUpgrades();
      G.state = 'playing';
      IN.clear();
      let next = G.run.stage + 1;
      if (next >= STAGES.length) {
        // the Sealwright's last stroke: the seal is rewritten, and it all begins again
        next = 0;
        G.run.loop++;
        G.applyLoop();
        U.ui.banner('The Seal Is Rewritten', 'Loop ' + U.ui.roman(G.run.loop) + ' · the eclipse cracks further', 3.2);
        U.audio.play('wave');
        G.run.stage = next;
        G.loopPause = 2.6; // a breath before the next wave
        G.save();
        return;
      }
      G.startStage(next);
      document.getElementById('scene').focus({ preventScroll: true });
    };
    if (st.type === 'wave') {
      G.addScore(SCORE.wave);
      U.ui.showUpgrades(G.wave, (id) => {
        U.player.applyUpgrade(id);
        U.player.heal(HEAL_BETWEEN);
        U.audio.play('choose');
        advance();
      });
    } else {
      U.ui.showRelics(st.boss, (id) => {
        U.player.addRelic(id);
        U.player.heal(9999);
        U.audio.play('choose');
        advance();
      });
    }
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
    U.bosses.update(dt);
    U.fx.update(dt);
    updateWave(dt);
    U.world.update(dt, U.time.now);
    U.world.followCamera(U.player.pos, rawDt);
    U.world.camera.updateMatrixWorld(); // keep the aim raycast in sync even when stepping without rendering
    U.ui.update(rawDt);
    if (G.clearTimer > 0) { G.clearTimer -= dt; if (G.clearTimer <= 0) { G.clearTimer = -1; waveCleared(); } }
    if (G.loopPause > 0) { G.loopPause -= dt; if (G.loopPause <= 0) { G.loopPause = 0; G.startStage(G.run.stage); } }
    if (G.endTimer > 0) {
      G.endTimer -= rawDt;
      if (G.endTimer <= 0) {
        G.endTimer = -1; G.state = 'dead';
        const rank = G.recordScore();
        G.clearSave();
        U.ui.showEnd(false, rank);
      }
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
