/* UNHALLOWED — Vaust's five skills.
   Q Needle Through Hours · E Hands Beneath · R Sever the Veil · T The Missing Second · Y The Seal Objects
   Each cast follows anticipation -> release -> impact -> dissipation. Cooldowns start when a cast commits. */
'use strict';
(function (U) {
  const T = THREE;
  const V3 = T.Vector3;
  const S = (U.skills = {});
  const FX = U.fx;

  S.DEFS = {
    Q: { name: 'Needle Through Hours', cd: 4 },
    E: { name: 'Hands Beneath', cd: 8 },
    R: { name: 'Sever the Veil', cd: 10 },
    T: { name: 'The Missing Second', cd: 14 },
    Y: { name: 'The Seal Objects', cd: 30 },
  };
  S.KEYS = ['Q', 'E', 'R', 'T', 'Y'];
  S.TUNE = {
    qDmg: 30, qWidth: 0.42, qRange: 19, qSpeed: 50,
    eRadius: 3.2, eRange: 12, eDmg: 18, eRoot: 1.7,
    rDmg: 72, rRange: 8.3, rHalf: 1.2, rWind: 0.55, rSwing: 0.12,
    tRadius: 4.5, tRange: 12, tDur: 4, tScale: 0.5,
    yDmg: 105, yRadius: 8.4, yCharge: 1.0,
  };

  S.cd = { Q: 0, E: 0, R: 0, T: 0, Y: 0 };
  S.active = [];
  S.fields = [];

  // ---------------- shared builders ----------------
  const SLIT_FS = `
    uniform float uOpen, uOpacity; varying vec2 vUv;
    void main(){
      vec2 p = vUv * 2.0 - 1.0;
      float w = uOpen * (1.0 - p.y * p.y);           // lens: long axis along local Y, sharp tips
      float d = abs(p.x) - w;
      float edge = exp(-pow(d / 0.06, 2.0));
      float inside = step(d, 0.0);
      float tips = exp(-pow(p.x / 0.03, 2.0)) * (1.0 - abs(p.y)) * 0.6;
      vec3 col = vec3(2.6, 2.65, 2.85) * (edge + tips);
      float a = clamp(edge + tips + inside * 0.92, 0.0, 1.0) * uOpacity;
      gl_FragColor = vec4(mix(vec3(0.0), col, clamp(edge + tips, 0.0, 1.0)), a);
    }`;
  const TEAR_FS = `
    uniform float uOpen, uOpacity, uHead; varying vec2 vUv;
    void main(){
      float along = vUv.x;
      if (along > uHead) discard;
      float taper = sin(along * 3.14159);
      float w = uOpen * taper;
      float d = abs(vUv.y - 0.5) * 2.0 - w;
      float edge = exp(-pow(d / 0.12, 2.0)) * step(0.001, w);
      float inside = step(d, 0.0);
      float a = clamp(edge + inside, 0.0, 1.0) * uOpacity;
      if (a < 0.003) discard;
      gl_FragColor = vec4(vec3(2.4, 2.45, 2.7) * edge, a);
    }`;
  const FIELD_FS = `
    uniform float uR, uAlpha, uSpin, uTime; varying vec2 vP;
    float band(float d, float r, float w){ return exp(-pow((d - r) / w, 2.0)); }
    void main(){
      float d = length(vP);
      float a = atan(vP.y, vP.x);
      float TAU = 6.28318;
      float r1 = band(d, uR, 0.04) * step(0.22, fract((a + uSpin * 0.12) / TAU * 6.0));
      float r2 = band(d, uR * 0.8, 0.028) * step(0.4, fract((a - uSpin * 0.22) / TAU * 9.0 + 0.3));
      float r3 = band(d, uR * 0.46, 0.022) * step(0.3, fract((a + uSpin * 0.35) / TAU * 4.0 + 0.6));
      float r4 = band(d, uR * 0.62, 0.012);
      float ti = (a + uSpin * 0.05) / TAU * 60.0;
      float idx = floor(ti);
      float major = step(mod(idx, 5.0), 0.5);
      float tick = smoothstep(0.16, 0.0, abs(fract(ti) - 0.5)) * step(uR * (major > 0.5 ? 0.84 : 0.89), d) * step(d, uR * 0.95);
      float ha = uSpin * 0.55;
      vec2 hd = vec2(cos(ha), sin(ha));
      float along = dot(vP, hd);
      float hand = exp(-pow(abs(vP.x * hd.y - vP.y * hd.x) / 0.03, 2.0)) * step(0.0, along) * step(along, uR * 0.74);
      float fill = 0.045 * (1.0 - smoothstep(uR - 0.1, uR, d)) * (0.7 + 0.3 * sin(d * 6.0 - uTime * 1.5));
      float al = (r1 * 0.95 + r2 * 0.7 + r3 * 0.55 + r4 * 0.25 + tick * 0.6 + hand * 0.75 + fill) * uAlpha;
      if (al < 0.003) discard;
      gl_FragColor = vec4(vec3(1.35, 1.38, 1.5), al);
    }`;
  const QUAD_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const FIELD_VS = `varying vec2 vP; uniform float uSize; void main(){ vP = (uv * 2.0 - 1.0) * uSize; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

  function bigBladeGeom(len, w) {
    const st = [[0, w * 0.6, 0.05], [0.12, w, 0.08], [len * 0.82, w * 0.75, 0.06], [len, 0, 0]];
    const v = [];
    for (const [y, ww, th] of st) v.push([ww, y, 0], [0, y, th], [-ww, y, 0], [0, y, -th]);
    const t = [];
    for (let s = 0; s < st.length - 1; s++) {
      const a = s * 4, b = a + 4;
      for (let k = 0; k < 4; k++) { const k1 = (k + 1) % 4; t.push([a + k, a + k1, b + k1], [a + k, b + k1, b + k]); }
    }
    t.push([0, 3, 2], [0, 2, 1]);
    return U.geomFrom(v, t);
  }

  S.init = function (scene) {
    S.scene = scene;
    // Q: slit + lance + ground light line
    S.slit = new T.Mesh(new T.PlaneGeometry(1, 1), new T.ShaderMaterial({
      uniforms: { uOpen: { value: 0 }, uOpacity: { value: 1 } }, vertexShader: QUAD_VS, fragmentShader: SLIT_FS,
      transparent: true, depthWrite: false, depthTest: false,
    }));
    S.slit.renderOrder = 11; S.slit.visible = false; scene.add(S.slit);
    const lanceGeo = new T.OctahedronGeometry(1, 0); lanceGeo.scale(0.08, 0.08, 1.5);
    S.lanceMat = new T.MeshBasicMaterial({ color: new T.Color(3.0, 3.05, 3.3) });
    S.lance = new T.Mesh(lanceGeo, S.lanceMat); S.lance.visible = false; scene.add(S.lance);
    const trailGeo = new T.PlaneGeometry(1, 1); trailGeo.translate(0, -0.5, 0); trailGeo.rotateX(-Math.PI / 2); // flat ribbon spanning local z 0..1
    S.lanceTrail = new T.Mesh(trailGeo, new T.ShaderMaterial({
      uniforms: { uOpacity: { value: 1 } }, vertexShader: QUAD_VS,
      fragmentShader: `uniform float uOpacity; varying vec2 vUv; void main(){ float a = pow(vUv.y, 1.5) * (1.0 - pow(abs(vUv.x * 2.0 - 1.0), 2.0)); gl_FragColor = vec4(vec3(2.2, 2.25, 2.5), a * uOpacity); }`,
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
    }));
    S.lanceTrail.visible = false; S.lanceTrail.renderOrder = 9; scene.add(S.lanceTrail);
    S.groundLine = new T.Mesh(new T.PlaneGeometry(1, 1), new T.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 } }, vertexShader: QUAD_VS,
      fragmentShader: `uniform float uOpacity; varying vec2 vUv; void main(){ float a = exp(-pow((vUv.x - 0.5) / 0.18, 2.0)) * smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.85, vUv.y); gl_FragColor = vec4(vec3(1.5, 1.52, 1.65), a * uOpacity); }`,
      transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    }));
    S.groundLine.rotation.x = -Math.PI / 2; S.groundLine.visible = false; S.groundLine.renderOrder = 3; scene.add(S.groundLine);

    // E: pool of rising hands
    S.eHands = [];
    for (let i = 0; i < 13; i++) {
      const h = new U.SpectralHand(scene, { mirror: i % 2 === 1, opacity: 1, glow: 1.3, core: 0.32 });
      h.setOpacity(0);
      S.eHands.push(h);
    }

    // R: giant hand + blade, crescent and tear
    S.giant = new U.SpectralHand(scene, { opacity: 1, glow: 1.4, core: 0.26, edge: 1.0 });
    S.giant.setOpacity(0);
    S.bladeMat = U.spectralMaterial({ opacity: 1, core: 0.35, edge: 1.0, glow: 1.6 });
    S.blade = new T.Mesh(bigBladeGeom(9.4, 0.42), S.bladeMat);
    S.blade.visible = false; S.blade.renderOrder = 6; scene.add(S.blade);
    S.rCres = FX.makeCrescentMesh();
    S.rCres.mesh.matrix.identity(); S.rCres.mesh.matrixWorld.identity();
    S.tear = FX.makeCrescentMesh();
    S.tear.mesh.material = new T.ShaderMaterial({
      uniforms: { uOpen: { value: 0 }, uOpacity: { value: 1 }, uHead: { value: 1 } }, vertexShader: QUAD_VS, fragmentShader: TEAR_FS,
      transparent: true, depthWrite: false, side: T.DoubleSide,
    });
    S.tear.mesh.renderOrder = 10;
    S.tear.mesh.matrix.identity(); S.tear.mesh.matrixWorld.identity();

    // T: two field slots (cooldown makes overlap rare)
    for (let i = 0; i < 2; i++) {
      const mat = new T.ShaderMaterial({
        uniforms: { uR: { value: S.TUNE.tRadius }, uAlpha: { value: 0 }, uSpin: { value: 0 }, uTime: U.shared.uTime, uSize: { value: S.TUNE.tRadius + 0.3 } },
        vertexShader: FIELD_VS, fragmentShader: FIELD_FS, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      });
      const disc = new T.Mesh(new T.PlaneGeometry(2, 2), mat);
      disc.rotation.x = -Math.PI / 2; disc.renderOrder = 4; disc.visible = false;
      scene.add(disc);
      const fg = new T.TetrahedronGeometry(0.09, 0); fg.scale(0.6, 1.8, 0.5);
      const frags = new T.InstancedMesh(fg, new T.MeshBasicMaterial({ color: new T.Color(1.6, 1.65, 1.8), transparent: true, opacity: 0.75, blending: T.AdditiveBlending, depthWrite: false }), 34);
      frags.visible = false; frags.frustumCulled = false; scene.add(frags);
      const seeds = [];
      for (let k = 0; k < 34; k++) seeds.push({ a: Math.random() * Math.PI * 2, r: Math.sqrt(Math.random()), y: 0.3 + Math.random() * 2.4, rx: Math.random() * 6, ry: Math.random() * 6, s: 0.6 + Math.random() * 1.2, sp: (Math.random() - 0.5) * 0.6 });
      S.fields.push({ disc, mat, frags, seeds, active: false, pos: new V3(), t: 0, r: S.TUNE.tRadius });
    }

    // Y: fractured halo (segments + spokes) facing the camera
    S.halo = new T.Group();
    S.haloMat = U.spectralMaterial({ opacity: 0, core: 0.55, edge: 1.0, glow: 1.7, side: T.DoubleSide });
    S.haloSegs = [];
    for (let i = 0; i < 11; i++) {
      const g = new T.TorusGeometry(1.75, 0.055, 3, 6, (Math.PI * 2 / 11) * 0.78);
      const m = new T.Mesh(g, S.haloMat);
      m.userData.final = (i / 11) * Math.PI * 2;
      S.halo.add(m); S.haloSegs.push(m);
    }
    for (let i = 0; i < 7; i++) {
      const g = new T.TorusGeometry(2.35, 0.03, 3, 5, (Math.PI * 2 / 7) * 0.55);
      const m = new T.Mesh(g, S.haloMat);
      m.userData.final = (i / 7) * Math.PI * 2 + 0.3; m.userData.outer = true;
      S.halo.add(m); S.haloSegs.push(m);
    }
    for (let i = 0; i < 12; i++) {
      const g = U.taperGeom(0.75 + (i % 3 === 0 ? 0.45 : 0), 0.04, 0.0, 4, 1, 0.4, false);
      const m = new T.Mesh(g, S.haloMat);
      const a = (i / 12) * Math.PI * 2;
      m.userData.final = a; m.userData.spoke = true;
      S.halo.add(m); S.haloSegs.push(m);
    }
    S.halo.visible = false;
    scene.add(S.halo);
    S.previewTele = null;
  };

  S.reset = function () {
    for (const k of S.KEYS) S.cd[k] = 0;
    for (const c of S.active) if (c.cleanup) c.cleanup();
    S.active.length = 0;
    for (const f of S.fields) { f.active = false; f.disc.visible = false; f.frags.visible = false; }
    S.slit.visible = false; S.lance.visible = false; S.lanceTrail.visible = false; S.groundLine.visible = false;
    for (const h of S.eHands) h.setOpacity(0);
    S.giant.setOpacity(0); S.blade.visible = false;
    S.rCres.mesh.visible = false; S.tear.mesh.visible = false;
    S.halo.visible = false;
    if (S.previewTele) { S.previewTele.release(); S.previewTele = null; }
    U.world.dim = 0;
  };

  S.timeScaleAt = function (pos) {
    for (const f of S.fields) {
      if (!f.active || f.ending) continue;
      if (Math.hypot(pos.x - f.pos.x, pos.z - f.pos.z) <= f.r) return S.TUNE.tScale;
    }
    return 1;
  };

  S.upgradeMult = function () {
    const up = U.player.upgrades;
    return {
      qWidth: Math.pow(1.25, up.widen), qDmg: Math.pow(1.2, up.widen),
      eRadius: Math.pow(1.25, up.hands),
    };
  };

  // clamp a ground target to the skill range and the courtyard
  S.clampTarget = function (aim, range, out) {
    const P = U.player.pos;
    out = out || new V3();
    let dx = aim.x - P.x, dz = aim.z - P.z;
    const d = Math.hypot(dx, dz);
    if (d > range) { dx *= range / d; dz *= range / d; }
    out.set(P.x + dx, 0, P.z + dz);
    return U.arenaClamp(out, 0.3);
  };

  // ---------------- area preview (E / T while held) ----------------
  S.showPreview = function (key, aim) {
    const m = S.upgradeMult();
    const r = key === 'E' ? S.TUNE.eRadius * m.eRadius : S.TUNE.tRadius;
    const range = key === 'E' ? S.TUNE.eRange : S.TUNE.tRange;
    const p = S.clampTarget(aim, range, _pv);
    if (!S.previewTele || S.previewKey !== key) {
      if (S.previewTele) S.previewTele.release();
      S.previewTele = FX.telegraph({ pos: p, r, color: _white, intensity: 0.55 });
      S.previewKey = key;
    }
    const t = S.previewTele;
    t.grp.position.set(p.x, 0.08, p.z);
    t.mat.uniforms.uR.value = r;
    const size = r + 0.2; t.mesh.scale.set(size, size, 1); t.mat.uniforms.uSize.value = size;
    t.mat.uniforms.uProgress.value = 1;
    t.mat.uniforms.uLocked.value = 0.4;
    t.mat.uniforms.uOpacity.value = 0.55;
  };
  S.hidePreview = function () { if (S.previewTele) { S.previewTele.release(); S.previewTele = null; S.previewKey = null; } };
  const _pv = new V3(), _white = new T.Color(0.85, 0.88, 1.0);

  // ---------------- cast ----------------
  S.ready = function (key) { return S.cd[key] <= 0; };

  S.cast = function (key, aim) {
    if (!S.ready(key)) return false;
    const P = U.player;
    const fn = { Q: castQ, E: castE, R: castR, T: castT, Y: castY }[key];
    S.cd[key] = S.DEFS[key].cd;
    const c = fn(P, aim);
    if (c) S.active.push(c);
    if (U.ui) U.ui.onCast(key);
    return true;
  };

  S.update = function (dt) {
    for (const k of S.KEYS) {
      if (S.cd[k] > 0) {
        S.cd[k] = Math.max(0, S.cd[k] - dt);
        if (S.cd[k] === 0 && U.ui) U.ui.onReady(k);
      }
    }
    for (let i = S.active.length - 1; i >= 0; i--) {
      const c = S.active[i];
      c.t += dt;
      c.update(dt);
      if (c.done) { if (c.cleanup) c.cleanup(); S.active.splice(i, 1); }
    }
    updateFields(dt);
  };

  function aimDirFrom(P, aim) {
    const dx = aim.x - P.pos.x, dz = aim.z - P.pos.z;
    const l = Math.hypot(dx, dz);
    if (l < 0.05) return U.dirFromAngle(P.facing, new V3());
    return new V3(dx / l, 0, dz / l);
  }

  function hitstopAndShake(hs, sh) { U.time.addHitstop(hs); U.world.addShake(sh); }

  // =============== Q — Needle Through Hours ===============
  function castQ(P, aim) {
    const T_ = S.TUNE, m = S.upgradeMult();
    const dir = aimDirFrom(P, aim);
    const width = T_.qWidth * m.qWidth, dmg = T_.qDmg * m.qDmg;
    const rig = P.rig;
    const right = new V3(-dir.z, 0, dir.x); // Vaust's right-hand side when facing `dir`
    const origin = new V3().copy(P.pos).addScaledVector(dir, 1.25).setY(1.3);
    P.setGesture({ kind: 'Q', inT: 0.08, holdT: 0.3, outT: 0.5 });
    U.audio.play('q');
    const hit = new Set();
    const c = {
      t: 0, done: false, released: false, dist: 0, prev: new V3(), head: new V3(),
      update(dt) {
        const t = this.t;
        // spectral hand points toward the cursor beside the slit
        if (t < 0.5) {
          const hp = _a.copy(P.pos).addScaledVector(dir, 0.75).addScaledVector(right, 0.45).setY(1.55 + P.rig.body.position.y);
          rig.command(0, { pos: hp.clone(), up: dir.clone().setY(0.05), palm: _b.set(0, -1, 0).addScaledVector(right, -0.6).clone(), pose: 'point', dur: 0.12, follow: 22, turn: 22, glow: 1.6 });
        }
        // slit opens, then closes after the lance passes
        const open = t < 0.15 ? U.easeOutCubic(t / 0.15) : 1 - U.smooth(U.clamp((t - 0.24) / 0.22, 0, 1));
        S.slit.visible = open > 0.01;
        if (S.slit.visible) {
          S.slit.position.copy(origin);
          orientSlit(S.slit, origin, dir);
          S.slit.scale.set(0.42 * (0.7 + 0.3 * open) * Math.sqrt(m.qWidth), 1.55 * (0.4 + 0.6 * open), 1);
          S.slit.material.uniforms.uOpen.value = open * 0.5 * Math.min(1.4, m.qWidth);
          S.slit.material.uniforms.uOpacity.value = Math.min(1, open * 1.5);
        }
        if (!this.released && t >= 0.13) {
          this.released = true;
          this.head.copy(origin); this.prev.copy(origin);
          S.lance.visible = true; S.lanceTrail.visible = true;
          S.lance.scale.set(width / 0.42, width / 0.42, 1);
          FX.sparks(origin, 12, { speed: 5, dir, bias: 0.75, life: 0.25, size: 0.09, grav: 0 });
          FX.flash(origin, 9, 6, 0.18);
        }
        if (this.released && this.dist < T_.qRange) {
          const step = Math.min(T_.qSpeed * dt, T_.qRange - this.dist);
          this.prev.copy(this.head);
          this.head.addScaledVector(dir, step);
          this.dist += step;
          // pierce: sweep segment against every enemy, each hit once
          for (const e of U.enemies.list) {
            if (hit.has(e) || !e.alive) continue;
            const d = segDist(e.pos, this.prev, this.head);
            if (d <= width + e.radius) {
              hit.add(e);
              const hp = _c.copy(e.pos).setY(e.type === 'idol' ? 1.75 : 1.2);
              U.enemies.hit(e, dmg, { dir, knock: 2.5 });
              FX.fracture(hp, 1.0 + width, 0.34);
              FX.sparks(hp, 14, { speed: 7, dir, bias: 0.55, life: 0.3, size: 0.09, grav: 2 });
              FX.shards(hp, 4, { bright: true, speed: 4, size: 0.07, life: 0.4, grav: 2 });
              FX.flash(hp, 10, 5, 0.18);
              U.audio.play('qhit');
              hitstopAndShake(0.03, 0.07);
            }
          }
          S.lance.position.copy(this.head);
          S.lance.lookAt(_c.copy(this.head).add(dir));
          const tl = Math.min(this.dist, 5);
          S.lanceTrail.position.copy(this.head);
          S.lanceTrail.rotation.set(0, Math.atan2(-dir.x, -dir.z), 0);
          S.lanceTrail.scale.set(width * 1.2, 1, tl);
          S.lanceTrail.material.uniforms.uOpacity.value = 1;
          // light line on the floor along the path
          S.groundLine.visible = true;
          const mid = _a.copy(origin).add(this.head).multiplyScalar(0.5);
          S.groundLine.position.set(mid.x, 0.06, mid.z);
          S.groundLine.rotation.set(-Math.PI / 2, 0, Math.atan2(dir.x, dir.z) + Math.PI);
          S.groundLine.scale.set(width * 2.2, this.dist, 1);
          S.groundLine.material.uniforms.uOpacity.value = 0.9;
          if (this.dist >= T_.qRange) {
            FX.sparks(this.head, 8, { speed: 3, life: 0.25, size: 0.07, grav: 0 });
            this.endT = t;
          }
        }
        if (this.endT != null) {
          const k = U.clamp((t - this.endT) / 0.25, 0, 1);
          S.lance.visible = k < 0.3;
          S.lanceTrail.material.uniforms.uOpacity.value = 1 - k;
          S.groundLine.material.uniforms.uOpacity.value = 0.9 * (1 - k);
          if (k >= 1 && t > 0.5) this.done = true;
        }
      },
      cleanup() { S.slit.visible = false; S.lance.visible = false; S.lanceTrail.visible = false; S.groundLine.visible = false; },
    };
    return c;
  }
  const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3();
  const _sp = new V3(), _sq = new V3();
  function orientSlit(mesh, origin, dir) {
    // billboard; long axis perpendicular to the on-screen direction of travel
    const cam = U.world.camera;
    _sp.copy(origin).project(cam);
    _sq.copy(origin).add(dir).project(cam);
    const ang = Math.atan2((_sq.y - _sp.y), (_sq.x - _sp.x) * cam.aspect);
    mesh.quaternion.copy(cam.quaternion);
    mesh.rotateZ(ang);
  }
  function segDist(p, a, b) {
    const abx = b.x - a.x, abz = b.z - a.z;
    const l2 = abx * abx + abz * abz || 1e-6;
    const t = U.clamp(((p.x - a.x) * abx + (p.z - a.z) * abz) / l2, 0, 1);
    return Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t));
  }

  // =============== E — Hands Beneath ===============
  function castE(P, aim) {
    const T_ = S.TUNE, m = S.upgradeMult();
    const R = T_.eRadius * m.eRadius;
    const center = S.clampTarget(aim, T_.eRange, new V3());
    const n = Math.min(S.eHands.length, Math.round(7 + (m.eRadius - 1) * 6));
    P.setGesture({ kind: 'E', inT: 0.1, holdT: 0.45, outT: 0.7, crouch: 0.05 });
    U.audio.play('eRise');
    FX.ring({ pos: center, r0: R * 0.3, r1: R, dur: 0.45, w0: 0.06, w1: 0.05, opacity: 0.6, fill: 0.08, ease: U.easeOutCubic });
    FX.ring({ pos: center, r0: R, r1: R * 0.98, dur: 1.1, w0: 0.035, w1: 0.03, opacity: 0.45, fadeIn: 0.2 });
    const hands = [];
    for (let i = 0; i < n; i++) {
      const h = S.eHands[i];
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.2;
      hands.push({ h, a, delay: i * 0.02 + Math.random() * 0.05 });
      h.snapPose('reach');
      h.setScale(2.0);
      h.setOpacity(0);
      h.setGlow(1.15);
      h.group.position.set(center.x + Math.sin(a) * R, -1.2, center.z + Math.cos(a) * R);
    }
    const grabbed = [];
    const c = {
      t: 0, done: false, grasped: false,
      update(dt) {
        const t = this.t;
        for (const o of hands) {
          const h = o.h;
          const lt = t - o.delay;
          const inward = _a.set(-Math.sin(o.a), 0, -Math.cos(o.a));
          let r = R * 0.93, y = -1.2, op = 0, lean = 0;
          if (lt < 0.38) { // formation: rise from beneath the floor
            const k = U.easeOutCubic(U.clamp(lt / 0.38, 0, 1));
            y = U.lerp(-1.4, 0.25, k); op = U.clamp(lt / 0.15, 0, 1);
            h.setPose('reach', 8);
          } else if (lt < 0.62) { // decisive grasp: sweep inward and close
            const k = U.easeInCubic(U.clamp((lt - 0.38) / 0.18, 0, 1));
            r = U.lerp(R * 0.93, 0.7, k); y = U.lerp(0.25, 0.55, k); op = 1; lean = k;
            h.setPose(k > 0.4 ? 'clench' : 'claw', 22);
          } else { // sink and dissipate
            const k = U.clamp((lt - 0.62) / 0.5, 0, 1);
            r = 0.7 + k * 0.4; y = U.lerp(0.55, -1.0, U.easeInCubic(k)); op = 1 - k; lean = 1;
          }
          h.group.position.set(center.x - inward.x * r, y, center.z - inward.z * r);
          const up = _b.set(0, 1, 0).lerp(_c.copy(inward).setY(-0.35), lean * 0.85).normalize();
          const palm = _d.copy(inward).lerp(_c.set(0, -1, 0), lean * 0.8).normalize();
          h.orient(up, palm);
          h.setOpacity(op);
          h.update(dt);
        }
        if (!this.pulled && t >= 0.44) {
          this.pulled = true;
          for (const e of U.enemies.list) {
            if (!e.alive) continue;
            const d = Math.hypot(e.pos.x - center.x, e.pos.z - center.z);
            if (d <= R + e.radius * 0.5) grabbed.push({ e, from: e.pos.clone(), a: Math.atan2(e.pos.x - center.x, e.pos.z - center.z), d });
          }
        }
        if (this.pulled && t < 0.62) {
          const k = U.easeInCubic(U.clamp((t - 0.44) / 0.16, 0, 1));
          for (const g of grabbed) {
            if (!g.e.alive) continue;
            const dd = Math.min(g.d, 0.75 + g.e.radius);
            g.e.pos.x = U.lerp(g.from.x, center.x + Math.sin(g.a) * dd, k);
            g.e.pos.z = U.lerp(g.from.z, center.z + Math.cos(g.a) * dd, k);
          }
        }
        if (!this.grasped && t >= 0.58) {
          this.grasped = true;
          U.audio.play('eGrasp');
          FX.ring({ pos: center, r0: R * 0.2, r1: 1.6, dur: 0.3, w0: 0.25, w1: 0.05, opacity: 0.9, intensity: 1.3, ease: U.easeOutQuad });
          FX.mist(_a.copy(center).setY(0.3), 7, { spread: 1.0, rise: 0.6, out: 1.4, life: 0.9, size: 1.1, a: 0.25 });
          FX.sparks(_a.copy(center).setY(0.5), 22, { speed: 6, up: 1.2, life: 0.4, size: 0.1, grav: 4 });
          FX.flash(_a.copy(center).setY(1.0), 18, 8, 0.3);
          let any = false;
          for (const g of grabbed) {
            if (!g.e.alive) continue;
            any = true;
            U.enemies.hit(g.e, T_.eDmg, { root: T_.eRoot });
            FX.ring({ pos: g.e.pos, r0: 0.62, r1: 0.55, dur: T_.eRoot, w0: 0.05, w1: 0.04, opacity: 0.7, fadePow: 4 });
          }
          hitstopAndShake(any ? 0.05 : 0, 0.12);
        }
        if (t > 1.25) this.done = true;
      },
      cleanup() { for (const o of hands) o.h.setOpacity(0); },
    };
    return c;
  }

  // =============== R — Sever the Veil ===============
  function castR(P, aim) {
    const T_ = S.TUNE;
    const dir = aimDirFrom(P, aim);
    const aimYaw = Math.atan2(dir.x, dir.z);
    P.setGesture({ kind: 'R', inT: 0.12, holdT: 0.72, outT: 1.0, release: T_.rWind, twist: -0.25 });
    U.audio.play('rWind');
    const G = S.giant;
    G.snapPose('open');
    G.setOpacity(0);
    G.setScale(3.2);
    let tele = FX.telegraph({ pos: P.pos, r: T_.rRange, half: T_.rHalf, yaw: aimYaw, color: _white, intensity: 0.45 });
    const dropTele = () => { if (tele) { tele.release(); tele = null; } };
    tele.mat.uniforms.uOpacity.value = 0;
    const hit = new Set();
    const pivot = new V3();
    const D = new V3();
    const yawStart = aimYaw - T_.rHalf - 0.08, yawEnd = aimYaw + T_.rHalf + 0.08;
    const SEG = FX.CRESCENT_SEG;
    let prevYaw = yawStart;
    const bladeDir = (yaw, pitch, out) => out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const c = {
      t: 0, done: false, swung: false, firstHit: false,
      startSwing() {
        if (this.swung) return;
        this.swung = true;
        U.audio.play('rSlash');
        this.origin = P.pos.clone();
        dropTele();
        buildArc(S.rCres, pivot, yawStart, yawEnd, 2.3, 9.6);
        buildArc(S.tear, pivot, yawStart, yawEnd, 8.0, 8.9);
        S.rCres.mesh.visible = true;
        S.rCres.mat.uniforms.uOpacity.value = 1;
        S.rCres.mat.uniforms.uColor.value.setRGB(3.0, 3.05, 3.3);
      },
      // damage every enemy whose bearing the visible blade crossed between yaw a and b
      sweep(a, b) {
        const o = this.origin;
        for (const en of U.enemies.list) {
          if (hit.has(en) || !en.alive) continue;
          const dx = en.pos.x - o.x, dz = en.pos.z - o.z;
          const d = Math.hypot(dx, dz);
          if (d > T_.rRange + en.radius) continue;
          const ang = aimYaw + U.angleDiff(aimYaw, Math.atan2(dx, dz));
          if (ang < Math.min(a, b) - 0.05 || ang > Math.max(a, b) + 0.05) continue;
          hit.add(en);
          const tang = _a.set(Math.cos(b), 0, -Math.sin(b)).multiplyScalar(-1);
          const push = _b.set(dx, 0, dz).normalize().multiplyScalar(0.6).add(tang).normalize();
          U.enemies.hit(en, T_.rDmg, { dir: push, knock: 8, heavy: true, stagger: 0.8 });
          const hp = _c.copy(en.pos).setY(1.2);
          FX.sparks(hp, 26, { speed: 9, dir: push, bias: 0.6, life: 0.4, size: 0.12, grav: 3 });
          FX.shards(hp, 6, { bright: true, speed: 6, size: 0.1, life: 0.5, dir: push, bias: 0.5 });
          FX.flash(hp, 16, 7, 0.25);
          FX.fracture(hp, 1.4, 0.3);
          U.audio.play('hit', { heavy: true, gap: 0.02 });
          if (!this.firstHit) { this.firstHit = true; hitstopAndShake(0.085, 0.3); }
        }
      },
      update(dt) {
        const t = this.t, W = T_.rWind, SW = T_.rSwing;
        // pivot above and slightly behind Vaust, following him until the swing commits
        if (t < W) pivot.copy(P.pos).addScaledVector(dir, -1.15).setY(3.5);
        let yaw, pitch, op = 1, sc = 1;
        if (t < W) {
          const k = U.clamp(t / W, 0, 1);
          // anticipation: blade raised high on his right, then cocks down into the swing start
          const cock = U.smooth(U.clamp((t - (W - 0.12)) / 0.12, 0, 1));
          yaw = U.lerp(aimYaw - 2.1, yawStart, cock);
          pitch = U.lerp(0.95, -0.33, cock);
          op = U.smooth(U.clamp(t / 0.25, 0, 1));
          sc = U.lerp(0.55, 1, U.easeOutCubic(k));
          if (tele) {
            tele.mat.uniforms.uOpacity.value = 0.6 * U.clamp(t / 0.2, 0, 1);
            tele.mat.uniforms.uProgress.value = k;
            tele.grp.position.set(P.pos.x, 0.07, P.pos.z);
          }
          G.setPose(k > 0.3 ? 'grip' : 'open', 12);
        } else if (t < W + SW) {
          const k = U.clamp((t - W) / SW, 0, 1);
          const e = 1 - Math.pow(1 - k, 1.6);
          yaw = U.lerp(yawStart, yawEnd, e); pitch = -0.33;
          this.startSwing();
          S.rCres.mat.uniforms.uHead.value = e;
          S.rCres.mat.uniforms.uTail.value = Math.max(0, e - 0.9);
          this.sweep(prevYaw, yaw);
          prevYaw = yaw;
        } else {
          yaw = yawEnd; pitch = -0.33;
          if (prevYaw < yawEnd) { this.startSwing(); this.sweep(prevYaw, yawEnd); prevYaw = yawEnd; S.rCres.mat.uniforms.uHead.value = 1; }
          const k = U.clamp((t - W - SW) / 0.45, 0, 1);
          op = 1 - U.smooth(k); sc = 1 + k * 0.08;
          if (!this.tore) {
            this.tore = true;
            S.tear.mesh.visible = true;
            U.world.addShake(this.firstHit ? 0.1 : 0.22);
            FX.flash(_a.copy(pivot).addScaledVector(bladeDir(aimYaw, -0.33, _d), 5).setY(1.2), 22, 14, 0.3);
            // bright fragments shed along the arc
            for (let i = 0; i < 6; i++) {
              const yy = U.lerp(yawStart, yawEnd, Math.random());
              const p = _a.copy(pivot).addScaledVector(bladeDir(yy, -0.33, _d), 4 + Math.random() * 5);
              FX.shards(p, 2, { bright: true, speed: 3, size: 0.09, life: 0.6, grav: 2 });
              FX.mist(p.setY(0.6), 1, { spread: 0.3, size: 1.2, a: 0.18, life: 0.9 });
            }
          }
          const tk = U.clamp((t - W - SW) / 0.42, 0, 1);
          S.tear.mesh.material.uniforms.uOpen.value = Math.sin(Math.min(1, tk * 1.4) * Math.PI) * 0.75;
          S.tear.mesh.material.uniforms.uOpacity.value = 1 - U.smooth(U.clamp((tk - 0.6) / 0.4, 0, 1));
          S.rCres.mat.uniforms.uOpacity.value = Math.max(0, 1 - k * 2.2);
          S.rCres.mat.uniforms.uTail.value = Math.min(1, S.rCres.mat.uniforms.uTail.value + dt * 4);
          if (t > W + SW + 0.6) this.done = true;
        }
        // place giant hand and blade
        bladeDir(yaw, pitch, D);
        const tan = _a.set(Math.cos(yaw), 0, -Math.sin(yaw)); // swing tangent (yaw increasing)
        const up = _b.crossVectors(D, tan).normalize();
        G.group.position.copy(pivot).addScaledVector(D, -0.25);
        G.orient(up.lengthSq() > 0.01 ? up : _c.set(0, 1, 0), tan);
        G.setScale(3.2 * sc);
        G.setOpacity(op);
        G.setGlow(1.4 + (t > W && t < W + SW ? 0.8 : 0));
        G.update(dt);
        S.blade.visible = op > 0.01;
        S.blade.position.copy(pivot).addScaledVector(D, 0.2);
        _m.makeBasis(_d.crossVectors(D, up).normalize(), D, up);
        S.blade.quaternion.setFromRotationMatrix(_m);
        S.blade.scale.set(1, sc * U.clamp(op * 1.4, 0, 1), 1);
        S.bladeMat.uniforms.uOpacity.value = op;
        S.bladeMat.uniforms.uGlow.value = 1.5 + (t > W && t < W + SW ? 1.2 : 0);
      },
      cleanup() { G.setOpacity(0); S.blade.visible = false; S.rCres.mesh.visible = false; S.tear.mesh.visible = false; dropTele(); },
    };
    function buildArc(cm, pv, y0, y1, rIn, rOut) {
      const pos = cm.geo.attributes.position.array;
      for (let i = 0; i <= SEG; i++) {
        const yy = U.lerp(y0, y1, i / SEG);
        bladeDir(yy, -0.33, _d);
        const taper = Math.sin((i / SEG) * Math.PI);
        const ri = U.lerp(rOut - 0.3, rIn, Math.pow(taper, 0.5));
        pos[i * 6] = pv.x + _d.x * ri; pos[i * 6 + 1] = Math.max(0.08, pv.y + _d.y * ri); pos[i * 6 + 2] = pv.z + _d.z * ri;
        pos[i * 6 + 3] = pv.x + _d.x * rOut; pos[i * 6 + 4] = Math.max(0.08, pv.y + _d.y * rOut); pos[i * 6 + 5] = pv.z + _d.z * rOut;
      }
      cm.geo.attributes.position.needsUpdate = true;
    }
    return c;
  }
  const _m = new T.Matrix4();

  // =============== T — The Missing Second ===============
  function castT(P, aim) {
    const T_ = S.TUNE;
    const center = S.clampTarget(aim, T_.tRange, new V3());
    const f = S.fields.find((x) => !x.active) || S.fields[0];
    f.active = true; f.ending = false; f.t = 0; f.pos.copy(center); f.r = T_.tRadius;
    f.disc.position.set(center.x, 0.075, center.z);
    const size = f.r + 0.3; f.disc.scale.set(size, size, 1); f.mat.uniforms.uSize.value = size;
    f.disc.visible = true; f.frags.visible = true;
    f.spin = Math.random() * 6;
    P.setGesture({ kind: 'T', inT: 0.1, holdT: 0.35, outT: 0.6 });
    U.audio.play('t');
    FX.ring({ pos: center, r0: 0.3, r1: f.r, dur: 0.35, w0: 0.12, w1: 0.04, opacity: 0.8, ease: U.easeOutCubic });
    FX.sparks(_a.copy(center).setY(0.6), 18, { speed: 3, up: 1.5, life: 0.8, size: 0.07, grav: -0.5, drag: 3 });
    return null;
  }
  const _mtx = new T.Matrix4(), _qq = new T.Quaternion(), _eu = new T.Euler(), _sc = new V3(), _pp = new V3();
  function updateFields(dt) {
    const T_ = S.TUNE;
    for (const f of S.fields) {
      if (!f.active) continue;
      f.t += dt;
      const appear = U.easeOutCubic(U.clamp(f.t / 0.3, 0, 1));
      const end = U.clamp((f.t - T_.tDur) / 0.4, 0, 1);
      f.ending = f.t >= T_.tDur;
      f.spin += dt * (1 - end * 0.5);
      f.mat.uniforms.uSpin.value = f.spin;
      f.mat.uniforms.uR.value = f.r * appear * (1 - end * 0.25);
      f.mat.uniforms.uAlpha.value = appear * (1 - end) * (f.t > T_.tDur - 0.6 && f.t < T_.tDur ? 0.75 + 0.25 * Math.sin(f.t * 30) : 1);
      const n = f.seeds.length;
      for (let i = 0; i < n; i++) {
        const s = f.seeds[i];
        const r = s.r * f.r * 0.95 * appear;
        _pp.set(f.pos.x + Math.cos(s.a + f.spin * s.sp * 0.1) * r, s.y + Math.sin(f.t * 0.6 + i) * 0.05 - end * 0.6, f.pos.z + Math.sin(s.a + f.spin * s.sp * 0.1) * r);
        _qq.setFromEuler(_eu.set(s.rx + f.t * s.sp * 0.4, s.ry + f.t * s.sp * 0.3, 0));
        const sc = s.s * appear * (1 - end);
        _mtx.compose(_pp, _qq, _sc.set(sc, sc, sc));
        f.frags.setMatrixAt(i, _mtx);
      }
      f.frags.instanceMatrix.needsUpdate = true;
      if (Math.random() < dt * 6 && !f.ending) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * f.r;
        FX.sparks(_a.set(f.pos.x + Math.cos(a) * r, 0.3 + Math.random() * 1.5, f.pos.z + Math.sin(a) * r), 1, { speed: 0.15, life: 1.2, size: 0.06, grav: 0, a: 0.6, drag: 0.5 });
      }
      if (end >= 1) { f.active = false; f.disc.visible = false; f.frags.visible = false; }
    }
  }

  // =============== Y — The Seal Objects ===============
  function castY(P, aim) {
    const T_ = S.TUNE;
    const rig = P.rig;
    P.setGesture({ kind: 'Y', inT: 0.25, holdT: 1.0, outT: 1.35, headX: -0.18 });
    U.audio.play('yCharge');
    const hit = new Set();
    const center = new V3();
    // four positions surrounding him, fixed to the view so the cage reads from the camera
    const slots = [new V3(-2.5, 3.3, -1.0), new V3(2.5, 3.3, -1.0), new V3(-2.9, 1.45, 0.9), new V3(2.9, 1.45, 0.9)];
    const c = {
      t: 0, done: false, released: false, firstHit: false,
      update(dt) {
        const t = this.t, CH = T_.yCharge;
        if (!this.released) center.copy(P.pos);
        if (t < CH) {
          const k = U.clamp(t / CH, 0, 1);
          U.world.dim = U.smooth(U.clamp(k * 1.4, 0, 1));
          // the hands enlarge and surround him, brightening, then clench
          for (let i = 0; i < 4; i++) {
            const s = slots[i];
            const out = U.easeOutCubic(U.clamp(k * 1.5, 0, 1));
            const pos = _a.set(center.x + s.x * out, s.y * out + 1.2 * (1 - out), center.z + s.z * out);
            const toC = _b.set(center.x - pos.x, 1.6 - pos.y, center.z - pos.z).normalize();
            const up = _c.set(s.x * 0.25, 1, s.z * 0.2).normalize();
            const pose = k < 0.45 ? 'open' : k < 0.78 ? 'claw' : 'clench';
            rig.command(i, { pos: pos.clone(), up: up.clone(), palm: toC.clone(), pose, poseSpeed: k < 0.78 ? 8 : 26, dur: 0.1, follow: 10, turn: 10, scale: U.lerp(1.2, 3.3, U.easeOutCubic(U.clamp(k * 1.3, 0, 1))), scaleSpeed: 12, glow: 1.2 + k * 1.4 });
          }
          // halo unfolds behind him (facing the camera)
          S.halo.visible = true;
          S.halo.position.set(center.x, 2.25 + P.rig.body.position.y, center.z - 0.9);
          S.halo.quaternion.copy(U.world.camera.quaternion);
          const hk = U.easeOutCubic(U.clamp((t - 0.1) / 0.7, 0, 1));
          S.halo.scale.setScalar(0.6 + 0.4 * hk);
          S.haloSegs.forEach((m, i) => {
            const stag = U.clamp(hk * 1.4 - (i % 11) * 0.03, 0, 1);
            const a = m.userData.final * stag + (1 - stag) * (m.userData.outer ? 1.2 : -0.6);
            if (m.userData.spoke) {
              m.position.set(Math.cos(a) * 1.95, Math.sin(a) * 1.95, 0);
              m.rotation.set(0, 0, a - Math.PI / 2);
              m.scale.setScalar(stag);
            } else m.rotation.set(0, 0, a);
          });
          S.haloMat.uniforms.uOpacity.value = hk * 0.9;
          S.haloMat.uniforms.uGlow.value = 1.3 + k * 1.6;
          // light converging toward him
          if (!this.conv) { this.conv = true; FX.ring({ pos: center, r0: T_.yRadius, r1: 0.6, dur: CH * 0.95, w0: 0.05, w1: 0.2, opacity: 0.55, ease: U.easeInCubic, fadePow: 6 }); }
          if (Math.random() < dt * 40) {
            const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 5;
            const p = _a.set(center.x + Math.cos(a) * r, 0.2 + Math.random() * 1.2, center.z + Math.sin(a) * r);
            FX.sparks(p, 1, { speed: r * 1.6, dir: _b.set(center.x - p.x, 0.6, center.z - p.z).normalize(), bias: 1, life: 0.45, size: 0.08, grav: 0, drag: 0.5 });
          }
        } else if (!this.released) {
          this.released = true;
          U.world.dim = 0;
          U.world.sealPulse = 1;
          U.audio.play('yBurst');
          U.world.addShake(0.45);
          U.time.addHitstop(0.07);
          U.world.grade.uniforms.uFlash.value = 1;
          FX.ring({ pos: center, r0: 0.5, r1: T_.yRadius + 0.6, dur: 0.42, w0: 0.45, w1: 0.06, opacity: 1, intensity: 2.2, fill: 0.25, ease: U.easeOutCubic });
          FX.ring({ pos: center, r0: 0.3, r1: T_.yRadius * 0.72, dur: 0.7, w0: 0.2, w1: 0.03, opacity: 0.7, intensity: 1.4, ease: U.easeOutCubic });
          FX.ring({ pos: center, r0: T_.yRadius + 0.3, r1: T_.yRadius + 1.2, dur: 0.9, w0: 0.06, w1: 0.02, opacity: 0.5, ease: U.easeOutCubic });
          FX.crack(center, T_.yRadius * 1.05, 1.15, 0.5);
          FX.flash(_a.copy(center).setY(2), 60, 18, 0.45);
          FX.shards(_a.copy(center).setY(1.4), 34, { bright: true, speed: 13, up: 0.35, size: 0.13, life: 0.8, spread: 1.0, grav: 4 });
          FX.shards(_a.copy(center).setY(0.2), 20, { speed: 9, up: 0.8, size: 0.16, life: 1.2, spread: 1.4, colors: [_stone1, _stone2] });
          for (let i = 0; i < 16; i++) {
            const a = (i / 16) * Math.PI * 2;
            FX.mist(_a.set(center.x + Math.cos(a) * 2.2, 0.4, center.z + Math.sin(a) * 2.2), 1, { spread: 0.3, vel: _b.set(Math.cos(a) * 7, 0.5, Math.sin(a) * 7), drag: 3.2, life: 1.3, size: 1.6, a: 0.3, out: 0.2 });
          }
          FX.sparks(_a.copy(center).setY(0.4), 50, { speed: 14, up: 0.3, life: 0.5, size: 0.11, grav: 3 });
          // hands slam inward, then burst
          for (let i = 0; i < 4; i++) {
            rig.command(i, { pos: _a.copy(center).setY(1.5).clone(), up: _b.set(0, 1, 0).clone(), palm: _c.set(-slots[i].x, 0, -slots[i].z).normalize().clone(), pose: 'clench', dur: 0.12, follow: 40, turn: 30, scale: 2.2, scaleSpeed: 30, glow: 3 });
          }
          this.relT = t;
        }
        if (this.released) {
          const rt = t - this.relT;
          U.world.grade.uniforms.uFlash.value = Math.max(0, 1 - rt / 0.18);
          // damage as the rupture front reaches each enemy
          const front = U.lerp(0.5, T_.yRadius + 0.6, U.easeOutCubic(U.clamp(rt / 0.42, 0, 1)));
          for (const e of U.enemies.list) {
            if (hit.has(e) || !e.alive) continue;
            const d = Math.hypot(e.pos.x - center.x, e.pos.z - center.z);
            if (d <= T_.yRadius + e.radius && d <= front + e.radius) {
              hit.add(e);
              const dir = _b.set(e.pos.x - center.x, 0, e.pos.z - center.z).normalize();
              U.enemies.hit(e, T_.yDmg, { dir, knock: 10, heavy: true, stagger: 1.0 });
              const hp = _c.copy(e.pos).setY(1.2);
              FX.sparks(hp, 18, { speed: 8, dir, bias: 0.5, life: 0.4, size: 0.11 });
              FX.fracture(hp, 1.3, 0.3);
              if (!this.firstHit) { this.firstHit = true; U.audio.play('hit', { heavy: true }); }
            }
          }
          // halo shatters outward
          const hk = U.clamp(rt / 0.5, 0, 1);
          S.halo.scale.setScalar(1 + hk * 0.9);
          S.haloMat.uniforms.uOpacity.value = 0.9 * (1 - hk);
          S.haloMat.uniforms.uGlow.value = 3 * (1 - hk) + 0.5;
          if (hk >= 1) S.halo.visible = false;
          // main hands dissolve after the slam and re-form at their anchors
          for (const h of rig.hands) h.fade = U.clamp(rt < 0.1 ? 1 : 1 - (rt - 0.1) / 0.12, 0, 1) + U.clamp((rt - 0.7) / 0.6, 0, 1);
          if (rt > 0.15 && !this.reset) {
            this.reset = true;
            for (let i = 0; i < 4; i++) {
              const h = rig.hands[i];
              h.override = null;
              h.group.position.copy(h.anchor.p).applyAxisAngle(_yAxis, P.facing).add(P.pos);
              h.setScale(h.baseScale);
            }
            FX.shards(_a.copy(center).setY(1.5), 16, { bright: true, speed: 7, size: 0.1, life: 0.6, grav: 1 });
          }
          if (rt > 1.4) this.done = true;
        }
      },
      cleanup() {
        U.world.dim = 0;
        S.halo.visible = false;
        U.world.grade.uniforms.uFlash.value = 0;
        for (const h of rig.hands) h.fade = 1;
      },
    };
    return c;
  }
  const _yAxis = new V3(0, 1, 0);
  const _stone1 = new T.Color(0.13, 0.13, 0.15), _stone2 = new T.Color(0.3, 0.3, 0.33);
})(window.U);
