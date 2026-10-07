/* UNHALLOWED — Vaust's five skills.
   Q Needle Through Hours · E Hands Beneath · R Sever the Veil · T The Missing Second · 1 The Seal Objects
   None of them obey the order of things: the lance has already struck before it is thrown, the floor
   swallows bodies and spits them back out, a cut stays open, time stutters and rewinds, and the seal
   simply deletes what it closes on. Cooldowns start when a cast commits. */
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
    qDmg: 30, qWidth: 0.42, qRange: 19, qPin: 0.6, qMark: 4, qEcho: 2.0, qEchoMult: 0.5,
    eRadius: 3.2, eRange: 12, eDmg: 18, eHold: 1.4, eTrap: 3.0, eTrapDmg: 12,
    rDmg: 72, rRange: 8.3, rHalf: 1.2, rWind: 0.55, rSwing: 0.12, rTear: 3.0, rRecut: 18, rSplit: 16,
    tRadius: 4.5, tRange: 12, tDur: 4, tScale: 0.5, tCrawl: 0.2, tStutter: 0.7, tRewind: 0.75,
    yRadius: 8.4, yCharge: 1.0,
  };
  const STRAIN = { Q: 0.1, E: 0.14, R: 0.22, T: 0.18, Y: 0.6 };

  S.cd = { Q: 0, E: 0, R: 0, T: 0, Y: 0 };
  S.active = [];
  S.fields = [];
  S.freeze = 0;   // The Seal Objects: the world holds still
  S.strain = 0;   // what using all this costs him (flavour: dark edges, whispering)

  // ---------------- shaders ----------------
  const SLIT_FS = `
#define sq(x) ((x)*(x))
    uniform float uOpen, uOpacity; varying vec2 vUv;
    void main(){
      vec2 p = vUv * 2.0 - 1.0;
      float w = uOpen * 0.22 * pow(max(1.0 - p.y * p.y, 0.0), 1.5);   // thin lens, long axis along local Y, sharp tips
      float d = abs(p.x) - w;
      float edge = exp(-sq(d / 0.035)) * (1.0 - smoothstep(0.7, 1.0, abs(p.y)));
      float core = (1.0 - smoothstep(-0.02, 0.0, d)) * step(0.004, w);   // dark interior, only inside the lens
      float a = clamp(edge + core * 0.85, 0.0, 1.0) * uOpacity;
      if (a < 0.004) discard;
      gl_FragColor = vec4(vec3(2.8, 2.85, 3.1) * edge, a);
    }`;
  // the standing tear left by Sever the Veil: a wound in the air with stars behind it, and an eye
  const RIFT_FS = `
#define sq(x) ((x)*(x))
    uniform float uOpen, uOpacity, uTime, uEye, uLen; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main(){
      float x = vUv.x, y = vUv.y;
      float taper = sin(clamp(x, 0.0, 1.0) * 3.14159);
      float w = uOpen * taper * 0.36 * (1.0 + 0.14 * sin(x * 41.0 + uTime * 2.3));
      float cy = 0.42 + 0.05 * sin(x * 9.0 + 1.3);
      float d = abs(y - cy) - w;
      if (d > 0.08 || w < 0.002) discard;
      float edge = exp(-sq(d / 0.022));
      float inside = 1.0 - smoothstep(-0.012, 0.0, d);
      // beyond it: cold stars, drifting the wrong way
      vec2 sp = vec2(x * uLen * 3.0, (y - cy) * 9.0 - uTime * 0.25);
      vec2 cell = floor(sp); vec2 f = fract(sp) - 0.5;
      float h = hash(cell);
      float star = step(0.8, h) * exp(-dot(f, f) * 70.0) * (0.55 + 0.45 * sin(uTime * 3.0 + h * 40.0));
      vec3 col = vec3(0.008, 0.01, 0.026) + vec3(0.75, 0.8, 1.0) * star * 1.6;
      // and something looking back out
      vec2 e = vec2((x - 0.5) * uLen, (y - cy) * 2.6);
      float lid = max(0.0, 1.0 - sq(e.x / 0.5)) * 0.2 * uEye;
      float eye = (1.0 - smoothstep(lid - 0.02, lid, abs(e.y))) * step(0.001, lid);
      vec2 ip = e - vec2(0.06 * sin(uTime * 1.3), 0.0);
      float ir = length(ip);
      vec3 ec = mix(vec3(0.2, 0.2, 0.22), vec3(1.6, 1.5, 1.2), (1.0 - smoothstep(0.15, 0.17, ir)));
      ec = mix(ec, vec3(0.0), (1.0 - smoothstep(0.02, 0.035, abs(ip.x))) * (1.0 - smoothstep(0.1, 0.15, ir)));
      col = mix(col, ec, eye * inside);
      float a = clamp(edge + inside, 0.0, 1.0) * uOpacity;
      if (a < 0.003) discard;
      gl_FragColor = vec4(col * inside + vec3(2.4, 2.45, 2.7) * edge, a);
    }`;
  // the shadow of the giant blade, crossing the ground before it falls
  const SHADOW_FS = `
    uniform float uOpacity, uHead, uTail; varying vec2 vUv;
    void main(){
      float along = smoothstep(uTail - 0.02, uTail + 0.12, vUv.x) * (1.0 - smoothstep(uHead - 0.1, uHead, vUv.x));
      float v = vUv.y;
      float a = along * smoothstep(0.0, 0.25, v) * (1.0 - smoothstep(0.85, 1.0, v)) * uOpacity;
      if (a < 0.003) discard;
      gl_FragColor = vec4(0.0, 0.0, 0.0, a);
    }`;
  const FIELD_FS = `
#define sq(x) ((x)*(x))
    uniform float uR, uAlpha, uSpin, uTime; varying vec2 vP;
    float band(float d, float r, float w){ return exp(-sq((d - r) / w)); }
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
      float tick = (1.0 - smoothstep(0.0, 0.16, abs(fract(ti) - 0.5))) * step(uR * (major > 0.5 ? 0.84 : 0.89), d) * step(d, uR * 0.95);
      // two hands, both turning the wrong way, and not at the same rate
      float ha = -uSpin * 0.9;
      vec2 hd = vec2(cos(ha), sin(ha));
      float along = dot(vP, hd);
      float hand = exp(-sq(abs(vP.x * hd.y - vP.y * hd.x) / 0.03)) * step(0.0, along) * step(along, uR * 0.74);
      float hb = -uSpin * 0.13 + 1.7;
      vec2 hd2 = vec2(cos(hb), sin(hb));
      float along2 = dot(vP, hd2);
      float hand2 = exp(-sq(abs(vP.x * hd2.y - vP.y * hd2.x) / 0.045)) * step(0.0, along2) * step(along2, uR * 0.48);
      float fill = 0.045 * (1.0 - smoothstep(uR - 0.1, uR, d)) * (0.7 + 0.3 * sin(d * 6.0 + uTime * 1.5));
      float al = (r1 * 0.95 + r2 * 0.7 + r3 * 0.55 + r4 * 0.25 + tick * 0.6 + hand * 0.75 + hand2 * 0.6 + fill) * uAlpha;
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
  // a strip of SEG quads: uv.x along, uv.y across; positions filled per cast
  function stripMesh(seg, mat, renderOrder) {
    const geo = new T.BufferGeometry();
    const n = (seg + 1) * 2;
    geo.setAttribute('position', new T.BufferAttribute(new Float32Array(n * 3), 3).setUsage(T.DynamicDrawUsage));
    const uv = new Float32Array(n * 2);
    for (let i = 0; i <= seg; i++) { uv[i * 4] = i / seg; uv[i * 4 + 1] = 0; uv[i * 4 + 2] = i / seg; uv[i * 4 + 3] = 1; }
    geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
    const idx = [];
    for (let i = 0; i < seg; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    const m = new T.Mesh(geo, mat);
    m.frustumCulled = false; m.visible = false; m.renderOrder = renderOrder;
    S.scene.add(m);
    return { mesh: m, geo, mat, seg };
  }

  const E_MAIN = 13, E_LATE = 5;

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
      fragmentShader: `
#define sq(x) ((x)*(x))
uniform float uOpacity; varying vec2 vUv; void main(){ float a = pow(vUv.y, 1.5) * (1.0 - sq(abs(vUv.x * 2.0 - 1.0))); gl_FragColor = vec4(vec3(2.2, 2.25, 2.5), a * uOpacity); }`,
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
    }));
    S.lanceTrail.visible = false; S.lanceTrail.renderOrder = 9; scene.add(S.lanceTrail);
    S.groundLine = new T.Mesh(new T.PlaneGeometry(1, 1), new T.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 } }, vertexShader: QUAD_VS,
      fragmentShader: `
#define sq(x) ((x)*(x))
uniform float uOpacity; varying vec2 vUv; void main(){ float a = exp(-sq((vUv.x - 0.5) / 0.18)) * smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.85, 1.0, vUv.y)); gl_FragColor = vec4(vec3(1.5, 1.52, 1.65), a * uOpacity); }`,
      transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    }));
    S.groundLine.rotation.x = -Math.PI / 2; S.groundLine.visible = false; S.groundLine.renderOrder = 3; scene.add(S.groundLine);

    // E: hands from beneath — they have too many fingers
    S.eHands = [];
    for (let i = 0; i < E_MAIN + E_LATE; i++) {
      const h = new U.SpectralHand(scene, { mirror: i % 2 === 1, opacity: 1, glow: 1.3, core: 0.32, fingers: 6 + (i % 3 === 0 ? 1 : 0) });
      h.setOpacity(0);
      S.eHands.push(h);
    }

    // R: giant hand + blade, crescent, ground shadow and the standing rift
    S.giant = new U.SpectralHand(scene, { opacity: 1, glow: 1.4, core: 0.26, edge: 1.0 });
    S.giant.setOpacity(0);
    S.bladeMat = U.spectralMaterial({ opacity: 1, core: 0.35, edge: 1.0, glow: 1.6 });
    S.blade = new T.Mesh(bigBladeGeom(9.4, 0.42), S.bladeMat);
    S.blade.visible = false; S.blade.renderOrder = 6; scene.add(S.blade);
    S.rCres = FX.makeCrescentMesh();
    S.rCres.mesh.matrix.identity(); S.rCres.mesh.matrixWorld.identity();
    S.rShadow = stripMesh(FX.CRESCENT_SEG, new T.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 }, uHead: { value: 0 }, uTail: { value: 0 } }, vertexShader: QUAD_VS, fragmentShader: SHADOW_FS,
      transparent: true, depthWrite: false,
    }), 2);
    S.rift = stripMesh(40, new T.ShaderMaterial({
      uniforms: { uOpen: { value: 0 }, uOpacity: { value: 1 }, uTime: U.shared.uTime, uEye: { value: 0 }, uLen: { value: 10 } },
      vertexShader: QUAD_VS, fragmentShader: RIFT_FS, transparent: true, depthWrite: false, side: T.DoubleSide,
    }), 10);
    S.tears = [];

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
      S.fields.push({ disc, mat, frags, seeds, active: false, dead: true, pos: new V3(), t: 0, r: S.TUNE.tRadius, last: new Map(), replay: [], stut: 0, skip: false, clock: 0 });
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
    for (const f of S.fields) { f.active = false; f.dead = true; f.disc.visible = false; f.frags.visible = false; f.last.clear(); f.replay.length = 0; }
    S.slit.visible = false; S.lance.visible = false; S.lanceTrail.visible = false; S.groundLine.visible = false;
    for (const h of S.eHands) h.setOpacity(0);
    S.giant.setOpacity(0); S.blade.visible = false;
    S.rCres.mesh.visible = false; S.rShadow.mesh.visible = false; S.rift.mesh.visible = false;
    S.tears.length = 0;
    S.halo.visible = false;
    if (S.previewTele) { S.previewTele.release(); S.previewTele = null; }
    S.freeze = 0; S.strain = 0; S._replaying = false;
    U.world.dim = 0; U.world.neg = 0; U.world.eye = 0; U.world.strain = 0;
    if (U.audio.setStrain) U.audio.setStrain(0);
  };

  // ---------------- queries used by enemies ----------------
  function fieldContaining(pos) {
    for (const f of S.fields) {
      if (!f.active || f.ending) continue;
      if (Math.hypot(pos.x - f.pos.x, pos.z - f.pos.z) <= f.r) return f;
    }
    return null;
  }
  // inside The Missing Second things crawl; every so often the lost time arrives all at once (S.skipAt)
  S.timeScaleAt = function (pos) { return fieldContaining(pos) ? S.TUNE.tCrawl : 1; };
  S.fieldAt = fieldContaining;
  S.skipAt = function (pos) { const f = fieldContaining(pos); return !!(f && f.skip); };
  // remember the last wound each body took inside a field: the collapse plays it back
  S.recordHit = function (e, dmg) {
    if (S._replaying) return;
    for (const f of S.fields) {
      if (!f.active || f.ending) continue;
      if (Math.hypot(e.pos.x - f.pos.x, e.pos.z - f.pos.z) <= f.r) f.last.set(e, dmg);
    }
  };
  // a standing rift swallows enemy projectiles that touch it
  S.tearSwallow = function (pos) {
    for (const tr of S.tears) {
      if (!tr.open) continue;
      const dx = pos.x - tr.origin.x, dz = pos.z - tr.origin.z;
      if (Math.abs(Math.hypot(dx, dz) - tr.r) > 0.55) continue;
      const ang = tr.aimYaw + U.angleDiff(tr.aimYaw, Math.atan2(dx, dz));
      if (ang < tr.y0 || ang > tr.y1) continue;
      FX.sparks(pos, 8, { speed: 2.5, life: 0.3, size: 0.07, grav: 0, dir: _sw.set(-dx, 0, -dz).normalize(), bias: 0.6 });
      FX.ring({ pos: _sw.copy(pos).setY(0.06), r0: 0.5, r1: 0.05, dur: 0.25, w0: 0.05, w1: 0.02, opacity: 0.6 });
      U.audio.play('swallow', { gap: 0.05 });
      tr.eyeKick = 1;
      return true;
    }
    return false;
  };
  const _sw = new V3();

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
    // every cast costs something: the seal on his chest flares, the edges of the world darken
    S.strain = Math.min(1, S.strain + STRAIN[key]);
    U.world.sealPulse = Math.max(U.world.sealPulse, 0.45);
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
    S.freeze = Math.max(0, S.freeze - dt);
    S.strain = Math.max(0, S.strain - dt * 0.07);
    U.world.strain = U.smooth(U.clamp((S.strain - 0.15) / 0.75, 0, 1));
    if (U.audio.setStrain) U.audio.setStrain(S.strain);
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
  const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3();

  // =============== Q — Needle Through Hours ===============
  // The lance has already struck before it is thrown: everything on the line is hit at once and pinned
  // in time; only afterwards does the slit open, and the lance is seen flying backwards into it.
  // Two seconds later the line remembers and strikes again.
  function castQ(P, aim) {
    const T_ = S.TUNE, m = S.upgradeMult();
    const dir = aimDirFrom(P, aim);
    const width = T_.qWidth * m.qWidth, dmg = T_.qDmg * m.qDmg;
    const rig = P.rig;
    const right = new V3(-dir.z, 0, dir.x);
    const origin = new V3().copy(P.pos).addScaledVector(dir, 1.25).setY(1.3);
    // the line runs to its full length or the courtyard's edge
    let len = 0;
    while (len < T_.qRange) {
      const x = origin.x + dir.x * (len + 0.25), z = origin.z + dir.z * (len + 0.25);
      if (Math.hypot(x, z) > U.arenaMaxR(x, z) + 1.5) break;
      len += 0.25;
    }
    len = Math.max(len, 2);
    const end = origin.clone().addScaledVector(dir, len);
    const g0 = origin.clone().setY(0), g1 = end.clone().setY(0);
    P.setGesture({ kind: 'Q', inT: 0.08, holdT: 0.3, outT: 0.5 });
    U.audio.play('q');
    const fly = len / 58;
    const c = {
      t: 0, done: false, struck: false, echoed: false, flyT: -1, flyK: 1, lineK: 0,
      strike(mult, first) {
        let any = false;
        for (const e of U.enemies.list) {
          if (!e.alive || e.under) continue;
          if (segDist(e.pos, origin, end) > width + e.radius) continue;
          any = true;
          const hp = _c.copy(e.pos).setY(e.type === 'idol' ? 1.75 : 1.2);
          U.enemies.hit(e, dmg * mult, { mark: T_.qMark });
          if (first) U.enemies.pin(e, T_.qPin);
          FX.fracture(hp, (1.0 + width) * (0.6 + 0.4 * mult), 0.34);
          FX.sparks(hp, first ? 14 : 8, { speed: 6, dir: _d.copy(dir).negate(), bias: 0.5, life: 0.3, size: 0.09, grav: 2 });
          FX.shards(hp, first ? 4 : 2, { bright: true, speed: 4, size: 0.07, life: 0.4, grav: 2 });
          FX.flash(hp, 10 * mult, 5, 0.18);
          if (first) FX.wrong(e.pos, 0.9, 3.5, 0.5);
        }
        if (any) { U.audio.play('qhit'); hitstopAndShake(first ? 0.05 : 0.025, first ? 0.1 : 0.05); }
        // the floor along the line stays wrong: an inverted seam that lingers
        FX.seam(g0, g1, width * (first ? 1.0 : 0.7), first ? 2.6 : 1.4);
        this.lineK = mult;
        this.flyT = this.t; this.flyK = mult;
        S.lanceMat.color.setRGB(3.0, 3.05, 3.3).multiplyScalar(0.35 + 0.65 * mult);
        FX.flash(_a.copy(end).setY(1.2), 8 * mult, 6, 0.2);
        FX.sparks(end, 8, { speed: 3, life: 0.3, size: 0.07, grav: 0 });
      },
      update(dt) {
        const t = this.t;
        // spectral hand points along the line beside the slit
        if (t < 0.5) {
          const hp = _a.copy(P.pos).addScaledVector(dir, 0.75).addScaledVector(right, 0.45).setY(1.55 + P.rig.body.position.y);
          rig.command(0, { pos: hp.clone(), up: dir.clone().setY(0.05), palm: _b.set(0, -1, 0).addScaledVector(right, -0.6).clone(), pose: 'point', dur: 0.12, follow: 22, turn: 22, glow: 1.6 });
        }
        if (!this.struck && t >= 0.08) { this.struck = true; this.strike(1, true); }
        if (!this.echoed && t >= T_.qEcho) { this.echoed = true; U.audio.play('pin', { gap: 0.05 }); this.strike(T_.qEchoMult, false); }
        // the bright line on the floor flashes the instant it is struck, then fades
        const lk = this.flyT >= 0 ? U.clamp(1 - (t - this.flyT) / 0.6, 0, 1) : 0;
        S.groundLine.visible = lk > 0.01;
        if (S.groundLine.visible) {
          S.groundLine.position.set((g0.x + g1.x) / 2, 0.06, (g0.z + g1.z) / 2);
          S.groundLine.rotation.set(-Math.PI / 2, 0, Math.atan2(dir.x, dir.z) + Math.PI);
          S.groundLine.scale.set(width * 2.2, len, 1);
          S.groundLine.material.uniforms.uOpacity.value = 0.95 * lk * lk * this.lineK;
        }
        // afterwards: the lance flies backwards out of the struck line and into the slit
        const lt = this.flyT >= 0 ? t - this.flyT : -1;
        const flying = lt >= 0 && lt < fly;
        S.lance.visible = flying;
        S.lanceTrail.visible = lt >= 0 && lt < fly + 0.2;
        if (lt >= 0) {
          const k = U.clamp(lt / fly, 0, 1);
          const head = _a.copy(end).addScaledVector(dir, -len * U.easeInCubic(k * 0.6 + 0.4 * k * k) );
          S.lance.position.copy(head);
          S.lance.lookAt(_b.copy(head).add(dir));
          S.lance.scale.set(width / 0.42, width / 0.42, 1);
          S.lanceTrail.position.copy(head);
          S.lanceTrail.rotation.set(0, Math.atan2(dir.x, dir.z), 0);
          S.lanceTrail.scale.set(width * 1.2, 1, Math.max(0.01, Math.min(len * k, 5)));
          S.lanceTrail.material.uniforms.uOpacity.value = this.flyK * (1 - U.clamp((lt - fly) / 0.2, 0, 1));
        }
        // the slit opens only after the strike, takes the lance back, and closes
        let open = 0;
        if (lt >= 0) open = U.easeOutCubic(U.clamp(lt / 0.12, 0, 1)) * (1 - U.smooth(U.clamp((lt - fly - 0.04) / 0.2, 0, 1))) * (0.5 + 0.5 * this.flyK);
        S.slit.visible = open > 0.01;
        if (S.slit.visible) {
          S.slit.position.copy(origin);
          orientSlit(S.slit, origin, dir);
          S.slit.scale.set(1.1 * Math.sqrt(m.qWidth), 1.7 * (0.4 + 0.6 * open), 1);
          S.slit.material.uniforms.uOpen.value = open * 0.5 * Math.min(1.4, m.qWidth);
          S.slit.material.uniforms.uOpacity.value = Math.min(1, open * 1.5);
          if (!this.swallowed && lt >= fly) {
            this.swallowed = true;
            FX.sparks(origin, 10, { speed: 4, dir: _b.copy(dir).negate(), bias: 0.6, life: 0.25, size: 0.08, grav: 0 });
            FX.flash(origin, 7 * this.flyK, 5, 0.15);
          }
        }
        if (this.echoed && lt > fly + 0.35) this.done = true;
        if (!this.echoed && lt > fly + 0.3) this.swallowed = false;
      },
      cleanup() { S.slit.visible = false; S.lance.visible = false; S.lanceTrail.visible = false; S.groundLine.visible = false; S.lanceMat.color.setRGB(3.0, 3.05, 3.3); },
    };
    return c;
  }
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
  // Hands with too many fingers rise around the circle. Each one that finds a body drags it waist-deep
  // into the floor, holds it there, then pulls it under entirely and lets it surface somewhere else.
  // Hands that catch nothing stay, half-buried, and take the first thing that walks past.
  const _hu = new V3(), _hp = new V3(), _hq = new V3();
  function driveHand(o, dt) {
    const h = o.h;
    h.group.position.set(o.x, o.y, o.z);
    const up = _hu.set(0, 1, 0).lerp(_hq.set(o.ix, -0.35, o.iz), o.lean * 0.85).normalize();
    const palm = _hp.set(o.ix, 0, o.iz).lerp(_hq.set(0, -1, 0), o.lean * 0.8).normalize();
    h.orient(up, palm);
    h.setOpacity(o.op);
    h.update(dt);
  }
  function castE(P, aim) {
    const T_ = S.TUNE, m = S.upgradeMult();
    const R = T_.eRadius * m.eRadius;
    const center = S.clampTarget(aim, T_.eRange, new V3());
    const n = Math.min(E_MAIN, Math.round(7 + (m.eRadius - 1) * 6));
    P.setGesture({ kind: 'E', inT: 0.1, holdT: 0.45, outT: 0.7, crouch: 0.05 });
    U.audio.play('eRise');
    FX.ring({ pos: center, r0: R * 0.3, r1: R, dur: 0.45, w0: 0.06, w1: 0.05, opacity: 0.6, fill: 0.08, ease: U.easeOutCubic });
    FX.ring({ pos: center, r0: R, r1: R * 0.98, dur: T_.eTrap + 0.8, w0: 0.035, w1: 0.03, opacity: 0.35, fadeIn: 0.2, fadePow: 3 });
    const hands = [];
    for (let i = 0; i < n; i++) {
      const h = S.eHands[i];
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.2;
      const o = { h, a, delay: i * 0.02 + Math.random() * 0.05, mode: 'rise', x: center.x + Math.sin(a) * R * 0.93, y: -1.4, z: center.z + Math.cos(a) * R * 0.93, ix: -Math.sin(a), iz: -Math.cos(a), op: 0, lean: 0, target: null, t0: 0, trapT: 0 };
      hands.push(o);
      h.snapPose('reach'); h.setScale(2.0); h.setOpacity(0); h.setGlow(1.15);
    }
    const late = [];
    for (let i = 0; i < E_LATE; i++) {
      const h = S.eHands[E_MAIN + i];
      const a = Math.random() * Math.PI * 2, r = R * (1.0 + Math.random() * 0.18);
      late.push({ h, at: 0.85 + i * 0.38 + Math.random() * 0.2, mode: 'wait', x: center.x + Math.sin(a) * r, y: -1.5, z: center.z + Math.cos(a) * r, ix: -Math.sin(a), iz: -Math.cos(a), op: 0, lean: 0, lt: 0 });
      h.snapPose('reach'); h.setScale(1.6 + Math.random() * 0.6); h.setOpacity(0); h.setGlow(1.0);
    }
    const seize = (o, e, dmg, hold) => {
      o.mode = 'hold'; o.target = e;
      U.enemies.hit(e, dmg, {});
      if (e.alive) U.enemies.grab(e, center, R, hold);
      FX.wrong(e.pos, 1.0, 3.2, 0.6);
      FX.ring({ pos: e.pos, r0: 1.2, r1: 0.5, dur: 0.3, w0: 0.08, w1: 0.03, opacity: 0.8 });
      FX.sparks(_a.copy(e.pos).setY(0.4), 10, { speed: 4, up: 1, life: 0.35, size: 0.08, grav: 4 });
    };
    const c = {
      t: 0, done: false, grasped: false, assigned: false,
      update(dt) {
        const t = this.t;
        // the decisive moment: each body in the circle is claimed by the nearest hand
        if (!this.assigned && t >= 0.36) {
          this.assigned = true;
          for (const e of U.enemies.list) {
            if (!e.alive || e.under || e.grip) continue;
            if (Math.hypot(e.pos.x - center.x, e.pos.z - center.z) > R + e.radius * 0.5) continue;
            let best = null, bd = Infinity;
            for (const o of hands) {
              if (o.target) continue;
              const d = Math.hypot(o.x - e.pos.x, o.z - e.pos.z);
              if (d < bd) { bd = d; best = o; }
            }
            if (best) { best.target = e; best.mode = 'lunge'; best.t0 = t; best.sx = best.x; best.sz = best.z; best.sy = best.y; }
          }
          for (const o of hands) if (!o.target) { o.mode = 'settle'; o.t0 = t; o.sx = o.x; o.sz = o.z; o.sy = o.y; }
        }
        let alive = 0;
        for (const o of hands) {
          const h = o.h, lt = t - o.delay;
          if (o.mode === 'rise') {
            const k = U.easeOutCubic(U.clamp(lt / 0.38, 0, 1));
            o.y = U.lerp(-1.4, 0.25, k); o.op = U.clamp(lt / 0.15, 0, 1);
            h.setPose('reach', 8);
          } else if (o.mode === 'lunge') {
            const e = o.target, k = U.easeInCubic(U.clamp((t - o.t0) / 0.22, 0, 1));
            const dx = e.pos.x - o.sx, dz = e.pos.z - o.sz, dl = Math.hypot(dx, dz) || 1;
            o.ix = dx / dl; o.iz = dz / dl;
            const reach = Math.max(0, dl - e.radius * 0.7);
            o.x = o.sx + o.ix * reach * k; o.z = o.sz + o.iz * reach * k;
            o.y = U.lerp(o.sy, 0.5, k); o.op = 1; o.lean = k;
            h.setPose(k > 0.5 ? 'clench' : 'claw', 22);
          } else if (o.mode === 'settle') {
            // nothing to take: sink to the knuckles and wait
            const k = U.smooth(U.clamp((t - o.t0) / 0.3, 0, 1));
            const r0 = R * 0.93, r1 = R * 0.62;
            o.x = center.x - o.ix * U.lerp(r0, r1, k); o.z = center.z - o.iz * U.lerp(r0, r1, k);
            o.y = U.lerp(o.sy, -0.25, k); o.op = U.lerp(1, 0.8, k); o.lean = 0.15 * k;
            h.setPose('claw', 10);
            if (k >= 1) { o.mode = 'trap'; o.trapT = T_.eTrap; }
          } else if (o.mode === 'trap') {
            o.trapT -= dt;
            o.y = -0.25 + Math.sin(t * 7 + o.a * 5) * 0.04;
            h.setPose(Math.sin(t * 3.1 + o.a * 7) > 0.6 ? 'open' : 'claw', 9);
            for (const e of U.enemies.list) {
              if (!e.alive || e.under || e.grip || e.state === 'arrive') continue;
              if (Math.hypot(e.pos.x - o.x, e.pos.z - o.z) < 0.85 + e.radius) {
                const dx = e.pos.x - o.x, dz = e.pos.z - o.z, dl = Math.hypot(dx, dz) || 1;
                o.ix = dx / dl; o.iz = dz / dl; o.x = e.pos.x - o.ix * e.radius * 0.7; o.z = e.pos.z - o.iz * e.radius * 0.7;
                o.lean = 1; o.op = 1;
                h.setPose('clench', 26);
                seize(o, e, T_.eTrapDmg, 1.0);
                U.audio.play('eGrasp', { gap: 0.05 });
                break;
              }
            }
            if (o.mode === 'trap' && o.trapT <= 0) o.mode = 'sink';
          } else if (o.mode === 'hold') {
            const e = o.target, g = e.grip;
            if (!e.alive || !g || g.phase === 'gone' || g.phase === 'up') { o.mode = 'sink'; }
            else {
              o.x = U.damp(o.x, e.pos.x - o.ix * e.radius * 0.7, 20, dt);
              o.z = U.damp(o.z, e.pos.z - o.iz * e.radius * 0.7, 20, dt);
              o.y = 0.5 - e.sink * 0.55;
              h.setPose('clench', 26);
            }
          } else if (o.mode === 'sink') {
            o.y -= dt * 2.2; o.op = Math.max(0, o.op - dt * 2.4);
            if (o.op <= 0) o.mode = 'off';
          }
          if (o.mode !== 'off') { alive++; driveHand(o, dt); } else h.setOpacity(0);
        }
        if (!this.grasped && t >= 0.58) {
          this.grasped = true;
          U.audio.play('eGrasp');
          FX.mist(_a.copy(center).setY(0.3), 7, { spread: 1.0, rise: 0.6, out: 1.4, life: 0.9, size: 1.1, a: 0.25 });
          FX.flash(_a.copy(center).setY(1.0), 14, 8, 0.3);
          let any = false;
          for (const o of hands) {
            if (o.mode !== 'lunge') continue;
            if (!o.target.alive || o.target.under || o.target.grip) { o.mode = 'sink'; continue; }
            any = true;
            seize(o, o.target, T_.eDmg, T_.eHold);
          }
          hitstopAndShake(any ? 0.05 : 0, 0.12);
          U.enemies.dread(center, R + 4, 1.6);
        }
        // more keep arriving at the edges, late, reaching for nothing
        for (const o of late) {
          const h = o.h;
          if (o.mode === 'wait') { if (t >= o.at) { o.mode = 'rise'; o.lt = 0; } else continue; }
          if (o.mode === 'off') continue;
          o.lt += dt;
          const lt = o.lt;
          if (lt < 0.3) { o.y = U.lerp(-1.5, 0.45, U.easeOutCubic(lt / 0.3)); o.op = U.clamp(lt / 0.12, 0, 0.75); h.setPose('reach', 8); }
          else if (lt < 1.0) { o.y = 0.45 + Math.sin(lt * 9) * 0.05; o.lean = 0.3 * Math.sin(lt * 4); h.setPose(Math.sin(lt * 11) > 0 ? 'claw' : 'open', 14); }
          else { o.y -= dt * 2.6; o.op = Math.max(0, o.op - dt * 2); if (o.op <= 0) { o.mode = 'off'; h.setOpacity(0); continue; } }
          alive++;
          driveHand(o, dt);
        }
        if (t > 1.0 && alive === 0) this.done = true;
      },
      cleanup() { for (const o of hands) o.h.setOpacity(0); for (const o of late) o.h.setOpacity(0); },
    };
    return c;
  }

  // =============== R — Sever the Veil ===============
  // A giant spectral hand draws a blade nine metres long; its shadow crosses the ground first.
  // The cut does not close: a standing rift stays along the arc for a while, with stars behind it and
  // an eye that opens. Anything crossing it is cut again; enemy shots that touch it are swallowed.
  // Bodies it cuts come apart for a moment and rejoin with a second wound.
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
    let prevYaw = yawStart;
    const bladeDir = (yaw, pitch, out) => out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    // the blade's shadow on the floor (laid out around where he stands now)
    groundArc(S.rShadow, P.pos, yawStart, yawEnd, 1.0, T_.rRange + 0.4);
    S.rShadow.mesh.visible = true;
    const sh = S.rShadow.mat.uniforms;
    sh.uOpacity.value = 0; sh.uHead.value = 0; sh.uTail.value = 0;
    const tear = { open: false, origin: new V3(), r: T_.rRange * 0.6, aimYaw, y0: yawStart, y1: yawEnd, t: 0, side: new Map(), cool: new Map(), eyeKick: 0 };
    const c = {
      t: 0, done: false, swung: false, firstHit: false,
      startSwing() {
        if (this.swung) return;
        this.swung = true;
        U.audio.play('rSlash');
        this.origin = P.pos.clone();
        dropTele();
        buildArc(S.rCres, pivot, yawStart, yawEnd, 2.3, 9.6);
        S.rCres.mesh.visible = true;
        S.rCres.mat.uniforms.uOpacity.value = 1;
        S.rCres.mat.uniforms.uColor.value.setRGB(3.0, 3.05, 3.3);
      },
      // damage every enemy whose bearing the visible blade crossed between yaw a and b
      sweep(a, b) {
        const o = this.origin;
        for (const en of U.enemies.list) {
          if (hit.has(en) || !en.alive || en.under) continue;
          const dx = en.pos.x - o.x, dz = en.pos.z - o.z;
          const d = Math.hypot(dx, dz);
          if (d > T_.rRange + en.radius) continue;
          const ang = aimYaw + U.angleDiff(aimYaw, Math.atan2(dx, dz));
          if (ang < Math.min(a, b) - 0.05 || ang > Math.max(a, b) + 0.05) continue;
          hit.add(en);
          const tang = _a.set(Math.cos(b), 0, -Math.sin(b)).multiplyScalar(-1);
          const push = _b.set(dx, 0, dz).normalize().multiplyScalar(0.6).add(tang).normalize();
          U.enemies.hit(en, T_.rDmg, { dir: push, knock: 8, heavy: true, stagger: 0.8 });
          if (en.alive) U.enemies.split(en, Math.random() < 0.5 ? -1 : 1, T_.rSplit);
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
        const t = this.t, W = T_.rWind, SW = T_.rSwing, TE = W + SW + 0.1;
        if (t < W) pivot.copy(P.pos).addScaledVector(dir, -1.15).setY(3.5);
        let yaw = yawEnd, pitch = -0.33, op = 1, sc = 1;
        if (t < W) {
          const k = U.clamp(t / W, 0, 1);
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
          // the shadow of the blade crosses the ground before the blade does
          groundArc(S.rShadow, P.pos, yawStart, yawEnd, 1.0, T_.rRange + 0.4);
          sh.uOpacity.value = 0.55 * U.clamp(t / 0.15, 0, 1);
          sh.uHead.value = U.smooth(U.clamp((t - 0.1) / (W - 0.1), 0, 1)) * 1.1;
          sh.uTail.value = 0;
        } else if (t < W + SW) {
          const k = U.clamp((t - W) / SW, 0, 1);
          const e = 1 - Math.pow(1 - k, 1.6);
          yaw = U.lerp(yawStart, yawEnd, e); pitch = -0.33;
          this.startSwing();
          S.rCres.mat.uniforms.uHead.value = e;
          S.rCres.mat.uniforms.uTail.value = Math.max(0, e - 0.9);
          sh.uTail.value = e; sh.uHead.value = 1.1;
          this.sweep(prevYaw, yaw);
          prevYaw = yaw;
        } else if (t < TE + 0.5) {
          yaw = yawEnd; pitch = -0.33;
          if (prevYaw < yawEnd) { this.startSwing(); this.sweep(prevYaw, yawEnd); prevYaw = yawEnd; S.rCres.mat.uniforms.uHead.value = 1; }
          const k = U.clamp((t - W - SW) / 0.45, 0, 1);
          op = 1 - U.smooth(k); sc = 1 + k * 0.08;
          sh.uOpacity.value = 0.55 * (1 - k); sh.uTail.value = 1;
          S.rCres.mat.uniforms.uOpacity.value = Math.max(0, 1 - k * 2.2);
          S.rCres.mat.uniforms.uTail.value = Math.min(1, S.rCres.mat.uniforms.uTail.value + dt * 4);
        } else op = 0;
        // the cut stays open
        if (!this.tore && t >= W + SW) {
          this.tore = true;
          tear.origin.copy(this.origin || P.pos); tear.open = true; tear.t = 0;
          S.tears.push(tear);
          riftArc(S.rift, tear.origin, yawStart + 0.1, yawEnd - 0.1, tear.r, 2.7);
          S.rift.mat.uniforms.uLen.value = tear.r * (yawEnd - yawStart - 0.2);
          S.rift.mesh.visible = true;
          U.world.addShake(this.firstHit ? 0.1 : 0.22);
          U.audio.play('tear');
          FX.flash(_a.copy(tear.origin).addScaledVector(dir, tear.r).setY(1.2), 22, 14, 0.3);
          for (let i = 0; i < 4; i++) {
            const yy = U.lerp(yawStart + 0.2, yawEnd - 0.2, (i + Math.random()) / 4);
            FX.wrong(_a.set(tear.origin.x + Math.sin(yy) * tear.r, 0, tear.origin.z + Math.cos(yy) * tear.r), 1.1, 4.5, 0.6);
          }
          // things that see it back away
          U.enemies.dread(tear.origin, T_.rRange + 5, 2.0);
        }
        if (this.tore) this.updateTear(dt);
        // place giant hand and blade
        if (op > 0.001) {
          bladeDir(yaw, pitch, D);
          const tan = _a.set(Math.cos(yaw), 0, -Math.sin(yaw)); // swing tangent (yaw increasing)
          const up = _b.crossVectors(D, tan).normalize();
          G.group.position.copy(pivot).addScaledVector(D, -0.25);
          G.orient(up.lengthSq() > 0.01 ? up : _c.set(0, 1, 0), tan);
          G.setScale(3.2 * sc);
          G.setGlow(1.4 + (t > W && t < W + SW ? 0.8 : 0));
          G.update(dt);
          S.blade.position.copy(pivot).addScaledVector(D, 0.2);
          _m.makeBasis(_d.crossVectors(D, up).normalize(), D, up);
          S.blade.quaternion.setFromRotationMatrix(_m);
          S.blade.scale.set(1, sc * U.clamp(op * 1.4, 0, 1), 1);
          S.bladeMat.uniforms.uOpacity.value = op;
          S.bladeMat.uniforms.uGlow.value = 1.5 + (t > W && t < W + SW ? 1.2 : 0);
        }
        G.setOpacity(op);
        S.blade.visible = op > 0.01;
        S.rShadow.mesh.visible = sh.uOpacity.value > 0.003;
        if (this.tore && !tear.open && t > TE + 0.5) this.done = true;
      },
      updateTear(dt) {
        tear.t += dt;
        const tt = tear.t, L = T_.rTear;
        const u = S.rift.mat.uniforms;
        u.uOpen.value = U.easeOutCubic(U.clamp(tt / 0.25, 0, 1)) * (1 - U.smooth(U.clamp((tt - (L - 0.45)) / 0.45, 0, 1)));
        u.uOpacity.value = 1;
        tear.eyeKick = Math.max(0, tear.eyeKick - dt * 2);
        u.uEye.value = U.smooth(U.clamp((tt - 0.6) / 0.6, 0, 1)) * (1 - U.smooth(U.clamp((tt - (L - 0.7)) / 0.3, 0, 1))) * (1 - 0.6 * tear.eyeKick);
        if (tt >= L) { tear.open = false; S.rift.mesh.visible = false; const i = S.tears.indexOf(tear); if (i >= 0) S.tears.splice(i, 1); return; }
        if (tt < 0.15) return;
        // anything crossing the rift is cut again
        for (const en of U.enemies.list) {
          if (!en.alive || en.under) continue;
          const dx = en.pos.x - tear.origin.x, dz = en.pos.z - tear.origin.z, d = Math.hypot(dx, dz);
          const ang = aimYaw + U.angleDiff(aimYaw, Math.atan2(dx, dz));
          const within = ang >= tear.y0 + 0.08 && ang <= tear.y1 - 0.08;
          const side = d > tear.r ? 1 : -1, prev = tear.side.get(en);
          tear.side.set(en, side);
          const cd = (tear.cool.get(en) || 0) - dt;
          tear.cool.set(en, cd);
          if (!within || cd > 0) continue;
          if ((prev != null && prev !== side) || Math.abs(d - tear.r) < en.radius * 0.6) {
            tear.cool.set(en, 0.8);
            const n = _a.set(dx, 0, dz).normalize().multiplyScalar(-side);
            U.enemies.hit(en, T_.rRecut, { dir: n, knock: 3, stagger: 0.4 });
            if (en.alive) U.enemies.split(en, Math.random() < 0.5 ? -1 : 1, T_.rSplit * 0.6);
            const hp = _c.copy(en.pos).setY(1.2);
            FX.sparks(hp, 14, { speed: 6, life: 0.3, size: 0.09, grav: 2 });
            FX.fracture(hp, 1.1, 0.3);
            U.audio.play('rSlash', { gap: 0.15 });
            tear.eyeKick = 1;
          }
        }
      },
      cleanup() {
        G.setOpacity(0); S.blade.visible = false; S.rCres.mesh.visible = false; S.rShadow.mesh.visible = false; dropTele();
        tear.open = false; S.rift.mesh.visible = false;
        const i = S.tears.indexOf(tear); if (i >= 0) S.tears.splice(i, 1);
      },
    };
    function buildArc(cm, pv, y0, y1, rIn, rOut) {
      const SEG = FX.CRESCENT_SEG;
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
  // flat arc on the ground around o (uv.y: 0 inner -> 1 outer)
  function groundArc(st, o, y0, y1, rIn, rOut) {
    const pos = st.geo.attributes.position.array, seg = st.seg;
    for (let i = 0; i <= seg; i++) {
      const yy = U.lerp(y0, y1, i / seg), sx = Math.sin(yy), cz = Math.cos(yy);
      pos[i * 6] = o.x + sx * rIn; pos[i * 6 + 1] = 0.065; pos[i * 6 + 2] = o.z + cz * rIn;
      pos[i * 6 + 3] = o.x + sx * rOut; pos[i * 6 + 4] = 0.065; pos[i * 6 + 5] = o.z + cz * rOut;
    }
    st.geo.attributes.position.needsUpdate = true;
  }
  // vertical curtain along an arc (uv.y: 0 floor -> 1 top)
  function riftArc(st, o, y0, y1, r, h) {
    const pos = st.geo.attributes.position.array, seg = st.seg;
    for (let i = 0; i <= seg; i++) {
      const yy = U.lerp(y0, y1, i / seg), x = o.x + Math.sin(yy) * r, z = o.z + Math.cos(yy) * r;
      pos[i * 6] = x; pos[i * 6 + 1] = 0.0; pos[i * 6 + 2] = z;
      pos[i * 6 + 3] = x; pos[i * 6 + 4] = h; pos[i * 6 + 5] = z;
    }
    st.geo.attributes.position.needsUpdate = true;
    st.geo.computeBoundingSphere();
  }
  const _m = new T.Matrix4();

  // =============== T — The Missing Second ===============
  // Inside the circle time does not slow evenly: it crawls, then skips forward all at once, leaving
  // images of where things were. Shots that enter it stop dead. When the second ends, everything in it
  // relives the last wound it took there, and the stopped shots go back the way they came.
  function castT(P, aim) {
    const T_ = S.TUNE;
    const center = S.clampTarget(aim, T_.tRange, new V3());
    let f = S.fields.find((x) => !x.active);
    if (!f) { f = S.fields[0]; collapse(f); }
    f.active = true; f.ending = false; f.dead = false; f.t = 0; f.pos.copy(center); f.r = T_.tRadius;
    f.last.clear(); f.replay.length = 0; f.stut = 0; f.skip = false; f.collapsed = false;
    f.disc.position.set(center.x, 0.075, center.z);
    const size = f.r + 0.3; f.disc.scale.set(size, size, 1); f.mat.uniforms.uSize.value = size;
    f.disc.visible = true; f.frags.visible = true;
    f.spin = Math.random() * 6;
    P.setGesture({ kind: 'T', inT: 0.1, holdT: 0.35, outT: 0.6 });
    U.audio.play('t');
    U.audio.play('tDrone');
    FX.ring({ pos: center, r0: 0.3, r1: f.r, dur: 0.35, w0: 0.12, w1: 0.04, opacity: 0.8, ease: U.easeOutCubic });
    FX.sparks(_a.copy(center).setY(0.6), 18, { speed: 3, up: 1.5, life: 0.8, size: 0.07, grav: -0.5, drag: 3 });
    return null;
  }
  function collapse(f) {
    if (f.collapsed) return;
    f.collapsed = true; f.ending = true; f.dead = true;
    U.enemies.reverseHeld(f);
    // every body still inside relives its last wound
    for (const [e, dmg] of f.last) {
      if (!e.alive) continue;
      f.replay.push({ e, dmg: Math.min(60, dmg) * S.TUNE.tRewind, at: f.t + 0.05 + Math.random() * 0.25 });
    }
    f.last.clear();
    U.audio.play('rewind');
    FX.ring({ pos: f.pos, r0: f.r, r1: 0.4, dur: 0.4, w0: 0.08, w1: 0.2, opacity: 0.7, ease: U.easeInCubic });
  }
  const _mtx = new T.Matrix4(), _qq = new T.Quaternion(), _eu = new T.Euler(), _sc = new V3(), _pp = new V3();
  function updateFields(dt) {
    const T_ = S.TUNE;
    for (const f of S.fields) {
      f.skip = false;
      if (!f.active) continue;
      f.t += dt;
      const appear = U.easeOutCubic(U.clamp(f.t / 0.3, 0, 1));
      const end = U.clamp((f.t - T_.tDur) / 0.4, 0, 1);
      if (f.t >= T_.tDur) collapse(f);
      // the clock crawls, then the missing time arrives at once
      if (!f.ending) {
        f.stut += dt;
        f.spin += dt * 0.25;
        if (f.stut >= T_.tStutter) {
          f.stut -= T_.tStutter; f.skip = true; f.spin += 0.9;
          FX.ring({ pos: f.pos, r0: f.r * 0.98, r1: f.r * 0.9, dur: 0.25, w0: 0.05, w1: 0.03, opacity: 0.5 });
          U.audio.play('tick', { gap: 0.1 });
        }
      } else f.spin -= dt * 3; // and runs back as it collapses
      f.mat.uniforms.uSpin.value = f.spin;
      f.mat.uniforms.uR.value = f.r * appear * (1 - end * 0.25);
      f.mat.uniforms.uAlpha.value = appear * (1 - end) * (f.t > T_.tDur - 0.6 && f.t < T_.tDur ? 0.75 + 0.25 * Math.sin(f.t * 30) : 1);
      // replay the remembered wounds
      if (f.replay.length) {
        S._replaying = true;
        for (let i = f.replay.length - 1; i >= 0; i--) {
          const r = f.replay[i];
          if (f.t < r.at) continue;
          f.replay.splice(i, 1);
          if (!r.e.alive || r.e.under) continue;
          FX.ghostOf(r.e.root, { opacity: 0.5, dur: 0.3 });
          const hp = _a.copy(r.e.pos).setY(r.e.type === 'idol' ? 1.8 : 1.2);
          U.enemies.hit(r.e, r.dmg, { stagger: 0.35 });
          FX.fracture(hp, 1.2, 0.3);
          FX.shards(hp, 4, { bright: true, speed: 3, size: 0.07, life: 0.4, grav: -1 });
          U.audio.play('qhit', { gap: 0.04 });
        }
        S._replaying = false;
      }
      const n = f.seeds.length;
      for (let i = 0; i < n; i++) {
        const s = f.seeds[i];
        const r = s.r * f.r * 0.95 * appear;
        _pp.set(f.pos.x + Math.cos(s.a + f.spin * s.sp * 0.1) * r, s.y + Math.sin(f.spin * 0.6 + i) * 0.05 - end * 0.6, f.pos.z + Math.sin(s.a + f.spin * s.sp * 0.1) * r);
        _qq.setFromEuler(_eu.set(s.rx + f.spin * s.sp * 0.4, s.ry + f.spin * s.sp * 0.3, 0));
        const sc = s.s * appear * (1 - end);
        _mtx.compose(_pp, _qq, _sc.set(sc, sc, sc));
        f.frags.setMatrixAt(i, _mtx);
      }
      f.frags.instanceMatrix.needsUpdate = true;
      if (Math.random() < dt * 6 && !f.ending) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * f.r;
        FX.sparks(_a.set(f.pos.x + Math.cos(a) * r, 0.3 + Math.random() * 1.5, f.pos.z + Math.sin(a) * r), 1, { speed: 0.15, life: 1.2, size: 0.06, grav: 0, a: 0.6, drag: 0.5 });
      }
      if (end >= 1 && !f.replay.length) { f.active = false; f.disc.visible = false; f.frags.visible = false; }
    }
  }

  // =============== 1 — The Seal Objects ===============
  // The seal on his chest refuses. For a second the world stops and turns to its negative, and every
  // mask turns to look at him. Then the hands close, and what was inside the ring is no longer there:
  // no corpses, only silhouettes burned into the stone. It costs him; he is pressed to one knee.
  function castY(P, aim) {
    const T_ = S.TUNE;
    const rig = P.rig;
    P.setGesture({ kind: 'Y', inT: 0.25, holdT: 1.0, outT: 1.35, headX: -0.18 });
    U.audio.play('yCharge');
    U.audio.play('negative');
    S.freeze = T_.yCharge;
    const erased = new Set();
    const center = new V3();
    const slots = [new V3(-2.5, 3.3, -1.0), new V3(2.5, 3.3, -1.0), new V3(-2.9, 1.45, 0.9), new V3(2.9, 1.45, 0.9)];
    const c = {
      t: 0, done: false, released: false,
      update(dt) {
        const t = this.t, CH = T_.yCharge;
        if (!this.released) center.copy(P.pos);
        if (t < CH) {
          const k = U.clamp(t / CH, 0, 1);
          U.world.dim = U.smooth(U.clamp(k * 1.4, 0, 1)) * 0.5;
          U.world.neg = U.clamp(t / 0.05, 0, 1) * (0.93 + 0.07 * Math.sin(t * 70));
          U.world.eye = U.smooth(U.clamp((t - 0.15) / 0.6, 0, 1));
          for (let i = 0; i < 4; i++) {
            const s = slots[i];
            const out = U.easeOutCubic(U.clamp(k * 1.5, 0, 1));
            const pos = _a.set(center.x + s.x * out, s.y * out + 1.2 * (1 - out), center.z + s.z * out);
            const toC = _b.set(center.x - pos.x, 1.6 - pos.y, center.z - pos.z).normalize();
            const up = _c.set(s.x * 0.25, 1, s.z * 0.2).normalize();
            const pose = k < 0.45 ? 'open' : k < 0.78 ? 'claw' : 'clench';
            rig.command(i, { pos: pos.clone(), up: up.clone(), palm: toC.clone(), pose, poseSpeed: k < 0.78 ? 8 : 26, dur: 0.1, follow: 10, turn: 10, scale: U.lerp(1.2, 3.3, U.easeOutCubic(U.clamp(k * 1.3, 0, 1))), scaleSpeed: 12, glow: 1.2 + k * 1.4 });
          }
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
          if (!this.conv) { this.conv = true; FX.ring({ pos: center, r0: T_.yRadius, r1: 0.6, dur: CH * 0.95, w0: 0.05, w1: 0.2, opacity: 0.55, ease: U.easeInCubic, fadePow: 6 }); }
        } else if (!this.released) {
          this.released = true;
          U.world.dim = 0;
          U.world.sealPulse = 1;
          U.audio.play('yBurst');
          U.audio.play('erase');
          U.world.addShake(0.3);
          U.time.addHitstop(0.06);
          U.world.grade.uniforms.uFlash.value = 1;
          FX.ring({ pos: center, r0: 0.5, r1: T_.yRadius + 0.6, dur: 0.42, w0: 0.45, w1: 0.06, opacity: 1, intensity: 2.2, fill: 0.25, ease: U.easeOutCubic });
          FX.ring({ pos: center, r0: T_.yRadius + 0.3, r1: T_.yRadius + 1.2, dur: 0.9, w0: 0.06, w1: 0.02, opacity: 0.5, ease: U.easeOutCubic });
          FX.crack(center, T_.yRadius * 1.05, 2.5, 0.5);
          FX.flash(_a.copy(center).setY(2), 50, 18, 0.4);
          FX.shards(_a.copy(center).setY(1.4), 24, { bright: true, speed: 12, up: 0.35, size: 0.12, life: 0.8, spread: 1.0, grav: 4 });
          for (let i = 0; i < 16; i++) {
            const a = (i / 16) * Math.PI * 2;
            FX.mist(_a.set(center.x + Math.cos(a) * 2.2, 0.4, center.z + Math.sin(a) * 2.2), 1, { spread: 0.3, vel: _b.set(Math.cos(a) * 7, 0.5, Math.sin(a) * 7), drag: 3.2, life: 1.3, size: 1.6, a: 0.3, out: 0.2 });
          }
          for (let i = 0; i < 4; i++) {
            rig.command(i, { pos: _a.copy(center).setY(1.5).clone(), up: _b.set(0, 1, 0).clone(), palm: _c.set(-slots[i].x, 0, -slots[i].z).normalize().clone(), pose: 'clench', dur: 0.12, follow: 40, turn: 30, scale: 2.2, scaleSpeed: 30, glow: 3 });
          }
          this.relT = t;
        }
        if (this.released) {
          const rt = t - this.relT;
          U.world.grade.uniforms.uFlash.value = Math.max(0, 1 - rt / 0.18);
          U.world.neg = Math.max(0, 1 - rt / 0.2) * 0.9;
          U.world.eye = 1 - U.smooth(U.clamp((rt - 1.1) / 0.8, 0, 1));
          // erased as the closing front reaches them
          const front = U.lerp(0.5, T_.yRadius + 0.6, U.easeOutCubic(U.clamp(rt / 0.42, 0, 1)));
          for (const e of U.enemies.list) {
            if (erased.has(e) || !e.alive) continue;
            const d = Math.hypot(e.pos.x - center.x, e.pos.z - center.z);
            if (d <= T_.yRadius + e.radius && d <= front + e.radius) { erased.add(e); U.enemies.kill(e, { erase: true }); }
          }
          if (!this.dreaded && rt > 0.42) { this.dreaded = true; U.enemies.dread(center, 60, 2.5); }
          // it costs him: one knee to the stone, the tethers pulled taut, the other powers flicker
          if (!this.knelt && rt > 0.08) {
            this.knelt = true;
            P.setGesture({ kind: 'Kneel', inT: 0.12, holdT: 0.55, outT: 0.95, crouch: 0.36, lean: 0.35, headX: 0.45 });
            P.rig.tension = 1;
            if (U.ui && U.ui.flicker) U.ui.flicker(1.5);
          }
          const hk = U.clamp(rt / 0.5, 0, 1);
          S.halo.scale.setScalar(1 + hk * 0.9);
          S.haloMat.uniforms.uOpacity.value = 0.9 * (1 - hk);
          S.haloMat.uniforms.uGlow.value = 3 * (1 - hk) + 0.5;
          if (hk >= 1) S.halo.visible = false;
          for (const h of rig.hands) h.fade = U.clamp(rt < 0.1 ? 1 : 1 - (rt - 0.1) / 0.12, 0, 1) + U.clamp((rt - 0.7) / 0.6, 0, 1);
          if (rt > 0.15 && !this.reset) {
            this.reset = true;
            for (let i = 0; i < 4; i++) {
              const h = rig.hands[i];
              h.override = null;
              h.group.position.copy(h.anchor.p).applyAxisAngle(_yAxis, P.facing).add(P.pos);
              h.setScale(h.baseScale);
            }
          }
          if (rt > 2.0) this.done = true;
        }
      },
      cleanup() {
        U.world.dim = 0; U.world.neg = 0; U.world.eye = 0;
        S.halo.visible = false;
        U.world.grade.uniforms.uFlash.value = 0;
        for (const h of rig.hands) h.fade = 1;
      },
    };
    return c;
  }
  const _yAxis = new V3(0, 1, 0);
})(window.U);
