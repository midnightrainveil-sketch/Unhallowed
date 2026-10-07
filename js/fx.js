/* UNHALLOWED — pooled effects: ground rings, sparks, mist puffs, shards, impact lights,
   crack decals, fracture marks, sword crescents, afterimages and enemy telegraphs.
   Everything is pre-allocated; nothing is created during combat. */
'use strict';
(function (U) {
  const T = THREE;
  const FX = (U.fx = {});
  const V3 = T.Vector3;

  const WHITE = new T.Color(1, 1, 1);
  FX.AMBER = new T.Color(1.0, 0.56, 0.24);
  FX.CRIMSON = new T.Color(0.75, 0.16, 0.12);

  // ---------------- Ground ring / disc shader ----------------
  const RING_VS = `varying vec2 vP; uniform float uSize; void main(){ vP = (uv * 2.0 - 1.0) * uSize; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const RING_FS = `
#define sq(x) ((x)*(x))
    uniform float uR, uW, uOpacity, uFill, uInnerFade; uniform vec3 uColor;
    varying vec2 vP;
    void main(){
      float d = length(vP);
      float ring = exp(-sq((d - uR) / max(uW, 0.001)));
      float fill = uFill * smoothstep(uR, uR - uInnerFade, d);
      float a = clamp(ring + fill, 0.0, 1.0) * uOpacity;
      if (a < 0.002) discard;
      gl_FragColor = vec4(uColor * (1.0 + ring * 0.6), a);
    }`;

  function makeRing() {
    const mat = new T.ShaderMaterial({
      uniforms: { uR: { value: 1 }, uW: { value: 0.1 }, uOpacity: { value: 1 }, uFill: { value: 0 }, uInnerFade: { value: 1 }, uSize: { value: 1 }, uColor: { value: new T.Color(1, 1, 1) } },
      vertexShader: RING_VS, fragmentShader: RING_FS, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    });
    const m = new T.Mesh(new T.PlaneGeometry(2, 2), mat);
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 4;
    m.visible = false;
    FX.scene.add(m);
    return { mesh: m, mat, active: false, t: 0, o: null, release() { this.active = false; this.mesh.visible = false; } };
  }

  // ring({pos, r0, r1, dur, w0, w1, color, opacity, fill, y, ease})
  FX.ring = function (o) {
    const r = FX.rings.get();
    r.active = true; r.t = 0; r.o = o;
    const maxR = Math.max(o.r0, o.r1) + (Math.max(o.w0 || 0.1, o.w1 || 0.1)) * 3;
    r.mesh.scale.set(maxR, maxR, 1);
    r.mat.uniforms.uSize.value = maxR;
    r.mat.uniforms.uColor.value.copy(o.color || WHITE).multiplyScalar(o.intensity || 1);
    r.mat.blending = o.normal ? T.NormalBlending : T.AdditiveBlending;
    r.mesh.position.set(o.pos.x, (o.y != null ? o.y : 0.06), o.pos.z);
    r.mesh.visible = true;
    updateRing(r, 0);
    return r;
  };
  function updateRing(r, dt) {
    r.t += dt;
    const o = r.o;
    const p = U.clamp(r.t / o.dur, 0, 1);
    const e = (o.ease || U.easeOutCubic)(p);
    const u = r.mat.uniforms;
    u.uR.value = U.lerp(o.r0, o.r1, e);
    u.uW.value = U.lerp(o.w0 || 0.1, o.w1 != null ? o.w1 : 0.02, e);
    u.uOpacity.value = (o.opacity != null ? o.opacity : 1) * (o.fadeIn ? Math.min(1, p / o.fadeIn) : 1) * (1 - Math.pow(p, o.fadePow || 1.6));
    u.uFill.value = (o.fill || 0) * (1 - p);
    u.uInnerFade.value = o.innerFade || u.uR.value;
    if (p >= 1) r.release();
  }

  // ---------------- Particle systems (points) ----------------
  function makePoints(max, additive, soft) {
    const geo = new T.BufferGeometry();
    const pos = new Float32Array(max * 3), size = new Float32Array(max), alpha = new Float32Array(max), col = new Float32Array(max * 3);
    geo.setAttribute('position', new T.BufferAttribute(pos, 3).setUsage(T.DynamicDrawUsage));
    geo.setAttribute('aSize', new T.BufferAttribute(size, 1).setUsage(T.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new T.BufferAttribute(alpha, 1).setUsage(T.DynamicDrawUsage));
    geo.setAttribute('aColor', new T.BufferAttribute(col, 3).setUsage(T.DynamicDrawUsage));
    const mat = new T.ShaderMaterial({
      uniforms: { uScale: { value: window.innerHeight * 0.9 } },
      vertexShader: `
        attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
        uniform float uScale; varying float vA; varying vec3 vC;
        void main(){ vA = aAlpha; vC = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uScale / -mv.z; }`,
      fragmentShader: soft ? `
        varying float vA; varying vec3 vC;
        void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = (1.0 - smoothstep(0.0, 1.0, d)); a *= a; if (vA * a < 0.003) discard; gl_FragColor = vec4(vC, vA * a); }` : `
        varying float vA; varying vec3 vC;
        void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = (1.0 - smoothstep(0.0, 1.0, d)); a = a * a * (0.6 + 0.4 * step(d, 0.25)); if (vA * a < 0.003) discard; gl_FragColor = vec4(vC, vA * a); }`,
      transparent: true, depthWrite: false, blending: additive ? T.AdditiveBlending : T.NormalBlending,
    });
    const pts = new T.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = soft ? 7 : 8;
    FX.scene.add(pts);
    const P = { pts, geo, max, n: 0, parts: [] };
    for (let i = 0; i < max; i++) P.parts.push({ active: false, p: new V3(), v: new V3(), life: 0, max: 1, s0: 0.1, s1: 0, a0: 1, c: new T.Color(), drag: 1, grav: 0, grow: 0 });
    P.cursor = 0;
    return P;
  }

  function emit(P, o) {
    let part = null;
    for (let k = 0; k < P.max; k++) {
      const c = P.parts[(P.cursor + k) % P.max];
      if (!c.active) { part = c; P.cursor = (P.cursor + k + 1) % P.max; break; }
    }
    if (!part) { part = P.parts[P.cursor]; P.cursor = (P.cursor + 1) % P.max; }
    part.active = true;
    part.p.copy(o.p); part.v.copy(o.v);
    part.life = 0; part.max = o.life; part.s0 = o.s0; part.s1 = o.s1 != null ? o.s1 : 0;
    part.a0 = o.a; part.c.copy(o.c); part.drag = o.drag != null ? o.drag : 2.5; part.grav = o.grav || 0;
    return part;
  }

  function updatePoints(P, dt) {
    const pos = P.geo.attributes.position.array, size = P.geo.attributes.aSize.array, alpha = P.geo.attributes.aAlpha.array, col = P.geo.attributes.aColor.array;
    for (let i = 0; i < P.max; i++) {
      const c = P.parts[i];
      if (c.active) {
        c.life += dt;
        if (c.life >= c.max) { c.active = false; }
        else {
          c.v.multiplyScalar(Math.exp(-c.drag * dt));
          c.v.y -= c.grav * dt;
          c.p.addScaledVector(c.v, dt);
          if (c.p.y < 0.02 && c.grav > 0) { c.p.y = 0.02; c.v.y *= -0.3; c.v.x *= 0.6; c.v.z *= 0.6; }
        }
      }
      if (!c.active) { alpha[i] = 0; size[i] = 0; pos[i * 3 + 1] = -999; continue; }
      const k = c.life / c.max;
      pos[i * 3] = c.p.x; pos[i * 3 + 1] = c.p.y; pos[i * 3 + 2] = c.p.z;
      size[i] = U.lerp(c.s0, c.s1, k);
      alpha[i] = c.a0 * (1 - k) * Math.min(1, c.life * 30 + 0.2);
      col[i * 3] = c.c.r; col[i * 3 + 1] = c.c.g; col[i * 3 + 2] = c.c.b;
    }
    P.geo.attributes.position.needsUpdate = true;
    P.geo.attributes.aSize.needsUpdate = true;
    P.geo.attributes.aAlpha.needsUpdate = true;
    P.geo.attributes.aColor.needsUpdate = true;
  }

  const _v = new V3(), _w = new V3();
  // sparks(pos, n, {speed, up, dir, spread, life, size, color, grav, a})
  FX.sparks = function (pos, n, o) {
    o = o || {};
    const col = o.color || WHITE;
    for (let i = 0; i < n; i++) {
      _v.set(Math.random() - 0.5, Math.random() * (o.up != null ? o.up : 0.6), Math.random() - 0.5).normalize();
      if (o.dir) _v.lerp(o.dir, o.bias != null ? o.bias : 0.6).normalize();
      const sp = (o.speed || 6) * (0.35 + Math.random() * 0.8);
      emit(FX.spark, {
        p: _w.copy(pos).add(_v.clone().multiplyScalar(o.offset || 0)), v: _v.multiplyScalar(sp), life: (o.life || 0.35) * (0.5 + Math.random() * 0.7),
        s0: (o.size || 0.12) * (0.6 + Math.random() * 0.7), s1: 0, a: o.a || 1, c: col, drag: o.drag != null ? o.drag : 4, grav: o.grav != null ? o.grav : 6,
      });
    }
  };
  // mist(pos, n, {spread, rise, life, size, color, a})
  FX.mist = function (pos, n, o) {
    o = o || {};
    const col = o.color || _mistCol;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * (o.spread || 0.6);
      _w.set(pos.x + Math.cos(a) * r, pos.y + (Math.random() - 0.3) * (o.yspread || 0.3), pos.z + Math.sin(a) * r);
      _v.set(Math.cos(a) * (o.out || 0.6), (o.rise || 0.5) * (0.5 + Math.random()), Math.sin(a) * (o.out || 0.6));
      if (o.vel) _v.add(o.vel);
      emit(FX.puff, {
        p: _w, v: _v, life: (o.life || 1.0) * (0.6 + Math.random() * 0.6), s0: (o.size || 0.9) * (0.6 + Math.random() * 0.6),
        s1: (o.size || 0.9) * (o.grow || 2.2), a: (o.a || 0.25), c: col, drag: o.drag || 1.6, grav: 0,
      });
    }
  };
  const _mistCol = new T.Color(0.82, 0.84, 0.9);

  // ---------------- Shards (instanced) ----------------
  function makeShards(max, mat, geo) {
    const im = new T.InstancedMesh(geo, mat, max);
    im.instanceMatrix.setUsage(T.DynamicDrawUsage);
    im.frustumCulled = false;
    im.castShadow = false;
    const zero = new T.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) { im.setMatrixAt(i, zero); im.setColorAt(i, WHITE); }
    FX.scene.add(im);
    const S = { im, max, parts: [], cursor: 0, zero };
    for (let i = 0; i < max; i++) S.parts.push({ active: false, p: new V3(), v: new V3(), q: new T.Quaternion(), av: new V3(), s: 1, life: 0, max: 1, grav: 9, floor: true });
    return S;
  }
  const _m = new T.Matrix4(), _q = new T.Quaternion(), _e = new T.Euler(), _sc = new V3();
  function updateShards(S, dt) {
    let any = false;
    for (let i = 0; i < S.max; i++) {
      const c = S.parts[i];
      if (!c.active) continue;
      any = true;
      c.life += dt;
      if (c.life >= c.max) { c.active = false; S.im.setMatrixAt(i, S.zero); continue; }
      c.v.y -= c.grav * dt;
      c.v.multiplyScalar(Math.exp(-c.drag * dt));
      c.p.addScaledVector(c.v, dt);
      if (c.floor && c.p.y < 0.05) { c.p.y = 0.05; c.v.y = Math.abs(c.v.y) * 0.25; c.v.x *= 0.5; c.v.z *= 0.5; c.av.multiplyScalar(0.5); }
      _e.set(c.av.x * dt, c.av.y * dt, c.av.z * dt);
      c.q.multiply(_q.setFromEuler(_e));
      const k = c.life / c.max;
      const s = c.s * (k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3);
      _m.compose(c.p, c.q, _sc.set(s, s, s));
      S.im.setMatrixAt(i, _m);
    }
    if (any || S.dirty) { S.im.instanceMatrix.needsUpdate = true; S.dirty = any; }
  }
  // shards(pos, n, {speed, up, size, life, color, bright, grav, spread})
  FX.shards = function (pos, n, o) {
    o = o || {};
    const S = o.bright ? FX.brightShards : FX.stoneShards;
    for (let k = 0; k < n; k++) {
      let c = null;
      for (let j = 0; j < S.max; j++) { const it = S.parts[(S.cursor + j) % S.max]; if (!it.active) { c = it; S.cursor = (S.cursor + j + 1) % S.max; break; } }
      if (!c) { c = S.parts[S.cursor]; S.cursor = (S.cursor + 1) % S.max; }
      const idx = S.parts.indexOf(c);
      c.active = true; c.life = 0; c.max = (o.life || 1.2) * (0.6 + Math.random() * 0.6);
      const sp = o.spread || 0.3;
      c.p.set(pos.x + (Math.random() - 0.5) * sp, pos.y + (Math.random() - 0.5) * sp * (o.yspread || 1), pos.z + (Math.random() - 0.5) * sp);
      _v.set(Math.random() - 0.5, Math.random() * (o.up != null ? o.up : 1.2), Math.random() - 0.5).normalize();
      if (o.dir) _v.lerp(o.dir, o.bias || 0.5).normalize();
      c.v.copy(_v).multiplyScalar((o.speed || 5) * (0.4 + Math.random() * 0.8));
      c.q.setFromEuler(_e.set(Math.random() * 6, Math.random() * 6, Math.random() * 6));
      c.av.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18);
      c.s = (o.size || 0.15) * (0.5 + Math.random() * 0.9);
      c.grav = o.grav != null ? o.grav : 11;
      c.drag = o.drag || 0.4;
      c.floor = o.floor !== false;
      S.im.setColorAt(idx, o.colors ? U.pick(o.colors) : (o.color || WHITE));
    }
    if (S.im.instanceColor) S.im.instanceColor.needsUpdate = true;
  };

  // ---------------- Impact lights ----------------
  FX.flash = function (pos, intensity, dist, dur, color) {
    let best = FX.lights[0];
    for (const l of FX.lights) { if (l.t >= l.dur) { best = l; break; } if (l.t / l.dur > best.t / best.dur) best = l; }
    // lift impact lights clear of nearby surfaces so they never sit against geometry
    best.light.position.set(pos.x, Math.max(pos.y, 0.6) + 0.9, pos.z);
    best.light.distance = dist || 8;
    best.peak = intensity; best.t = 0; best.dur = dur || 0.25;
    best.light.color.copy(color || WHITE);
  };

  // ---------------- Crack decals ----------------
  function makeDecal() {
    const mat = new T.MeshBasicMaterial({ map: U.tex.cracks, transparent: true, depthWrite: false, blending: T.AdditiveBlending, color: new T.Color(1, 1, 1), opacity: 0, polygonOffset: true, polygonOffsetFactor: -3 });
    const m = new T.Mesh(new T.PlaneGeometry(2, 2), mat);
    m.rotation.x = -Math.PI / 2; m.visible = false; m.renderOrder = 3;
    FX.scene.add(m);
    return { mesh: m, mat, active: false, t: 0, dur: 1, peak: 1, release() { this.active = false; this.mesh.visible = false; } };
  }
  FX.crack = function (pos, size, dur, intensity, color) {
    const d = FX.decals.get();
    d.active = true; d.t = 0; d.dur = dur; d.peak = intensity || 1;
    d.mesh.position.set(pos.x, 0.045, pos.z);
    d.mesh.scale.set(size, size, 1);
    d.mesh.rotation.z = Math.random() * Math.PI * 2;
    d.mat.color.copy(color || WHITE);
    d.mesh.visible = true;
    return d;
  };

  // ---------------- Fracture marks (billboarded jagged lines, Q impacts) ----------------
  function fractureGeom(seed) {
    const rnd = U.rng(seed);
    const pos = [];
    const seg = (x0, y0, x1, y1, w) => {
      const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1;
      const nx = (-dy / l) * w, ny = (dx / l) * w;
      pos.push(x0 + nx, y0 + ny, 0, x0 - nx, y0 - ny, 0, x1, y1, 0);
    };
    const n = 6 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      let a = (i / n) * Math.PI * 2 + rnd() * 0.5, x = 0, y = 0;
      let w = 0.035;
      const len = 0.5 + rnd() * 0.5;
      for (let k = 0; k < 3; k++) {
        a += (rnd() - 0.5) * 0.9;
        const nx = x + Math.cos(a) * len / 3, ny = y + Math.sin(a) * len / 3;
        seg(x, y, nx, ny, w);
        if (rnd() < 0.4) seg(nx, ny, nx + Math.cos(a + 1) * 0.15, ny + Math.sin(a + 1) * 0.15, w * 0.5);
        x = nx; y = ny; w *= 0.65;
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    return g;
  }
  FX.fracture = function (pos, size, dur) {
    const f = FX.fractures.get();
    f.active = true; f.t = 0; f.dur = dur || 0.32;
    f.mesh.geometry = FX.fractureGeos[Math.floor(Math.random() * FX.fractureGeos.length)];
    f.mesh.position.copy(pos);
    f.mesh.quaternion.copy(U.world.camera.quaternion);
    f.mesh.rotateZ(Math.random() * 6.28);
    f.mesh.scale.setScalar(size || 1);
    f.mesh.visible = true;
  };

  // ---------------- Sword crescent ----------------
  // Analytic crescent following a slash definition: built in body space, frozen at swing start.
  const SEG = 48;
  function makeCrescent() {
    const geo = new T.BufferGeometry();
    const n = (SEG + 1) * 2;
    geo.setAttribute('position', new T.BufferAttribute(new Float32Array(n * 3), 3).setUsage(T.DynamicDrawUsage));
    const uv = new Float32Array(n * 2);
    for (let i = 0; i <= SEG; i++) { uv[i * 4] = i / SEG; uv[i * 4 + 1] = 0; uv[i * 4 + 2] = i / SEG; uv[i * 4 + 3] = 1; }
    geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
    const idx = [];
    for (let i = 0; i < SEG; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    const mat = new T.ShaderMaterial({
      uniforms: { uOpacity: { value: 1 }, uHead: { value: 1 }, uTail: { value: 0 }, uColor: { value: new T.Color(2.4, 2.45, 2.6) }, uEdgeDark: { value: 0.0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
#define sq(x) ((x)*(x))
        uniform float uOpacity, uHead, uTail; uniform vec3 uColor;
        varying vec2 vUv;
        void main(){
          float along = clamp((vUv.x - uTail) / max(uHead - uTail, 0.0001), 0.0, 1.0);
          float body = pow(along, 1.6);
          // brightest along the outer (tip) edge, with a thin hot core line
          float v = vUv.y;
          float edge = smoothstep(0.0, 0.85, v) * (1.0 - smoothstep(0.93, 1.0, v));
          float core = exp(-sq((v - 0.86) / 0.05));
          float a = (edge * 0.55 + core * 0.9) * body * uOpacity;
          if (a < 0.003) discard;
          gl_FragColor = vec4(uColor * (0.6 + core * 0.9), a);
        }`,
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
    });
    const m = new T.Mesh(geo, mat);
    m.matrixAutoUpdate = false;
    m.frustumCulled = false;
    m.renderOrder = 9;
    m.visible = false;
    FX.scene.add(m);
    return { mesh: m, geo, mat, active: false, release() { this.active = false; this.mesh.visible = false; } };
  }

  const _arcH = new V3(), _arcB = new V3(), _R = new V3();
  // Create a crescent for slash definition S, frozen to the body's current world matrix.
  FX.crescent = function (S, bodyMatrix, opts) {
    const c = FX.crescents.get();
    c.active = true; c.S = S; c.t = 0; c.released = false; c.fade = 1;
    c.opts = opts || {};
    c.mesh.matrix.copy(bodyMatrix);
    c.mesh.matrixWorld.copy(bodyMatrix);
    c.mesh.visible = true;
    c.mat.uniforms.uColor.value.setRGB(2.4, 2.45, 2.6).multiplyScalar(c.opts.bright || 1);
    // precompute geometry along the full arc; reveal is driven by uHead/uTail in UV space
    const pos = c.geo.attributes.position.array;
    const inner = c.opts.inner || 0.35, outer = c.opts.outer || 1.16;
    _R.set(-1, S.tilt, 0).normalize();
    for (let i = 0; i <= SEG; i++) {
      const th = U.lerp(S.th0, S.th1, i / SEG);
      const cx = Math.cos(th), sz = Math.sin(th);
      _arcH.set(S.pivot.x + S.r * cx * _R.x, S.pivot.y + S.r * cx * _R.y, S.pivot.z + S.r * sz);
      _arcB.set(cx * _R.x, cx * _R.y - S.droop, sz).normalize();
      // taper the crescent thickness toward both ends
      const taper = Math.sin((i / SEG) * Math.PI);
      const inR = U.lerp(outer - 0.12, inner, Math.pow(taper, 0.6));
      pos[i * 6] = _arcH.x + _arcB.x * inR; pos[i * 6 + 1] = _arcH.y + _arcB.y * inR; pos[i * 6 + 2] = _arcH.z + _arcB.z * inR;
      pos[i * 6 + 3] = _arcH.x + _arcB.x * outer; pos[i * 6 + 4] = _arcH.y + _arcB.y * outer; pos[i * 6 + 5] = _arcH.z + _arcB.z * outer;
    }
    c.geo.attributes.position.needsUpdate = true;
    c.mat.uniforms.uHead.value = 0; c.mat.uniforms.uTail.value = 0; c.mat.uniforms.uOpacity.value = 1;
    return c;
  };
  // drive: progress 0..1 of the swing (head position along the arc)
  FX.makeCrescentMesh = makeCrescent;
  FX.CRESCENT_SEG = SEG;
  FX.crescentSet = function (c, progress) {
    if (!c || !c.active) return;
    c.mat.uniforms.uHead.value = progress;
    c.mat.uniforms.uTail.value = Math.max(0, progress - 0.85);
  };
  FX.crescentRelease = function (c) { if (c && c.active) c.released = true; };

  // ---------------- Afterimages ----------------
  FX.initAfterimages = function (rig) {
    FX.ghosts = [];
    for (let g = 0; g < 6; g++) {
      const mat = U.spectralMaterial({ opacity: 0.5, core: 0.25, edge: 1.0, glow: 1.3 });
      const grp = new T.Group();
      grp.visible = false;
      const meshes = rig.meshList.map((src) => {
        const m = new T.Mesh(src.geometry, mat);
        m.matrixAutoUpdate = false;
        m.frustumCulled = false;
        m.renderOrder = 4;
        grp.add(m);
        return { m, src };
      });
      FX.scene.add(grp);
      FX.ghosts.push({ grp, mat, meshes, active: false, t: 0, dur: 0.4, peak: 0.5 });
    }
  };
  FX.afterimage = function (peak, dur) {
    let g = FX.ghosts.find((x) => !x.active) || FX.ghosts.reduce((a, b) => (a.t > b.t ? a : b));
    g.active = true; g.t = 0; g.dur = dur || 0.38; g.peak = peak || 0.5;
    for (const { m, src } of g.meshes) { m.matrix.copy(src.matrixWorld); m.matrixWorld.copy(src.matrixWorld); m.visible = src.visible; }
    g.grp.visible = true;
    g.mat.uniforms.uOpacity.value = g.peak;
  };

  // ---------------- Telegraphs (enemy warnings) ----------------
  const TELE_FS = `
#define sq(x) ((x)*(x))
    uniform float uR, uHalf, uProgress, uOpacity, uLocked, uTime; uniform vec3 uColor; uniform float uMode;
    varying vec2 vP;
    void main(){
      float d = length(vP);
      float ang = atan(vP.x, -vP.y);
      float inSector = 1.0 - smoothstep(uHalf - 0.02, uHalf + 0.02, abs(ang));
      if (uMode < 0.5) inSector = 1.0;
      float inside = (1.0 - smoothstep(uR - 0.03, uR, d)) * inSector;
      float outline = exp(-sq((d - uR) / 0.045)) * inSector;
      if (uMode > 0.5) {
        float sideD = abs(abs(ang) - uHalf) * d;
        outline += exp(-sq(sideD / 0.04)) * (1.0 - smoothstep(uR, uR + 0.05, d)) * step(0.15, d);
      }
      float front = uProgress * uR;
      float fill = inside * (1.0 - smoothstep(front - 0.02, front, d)) * 0.2;
      float frontLine = inside * exp(-sq((d - front) / 0.05)) * 0.7;
      float pulse = 0.85 + 0.15 * sin(uTime * 18.0);
      float a = (outline * (0.55 + 0.45 * uLocked) * pulse + fill + frontLine + inside * 0.035) * uOpacity;
      if (a < 0.003) discard;
      gl_FragColor = vec4(uColor * (1.0 + uLocked * 0.4), a);
    }`;
  function makeTelegraph() {
    const mat = new T.ShaderMaterial({
      uniforms: { uR: { value: 2 }, uHalf: { value: 1 }, uProgress: { value: 0 }, uOpacity: { value: 1 }, uLocked: { value: 0 }, uTime: U.shared.uTime, uColor: { value: FX.AMBER.clone() }, uMode: { value: 0 }, uSize: { value: 2 } },
      vertexShader: RING_VS, fragmentShader: TELE_FS, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    });
    const grp = new T.Group();
    const m = new T.Mesh(new T.PlaneGeometry(2, 2), mat);
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 5;
    grp.add(m);
    grp.visible = false;
    FX.scene.add(grp);
    return { grp, mesh: m, mat, active: false, release() { this.active = false; this.grp.visible = false; } };
  }
  // circle or sector warning; returns a handle the owner updates and releases
  FX.telegraph = function (o) {
    const t = FX.teles.get();
    t.active = true;
    const u = t.mat.uniforms;
    const size = o.r + 0.2;
    t.mesh.scale.set(size, size, 1);
    u.uSize.value = size;
    u.uR.value = o.r; u.uHalf.value = o.half || Math.PI; u.uMode.value = o.half ? 1 : 0;
    u.uProgress.value = 0; u.uLocked.value = 0; u.uOpacity.value = 1;
    u.uColor.value.copy(o.color || FX.AMBER).multiplyScalar(o.intensity || 1);
    t.grp.position.set(o.pos.x, 0.07, o.pos.z);
    t.grp.rotation.y = o.yaw || 0;
    t.grp.visible = true;
    return t;
  };

  // ---------------- Generic ghosts (any object: enemy echoes, predictions, burned silhouettes) ----------------
  const GHOST_SLOTS = 40;
  function makeGhost() {
    const spectral = U.spectralMaterial({ opacity: 0.5, core: 0.3, edge: 1.0, glow: 1.2 });
    const burn = new T.MeshBasicMaterial({ color: 0x030304, transparent: true, opacity: 0.9, depthWrite: false });
    const grp = new T.Group();
    grp.visible = false;
    const meshes = [];
    for (let i = 0; i < GHOST_SLOTS; i++) {
      const m = new T.Mesh(undefined, spectral);
      m.matrixAutoUpdate = false; m.frustumCulled = false; m.visible = false; m.renderOrder = 4;
      grp.add(m); meshes.push(m);
    }
    FX.scene.add(grp);
    return { grp, meshes, spectral, burn, active: false, t: 0, o: null, release() { this.active = false; this.grp.visible = false; } };
  }
  const _gm = new T.Matrix4();
  // Snapshot every visible mesh under `root` into a ghost. o: {offset (V3, world), opacity, dur, hold, mode: 'spectral'|'burn', fadeIn}
  FX.ghostOf = function (root, o) {
    o = o || {};
    const g = FX.ghostPool.get();
    g.active = true; g.t = 0; g.o = o;
    root.updateMatrixWorld(true);
    _gm.makeTranslation(o.offset ? o.offset.x : 0, o.offset ? o.offset.y : 0, o.offset ? o.offset.z : 0);
    const mat = o.mode === 'burn' ? g.burn : g.spectral;
    let i = 0;
    root.traverseVisible((src) => {
      if (!src.isMesh || src.isInstancedMesh || i >= GHOST_SLOTS || src.userData.noGhost || src.renderOrder >= 20) return;
      const m = g.meshes[i++];
      m.geometry = src.geometry; m.material = mat; m.visible = true;
      m.matrix.multiplyMatrices(_gm, src.matrixWorld); m.matrixWorld.copy(m.matrix);
    });
    for (; i < GHOST_SLOTS; i++) g.meshes[i].visible = false;
    g.grp.visible = true;
    updateGhost(g, 0);
    return g;
  };
  function updateGhost(g, dt) {
    g.t += dt;
    const o = g.o, dur = o.dur || 0.4, hold = o.hold || 0, peak = o.opacity != null ? o.opacity : 0.5;
    const fadeIn = o.fadeIn ? U.clamp(g.t / o.fadeIn, 0, 1) : 1;
    const k = g.t < hold ? 0 : U.clamp((g.t - hold) / dur, 0, 1);
    const a = peak * fadeIn * (1 - k) * (1 - k);
    if (o.mode === 'burn') g.burn.opacity = a; else g.spectral.uniforms.uOpacity.value = a;
    if (g.t >= hold + dur) g.release();
  }

  // ---------------- Reality damage: the floor stays wrong for a while ----------------
  const _wp = new V3(), _wv = new V3();
  FX.wrong = function (pos, radius, dur, strength) {
    const k = strength || 1;
    FX.crack(pos, radius * 1.6, dur, 0.28 * k);
    // slabs and grit lift off the floor and hang there, slowly turning
    for (let i = 0; i < Math.round(8 * k); i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius;
      _wp.set(pos.x + Math.cos(a) * r, 0.1, pos.z + Math.sin(a) * r);
      FX.shards(_wp, 1, { speed: 0.6, up: 6, size: 0.12 + Math.random() * 0.18, life: dur, grav: -0.25, drag: 1.2, spread: 0.1, floor: false, colors: [_slabA, _slabB] });
    }
    // mist that runs backwards: it falls and gathers instead of rising
    for (let i = 0; i < Math.round(5 * k); i++) {
      const a = Math.random() * Math.PI * 2, r = radius * (0.7 + Math.random() * 0.5);
      _wp.set(pos.x + Math.cos(a) * r, 1.4 + Math.random(), pos.z + Math.sin(a) * r);
      _wv.set(-Math.cos(a) * 0.9, -0.5, -Math.sin(a) * 0.9);
      FX.mist(_wp, 1, { spread: 0.1, rise: 0.01, out: 0.01, vel: _wv, life: Math.min(2.2, dur), size: 1.0, grow: 0.6, a: 0.16, drag: 0.4 });
    }
  };
  const _slabA = new T.Color(0.16, 0.16, 0.18), _slabB = new T.Color(0.26, 0.26, 0.29);

  // ---------------- Space-fold seam: a hairline where space was folded shut ----------------
  const SEAM_FS = `
#define sq(x) ((x)*(x))
    uniform float uOpacity; varying vec2 vUv;
    void main(){
      float v = abs(vUv.y - 0.5) * 2.0;
      float edge = exp(-sq((v - 0.55) / 0.18));
      float core = 1.0 - smoothstep(0.35, 0.5, v);
      float ends = smoothstep(0.0, 0.08, vUv.x) * (1.0 - smoothstep(0.92, 1.0, vUv.x));
      float a = clamp(edge + core * 0.9, 0.0, 1.0) * ends * uOpacity;
      if (a < 0.004) discard;
      gl_FragColor = vec4(vec3(2.6, 2.65, 2.9) * edge, a);
    }`;
  function makeSeam() {
    const mat = new T.ShaderMaterial({ uniforms: { uOpacity: { value: 0 } }, vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`, fragmentShader: SEAM_FS, transparent: true, depthWrite: false, side: T.DoubleSide });
    const geo = new T.PlaneGeometry(1, 1); geo.translate(0.5, 0, 0); geo.rotateX(-Math.PI / 2);
    const m = new T.Mesh(geo, mat);
    m.visible = false; m.renderOrder = 8;
    FX.scene.add(m);
    return { mesh: m, mat, active: false, t: 0, dur: 0.2, release() { this.active = false; this.mesh.visible = false; } };
  }
  // flat seam on the ground from a to b
  FX.seam = function (a, b, width, dur) {
    const sm = FX.seams.get();
    sm.active = true; sm.t = 0; sm.dur = dur || 0.2;
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    sm.mesh.position.set(a.x, 0.09, a.z);
    sm.mesh.rotation.set(0, Math.atan2(-dz, dx), 0);
    sm.mesh.scale.set(len, 1, width || 0.12);
    sm.mesh.visible = true;
    return sm;
  };

  // ---------------- Init / update / reset ----------------
  FX.init = function (scene) {
    FX.scene = scene;
    FX.rings = new U.Pool(makeRing, 28);
    FX.spark = makePoints(900, true, false);
    FX.puff = makePoints(260, false, true);
    const shardGeo = new T.TetrahedronGeometry(1, 0);
    shardGeo.scale(0.55, 1.4, 0.4);
    FX.brightShards = makeShards(220, new T.MeshBasicMaterial({ color: new T.Color(2.0, 2.05, 2.2), transparent: true, opacity: 0.9, blending: T.AdditiveBlending, depthWrite: false }), shardGeo);
    const stoneMat = U.stdMat({ color: 0xffffff, roughness: 0.8, metalness: 0.2 }, 0.35, 2.2);
    FX.stoneShards = makeShards(320, stoneMat, shardGeo);
    FX.stoneShards.im.castShadow = true;
    FX.lights = [];
    for (let i = 0; i < 4; i++) {
      const l = new T.PointLight(0xffffff, 0, 8, 1.6);
      l.position.set(0, -50, 0);
      scene.add(l);
      FX.lights.push({ light: l, t: 1, dur: 1, peak: 0 });
    }
    FX.decals = new U.Pool(makeDecal, 8);
    FX.fractureGeos = [1, 2, 3, 4].map(fractureGeom);
    FX.fractures = new U.Pool(() => {
      const m = new T.Mesh(FX.fractureGeos[0], new T.MeshBasicMaterial({ color: new T.Color(2.6, 2.65, 2.8), transparent: true, depthWrite: false, depthTest: false, blending: T.AdditiveBlending, side: T.DoubleSide }));
      m.visible = false; m.renderOrder = 12;
      scene.add(m);
      return { mesh: m, active: false, t: 0, dur: 0.3, release() { this.active = false; this.mesh.visible = false; } };
    }, 10);
    FX.crescents = new U.Pool(makeCrescent, 6);
    FX.teles = new U.Pool(makeTelegraph, 24);
    FX.ghostPool = new U.Pool(makeGhost, 12);
    FX.seams = new U.Pool(makeSeam, 6);
  };

  FX.update = function (dt) {
    FX.rings.forEachActive((r) => updateRing(r, dt));
    updatePoints(FX.spark, dt);
    updatePoints(FX.puff, dt);
    updateShards(FX.brightShards, dt);
    updateShards(FX.stoneShards, dt);
    for (const l of FX.lights) {
      l.t += dt;
      const k = U.clamp(l.t / l.dur, 0, 1);
      l.light.intensity = l.peak * Math.pow(1 - k, 2);
    }
    FX.decals.forEachActive((d) => {
      d.t += dt;
      const k = d.t / d.dur;
      d.mat.opacity = d.peak * (k < 0.08 ? k / 0.08 : Math.pow(1 - (k - 0.08) / 0.92, 1.5));
      if (k >= 1) d.release();
    });
    FX.fractures.forEachActive((f) => {
      f.t += dt;
      const k = f.t / f.dur;
      f.mesh.material.opacity = 1 - k * k;
      f.mesh.scale.multiplyScalar(1 + dt * 0.6);
      if (k >= 1) f.release();
    });
    FX.crescents.forEachActive((c) => {
      c.t += dt;
      if (c.released) {
        c.fade -= dt / (c.opts.fadeTime || 0.16);
        const u = c.mat.uniforms;
        u.uTail.value = Math.min(u.uHead.value, u.uTail.value + dt * 5);
        u.uOpacity.value = Math.max(0, c.fade);
        if (c.fade <= 0) c.release();
      }
    });
    FX.ghostPool.forEachActive((g) => updateGhost(g, dt));
    FX.seams.forEachActive((sm) => {
      sm.t += dt;
      const k = sm.t / sm.dur;
      sm.mat.uniforms.uOpacity.value = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
      if (k >= 1) sm.release();
    });
    if (FX.ghosts) for (const g of FX.ghosts) {
      if (!g.active) continue;
      g.t += dt;
      const k = g.t / g.dur;
      g.mat.uniforms.uOpacity.value = g.peak * (1 - k) * (1 - k);
      if (k >= 1) { g.active = false; g.grp.visible = false; }
    }
  };

  FX.reset = function () {
    FX.rings.forEachActive((r) => r.release());
    for (const P of [FX.spark, FX.puff]) for (const c of P.parts) c.active = false;
    for (const S of [FX.brightShards, FX.stoneShards]) { for (let i = 0; i < S.max; i++) { S.parts[i].active = false; S.im.setMatrixAt(i, S.zero); } S.im.instanceMatrix.needsUpdate = true; }
    for (const l of FX.lights) { l.t = l.dur; l.light.intensity = 0; }
    FX.decals.forEachActive((d) => d.release());
    FX.fractures.forEachActive((f) => f.release());
    FX.crescents.forEachActive((c) => c.release());
    FX.teles.forEachActive((t) => t.release());
    if (FX.ghosts) for (const g of FX.ghosts) { g.active = false; g.grp.visible = false; }
    FX.ghostPool.forEachActive((g) => g.release());
    FX.seams.forEachActive((sm) => sm.release());
  };
})(window.U);
