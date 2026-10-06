/* UNHALLOWED — DOM interface: title screen, character panel, HUD, upgrade/pause/end overlays. */
'use strict';
(function (U) {
  const $ = (id) => document.getElementById(id);
  const UI = (U.ui = {});

  const ICONS = {
    Q: '<path d="M9 39 L39 9" stroke-width="2.4"/><path d="M39 9 L30.5 11 M39 9 L37 17.5" stroke-width="2"/><path d="M12.5 19.5 C18 22 25 29 28.5 35.5 C22.5 33 16 26.5 12.5 19.5 Z" stroke-width="1.5"/>',
    E: '<ellipse cx="24" cy="37" rx="17" ry="4.5" stroke-width="1.5"/><path d="M9 36 C9 27 12 21 16 17 M15.5 37 C15 28 17 20 20 15 M24 38 L24 12 M32.5 37 C33 28 31 20 28 15 M39 36 C39 27 36 21 32 17" stroke-width="2"/>',
    R: '<path d="M7 35 C13 16 31 7 42 10 C30 12 18 21 12 37 Z" fill="rgba(255,255,255,0.22)" stroke-width="1.8"/><path d="M8 41 L41 8" stroke-width="1.2" stroke-dasharray="2 3"/><path d="M33 6 L40 4 L38 11" stroke-width="1.6"/>',
    T: '<path d="M24 8 A16 16 0 1 1 9.5 17" stroke-width="2"/><path d="M14 11 A16 16 0 0 1 19 8.6" stroke-width="2"/><path d="M24 24 L24 13 M24 24 L31.5 28" stroke-width="2"/><path d="M24 40 V37 M40 24 H37 M8 24 H11" stroke-width="1.6"/><circle cx="24" cy="24" r="1.8" fill="#fff"/>',
    Y: '<circle cx="24" cy="24" r="13" stroke-width="2" stroke-dasharray="7.5 3.2"/><path d="M24 3 V9 M24 39 V45 M3 24 H9 M39 24 H45 M9.2 9.2 L13.4 13.4 M38.8 9.2 L34.6 13.4 M9.2 38.8 L13.4 34.6 M38.8 38.8 L34.6 34.6" stroke-width="1.6"/><path d="M24 16 L29 24 L24 32 L19 24 Z" stroke-width="1.8" fill="rgba(255,255,255,0.25)"/>',
    dodge: '<path d="M30 10 L38 24 L30 38 L22 24 Z" stroke-width="2" fill="rgba(255,255,255,0.2)"/><path d="M6 18 H18 M4 24 H17 M6 30 H18" stroke-width="1.6"/>',
  };
  const svg = (inner) => `<svg viewBox="0 0 48 48" fill="none" stroke="#f2f2f5" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

  UI.UPGRADES = [
    { id: 'widen', key: 'Q', title: 'Widen the Wound', skill: 'Needle Through Hours',
      desc: 'The slit tears wider. The lance’s visible and actual width grow, and it cuts deeper.',
      effect: (n) => `Q width +25% · Q damage +20%  (now ×${Math.pow(1.25, n).toFixed(2)} / ×${Math.pow(1.2, n).toFixed(2)})` },
    { id: 'hands', key: 'E', title: 'More Hands Below', skill: 'Hands Beneath',
      desc: 'More hands answer from beneath the stone. The grasp reaches farther and gathers more.',
      effect: (n) => `E radius +25%, preview and hand ring included  (now ×${Math.pow(1.25, n).toFixed(2)})` },
    { id: 'absence', key: 'dodge', title: 'A Shorter Absence', skill: 'Spectral Dash',
      desc: 'Vaust returns from the between-place sooner. Each dodge charge recovers faster.',
      effect: (n) => `Dodge recharge −20%  (now ${(3 * Math.pow(0.8, n)).toFixed(2)} s per charge)` },
  ];

  UI.init = function () {
    // skill bar
    const bar = $('skillbar');
    UI.slots = {};
    for (const k of U.skills.KEYS) {
      const el = document.createElement('div');
      el.className = 'skill ready' + (k === 'Y' ? ' ultimate' : '');
      el.title = `${k} — ${U.skills.DEFS[k].name}`;
      el.innerHTML = `${svg(ICONS[k])}<div class="cd"></div><div class="cd-text"></div><div class="key">${k}</div>`;
      bar.appendChild(el);
      UI.slots[k] = { el, cd: el.querySelector('.cd'), txt: el.querySelector('.cd-text'), last: -1 };
    }
    UI.pips = Array.from(document.querySelectorAll('#dodge-pips .pip'));
    UI.hpFill = $('hp-fill'); UI.hpLag = $('hp-lag'); UI.hpText = $('hp-text'); UI.hpBar = $('hp-bar');
    UI.portrait = $('portrait');
    UI.vignette = $('damage-vignette');
    UI.lag = 1; UI.lagHold = 0; UI.hurtPulse = 0;
    UI.markers = [];
    const mk = $('edge-markers');
    for (let i = 0; i < 8; i++) { const d = document.createElement('div'); d.className = 'edge-marker'; d.style.display = 'none'; mk.appendChild(d); UI.markers.push(d); }

    // title & panels
    $('btn-vaust').addEventListener('click', () => { U.audio.unlock(); U.audio.play('ui'); UI.openChar(); });
    $('char-close').addEventListener('click', () => UI.closeChar());
    $('char-panel').addEventListener('click', (e) => { if (e.target.id === 'char-panel') UI.closeChar(); });
    $('btn-resume').addEventListener('click', () => U.game.resume());
    $('btn-restart-p').addEventListener('click', () => U.game.restart());
    $('btn-title-p').addEventListener('click', () => U.game.toTitle());
    $('btn-restart-e').addEventListener('click', () => U.game.restart());
    $('btn-title-e').addEventListener('click', () => U.game.toTitle());
    UI.startMotes();
  };

  UI.setLoaded = function () {
    const b = $('btn-play');
    b.disabled = false;
    b.textContent = 'Play';
    b.addEventListener('click', () => U.game.start());
    b.focus({ preventScroll: true });
  };

  UI.openChar = function () { $('char-panel').classList.remove('hidden'); UI.charOpen = true; $('char-close').focus(); };
  UI.closeChar = function () { $('char-panel').classList.add('hidden'); UI.charOpen = false; $('btn-vaust').focus({ preventScroll: true }); };

  UI.showTitle = function (show) {
    const t = $('title-screen');
    if (show) { t.classList.remove('hidden'); t.classList.remove('leaving'); UI.startMotes(); }
    else { t.classList.add('leaving'); setTimeout(() => { if (U.game.state !== 'title') t.classList.add('hidden'); }, 900); }
  };
  UI.showHud = function (show) { $('hud').classList.toggle('hidden', !show); };

  // ---------- title motes ----------
  UI.startMotes = function () {
    if (UI.motesRunning) return;
    const c = $('title-motes');
    const ctx = c.getContext('2d');
    const parts = [];
    for (let i = 0; i < 70; i++) parts.push({ x: Math.random(), y: Math.random(), s: 0.5 + Math.random() * 1.8, v: 0.004 + Math.random() * 0.012, ph: Math.random() * 6, a: 0.2 + Math.random() * 0.6 });
    UI.motesRunning = true;
    let last = performance.now();
    const tick = (now) => {
      if (U.game && U.game.state !== 'title') { UI.motesRunning = false; return; }
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const w = c.clientWidth, h = c.clientHeight;
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        p.y -= p.v * dt; p.ph += dt * 0.6;
        if (p.y < -0.02) { p.y = 1.02; p.x = Math.random(); }
        const x = (p.x + Math.sin(p.ph) * 0.006) * w, y = p.y * h;
        const fade = Math.min(1, (1 - p.y) * 3) * Math.min(1, p.y * 4);
        ctx.fillStyle = `rgba(235,237,245,${p.a * fade})`;
        ctx.beginPath(); ctx.arc(x, y, p.s, 0, Math.PI * 2); ctx.fill();
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  // ---------- HUD ----------
  const ROMAN = ['', 'I', 'II', 'III', 'IV'];
  UI.roman = (n) => ROMAN[n] || String(n);

  UI.update = function (dt) {
    const P = U.player;
    // health with a lagging damage segment
    const k = U.clamp(P.hp / P.maxHp, 0, 1);
    UI.hpFill.style.width = (k * 100).toFixed(2) + '%';
    if (UI.lagHold > 0) UI.lagHold -= dt; else UI.lag = Math.max(k, UI.lag - dt * 0.6);
    if (UI.lag < k) UI.lag = k;
    UI.hpLag.style.width = (UI.lag * 100).toFixed(2) + '%';
    const hpTxt = `${Math.ceil(P.hp)} / ${P.maxHp}`;
    if (UI.hpText.textContent !== hpTxt) UI.hpText.textContent = hpTxt;
    const low = k < 0.3;
    UI.hpBar.classList.toggle('low', low);
    UI.portrait.classList.toggle('low', low);
    // dodge pips
    UI.pips.forEach((pip, i) => {
      const full = i < P.charges;
      pip.classList.toggle('full', full);
      const fill = pip.firstElementChild;
      fill.style.height = full ? '100%' : i === P.charges ? (P.chargeT * 100).toFixed(1) + '%' : '0%';
    });
    // skills
    const S = U.skills;
    for (const key of S.KEYS) {
      const s = UI.slots[key];
      const cd = S.cd[key], max = S.DEFS[key].cd;
      const f = cd > 0 ? cd / max : 0;
      if (Math.abs(f - s.last) > 0.002) {
        s.cd.style.setProperty('--cd', f.toFixed(4));
        s.last = f;
      }
      const txt = cd > 0 ? (cd < 1 ? cd.toFixed(1) : Math.ceil(cd).toString()) : '';
      if (s.txt.textContent !== txt) s.txt.textContent = txt;
      s.el.classList.toggle('ready', cd <= 0);
      s.el.classList.toggle('cooling', cd > 0);
      s.el.classList.toggle('aiming', !!(P.aiming && P.aiming.key === key));
    }
    // vignette: recent damage + low health pulse
    UI.hurtPulse = Math.max(0, UI.hurtPulse - dt * 2.2);
    const lowPulse = low && P.alive ? 0.25 + 0.15 * Math.sin(performance.now() / 260) : 0;
    UI.vignette.style.opacity = Math.min(1, UI.hurtPulse + lowPulse).toFixed(3);
    U.world.grade.uniforms.uHurt.value = UI.hurtPulse * 0.5;
    UI.updateMarkers();
    // controls hint fades after a while
    if (UI.hintT != null) {
      UI.hintT += dt;
      if (UI.hintT > 16) { $('controls-hint').classList.add('fade'); UI.hintT = null; }
    }
  };

  const _v = new THREE.Vector3();
  UI.updateMarkers = function () {
    const cam = U.world.camera;
    let i = 0;
    const W = window.innerWidth, H = window.innerHeight;
    for (const e of U.enemies.list) {
      if (i >= UI.markers.length) break;
      _v.copy(e.pos).setY(1.0).project(cam);
      const inside = Math.abs(_v.x) < 0.98 && Math.abs(_v.y) < 0.96 && _v.z < 1;
      if (inside) continue;
      let x = _v.x, y = _v.y;
      if (_v.z > 1) { x = -x; y = -y; }
      const m = Math.max(Math.abs(x) / 0.94, Math.abs(y) / 0.9);
      x /= m; y /= m;
      const el = UI.markers[i++];
      el.style.display = 'block';
      el.className = 'edge-marker' + (e.type === 'idol' ? ' idol' : '');
      const px = (x * 0.5 + 0.5) * W, py = (-y * 0.5 + 0.5) * H;
      const ang = Math.atan2(x, y);
      el.style.transform = `translate(${px - 7}px, ${py - 7}px) rotate(${ang}rad)`;
    }
    for (; i < UI.markers.length; i++) UI.markers[i].style.display = 'none';
  };

  UI.setWave = function (n, remaining) {
    $('wave-label').textContent = 'Wave ' + UI.roman(n);
    $('wave-remaining').textContent = remaining === 1 ? '1 remains' : `${remaining} remain`;
  };

  UI.banner = function (title, sub, dur) {
    const b = $('banner');
    $('banner-title').textContent = title;
    $('banner-sub').textContent = sub || '';
    b.classList.add('show');
    clearTimeout(UI.bannerTO);
    UI.bannerTO = setTimeout(() => b.classList.remove('show'), (dur || 2.2) * 1000);
  };

  UI.resetHud = function () {
    UI.lag = 1; UI.lagHold = 0; UI.hurtPulse = 0;
    $('controls-hint').classList.remove('fade');
    UI.hintT = 0;
    for (const k in UI.slots) UI.slots[k].last = -1;
  };

  // events from gameplay
  UI.onHurt = function () {
    UI.hurtPulse = Math.min(1, UI.hurtPulse + 0.75);
    UI.lagHold = 0.45;
    UI.portrait.classList.add('hurt');
    clearTimeout(UI.hurtTO);
    UI.hurtTO = setTimeout(() => UI.portrait.classList.remove('hurt'), 140);
  };
  UI.onDodge = function () {};
  UI.onCharge = function () {
    const i = U.player.charges - 1;
    const p = UI.pips[i];
    if (p) { p.classList.remove('flash'); void p.offsetWidth; p.classList.add('flash'); }
  };
  UI.onCast = function (key) {
    const s = UI.slots[key];
    s.el.classList.remove('flash'); void s.el.offsetWidth; s.el.classList.add('flash');
  };
  UI.onReady = function (key) {
    const s = UI.slots[key];
    s.el.classList.remove('flash'); void s.el.offsetWidth; s.el.classList.add('flash');
    if (key === 'Y' || key === 'R') U.audio.play('ready', { gap: 0.3 });
  };
  UI.onNotReady = function () {};

  // ---------- overlays ----------
  UI.showUpgrades = function (waveDone, onPick) {
    const P = U.player;
    $('upgrade-kicker').textContent = `Wave ${UI.roman(waveDone)} endured · the seal loosens`;
    const wrap = $('upgrade-cards');
    wrap.innerHTML = '';
    UI.cardHandlers = [];
    UI.UPGRADES.forEach((u, i) => {
      const lvl = P.upgrades[u.id];
      const maxed = lvl >= 2;
      const b = document.createElement('button');
      b.className = 'card';
      b.disabled = maxed;
      const pips = [0, 1].map((k) => `<i class="${k < lvl ? 'on' : ''}"></i>`).join('');
      b.innerHTML = `<div class="card-num"><span>${i + 1}</span></div>
        <div class="card-icon">${svg(ICONS[u.key])}</div>
        <h3>${u.title}</h3><div class="card-skill">${u.key === 'dodge' ? 'SHIFT' : u.key} · ${u.skill}</div>
        <p>${u.desc}</p>
        <div class="card-effect">${maxed ? 'Fully taken.' : u.effect(lvl + 1)}</div>
        <div class="card-level">${pips}</div>`;
      const pick = () => { if (!maxed) onPick(u.id); };
      b.addEventListener('click', pick);
      UI.cardHandlers[i] = pick;
      wrap.appendChild(b);
    });
    $('upgrade-overlay').classList.remove('hidden');
    setTimeout(() => { const f = wrap.querySelector('.card:not(:disabled)'); if (f) f.focus({ preventScroll: true }); }, 50);
  };
  UI.hideUpgrades = function () { $('upgrade-overlay').classList.add('hidden'); UI.cardHandlers = null; };

  UI.showPause = function (show) {
    $('pause-overlay').classList.toggle('hidden', !show);
    if (show) setTimeout(() => $('btn-resume').focus({ preventScroll: true }), 30);
  };

  UI.showEnd = function (victory) {
    $('end-kicker').textContent = victory ? 'Three waves endured' : 'The courtyard keeps him';
    $('end-title').textContent = victory ? 'The Seal Holds' : 'Vaust Falls';
    $('end-text').textContent = victory
      ? 'The courtyard falls silent beneath the white eclipse. For now, what is bound stays bound.'
      : 'The hands go still. Somewhere beneath the stone, the seal waits for him to rise again.';
    $('end-overlay').classList.remove('hidden');
    setTimeout(() => $('btn-restart-e').focus({ preventScroll: true }), 30);
  };
  UI.hideEnd = function () { $('end-overlay').classList.add('hidden'); };
})(window.U);
