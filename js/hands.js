/* UNHALLOWED — articulated spectral hands.
   Each hand is a single SkinnedMesh (rigid skinning) so a dozen of them stay cheap:
   palm, thumb and four 3-jointed fingers, plus a fading spectral forearm. Local frame:
   fingers extend along +Y from the wrist, the palm faces +Z, the thumb sits on +X. */
'use strict';
(function (U) {
  const T = THREE;

  U.HAND_POSES = {
    open:    { c: [0.04, 0.03, 0.07, 0.12], th: 0.0, sp: 1.0 },
    relaxed: { c: [0.28, 0.36, 0.44, 0.5], th: 0.25, sp: 0.45 },
    reach:   { c: [0.18, 0.22, 0.26, 0.3], th: 0.15, sp: 0.85 },
    claw:    { c: [0.6, 0.64, 0.66, 0.7], th: 0.45, sp: 0.75 },
    point:   { c: [0.0, 1.05, 1.1, 1.12], th: 0.8, sp: 0.12 },
    clench:  { c: [1.08, 1.12, 1.12, 1.1], th: 0.95, sp: 0.0 },
    grip:    { c: [0.85, 0.9, 0.92, 0.95], th: 0.7, sp: 0.05 },
  };

  const FINGERS = [
    { x: 0.052, lens: [0.078, 0.052, 0.04], r: 0.017, spread: -0.16 },
    { x: 0.017, lens: [0.088, 0.058, 0.043], r: 0.018, spread: -0.05 },
    { x: -0.018, lens: [0.083, 0.054, 0.041], r: 0.017, spread: 0.06 },
    { x: -0.052, lens: [0.064, 0.042, 0.034], r: 0.015, spread: 0.18 },
  ];
  const THUMB = { pos: [0.066, 0.035, 0.012], lens: [0.062, 0.046, 0.036], r: 0.02 };
  const PALM_TOP = 0.17;

  let template = null; // shared geometry + bone layout

  function palmGeom() {
    // faceted palm: narrower at the wrist, wide at the knuckles, slightly domed on the back
    const v = [
      [-0.05, 0.0, 0.016], [0.05, 0.0, 0.016], [0.078, PALM_TOP, 0.014], [-0.072, PALM_TOP, 0.014], // palm side (+z)
      [-0.05, 0.0, -0.018], [0.05, 0.0, -0.018], [0.078, PALM_TOP, -0.016], [-0.072, PALM_TOP, -0.016], // back side
      [0.0, 0.09, -0.034], [0.0, 0.085, 0.026], // back dome / palm hollow centre
      [0.082, 0.07, 0.0], [-0.07, 0.07, 0.0], // side bulges
    ];
    const t = [
      // palm face (+z) fan around centre 9
      [9, 0, 1], [9, 1, 10], [9, 10, 2], [9, 2, 3], [9, 3, 11], [9, 11, 0],
      // back face (-z) fan around centre 8
      [8, 5, 4], [8, 10, 5], [8, 6, 10], [8, 7, 6], [8, 11, 7], [8, 4, 11],
      // rims
      [1, 5, 10], [10, 6, 2], [3, 7, 11], [11, 4, 0], [0, 4, 5], [0, 5, 1], [2, 6, 7], [2, 7, 3],
    ];
    return U.geomFrom(v, t);
  }

  function segGeom(len, r0, r1) {
    // 4-sided tapered prism (diamond section) along +Y, slightly flattened
    return U.taperGeom(len, r0, r1, 4, 1.0, 0.8, false);
  }

  function buildTemplate() {
    const bones = [];
    const parts = []; // {geo, bone}
    const root = new T.Bone(); bones.push(root);
    parts.push({ geo: palmGeom(), bone: 0 });
    // spectral forearm: fades out away from the wrist (aFade)
    const fore = U.taperGeom(0.34, 0.042, 0.006, 5, 1.0, 0.75, true);
    fore.userData.fadeAlong = true;
    parts.push({ geo: fore, bone: 0 });
    const fingerBones = [];
    for (const f of FINGERS) {
      const chain = [];
      let parent = root, py = PALM_TOP, px = f.x;
      for (let k = 0; k < 3; k++) {
        const b = new T.Bone();
        b.position.set(k === 0 ? px : 0, k === 0 ? py : f.lens[k - 1], 0);
        parent.add(b); bones.push(b); chain.push(b);
        const r0 = f.r * (1 - k * 0.18), r1 = f.r * (1 - (k + 1) * 0.18) * (k === 2 ? 0.35 : 1);
        parts.push({ geo: segGeom(f.lens[k], r0, r1), bone: bones.length - 1 });
        parent = b;
      }
      fingerBones.push(chain);
    }
    const thumb = [];
    {
      let parent = root;
      for (let k = 0; k < 3; k++) {
        const b = new T.Bone();
        if (k === 0) { b.position.set(...THUMB.pos); b.rotation.set(0.35, -0.3, -0.85); }
        else b.position.set(0, THUMB.lens[k - 1], 0);
        parent.add(b); bones.push(b); thumb.push(b);
        const r0 = THUMB.r * (1 - k * 0.2), r1 = THUMB.r * (1 - (k + 1) * 0.2) * (k === 2 ? 0.4 : 1);
        parts.push({ geo: segGeom(THUMB.lens[k], r0, r1), bone: bones.length - 1 });
        parent = b;
      }
    }
    // bake bind pose
    root.updateMatrixWorld(true);
    const geos = [];
    for (const p of parts) {
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
      g.applyMatrix4(bones[p.bone].matrixWorld);
      const n = g.attributes.position.count;
      const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), fade = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        si[i * 4] = p.bone; sw[i * 4] = 1;
        fade[i] = 1;
        if (p.geo.userData.fadeAlong) {
          const y = g.attributes.position.getY(i); // 0 at wrist -> -0.34 at tip
          fade[i] = U.clamp(1 + y / 0.34, 0, 1);
        }
      }
      g.setAttribute('skinIndex', new T.Uint16BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new T.Float32BufferAttribute(sw, 4));
      g.setAttribute('aFade', new T.Float32BufferAttribute(fade, 1));
      if (g.attributes.uv) g.deleteAttribute('uv');
      geos.push(g);
    }
    const geo = THREE.BufferGeometryUtils.mergeGeometries(geos, false);
    geo.computeVertexNormals();
    // record rest rotations for each bone index
    const rest = bones.map((b) => b.rotation.clone());
    const fingerIdx = fingerBones.map((ch) => ch.map((b) => bones.indexOf(b)));
    const thumbIdx = thumb.map((b) => bones.indexOf(b));
    // bone hierarchy description to rebuild per instance
    const layout = bones.map((b) => ({ parent: b.parent && b.parent.isBone ? bones.indexOf(b.parent) : -1, pos: b.position.clone(), rot: b.rotation.clone() }));
    return { geo, rest, fingerIdx, thumbIdx, layout };
  }

  const HAND_VS = `
    #include <common>
    #include <skinning_pars_vertex>
    attribute float aFade;
    varying vec3 vViewPos;
    varying float vFade;
    void main() {
      vFade = aFade;
      #include <skinbase_vertex>
      #include <begin_vertex>
      #include <skinning_vertex>
      #include <project_vertex>
      vViewPos = mvPosition.xyz;
    }`;
  const HAND_FS = `
#define sq(x) ((x)*(x))
    uniform vec3 uColor; uniform float uOpacity; uniform float uCore; uniform float uEdge; uniform float uGlow;
    varying vec3 vViewPos; varying float vFade;
    void main() {
      vec3 n = cross(dFdx(vViewPos), dFdy(vViewPos)); n = length(n) > 1e-12 ? normalize(n) : vec3(0.0, 0.0, 1.0);
      vec3 v = normalize(-vViewPos);
      float ndv = abs(dot(n, v));
      float fres = sq(1.0 - ndv);
      float facet = 0.4 + 0.6 * clamp(n.y * 0.55 + n.x * 0.3 + 0.5, 0.0, 1.0);
      float a = uOpacity * vFade * clamp(uCore * facet + fres * uEdge, 0.0, 1.0);
      vec3 col = uColor * uGlow * (0.5 + 0.65 * facet + fres * 1.5);
      gl_FragColor = vec4(col, a);
    }`;

  U.handMaterial = function (o) {
    o = o || {};
    return new T.ShaderMaterial({
      uniforms: {
        uColor: { value: new T.Color(o.color || 0xe6ebf7) },
        uOpacity: { value: o.opacity != null ? o.opacity : 1 },
        uCore: { value: o.core != null ? o.core : 0.3 },
        uEdge: { value: o.edge != null ? o.edge : 0.95 },
        uGlow: { value: o.glow != null ? o.glow : 1.25 },
      },
      vertexShader: HAND_VS, fragmentShader: HAND_FS,
      transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    });
  };

  U.SpectralHand = class {
    constructor(scene, opts) {
      opts = opts || {};
      if (!template) template = buildTemplate();
      this.group = new T.Group();
      this.mat = U.handMaterial(opts);
      const bones = template.layout.map((l) => { const b = new T.Bone(); b.position.copy(l.pos); b.rotation.copy(l.rot); return b; });
      template.layout.forEach((l, i) => { if (l.parent >= 0) bones[l.parent].add(bones[i]); });
      this.bones = bones;
      this.mesh = new T.SkinnedMesh(template.geo, this.mat);
      this.mesh.add(bones[0]);
      this.mesh.frustumCulled = false;
      this.mesh.userData.sharedGeo = true;
      this.mesh.updateMatrixWorld(true);
      this.mesh.bind(new T.Skeleton(bones));
      this.mesh.renderOrder = 5;
      this.inner = new T.Group(); // allows mirroring (scale.x = -1) and base scale
      this.inner.add(this.mesh);
      this.group.add(this.inner);
      if (opts.mirror) this.inner.scale.x = -1;
      scene.add(this.group);
      this.cur = { c: [0.3, 0.3, 0.3, 0.3], th: 0.2, sp: 0.5 };
      this.target = U.HAND_POSES.relaxed;
      this.poseSpeed = 10;
      this.scale = 1;
      this.opacity = 1;
      this.active = false;
    }
    setPose(name, speed) {
      this.target = typeof name === 'string' ? U.HAND_POSES[name] : name;
      if (speed) this.poseSpeed = speed;
    }
    snapPose(name) {
      const p = U.HAND_POSES[name];
      this.target = p;
      for (let i = 0; i < 4; i++) this.cur.c[i] = p.c[i];
      this.cur.th = p.th; this.cur.sp = p.sp;
    }
    setScale(s) { this.scale = s; this.inner.scale.set(this.inner.scale.x < 0 ? -s : s, s, s); }
    setOpacity(o) { this.opacity = o; this.mat.uniforms.uOpacity.value = o; this.group.visible = o > 0.003; }
    setGlow(g) { this.mat.uniforms.uGlow.value = g; }
    // orient so local +Y (fingers) points along `up` and the palm (+Z) faces `palm`
    orient(up, palm, out) {
      const y = _a.copy(up).normalize();
      const z = _b.copy(palm).addScaledVector(y, -palm.dot(y)).normalize();
      const x = _c.crossVectors(y, z).normalize();
      _m.makeBasis(x, y, z);
      return (out || this.group.quaternion).setFromRotationMatrix(_m);
    }
    update(dt) {
      const k = 1 - Math.exp(-this.poseSpeed * dt);
      const c = this.cur, t = this.target;
      for (let i = 0; i < 4; i++) c.c[i] += (t.c[i] - c.c[i]) * k;
      c.th += (t.th - c.th) * k;
      c.sp += (t.sp - c.sp) * k;
      const B = this.bones, rest = template.rest;
      template.fingerIdx.forEach((chain, fi) => {
        const curl = c.c[fi];
        const b0 = B[chain[0]], b1 = B[chain[1]], b2 = B[chain[2]];
        b0.rotation.set(rest[chain[0]].x + curl * 1.2, 0, FINGERS[fi].spread * c.sp);
        b1.rotation.x = curl * 1.5;
        b2.rotation.x = curl * 1.15;
      });
      const th = template.thumbIdx;
      const r0 = rest[th[0]];
      B[th[0]].rotation.set(r0.x + c.th * 0.55, r0.y - c.th * 0.25, r0.z + c.th * 0.65);
      B[th[1]].rotation.x = c.th * 0.85;
      B[th[2]].rotation.x = c.th * 0.8;
    }
  };
  const _a = new T.Vector3(), _b = new T.Vector3(), _c = new T.Vector3(), _m = new T.Matrix4();
})(window.U);
