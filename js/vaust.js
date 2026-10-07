/* UNHALLOWED — Vaust: low-poly articulated model, procedural animation, cloth/hair secondary motion,
   two-bone arm IK for sword arcs, and the four spectral hands that float around him.
   Model faces +Z; his right side is -X. */
'use strict';
(function (U) {
  const T = THREE;
  const V3 = T.Vector3;
  const DOWN = new V3(0, -1, 0);

  // ---------------- Cloth panel (CPU-deformed strip with spring follow-through) ----------------
  class ClothPanel {
    constructor(parent, o) {
      this.o = o;
      const rows = 6, cols = 5;
      this.rows = rows; this.cols = cols;
      const rest = [];
      const uvs = [];
      const tipShape = o.tip || [0.03, -0.09, 0.02, -0.13, 0.04];
      for (let r = 0; r < rows; r++) {
        const t = r / (rows - 1);
        const hw = (o.w / 2) * (1 + (o.flare || 0.42) * t);
        for (let c = 0; c < cols; c++) {
          const u = c / (cols - 1);
          const x = (u - 0.5) * 2 * hw;
          let y = -t * o.len;
          if (r === rows - 1) y += tipShape[c]; // negative values extend into points
          const z = -(x * x) * (o.curve || 2.4) + (c === 2 ? (o.fold || 0.02) : 0);
          rest.push(x, y, z);
          uvs.push(u, 1 - t);
        }
      }
      const idx = [];
      for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cols - 1; c++) {
          const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
          idx.push(a, d, b, b, d, e);
        }
      }
      this.rest = new Float32Array(rest);
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(new Float32Array(rest), 3));
      geo.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      geo.boundingSphere = new T.Sphere(new V3(0, -o.len / 2, 0), o.len * 1.4);
      this.geo = geo;
      this.mesh = new T.Mesh(geo, o.mat);
      this.mesh.castShadow = true;
      this.group = new T.Group();
      this.group.position.copy(o.at);
      this.group.rotation.set(0, o.yaw, 0);
      this.tilt = new T.Group();
      this.tilt.rotation.x = -(o.tiltOut || 0.1); // positive tilt swings the hem outward (+Z)
      this.tilt.add(this.mesh);
      this.group.add(this.tilt);
      parent.add(this.group);
      this.s = new T.Vector2(); // x: sideways, y: outward
      this.v = new T.Vector2();
      this.ph = Math.random() * 10;
      this.outW = new V3(); this.sideW = new V3();
    }
    // vel: world velocity; push: extra outward push (legs); dt
    update(dt, vel, push, time, gust) {
      const q = this.group.getWorldQuaternion(_q);
      this.outW.set(0, 0, 1).applyQuaternion(q);
      this.sideW.set(1, 0, 0).applyQuaternion(q);
      const vo = vel.x * this.outW.x + vel.z * this.outW.z;
      const vs = vel.x * this.sideW.x + vel.z * this.sideW.z;
      const k = this.o.drag || 0.075;
      let tz = -vo * k + push + Math.sin(time * 1.7 + this.ph) * 0.012 * (1 + gust);
      let tx = -vs * k * 0.8 + Math.sin(time * 1.3 + this.ph * 2) * 0.015 * (1 + gust);
      tz = U.clamp(tz, -0.07, 0.75); tx = U.clamp(tx, -0.45, 0.45);
      const K = 70, D = 8.5;
      this.v.x += (K * (tx - this.s.x) - D * this.v.x) * dt;
      this.v.y += (K * (tz - this.s.y) - D * this.v.y) * dt;
      this.s.x += this.v.x * dt; this.s.y += this.v.y * dt;
      this.s.y = Math.max(this.s.y, -0.08);
      const pos = this.geo.attributes.position.array, rest = this.rest;
      const L = this.o.len, sx = this.s.x, sz = this.s.y;
      for (let i = 0; i < pos.length; i += 3) {
        const t = U.clamp(-rest[i + 1] / L, 0, 1.3);
        const w = Math.pow(t, 1.6);
        const ripple = Math.sin(time * 5 + t * 6 + rest[i] * 20 + this.ph) * 0.012 * t * (Math.abs(sz) + Math.abs(sx));
        pos[i] = rest[i] + sx * w * L;
        pos[i + 2] = rest[i + 2] + sz * w * L + ripple;
        pos[i + 1] = rest[i + 1] + (sx * sx + sz * sz) * 0.45 * t * t * L;
      }
      this.geo.attributes.position.needsUpdate = true;
    }
  }
  const _q = new T.Quaternion();

  // ---------------- Pendulum (hair clumps, talismans) ----------------
  class Swing {
    constructor(obj, restX, restZ, stiff, damp, gain) {
      this.obj = obj; this.rx = restX; this.rz = restZ;
      this.ax = 0; this.az = 0; this.vx = 0; this.vz = 0;
      this.k = stiff || 40; this.d = damp || 6; this.g = gain || 0.12;
      this.child = null; this.cx = 0; this.cz = 0; this.cvx = 0; this.cvz = 0;
    }
    update(dt, localVel, extraX, extraZ) {
      // localVel: velocity expressed in the parent's frame (x side, z forward)
      const tx = U.clamp(localVel.z * this.g, -0.9, 0.9) + (extraX || 0);  // forward motion -> swing back (+x rotation)
      const tz = U.clamp(-localVel.x * this.g, -0.7, 0.7) + (extraZ || 0);
      this.vx += (this.k * (tx - this.ax) - this.d * this.vx) * dt;
      this.vz += (this.k * (tz - this.az) - this.d * this.vz) * dt;
      this.ax += this.vx * dt; this.az += this.vz * dt;
      this.obj.rotation.x = this.rx + this.ax;
      this.obj.rotation.z = this.rz + this.az;
      if (this.child) {
        const k2 = this.k * 0.8, d2 = this.d * 0.8;
        this.cvx += (k2 * (this.ax * 0.7 - this.cx) - d2 * this.cvx) * dt;
        this.cvz += (k2 * (this.az * 0.7 - this.cz) - d2 * this.cvz) * dt;
        this.cx += this.cvx * dt; this.cz += this.cvz * dt;
        this.child.rotation.x = this.cx + this.childRestX;
        this.child.rotation.z = this.cz;
      }
    }
  }

  // ---------------- Geometry helpers specific to Vaust ----------------
  function mesh(geo, mat, parent, x, y, z, rx, ry, rz) {
    const m = new T.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  function maskGeom() {
    const v = [
      [0, 0.19, 0.072], [0.05, 0.1, 0.09], [-0.05, 0.1, 0.09], [0.09, 0.035, 0.052], [-0.09, 0.035, 0.052],
      [0.028, 0.04, 0.106], [-0.028, 0.04, 0.106], [0, -0.01, 0.127], [0.08, -0.06, 0.056], [-0.08, -0.06, 0.056],
      [0.04, -0.112, 0.086], [-0.04, -0.112, 0.086], [0, -0.185, 0.07], [0, 0.08, 0.107],
    ];
    const t = [
      [0, 2, 13], [0, 13, 1], [13, 2, 6], [13, 6, 5], [13, 5, 1], [2, 4, 6], [1, 5, 3],
      [6, 4, 9], [6, 9, 7], [6, 7, 5], [5, 7, 8], [5, 8, 3],
      [7, 9, 11], [7, 11, 10], [7, 10, 8], [11, 12, 10], [9, 12, 11], [10, 12, 8],
    ];
    return U.geomFrom(v, t);
  }

  function diamondGeom(w, h, d) {
    const v = [[0, h, 0], [w, 0, 0], [0, -h, 0], [-w, 0, 0], [0, 0, d], [0, 0, -d * 0.3]];
    const t = [[4, 0, 3], [4, 3, 2], [4, 2, 1], [4, 1, 0], [5, 3, 0], [5, 2, 3], [5, 1, 2], [5, 0, 1]];
    return U.geomFrom(v, t);
  }

  function bladeGeom() {
    // blade along +Y, diamond section, edges along ±X
    const st = [[0.05, 0.03, 0.012], [0.92, 0.024, 0.01], [1.14, 0.0, 0.0]];
    const v = [];
    for (const [y, w, th] of st) v.push([w, y, 0], [0, y, th], [-w, y, 0], [0, y, -th]);
    const t = [];
    for (let s = 0; s < 2; s++) {
      const a = s * 4, b = a + 4;
      for (let k = 0; k < 4; k++) {
        const k1 = (k + 1) % 4;
        t.push([a + k, a + k1, b + k1], [a + k, b + k1, b + k]);
      }
    }
    t.push([0, 3, 2], [0, 2, 1]);
    return U.geomFrom(v, t);
  }

  function bootGeom() {
    const v = [
      [0.055, 0.12, -0.05], [-0.055, 0.12, -0.05], [0.055, 0.12, 0.05], [-0.055, 0.12, 0.05],
      [0.06, 0.0, -0.075], [-0.06, 0.0, -0.075], [0.06, 0.0, 0.1], [-0.06, 0.0, 0.1],
      [0.0, 0.0, 0.25], [0.0, 0.05, 0.2],
    ];
    const t = [
      [0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5], [0, 4, 5], [0, 5, 1], [2, 3, 9], [2, 6, 0], [6, 4, 0], [3, 1, 5], [3, 5, 7],
      [2, 9, 6], [3, 7, 9], [9, 7, 8], [9, 8, 6], [6, 8, 7],
    ];
    return U.geomFrom(v, t);
  }

  function torsoGeom(h, w0, d0, w1, d1, sides) {
    // tapered prism going up from y=0 (w0,d0) to y=h (w1,d1)
    const g = U.taperGeom(h, 1, 1, sides || 6, 1, 1, false);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = p.getY(i) / h;
      p.setX(i, p.getX(i) * U.lerp(w0, w1, t));
      p.setZ(i, p.getZ(i) * U.lerp(d0, d1, t));
    }
    g.computeVertexNormals();
    return g;
  }

  function mantleGeom(rTopX, rTopZ, yTop, rBotX, rBotZ, yBot, drops, n) {
    const v = [], t = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      v.push([Math.sin(a) * rTopX, yTop, Math.cos(a) * rTopZ]);
    }
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      v.push([Math.sin(a) * rBotX, yBot - drops(a, i), Math.cos(a) * rBotZ]);
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      t.push([i, n + i, n + j], [i, n + j, j]);
    }
    const g = U.geomFrom(v, t);
    return g;
  }

  function trimGeom(rBotX, rBotZ, yBot, drops, n, width) {
    // thin band hugging the lower edge of a mantle tier
    const v = [], t = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const y = yBot - drops(a, i);
      v.push([Math.sin(a) * rBotX * 1.015, y + width, Math.cos(a) * rBotZ * 1.015]);
      v.push([Math.sin(a) * rBotX * 1.03, y - 0.004, Math.cos(a) * rBotZ * 1.03]);
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = i * 2, b = i * 2 + 1, c = j * 2, d = j * 2 + 1;
      t.push([a, b, d], [a, d, c]);
    }
    return U.geomFrom(v, t);
  }

  // ---------------- Two-bone IK ----------------
  const _t = new V3(), _d = new V3(), _p = new V3(), _u = new V3(), _e = new V3(), _f = new V3(), _qi = new T.Quaternion();
  function solveArm(chest, shoulder, elbow, a, b, targetWorld, poleLocal) {
    _t.copy(targetWorld);
    chest.worldToLocal(_t);
    _d.copy(_t).sub(shoulder.position);
    let dist = _d.length();
    const maxR = (a + b) * 0.995, minR = Math.abs(a - b) + 0.02;
    dist = U.clamp(dist, minR, maxR);
    _d.normalize();
    const cosA = U.clamp((a * a + dist * dist - b * b) / (2 * a * dist), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    _p.copy(poleLocal).addScaledVector(_d, -poleLocal.dot(_d)).normalize();
    _u.copy(_d).multiplyScalar(cosA).addScaledVector(_p, sinA).normalize(); // upper arm direction
    shoulder.quaternion.setFromUnitVectors(DOWN, _u);
    _e.copy(shoulder.position).addScaledVector(_u, a);                       // elbow position
    _f.copy(shoulder.position).addScaledVector(_d, dist).sub(_e).normalize(); // forearm direction (chest space)
    _qi.copy(shoulder.quaternion).invert();
    _f.applyQuaternion(_qi);
    elbow.quaternion.setFromUnitVectors(DOWN, _f);
  }

  // ---------------- Poses ----------------
  function P(hx, hy, hz, bx, by, bz, ex, ey, ez) {
    return { h: new V3(hx, hy, hz), b: new V3(bx, by, bz).normalize(), e: new V3(ex || 0, ey || 0, ez == null ? 1 : ez) };
  }
  const POSE = {
    idleR: P(-0.27, 0.98, 0.12, -0.16, -0.8, 0.58, 0, 0, 1),
    runR: P(-0.3, 1.04, -0.06, -0.25, -0.32, -0.92, 0, 1, 0),
    guardR: P(-0.2, 1.12, 0.3, 0.2, -0.38, 0.9, -1, 0, 0),
  };

  // Swing arc for the sword: hand travels on a tilted circle around a pivot; blade points outward.
  function arc(out, pivot, rightTilt, radius, theta, droop) {
    const R = _ar.set(-1, rightTilt, 0).normalize();
    const F = _af.set(0, 0, 1);
    const cx = Math.cos(theta), sz = Math.sin(theta);
    out.h.set(pivot.x + radius * (cx * R.x + sz * F.x), pivot.y + radius * (cx * R.y), pivot.z + radius * (sz * F.z));
    out.b.set(cx * R.x, cx * R.y - droop, sz).normalize();
    out.e.set(-sz * R.x, -sz * R.y, cx).normalize(); // tangent for increasing theta
    return out;
  }
  const _ar = new V3(), _af = new V3();

  const SLASH = {
    // normalized phase boundaries: anticipation [0,a], swing [a,b], recovery [b,1]
    slash1: { dur: 0.42, a: 0.24, b: 0.46, pivot: new V3(-0.05, 1.3, 0.12), tilt: 0.55, r: 0.44, th0: -0.6, th1: Math.PI + 0.35, droop: 0.12, tw0: -0.6, tw1: 0.62, dir: 1 },
    slash2: { dur: 0.6, a: 0.28, b: 0.45, pivot: new V3(0.0, 1.2, 0.12), tilt: 0.32, r: 0.47, th0: Math.PI + 0.65, th1: -0.75, droop: 0.05, tw0: 0.78, tw1: -0.62, dir: -1 },
  };
  U.SLASH = SLASH;

  // ---------------- Build ----------------
  U.Vaust = class {
    constructor(scene) {
      const m = U.mats;
      this.scene = scene;
      const root = (this.root = new T.Group());
      const body = (this.body = new T.Group());
      root.add(body);
      scene.add(root);

      // --- hips & legs ---
      const hips = (this.hips = new T.Group());
      hips.position.y = 0.98;
      body.add(hips);
      mesh(torsoGeom(0.2, 0.16, 0.12, 0.15, 0.11, 7), m.clothInner, hips, 0, -0.1, 0);
      mesh(U.taperGeom(0.075, 0.17, 0.168, 8, 1, 0.78, true), m.darkMetal, hips, 0, 0.11, 0);
      mesh(new T.TorusGeometry(0.032, 0.009, 4, 8), m.silver, hips, 0, 0.075, 0.138);
      mesh(diamondGeom(0.014, 0.022, 0.01), m.silver, hips, 0, 0.075, 0.14);
      U.mergeChildren(hips);
      this.legs = [];
      for (const side of [1, -1]) {
        const leg = new T.Group(); leg.position.set(side * 0.095, -0.02, 0); hips.add(leg);
        mesh(U.taperGeom(0.46, 0.085, 0.06, 5, 1, 1), m.clothInner, leg);
        const knee = new T.Group(); knee.position.y = -0.46; leg.add(knee);
        mesh(U.taperGeom(0.4, 0.062, 0.05, 5, 1, 1), m.leather, knee);
        // angular greave with a pointed knee plate
        mesh(U.taperGeom(0.3, 0.05, 0.03, 4, 1.1, 0.5), m.darkMetal, knee, 0, -0.02, 0.045, 0, Math.PI / 4, 0);
        mesh(diamondGeom(0.04, 0.06, 0.03), m.silver, knee, 0, 0.0, 0.06);
        const ankle = new T.Group(); ankle.position.y = -0.4; knee.add(ankle);
        mesh(bootGeom(), m.leather, ankle, 0, -0.12, 0);
        mesh(U.taperGeom(0.06, 0.055, 0.06, 6, 1, 1.0), m.darkMetal, ankle, 0, 0.02, 0);
        U.mergeChildren(knee); U.mergeChildren(ankle);
        this.legs.push({ side, leg, knee, ankle });
      }

      // --- skirt panels (hang from the belt, follow the legs) ---
      this.panels = [];
      const skirt = [
        { yaw: 0, w: 0.17, len: 0.74, mat: m.tabard, r: 0.165, tilt: 0.05, flare: 0.1, tip: [0.0, -0.06, -0.16, -0.06, 0.0], curve: 1.2, legs: 0.8 },
        { yaw: 0.62, w: 0.2, len: 0.84, mat: m.clothBlackDS, r: 0.16, tilt: 0.1, tip: [0.02, -0.12, 0.0, -0.1, 0.02], legs: 1 },
        { yaw: -0.62, w: 0.2, len: 0.84, mat: m.clothBlackDS, r: 0.16, tilt: 0.1, tip: [0.02, -0.1, 0.0, -0.12, 0.02], legs: 1 },
        { yaw: 1.35, w: 0.22, len: 0.86, mat: m.clothChar, r: 0.15, tilt: 0.12, tip: [0.0, -0.14, 0.02, -0.08, 0.0], legs: 0.5 },
        { yaw: -1.35, w: 0.22, len: 0.86, mat: m.clothChar, r: 0.15, tilt: 0.12, tip: [0.0, -0.08, 0.02, -0.14, 0.0], legs: 0.5 },
        { yaw: 2.25, w: 0.24, len: 0.88, mat: m.clothBlackDS, r: 0.15, tilt: 0.12, tip: [0.02, -0.12, 0.0, -0.15, 0.02], legs: 0.6 },
        { yaw: -2.25, w: 0.24, len: 0.88, mat: m.clothBlackDS, r: 0.15, tilt: 0.12, tip: [0.02, -0.15, 0.0, -0.12, 0.02], legs: 0.6 },
      ];
      for (const s of skirt) {
        const p = new ClothPanel(hips, {
          at: new V3(Math.sin(s.yaw) * s.r, 0.07, Math.cos(s.yaw) * s.r), yaw: s.yaw, w: s.w, len: s.len, mat: s.mat,
          tiltOut: s.tilt, flare: s.flare, tip: s.tip, curve: s.curve,
        });
        p.legInfluence = s.legs;
        this.panels.push(p);
      }

      // --- spine / chest ---
      const spine = (this.spine = new T.Group());
      spine.position.y = 1.07;
      body.add(spine);
      mesh(torsoGeom(0.26, 0.145, 0.105, 0.17, 0.12, 6), m.clothInner, spine);
      const chest = (this.chest = new T.Group());
      chest.position.y = 0.22;
      spine.add(chest);
      mesh(torsoGeom(0.27, 0.165, 0.12, 0.215, 0.13, 6), m.clothBlack, chest);
      // high wrapped collar / scarf
      mesh(torsoGeom(0.15, 0.1, 0.095, 0.085, 0.082, 7), m.clothChar, chest, 0, 0.24, 0.0);
      // two-tier angular mantle with silver trim
      const drops1 = (a) => 0.05 * Math.pow(Math.abs(Math.sin(a)), 3) + 0.06 * Math.pow(Math.max(0, Math.cos(a)), 6);
      const drops2 = (a, i) => 0.06 * Math.pow(Math.abs(Math.sin(a)), 2) + (i % 2 ? 0.035 : 0) + 0.05 * Math.pow(Math.max(0, Math.cos(a)), 4);
      const g2 = mantleGeom(0.12, 0.1, 0.25, 0.42, 0.24, 0.05, drops2, 16);
      const g1 = mantleGeom(0.1, 0.09, 0.33, 0.35, 0.2, 0.15, drops1, 12);
      mesh(g2, m.clothChar, chest);
      mesh(g1, m.clothBlack, chest);
      mesh(trimGeom(0.35, 0.2, 0.15, drops1, 12, 0.018), m.silver, chest);
      mesh(trimGeom(0.42, 0.24, 0.05, drops2, 16, 0.014), m.darkMetal, chest);
      // shoulder brooches
      for (const sx of [1, -1]) {
        mesh(new T.TorusGeometry(0.035, 0.009, 4, 8), m.silver, chest, sx * 0.17, 0.2, 0.12, -0.35, 0, 0);
        mesh(diamondGeom(0.016, 0.024, 0.012), m.silver, chest, sx * 0.17, 0.2, 0.125);
      }
      // crescent pendant + chains
      const cres = new T.TorusGeometry(0.045, 0.01, 4, 10, Math.PI * 1.1);
      mesh(cres, m.silver, chest, 0, 0.11, 0.135, 0, 0, Math.PI * 0.95);
      mesh(diamondGeom(0.012, 0.02, 0.01), m.silver, chest, 0, 0.165, 0.135);
      for (const sx of [1, -1]) {
        const ch = U.taperGeom(0.2, 0.004, 0.004, 3);
        mesh(ch, m.silver, chest, sx * 0.17, 0.2, 0.125, 0, 0, sx * -1.05);
      }
      U.mergeChildren(chest);

      // coat back: three long panels from the shoulders to the ankles (central one bears the crescent)
      const coat = [
        { x: 0, w: 0.28, len: 1.36, mat: m.coatBack, yaw: Math.PI, tip: [0.02, -0.1, -0.2, -0.1, 0.02] },
        { x: 0.17, w: 0.2, len: 1.3, mat: m.clothBlackDS, yaw: Math.PI - 0.55, tip: [0.0, -0.14, 0.02, -0.1, 0.0] },
        { x: -0.17, w: 0.2, len: 1.3, mat: m.clothBlackDS, yaw: Math.PI + 0.55, tip: [0.0, -0.1, 0.02, -0.14, 0.0] },
      ];
      for (const c of coat) {
        const p = new ClothPanel(chest, {
          at: new V3(c.x, 0.2, -0.11 - Math.abs(c.x) * 0.1), yaw: c.yaw, w: c.w, len: c.len, mat: c.mat,
          tiltOut: 0.11, flare: 0.55, tip: c.tip, curve: 1.6, drag: 0.09,
        });
        p.legInfluence = 0.25;
        p.isCoat = true;
        this.panels.push(p);
      }

      // --- head ---
      const neck = (this.neck = new T.Group());
      neck.position.set(0, 0.33, 0.0);
      chest.add(neck);
      const head = (this.head = new T.Group());
      head.position.set(0, 0.11, 0.0);
      neck.add(head);
      const skull = new T.IcosahedronGeometry(0.1, 0); skull.scale(0.86, 1.1, 0.95);
      mesh(skull, m.clothBlack, head, 0, 0.0, 0.0);
      mesh(maskGeom(), m.silver, head, 0, 0, 0.0);
      mesh(diamondGeom(0.017, 0.032, 0.012), m.maskDark, head, 0, 0.078, 0.108);
      mesh(U.taperGeom(0.08, 0.005, 0.003, 3), m.maskDark, head, 0, 0.17, 0.085, -0.3, 0, 0);
      // eyes: narrow pale slits angled with the mask planes
      const eyeG = diamondGeom(0.019, 0.006, 0.003);
      mesh(eyeG, m.eye, head, 0.046, 0.016, 0.094, 0, 0.45, -0.18).castShadow = false;
      mesh(eyeG, m.eye, head, -0.046, 0.016, 0.094, 0, -0.45, 0.18).castShadow = false;
      // hair mass + spiky crown around the mask crest
      const hm = new T.IcosahedronGeometry(0.125, 0); hm.scale(1.0, 1.15, 1.02);
      mesh(hm, m.hair, head, 0, 0.05, -0.035);
      for (let i = 0; i < 7; i++) {
        const a = -1.25 + (i / 6) * 2.5;
        const spike = U.taperGeom(0.12 + Math.random() * 0.05, 0.03, 0.0, 4, 1, 0.6, false);
        mesh(spike, m.hair, head, Math.sin(a) * 0.09, 0.08, Math.cos(a) * 0.06 - 0.01, -0.6 + Math.abs(a) * 0.1, 0, -a * 0.8);
      }
      U.mergeChildren(head);
      // long angular hair clumps (2 segments each) with pendulum sway
      this.hair = [];
      const clumps = [];
      for (let i = 0; i < 9; i++) {
        const u = i / 8 - 0.5;
        clumps.push({ x: u * 0.24, y: 0.07, z: -0.085, rx: 0.26 + Math.abs(u) * 0.22, rz: u * 0.7, len: 0.5 + (1 - Math.abs(u) * 1.5) * 0.3 + (i % 2) * 0.05, r: 0.05 });
      }
      for (const sx of [1, -1]) {
        clumps.push({ x: sx * 0.095, y: 0.03, z: 0.03, rx: -0.14, rz: sx * 0.12, len: 0.34, r: 0.034, front: true });
        clumps.push({ x: sx * 0.105, y: 0.05, z: -0.02, rx: 0.02, rz: sx * 0.24, len: 0.42, r: 0.04 });
        clumps.push({ x: sx * 0.08, y: 0.08, z: -0.05, rx: 0.15, rz: sx * 0.4, len: 0.46, r: 0.042 });
      }
      for (const c of clumps) {
        const pivot = new T.Group(); pivot.position.set(c.x, c.y, c.z); head.add(pivot);
        mesh(U.taperGeom(c.len * 0.55, c.r, c.r * 0.75, 4, 1, 0.55), m.hair, pivot, 0, 0, 0, 0, Math.PI / 4, 0);
        const lower = new T.Group(); lower.position.y = -c.len * 0.55; pivot.add(lower);
        mesh(U.taperGeom(c.len * 0.6, c.r * 0.75, 0.0, 4, 1, 0.55), m.hair, lower, 0, 0, 0, 0, Math.PI / 4, 0).castShadow = false;
        const sw = new Swing(pivot, c.rx, c.rz, c.front ? 55 : 32, c.front ? 7 : 4.5, c.front ? 0.05 : 0.11);
        sw.child = lower; sw.childRestX = c.front ? 0.1 : 0.15;
        this.hair.push(sw);
      }

      // --- arms ---
      this.arms = [];
      for (const side of [1, -1]) {
        const sh = new T.Group(); sh.position.set(side * 0.215, 0.215, -0.005); chest.add(sh);
        mesh(U.taperGeom(0.3, 0.068, 0.054, 5, 1, 1), m.clothBlack, sh);
        const el = new T.Group(); el.position.y = -0.3; sh.add(el);
        mesh(U.taperGeom(0.27, 0.05, 0.042, 5, 1, 1), m.clothInner, el);
        mesh(U.taperGeom(0.19, 0.064, 0.054, 6, 1, 0.9), m.silver, el, 0, -0.06, 0);
        mesh(U.taperGeom(0.1, 0.04, 0.0, 4, 1, 1, false), m.darkMetal, el, 0, 0.02, -0.03, -2.6, 0, 0);
        const wr = new T.Group(); wr.position.y = -0.27; el.add(wr);
        mesh(new T.BoxGeometry(0.065, 0.085, 0.07), m.leather, wr, 0, -0.04, 0.0);
        U.mergeChildren(el); U.mergeChildren(wr);
        this.arms.push({ side, sh, el, wr });
      }
      this.armL = this.arms[0]; this.armR = this.arms[1];
      this.ARM_A = 0.3; this.ARM_B = 0.31;

      // --- sword (placed in body space each frame at the right grip) ---
      const sword = (this.sword = new T.Group());
      body.add(sword);
      mesh(bladeGeom(), m.blade, sword);
      mesh(U.taperGeom(0.18, 0.017, 0.02, 6), m.leather, sword, 0, 0.0, 0);
      mesh(diamondGeom(0.024, 0.034, 0.024), m.silver, sword, 0, -0.205, 0);
      mesh(new T.TorusGeometry(0.05, 0.011, 4, 8), m.silver, sword, 0, 0.035, 0);
      mesh(diamondGeom(0.022, 0.032, 0.02), m.darkMetal, sword, 0, 0.035, 0);
      for (const sx of [1, -1]) {
        const arm = U.taperGeom(0.13, 0.016, 0.0, 4, 1, 0.6, false);
        mesh(arm, m.silver, sword, sx * 0.045, 0.03, 0, 0, 0, -sx * 1.25);
        mesh(U.taperGeom(0.06, 0.01, 0.0, 4, 1, 0.6, false), m.silver, sword, sx * 0.03, 0.05, 0, 0, 0, -sx * 0.35);
      }
      U.mergeChildren(sword);
      this.swordBase = new V3(); this.swordTip = new V3(); // world positions for trails / hits

      // --- talismans (hang from the belt and mantle, swing) ---
      this.talismans = [];
      const tali = [
        { parent: hips, x: 0.15, y: 0.06, z: 0.08, len: 0.14 },
        { parent: hips, x: 0.17, y: 0.06, z: 0.0, len: 0.2 },
        { parent: hips, x: -0.16, y: 0.06, z: 0.06, len: 0.16 },
        { parent: chest, x: 0.1, y: 0.08, z: 0.14, len: 0.1 },
      ];
      for (const t of tali) {
        const piv = new T.Group(); piv.position.set(t.x, t.y, t.z); t.parent.add(piv);
        mesh(U.taperGeom(t.len, 0.004, 0.004, 3), m.silver, piv);
        mesh(new T.TorusGeometry(0.014, 0.004, 3, 6), m.silver, piv, 0, -t.len - 0.012, 0);
        mesh(new T.BoxGeometry(0.03, 0.085, 0.008), m.silver, piv, 0, -t.len - 0.07, 0);
        U.mergeChildren(piv, { castShadow: false });
        this.talismans.push(new Swing(piv, 0, 0, 30, 3.2, 0.09));
      }

      // collect meshes for afterimages
      this.meshList = [];
      root.traverse((o) => {
        if (!o.isMesh) return;
        if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
        if (o.geometry.boundingSphere.radius > 0.07) this.meshList.push(o);
      });

      // --- spectral hands ---
      this.hands = [];
      const anchors = [
        { p: new V3(-0.72, 2.08, -0.4), up: new V3(-0.45, 1, 0.05), palm: new V3(0.35, 0.1, 1), mirror: false },
        { p: new V3(0.72, 2.08, -0.4), up: new V3(0.45, 1, 0.05), palm: new V3(-0.35, 0.1, 1), mirror: true },
        { p: new V3(-1.0, 1.22, -0.14), up: new V3(-0.7, 0.75, 0.25), palm: new V3(0.45, 0.2, 1), mirror: false },
        { p: new V3(1.0, 1.22, -0.14), up: new V3(0.7, 0.75, 0.25), palm: new V3(-0.45, 0.2, 1), mirror: true },
      ];
      anchors.forEach((a, i) => {
        const h = new U.SpectralHand(scene, { mirror: a.mirror, opacity: 0.95, glow: 1.0, core: 0.42 });
        h.anchor = a;
        h.baseScale = i < 2 ? 1.55 : 1.3;
        h.setScale(h.baseScale);
        h.ph = i * 1.7;
        h.gestT = 1 + Math.random() * 3;
        h.override = null;
        h.vel = new V3();
        this.hands.push(h);
        // luminous tether strand from the hand back toward Vaust's shoulders
        const n = 14;
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.BufferAttribute(new Float32Array(n * 3), 3));
        const lm = new T.LineBasicMaterial({ color: new T.Color(1.3, 1.35, 1.5), transparent: true, opacity: 0.22, blending: T.AdditiveBlending, depthWrite: false });
        const line = new T.Line(g, lm);
        line.frustumCulled = false;
        scene.add(line);
        h.strand = line;
      });

      // state
      this.phase = 0;
      this.time = 0;
      this.runBlend = 0;
      this.hipYaw = 0;
      this.guard = 0;
      this.prevPos = new V3();
      this.vel = new V3();
      this.accel = new V3();
      this.facing = 0;
      this.prevFacing = 0;
      this.turnRate = 0;
      this.hurtT = 0;
      this.deadT = -1;
      this.handsAlpha = 1; this.tension = 0;
      this.poseR = { h: new V3(), b: new V3(), e: new V3() };
      this.poseL = new V3();
      this._tmpPose = { h: new V3(), b: new V3(), e: new V3() };
    }

    // world position of a point given in body space
    toWorld(v, out) { return this.body.localToWorld(out.copy(v)); }

    // st: { pos, facing, vel, action, gesture, dodge, hurt, dead, dt }
    update(dt, st) {
      this.time += dt;
      const t = this.time;
      const root = this.root;
      root.position.copy(st.pos);
      root.rotation.y = st.facing;
      // velocity & turning (for secondary motion)
      this.vel.copy(st.vel);
      this.turnRate = U.damp(this.turnRate, U.angleDiff(this.prevFacing, st.facing) / Math.max(dt, 1e-4), 12, dt);
      this.prevFacing = st.facing;

      const speed = Math.hypot(st.vel.x, st.vel.z);
      const dodge = st.dodge;
      this.runBlend = U.damp(this.runBlend, U.clamp(speed / 5.4, 0, 1.2), 10, dt);
      const rb = Math.min(this.runBlend, 1);
      // local movement direction relative to facing
      const cf = Math.cos(st.facing), sf = Math.sin(st.facing);
      const lx = st.vel.x * cf - st.vel.z * sf; // local x (left = +X)
      const lz = st.vel.x * sf + st.vel.z * cf; // local z (forward)
      let moveAng = speed > 0.3 ? Math.atan2(lx, lz) : 0;
      let backward = false;
      if (Math.abs(moveAng) > 1.75) { backward = true; moveAng = U.wrapAngle(moveAng - Math.PI); }
      const hipTarget = U.clamp(moveAng, -1.0, 1.0) * rb;
      this.hipYaw = U.dampAngle(this.hipYaw, dodge ? 0 : hipTarget, 10, dt);
      const strideLen = 2.3;
      this.phase += (speed / strideLen) * Math.PI * 2 * dt * (backward ? -1 : 1);
      const ph = this.phase;

      // ---------- base pose ----------
      const breathe = Math.sin(t * 1.7);
      let bodyY = -0.035 * rb * (0.5 - 0.5 * Math.cos(ph * 2)) + breathe * 0.004;
      let leanX = (backward ? -0.08 : 0.16) * rb, leanZ = 0;
      leanZ = U.clamp(-lx / 5.5, -1, 1) * 0.08 * (1 - Math.abs(Math.sin(this.hipYaw)));
      let twist = this.hipYaw * 0.25;
      let headX = 0.06 - breathe * 0.015, headY = 0, headZ = 0;
      this.guard = Math.max(0, this.guard - dt);

      // legs
      const A = 0.62 * rb, Bk = 1.0 * rb;
      const legPose = [];
      for (const L of this.legs) {
        const s = L.side;
        const sw = Math.sin(ph) * s;           // left leg forward when sin(ph) < 0
        const thigh = -sw * A;
        const knee = 0.1 + Bk * Math.max(0, Math.cos(ph) * s) * 0.95 + 0.15 * rb;
        legPose.push({ L, thigh, knee, spread: s * 0.05 * (1 - rb) });
      }

      // arms (body-space targets)
      const R = this.poseR, Lh = this.poseL;
      const idleR = POSE.idleR, runR = POSE.runR, guardR = POSE.guardR;
      R.h.copy(idleR.h).lerp(runR.h, rb); R.b.copy(idleR.b).lerp(runR.b, rb).normalize(); R.e.copy(idleR.e).lerp(runR.e, rb).normalize();
      const gw = U.smooth(U.clamp(this.guard / 0.4, 0, 1));
      if (gw > 0) { R.h.lerp(guardR.h, gw); R.b.lerp(guardR.b, gw).normalize(); R.e.lerp(guardR.e, gw).normalize(); }
      R.h.y += breathe * 0.006;
      R.h.z += Math.sin(ph) * 0.08 * rb;
      Lh.set(0.29, 1.0 + breathe * 0.006, 0.04);
      Lh.z += -Math.sin(ph) * 0.2 * rb; Lh.y += Math.max(0, -Math.sin(ph)) * 0.06 * rb;
      Lh.x += 0.03 * rb;

      // ---------- action overlays ----------
      const act = st.action;
      if (act && SLASH[act.kind]) {
        const S = SLASH[act.kind];
        const p = U.clamp(act.t / S.dur, 0, 1);
        const pose = this._tmpPose;
        let w = 1, theta, tw;
        if (p < S.a) {
          const k = U.easeOutCubic(p / S.a);
          theta = S.th0; tw = S.tw0 * k;
          arc(pose, S.pivot, S.tilt, S.r, theta, S.droop);
          // during anticipation the blade cocks back; blend from current
          w = k;
          bodyY -= 0.04 * k * (act.kind === 'slash2' ? 1.5 : 1);
        } else if (p < S.b) {
          const k = (p - S.a) / (S.b - S.a);
          const e = 1 - Math.pow(1 - k, 2.2);
          theta = U.lerp(S.th0, S.th1, e);
          tw = U.lerp(S.tw0, S.tw1, e);
          arc(pose, S.pivot, S.tilt, S.r, theta, S.droop);
          if (S.dir < 0) pose.e.negate();
          bodyY -= 0.05 * (act.kind === 'slash2' ? 1.4 : 1);
          leanX += 0.12;
        } else {
          const k = U.easeInOutSine((p - S.b) / (1 - S.b));
          theta = S.th1; tw = S.tw1 * (1 - k);
          arc(pose, S.pivot, S.tilt, S.r, theta, S.droop);
          if (S.dir < 0) pose.e.negate();
          w = 1 - k;
          bodyY -= 0.05 * (1 - k);
          if (k > 0.3) this.guard = 1.4;
        }
        R.h.lerp(pose.h, w); R.b.lerp(pose.b, w).normalize(); R.e.lerp(pose.e, w).normalize();
        twist = U.lerp(twist, tw, p < S.b ? 1 : w);
        // free arm balances the swing
        Lh.set(U.lerp(Lh.x, 0.34, w), U.lerp(Lh.y, 1.12, w), U.lerp(Lh.z, -0.12 * S.dir, w));
        headY = -tw * 0.5;
      }

      const g = st.gesture; // spell gestures (restrained)
      if (g) {
        const w = U.env(g.t, 0, g.inT || 0.08, g.holdT || 0.3, g.outT || 0.55);
        if (w > 0) this.applyGesture(g, w, R, Lh);
        if (g.kind === 'R' || g.kind === 'Y') this.guard = 1.0;
        if (g.twist) twist = U.lerp(twist, g.twist, w);
        if (g.headX) headX += g.headX * w;
        if (g.crouch) bodyY -= g.crouch * w;
        if (g.lean) leanX += g.lean * w;
        if (g.kind === 'Q') twist = U.lerp(twist, 0.35, w);
      }

      if (dodge) {
        const k = U.env(dodge.t, 0, 0.04, 0.2, 0.36);
        leanX = U.lerp(leanX, 0.55, k);
        bodyY -= 0.14 * k;
        R.h.lerp(_tmpV.set(-0.36, 1.02, -0.32), k);
        R.b.lerp(_tmpV.set(-0.25, -0.2, -0.95).normalize(), k).normalize();
        R.e.lerp(_tmpV.set(0, 1, 0), k).normalize();
        Lh.lerp(_tmpV.set(0.38, 1.1, -0.36), k);
        legPose[0].thigh = U.lerp(legPose[0].thigh, -0.7, k); legPose[0].knee = U.lerp(legPose[0].knee, 0.4, k);
        legPose[1].thigh = U.lerp(legPose[1].thigh, 0.75, k); legPose[1].knee = U.lerp(legPose[1].knee, 0.9, k);
        twist *= 1 - k;
        headX -= 0.15 * k;
      }

      if (st.hurt > 0) {
        const k = st.hurt / 0.3;
        leanX -= 0.28 * k; headX -= 0.25 * k; twist += 0.15 * k * Math.sin(t * 40);
      }

      if (st.dead >= 0) {
        const k = U.smooth(U.clamp(st.dead / 1.1, 0, 1));
        bodyY = U.lerp(bodyY, -0.42, k);
        leanX = U.lerp(leanX, 0.5, k); twist *= 1 - k; leanZ *= 1 - k;
        headX = U.lerp(headX, 0.55, k);
        R.h.lerp(_tmpV.set(-0.12, 0.74, 0.42), k);
        R.b.lerp(_tmpV.set(0.05, -1, 0.1).normalize(), k).normalize();
        R.e.lerp(_tmpV.set(1, 0, 0), k).normalize();
        Lh.lerp(_tmpV.set(0.24, 0.62, 0.3), k);
        legPose[0].thigh = U.lerp(legPose[0].thigh, -1.25, k); legPose[0].knee = U.lerp(legPose[0].knee, 1.9, k);
        legPose[1].thigh = U.lerp(legPose[1].thigh, 0.35, k); legPose[1].knee = U.lerp(legPose[1].knee, 2.2, k);
      }

      // ---------- apply skeleton ----------
      this.body.position.y = bodyY;
      this.hips.rotation.set(0, this.hipYaw, 0);
      for (const lp of legPose) {
        lp.L.leg.rotation.set(lp.thigh, 0, lp.spread);
        lp.L.knee.rotation.x = lp.knee;
        lp.L.ankle.rotation.x = -(lp.thigh + lp.knee) * 0.7;
      }
      this.spine.rotation.set(leanX * 0.55, 0, leanZ);
      this.chest.rotation.set(leanX * 0.45 + breathe * 0.012, twist, leanZ * 0.5);
      this.chest.scale.set(1 + breathe * 0.008, 1, 1 + breathe * 0.01);
      this.head.rotation.set(headX - leanX * 0.6, headY - twist * 0.4, headZ);
      this.root.updateMatrixWorld(true);

      // arms via IK (targets in body space -> world)
      const tw = _tw;
      this.toWorld(R.h, tw);
      solveArm(this.chest, this.armR.sh, this.armR.el, this.ARM_A, this.ARM_B, tw, _poleR.set(-0.5, -0.35, -0.6));
      this.toWorld(Lh, tw);
      solveArm(this.chest, this.armL.sh, this.armL.el, this.ARM_A, this.ARM_B, tw, _poleL.set(0.5, -0.35, -0.6));
      this.chest.updateMatrixWorld(true);

      // sword at the right grip, oriented by blade/edge directions (body space)
      this.armR.wr.localToWorld(_gw.set(0, -0.045, 0));
      this.body.worldToLocal(_gw);
      const bdir = R.b, edge = _ed.copy(R.e).addScaledVector(R.b, -R.e.dot(R.b));
      if (edge.lengthSq() < 1e-4) edge.set(1, 0, 0); else edge.normalize();
      const zz = _zz.crossVectors(edge, bdir).normalize();
      _m4.makeBasis(edge, bdir, zz);
      this.sword.quaternion.setFromRotationMatrix(_m4);
      this.sword.position.copy(_gw).addScaledVector(bdir, 0.08);
      this.sword.updateMatrixWorld(true);
      this.sword.localToWorld(this.swordBase.set(0, 0.22, 0));
      this.sword.localToWorld(this.swordTip.set(0, 1.14, 0));

      // ---------- secondary motion ----------
      const gust = st.dodge ? 2 : 0;
      for (const p of this.panels) {
        let push = 0;
        if (!p.isCoat) {
          // legs swinging toward a panel push it outward
          for (const lp of legPose) {
            const legDirZ = -lp.thigh; // >0 when leg forward
            const panelFwd = Math.cos(p.o.yaw);
            const sideMatch = Math.sign(Math.sin(p.o.yaw)) === lp.L.side || Math.abs(Math.sin(p.o.yaw)) < 0.2 ? 1 : 0.35;
            push += Math.max(0, legDirZ * panelFwd) * 0.42 * sideMatch * p.legInfluence;
          }
        } else {
          push = Math.max(0, -leanX) * 0.2;
        }
        p.update(dt, this.vel, push, t, gust);
      }
      // hair & talismans: velocity in head/chest frame
      const lvx = lx, lvz = lz;
      _lv.set(lvx - this.turnRate * 0.25, 0, lvz);
      for (const h of this.hair) h.update(dt, _lv, (st.dodge ? 0.25 : 0) + leanX * 0.6, 0);
      for (const tl of this.talismans) tl.update(dt, _lv, leanX, 0);

      this.updateHands(dt, st);
    }

    applyGesture(g, w, R, Lh) {
      const tmp = _tmpV;
      switch (g.kind) {
        case 'Q': Lh.lerp(tmp.set(0.16, 1.38, 0.52), w); break;
        case 'E': Lh.lerp(tmp.set(0.24, 1.0, 0.45), w); break;
        case 'T': Lh.lerp(tmp.set(0.28, 1.52, 0.34), w); break;
        case 'R': {
          // raise the sword slightly during the wind-up, then follow the giant blade across
          const rel = g.release || 0.55;
          if (g.t < rel) {
            const k = U.smooth(U.clamp(g.t / 0.25, 0, 1)) * w;
            R.h.lerp(tmp.set(-0.32, 1.42, 0.0), k);
            R.b.lerp(tmp.set(-0.45, 0.75, -0.45).normalize(), k).normalize();
            R.e.lerp(tmp.set(0, 0, 1), k).normalize();
            Lh.lerp(tmp.set(0.3, 1.3, 0.3), k);
          } else {
            const k = U.smooth(U.clamp((g.t - rel) / 0.1, 0, 1));
            const a = _tmpV2.set(-0.32, 1.42, 0.0).lerp(tmp.set(0.26, 1.12, 0.38), k);
            R.h.lerp(a, w);
            const b = _tmpV2.set(-0.45, 0.75, -0.45).normalize().lerp(tmp.set(0.85, -0.25, 0.45).normalize(), k).normalize();
            R.b.lerp(b, w).normalize();
            R.e.lerp(tmp.set(1, 0, 0), w).normalize();
            Lh.lerp(tmp.set(0.36, 1.1, -0.15), w);
          }
          break;
        }
        case 'Kneel': {
          // pressed down by what he just did: one knee, sword-point to the stone
          Lh.lerp(tmp.set(0.3, 0.62, 0.3), w);
          R.h.lerp(tmp.set(-0.3, 0.7, 0.42), w);
          R.b.lerp(tmp.set(0, -1, 0.2).normalize(), w).normalize();
          R.e.lerp(tmp.set(1, 0, 0), w).normalize();
          break;
        }
        case 'Y': {
          Lh.lerp(tmp.set(0.5, 1.08, 0.12), w);
          R.h.lerp(tmp.set(-0.5, 1.06, 0.1), w);
          R.b.lerp(tmp.set(-0.55, -0.75, 0.25).normalize(), w).normalize();
          R.e.lerp(tmp.set(0, 0, 1), w).normalize();
          break;
        }
      }
    }

    updateHands(dt, st) {
      const t = this.time;
      const dead = st.dead >= 0;
      this.handsAlpha = U.damp(this.handsAlpha, dead ? 0 : 1, dead ? 2 : 6, dt);
      this.tension = Math.max(0, this.tension - dt * 0.45);
      const ten = this.tension;
      const facing = st.facing;
      _qf.setFromAxisAngle(_up, facing);
      const chestW = this.chest.getWorldPosition(_cw);
      this.hands.forEach((h, i) => {
        const a = h.anchor;
        let targetPos = _hp, targetQ = _hq;
        const o = h.override;
        if (o && o.until > t) {
          targetPos.copy(o.pos);
          if (o.quat) targetQ.copy(o.quat); else h.orient(o.up, o.palm, targetQ);
          h.setPose(o.pose, o.poseSpeed || 14);
          const s = o.scale || h.baseScale;
          h.setScale(U.damp(h.scale, s, o.scaleSpeed || 10, dt));
          const fl = o.follow || 14;
          h.group.position.x = U.damp(h.group.position.x, targetPos.x, fl, dt);
          h.group.position.y = U.damp(h.group.position.y, targetPos.y, fl, dt);
          h.group.position.z = U.damp(h.group.position.z, targetPos.z, fl, dt);
          h.group.quaternion.slerp(targetQ, 1 - Math.exp(-(o.turn || 14) * dt));
          h.setGlow(o.glow || 1.15);
        } else {
          if (o) h.override = null;
          // idle float: bob, slow sway, occasional gestures
          const bob = Math.sin(t * 1.1 + h.ph) * 0.06;
          const sway = Math.sin(t * 0.7 + h.ph * 1.3) * 0.05;
          _lp.copy(a.p);
          _lp.y += bob + (st.dodge ? -0.1 : 0);
          _lp.x += sway;
          // when running the hands stream back a little
          _lp.z -= this.runBlend * 0.25;
          _lp.applyQuaternion(_qf).add(st.pos);
          _lp.y += this.body.position.y;
          targetPos.copy(_lp);
          _u1.copy(a.up); _u1.x += Math.sin(t * 0.9 + h.ph) * 0.12;
          _u1.applyQuaternion(_qf);
          // palms turn toward the fixed camera so the open hands read clearly from above
          _u2.copy(a.palm).applyQuaternion(_qf).normalize().lerp(_camFacing, 0.6);
          h.orient(_u1, _u2, targetQ);
          const fl = st.dodge ? 5 : 7.5;
          h.group.position.x = U.damp(h.group.position.x, targetPos.x, fl, dt);
          h.group.position.y = U.damp(h.group.position.y, targetPos.y, fl, dt);
          h.group.position.z = U.damp(h.group.position.z, targetPos.z, fl, dt);
          h.group.quaternion.slerp(targetQ, 1 - Math.exp(-6 * dt));
          h.setScale(U.damp(h.scale, h.baseScale, 6, dt));
          h.setGlow(U.damp(h.mat.uniforms.uGlow.value, 1.0, 5, dt));
          h.gestT -= dt;
          if (h.gestT <= 0) {
            h.gestT = 1.8 + Math.random() * 3.2;
            h.setPose(U.pick(['relaxed', 'open', 'reach', 'claw', 'relaxed']), 2.2);
          }
        }
        h.setOpacity(this.handsAlpha * (h.fade != null ? h.fade : 1));
        h.update(dt);
        // tether strand: from the wrist curving back to the shoulder blade
        const pos = h.strand.geometry.attributes.position.array;
        const n = pos.length / 3;
        _s0.copy(h.group.position);
        _s1.set((i % 2 ? 0.16 : -0.16), 0.18, -0.12).applyQuaternion(_qf).add(chestW);
        for (let k = 0; k < n; k++) {
          const u = k / (n - 1);
          const sag = Math.sin(u * Math.PI) * (0.18 + Math.sin(t * 2 + h.ph + u * 4) * 0.05) * (1 - ten * 0.92);
          pos[k * 3] = U.lerp(_s0.x, _s1.x, u) + Math.sin(t * (3 + ten * 60) + u * 9 + h.ph) * (0.02 + ten * 0.012);
          pos[k * 3 + 1] = U.lerp(_s0.y, _s1.y, u) - sag;
          pos[k * 3 + 2] = U.lerp(_s0.z, _s1.z, u);
        }
        h.strand.geometry.attributes.position.needsUpdate = true;
        h.strand.material.opacity = (0.2 + ten * 0.6) * this.handsAlpha * (h.scale > 1.6 && ten < 0.3 ? 0.3 : 1) * (h.fade != null ? h.fade : 1);
      });
    }

    // command a spectral hand (0 UR, 1 UL, 2 LR, 3 LL)
    command(i, o) {
      const h = this.hands[i];
      h.override = Object.assign({ until: this.time + (o.dur || 0.4) }, o);
    }

    setVisible(v) {
      this.root.visible = v;
      for (const h of this.hands) { h.group.visible = v; h.strand.visible = v; }
    }

    reset(pos, facing) {
      this.phase = 0; this.runBlend = 0; this.hipYaw = 0; this.guard = 0; this.deadT = -1; this.handsAlpha = 1; this.tension = 0;
      this.turnRate = 0;
      for (const p of this.panels) { p.s.set(0, 0); p.v.set(0, 0); }
      for (const h of this.hair) { h.ax = h.az = h.vx = h.vz = h.cx = h.cz = h.cvx = h.cvz = 0; }
      for (const h of this.hands) {
        h.override = null; h.fade = 1;
        h.group.position.copy(h.anchor.p).applyAxisAngle(_up, facing || 0).add(pos);
        h.setScale(h.baseScale);
      }
    }
  };

  const _tmpV = new V3(), _tmpV2 = new V3(), _tw = new V3(), _poleR = new V3(), _poleL = new V3();
  const _gw = new V3(), _ed = new V3(), _zz = new V3(), _m4 = new T.Matrix4(), _lv = new V3();
  const _qf = new T.Quaternion(), _up = new V3(0, 1, 0), _cw = new V3(), _hp = new V3(), _hq = new T.Quaternion();
  const _lp = new V3(), _u1 = new V3(), _u2 = new V3(), _s0 = new V3(), _s1 = new V3();
  const _camFacing = new V3(0, Math.sin(38 * Math.PI / 180), Math.cos(38 * Math.PI / 180));
})(window.U);
