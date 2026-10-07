/* UNHALLOWED — renderer, camera, lighting, post-processing, sky, arena and distant world. */
'use strict';
(function (U) {
  const T = THREE;
  const W = (U.world = {});

  // ---------- Renderer / camera / post ----------
  W.init = function (canvas) {
    const renderer = new T.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    W.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(W.pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    W.renderer = renderer;

    const scene = new T.Scene();
    W.fogColor = new T.Color(0.15, 0.154, 0.172);
    scene.fog = new T.Fog(W.fogColor, 30, 340);
    W.scene = scene;

    const C = U.CONST;
    const camera = new T.PerspectiveCamera(C.CAM_FOV, window.innerWidth / window.innerHeight, 0.5, 1500);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(-C.CAM_PITCH, 0, 0);
    W.camOffset = new T.Vector3(0, Math.sin(C.CAM_PITCH) * C.CAM_DIST, Math.cos(C.CAM_PITCH) * C.CAM_DIST);
    camera.position.copy(W.camOffset);
    W.camera = camera;
    W.camTarget = new T.Vector3();
    W.shake = { trauma: 0, t: 0 };

    // environment for metals
    const pmrem = new T.PMREMGenerator(renderer);
    const eq = U.buildEnvEquirect();
    W.envMap = pmrem.fromEquirectangular(eq).texture;
    eq.dispose(); pmrem.dispose();
    U.applyEnvMap(W.envMap);

    // post: MSAA HDR target -> bloom -> grade -> output (tone map + sRGB)
    const size = renderer.getDrawingBufferSize(new T.Vector2());
    const rt = new T.WebGLRenderTarget(size.x, size.y, { type: T.HalfFloatType, samples: 4 });
    const composer = new THREE.EffectComposer(renderer, rt);
    composer.setPixelRatio(W.pixelRatio);
    composer.setSize(window.innerWidth, window.innerHeight);
    composer.addPass(new THREE.RenderPass(scene, camera));
    // Guard the HDR buffer: very bright specular (a light right against metal) can overflow the
    // half-float target to Inf, and the bloom blur would spread Inf/NaN into black blocks on real GPUs.
    composer.addPass(new THREE.ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
        void main(){
          vec4 c = texture2D(tDiffuse, vUv);
          if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
          gl_FragColor = vec4(clamp(c.rgb, 0.0, 32.0), clamp(c.a, 0.0, 1.0));
        }`,
    }));
    const bloom = new THREE.UnrealBloomPass(new T.Vector2(window.innerWidth, window.innerHeight), 0.62, 0.42, 0.9);
    composer.addPass(bloom);
    const grade = new THREE.ShaderPass(GradeShader);
    composer.addPass(grade);
    composer.addPass(new THREE.OutputPass());
    W.composer = composer; W.bloom = bloom; W.grade = grade;

    buildLights();
    buildSky();
    buildArena();
    buildDistantWorld();
    buildMist();
    buildMotes();
    buildReticle();

    window.addEventListener('resize', W.resize);
    W.resize();
  };

  W.resize = function () {
    const w = window.innerWidth, h = window.innerHeight;
    W.camera.aspect = w / h;
    W.camera.updateProjectionMatrix();
    W.renderer.setSize(w, h, false);
    W.composer.setSize(w, h);
    W.grade.uniforms.uAspect.value = w / h;
    // point sprites are sized in drawing-buffer pixels
    const ps = h * W.pixelRatio;
    if (W.motes) W.motes.material.uniforms.uScale.value = ps * (300 / 720);
    if (U.fx && U.fx.spark) { U.fx.spark.pts.material.uniforms.uScale.value = ps * 0.9; U.fx.puff.pts.material.uniforms.uScale.value = ps * 0.9; }
  };

  const GradeShader = {
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uVignette: { value: 0.5 },
      uDim: { value: 0 },
      uDesat: { value: 0.32 },
      uGrain: { value: 0.022 },
      uAspect: { value: 1.7 },
      uHurt: { value: 0 },
      uFlash: { value: 0 },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float uTime, uVignette, uDim, uDesat, uGrain, uAspect, uHurt, uFlash;
      varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        vec4 c = texture2D(tDiffuse, vUv);
        vec3 col = c.rgb;
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(col, vec3(l), uDesat);
        col *= mix(vec3(0.93, 0.95, 1.05), vec3(1.0), smoothstep(0.0, 0.35, l));
        vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);
        float r = length(d) / (0.5 * length(vec2(uAspect, 1.0)));
        float vig = smoothstep(0.42, 1.05, r);
        col *= 1.0 - vig * uVignette;
        col *= 1.0 - uDim * (0.35 + 0.55 * vig);
        col = mix(col, col * vec3(1.25, 0.55, 0.5), uHurt * vig);
        col += uFlash * (1.0 - vig) * 0.25;
        col += (hash(vUv * 1000.0 + fract(uTime) * 61.0) - 0.5) * uGrain * (0.25 + l);
        gl_FragColor = vec4(max(col, 0.0), c.a);
      }`,
  };

  // ---------- Lights ----------
  function buildLights() {
    const s = W.scene;
    W.hemi = new T.HemisphereLight(0x8e95aa, 0x08080b, 0.75);
    s.add(W.hemi);

    // cold back/key light from the eclipse side (north, high) -> rims and shadows toward the camera
    const key = new T.DirectionalLight(0xe4eaf8, 2.2);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera;
    sc.left = -17; sc.right = 17; sc.top = 17; sc.bottom = -17; sc.near = 1; sc.far = 80;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.025;
    key.shadow.radius = 3;
    W.keyDir = new T.Vector3(0.22, 0.5, -0.84).normalize(); // toward the light: low, behind the courtyard (north)
    s.add(key); s.add(key.target);
    W.key = key;

    // soft frontal fill so robe planes facing the camera still read
    const fill = new T.DirectionalLight(0xb8bfd2, 0.42);
    fill.position.set(-5, 9, 12);
    s.add(fill); s.add(fill.target);
    W.fill = fill;

    // cold light carried by Vaust's spectral hands: keeps the focus on him and lights the stone around him
    W.heroLight = new T.PointLight(0xe6ebff, 9, 9, 1.7);
    s.add(W.heroLight);
    W.baseLight = { hemi: W.hemi.intensity, key: key.intensity, fill: fill.intensity, hero: W.heroLight.intensity };
    W.dim = 0;
  }

  // ---------- Sky with the broken eclipse ----------
  function buildSky() {
    const az = 10 * Math.PI / 180, el = -16.5 * Math.PI / 180;
    W.eclipseDir = new T.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    const mat = new T.ShaderMaterial({
      uniforms: { uEclipse: { value: W.eclipseDir }, uTime: U.shared.uTime, uDim: { value: 0 } },
      vertexShader: `
        varying vec3 vDir;
        void main(){
          vDir = position;
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: `
#define sq(x) ((x)*(x))
        uniform vec3 uEclipse; uniform float uTime; uniform float uDim;
        varying vec3 vDir;
        float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float noise(vec3 x){
          vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
        float fbm(vec3 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 0.17; a *= 0.5; } return v; }
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 cDeep = vec3(0.045, 0.046, 0.054);
          vec3 cMist = vec3(0.26, 0.268, 0.30);
          vec3 cHigh = vec3(0.016, 0.016, 0.02);
          float band = exp(-sq((h + 0.16) / 0.30));
          vec3 col = mix(cDeep, cMist, band);
          col = mix(col, cHigh, smoothstep(0.02, 0.45, h));
          float cl = fbm(d * 3.2 + vec3(uTime * 0.004, 0.0, uTime * 0.0025));
          float cl2 = fbm(d * 8.0 + vec3(-uTime * 0.007, uTime * 0.002, 0.0));
          col *= 0.62 + 0.75 * cl;
          // eclipse
          float ang = acos(clamp(dot(d, uEclipse), -1.0, 1.0));
          float R = 0.098;
          vec3 eu = normalize(cross(uEclipse, vec3(0.0, 1.0, 0.0)));
          vec3 ev = cross(eu, uEclipse);
          float th = atan(dot(d, ev), dot(d, eu));
          float off = max(ang - R, 0.0);
          float glow = exp(-off * 7.0) * 0.5 + exp(-off * 26.0) * 0.75;
          col += vec3(0.84, 0.86, 0.94) * glow * (0.55 + 0.6 * cl2);
          // swirling cloud ring hugging the eclipse
          float swirl = fbm(vec3(th * 2.0, ang * 22.0 - uTime * 0.02, 1.7));
          col += vec3(0.55, 0.56, 0.62) * smoothstep(0.55, 0.8, swirl) * exp(-sq((ang - R * 1.9) / (R * 0.8))) * 0.35;
          col *= 1.0 - uDim * 0.55;
          gl_FragColor = vec4(col, 1.0);
        }`,
      side: T.BackSide,
      depthWrite: false,
      fog: false,
    });
    const sky = new T.Mesh(new T.SphereGeometry(1000, 48, 32), mat);
    sky.renderOrder = -100;
    sky.frustumCulled = false;
    W.scene.add(sky);
    W.sky = sky;
    buildEclipse();
  }

  // The broken white eclipse: a world-space disc hanging in the abyss beyond the terrace's northern drop.
  function buildEclipse() {
    const R = 36, S = 3.4;
    const mat = new T.ShaderMaterial({
      uniforms: { uTime: U.shared.uTime, uDim: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
#define sq(x) ((x)*(x))
        uniform float uTime, uDim; varying vec2 vUv;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
        void main(){
          vec2 p = (vUv * 2.0 - 1.0) * ${S.toFixed(1)};
          float d = length(p);
          float th = atan(p.y, p.x);
          float off = max(d - 1.0, 0.0);
          float n = noise(vec2(th * 3.0, d * 4.0 - uTime * 0.05)) * 0.6 + noise(vec2(th * 9.0, d * 11.0 + uTime * 0.03)) * 0.4;
          float glow = exp(-off * 1.6) * 0.32 + exp(-off * 6.0) * 0.55;
          glow *= 0.6 + 0.6 * n;
          float brk = smoothstep(0.03, 0.12, abs(sin(th * 2.5 + 0.9))) * smoothstep(0.02, 0.08, abs(sin(th * 4.0 - 1.3)));
          float ring = (exp(-sq((d - 1.0) / 0.018)) * 9.0 + exp(-sq((d - 1.0) / 0.07)) * 1.4) * mix(0.15, 1.0, brk);
          float a1 = exp(-sq((d - 1.55) / 0.012)) * step(0.32, fract(th / 6.2832 * 3.0 + 0.1));
          float a2 = exp(-sq((d - 2.2) / 0.011)) * step(0.45, fract(th / 6.2832 * 5.0 + 0.35));
          float a3 = exp(-sq((d - 3.0) / 0.016)) * step(0.22, fract(th / 6.2832 * 2.0 + 0.62));
          float spokes = exp(-sq(fract(th / 6.2832 * 16.0) - 0.5) / 0.0005) * smoothstep(1.6, 1.7, d) * (1.0 - smoothstep(2.1, 2.2, d));
          float fade = 1.0 - smoothstep(${(S * 0.82).toFixed(2)}, ${S.toFixed(2)}, d);
          vec3 light = vec3(0.86, 0.88, 0.96) * glow + vec3(1.0, 1.0, 1.05) * ring + vec3(0.92, 0.94, 1.0) * (a1 * 2.4 + a2 * 1.7 + a3 * 1.3 + spokes * 0.9);
          light *= fade * (1.0 - uDim * 0.5);
          float disc = smoothstep(1.0, 0.985, d);
          vec3 discCol = vec3(0.006, 0.006, 0.008) + n * 0.012;
          // premultiplied: the disc occludes, everything else adds light
          gl_FragColor = vec4(mix(light, discCol, disc), clamp(disc + glow * 0.18 * fade, 0.0, 1.0));
        }`,
      transparent: true, premultipliedAlpha: true, depthWrite: false, fog: false,
    });
    const m = new T.Mesh(new T.PlaneGeometry(2 * R * S, 2 * R * S), mat);
    // camera orientation never changes, so a fixed facing is a true billboard
    m.quaternion.copy(W.camera.quaternion);
    const dist = 270;
    const camH = W.camOffset.y, camZ = W.camOffset.z;
    const az = 10 * Math.PI / 180;
    const x = Math.sin(az) * dist, z = -Math.cos(az) * dist;
    const hd = Math.hypot(x, z - camZ);
    m.position.set(x, camH - hd * Math.tan(16.5 * Math.PI / 180), z);
    m.renderOrder = 1;
    m.frustumCulled = false;
    W.scene.add(m);
    W.eclipse = m;
  }

  // ---------- Arena ----------
  // visual edge of the terrace at a given direction
  const visR = (x, z) => U.arenaMaxR(x, z) + 1.15;
  W.visR = visR;
  function buildArena() {
    const m = U.mats;
    const rnd = U.rng(1337);
    const R = U.CONST.PLATFORM_R;
    const group = new T.Group();
    W.scene.add(group);
    W.arena = group;

    // Broken slab floor: jittered grid of irregular quads, each extruded and slightly tilted.
    const cell = 2.15, N = 9;
    const pts = [];
    for (let i = -N; i <= N + 1; i++) {
      pts[i] = [];
      for (let j = -N; j <= N + 1; j++) {
        pts[i][j] = [i * cell + (rnd() - 0.5) * 0.8, j * cell + (rnd() - 0.5) * 0.8];
      }
    }
    const pos = [], col = [], uv = [];
    const addSlab = (poly) => {
      let cx = 0, cz = 0;
      for (const p of poly) { cx += p[0]; cz += p[1]; }
      cx /= poly.length; cz /= poly.length;
      const rc = Math.hypot(cx, cz);
      const RV = visR(cx, cz);
      if (rc > RV - 0.35) return;
      const edge = U.inv(RV - 4, RV - 0.35, rc);
      if (edge > 0.3 && rnd() < edge * 0.35) return; // broken away near the rim
      const shrink = 0.05 + rnd() * 0.04;
      const P = poly.map(([x, z]) => {
        const dx = cx - x, dz = cz - z, l = Math.hypot(dx, dz) || 1;
        return [x + (dx / l) * shrink, z + (dz / l) * shrink];
      });
      const tilt = 0.012 + edge * 0.05;
      const ax = (rnd() - 0.5) * tilt, az = (rnd() - 0.5) * tilt;
      const base = (rnd() - 0.5) * 0.035 - edge * 0.1 * rnd();
      const topY = (x, z) => base + ax * (x - cx) + az * (z - cz);
      const shade = 0.05 + rnd() * 0.045 - edge * 0.015;
      const cr = shade, cg = shade, cb = shade * 1.06;
      const push = (x, y, z, k) => { pos.push(x, y, z); col.push(cr * k, cg * k, cb * k); uv.push(x / 1.7, z / 1.7); };
      // top (fan)
      for (let i = 1; i < P.length - 1; i++) {
        const a = P[0], b = P[i], c = P[i + 1];
        push(a[0], topY(a[0], a[1]), a[1], 1); push(b[0], topY(b[0], b[1]), b[1], 1); push(c[0], topY(c[0], c[1]), c[1], 1);
      }
      // sides
      const bot = -0.3;
      for (let i = 0; i < P.length; i++) {
        const a = P[i], b = P[(i + 1) % P.length];
        const ya = topY(a[0], a[1]), yb = topY(b[0], b[1]);
        push(a[0], ya, a[1], 0.7); push(b[0], bot, b[1], 0.4); push(b[0], yb, b[1], 0.7);
        push(a[0], ya, a[1], 0.7); push(a[0], bot, a[1], 0.4); push(b[0], bot, b[1], 0.4);
      }
    };
    for (let i = -N; i <= N; i++) {
      for (let j = -N; j <= N; j++) {
        const a = pts[i][j], b = pts[i + 1][j], c = pts[i + 1][j + 1], d = pts[i][j + 1];
        // winding so the top faces up: (a, d, c, b) is counter-clockwise seen from +Y
        const r = rnd();
        if (r < 0.2) { addSlab([a, d, c]); addSlab([a, c, b]); }
        else if (r < 0.32) { addSlab([a, d, b]); addSlab([d, c, b]); }
        else addSlab([a, d, c, b]);
      }
    }
    const fg = new T.BufferGeometry();
    fg.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    fg.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    fg.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    fg.computeVertexNormals();
    const floor = new T.Mesh(fg, m.floor);
    floor.receiveShadow = true;
    group.add(floor);
    W.floor = floor;

    // platform body following the terrace outline (fills slab gaps with darkness) and rocky underside
    const shape = new T.Shape();
    const NS = 96;
    for (let i = 0; i <= NS; i++) {
      const a = (i / NS) * Math.PI * 2;
      const sx = Math.sin(a), sz = -Math.cos(a);
      const r = visR(sx, sz) + 0.05 + (rnd() - 0.5) * 0.25;
      // shape lives in XY; rotated so Y -> -Z
      if (i === 0) shape.moveTo(sx * r, sz * r); else shape.lineTo(sx * r, sz * r);
    }
    const bodyGeo = new T.ExtrudeGeometry(shape, { depth: 3.2, bevelEnabled: false, curveSegments: 1 });
    bodyGeo.rotateX(Math.PI / 2); // extrude goes down from y=0
    const body = new T.Mesh(bodyGeo, m.cliff);
    body.position.y = -0.17;
    body.receiveShadow = true;
    group.add(body);
    const under = new T.ConeGeometry(U.CONST.NORTH_R + 0.6, 34, 22, 6, true);
    const up = under.attributes.position;
    for (let i = 0; i < up.count; i++) {
      const y = up.getY(i);
      if (y < 16.9 && y > -16.9) {
        const k = 1 + (rnd() - 0.5) * 0.5;
        up.setX(i, up.getX(i) * k); up.setZ(i, up.getZ(i) * k); up.setY(i, y + (rnd() - 0.5) * 2.5);
      }
    }
    under.computeVertexNormals();
    const underMesh = new T.Mesh(under, m.cliff);
    underMesh.rotation.x = Math.PI;
    underMesh.position.y = -3.4 - 17;
    group.add(underMesh);

    // faded occult seal at the centre
    const sealMat = new T.MeshBasicMaterial({
      map: U.tex.seal, color: new T.Color(0.85, 0.87, 0.95), transparent: true, opacity: 0.2,
      depthWrite: false, blending: T.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2,
    });
    sealMat.opacity = 0.13;
    const seal = new T.Mesh(new T.PlaneGeometry(12, 12), sealMat);
    seal.rotation.x = -Math.PI / 2;
    seal.position.y = 0.03;
    seal.renderOrder = 1;
    group.add(seal);
    W.seal = seal;

    // perimeter: pillars, broken arches, low parapet
    const stoneParts = [], darkParts = [];
    const pillarAngles = [];
    const nP = 14;
    for (let i = 0; i < nP; i++) {
      const a = (i / nP) * Math.PI * 2 + 0.11;
      if (Math.abs(U.wrapAngle(a)) < 0.4) continue; // keep the view over the northern drop open
      pillarAngles.push(a);
    }
    const pillarTops = [];
    for (const a of pillarAngles) {
      const sx = Math.sin(a), sz = -Math.cos(a);
      const rr = visR(sx, sz) + 0.45;
      const x = sx * rr, z = sz * rr;
      // south side (toward the camera) stays low so it never hides the action
      const south = z > 5;
      const framing = Math.abs(U.wrapAngle(a)) < 0.75;
      let h = south ? 0.7 + rnd() * 0.9 : 5.5 + rnd() * 6.5;
      if (framing) h = 10 + rnd() * 3;
      else if (!south && rnd() < 0.35) h = 2.2 + rnd() * 2.5; // broken
      addPillar(stoneParts, darkParts, x, z, h, rnd, !south && h > 5);
      pillarTops.push({ a, x, z, h });
    }
    // gothic arches between some tall northern pillars
    for (let i = 0; i < pillarTops.length; i++) {
      const p = pillarTops[i], q = pillarTops[(i + 1) % pillarTops.length];
      const gap = Math.abs(U.wrapAngle(q.a - p.a));
      if (gap < 0.6 && p.h > 7.5 && q.h > 7.5 && p.z < -2 && q.z < -2) addArch(stoneParts, p, q, Math.min(p.h, q.h), rnd);
    }
    // low parapet segments with gaps
    const segs = 56;
    for (let i = 0; i < segs; i++) {
      if (rnd() < 0.28) continue;
      const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 0.82) / segs) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const re = visR(Math.sin(am), -Math.cos(am)) - 0.2;
      const x = Math.sin(am) * re, z = -Math.cos(am) * re;
      const len = (a1 - a0) * re;
      const south = z > 4;
      const h = (south ? 0.35 : 0.55) + rnd() * 0.35;
      const g = new T.BoxGeometry(len, h, 0.42);
      // chip the top
      const gp = g.attributes.position;
      for (let k = 0; k < gp.count; k++) if (gp.getY(k) > 0) gp.setY(k, gp.getY(k) + (rnd() - 0.5) * 0.18);
      g.translate(0, h / 2 - 0.05, 0);
      g.rotateY(-am);
      g.translate(x, 0, z);
      stoneParts.push(g);
    }
    const merge = (list, mat) => {
      const geos = list.map((g) => (g.index ? g.toNonIndexed() : g));
      for (const g of geos) { if (!g.attributes.uv) g.setAttribute('uv', new T.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); g.computeVertexNormals(); }
      const mesh = new T.Mesh(THREE.BufferGeometryUtils.mergeGeometries(geos, false), mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };
    merge(stoneParts, m.stone);
    if (darkParts.length) merge(darkParts, m.stoneDark);

    // rubble scattered just inside the rim (low, non-blocking)
    const rubble = [];
    for (let i = 0; i < 46; i++) {
      const a = rnd() * Math.PI * 2, r = visR(Math.sin(a), -Math.cos(a)) - 0.5 - rnd() * 1.2;
      const s = 0.12 + rnd() * 0.3;
      const g = new T.DodecahedronGeometry(s, 0);
      g.scale(1, 0.6, 1);
      g.rotateY(rnd() * 3); g.rotateX(rnd() * 0.5);
      g.translate(Math.sin(a) * r, s * 0.25, -Math.cos(a) * r);
      rubble.push(g);
    }
    merge(rubble, m.stoneDark).castShadow = false;
  }

  function addPillar(parts, dark, x, z, h, rnd, intact) {
    const base = new T.BoxGeometry(1.5, 0.55, 1.5);
    base.translate(x, 0.27, z); parts.push(base);
    const plinth = new T.CylinderGeometry(0.72, 0.8, 0.35, 8);
    plinth.translate(x, 0.72, z); parts.push(plinth);
    const shaftH = Math.max(0.3, h - 0.9);
    const shaft = new T.CylinderGeometry(0.5, 0.55, shaftH, 8);
    const sp = shaft.attributes.position;
    if (!intact) {
      // jagged broken top
      for (let k = 0; k < sp.count; k++) if (sp.getY(k) > 0) sp.setY(k, sp.getY(k) - rnd() * 0.9);
    }
    shaft.translate(x, 0.9 + shaftH / 2, z); parts.push(shaft);
    // engaged colonnettes
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const ch = shaftH * (intact ? 1 : 0.6 + rnd() * 0.3);
      const c = new T.CylinderGeometry(0.14, 0.16, ch, 5);
      c.translate(x + Math.cos(a) * 0.5, 0.9 + ch / 2, z + Math.sin(a) * 0.5);
      dark.push(c);
    }
    if (intact) {
      const cap = new T.CylinderGeometry(0.85, 0.55, 0.6, 8);
      cap.translate(x, h + 0.2, z); parts.push(cap);
      const abacus = new T.BoxGeometry(1.7, 0.3, 1.7);
      abacus.translate(x, h + 0.65, z); parts.push(abacus);
      // pinnacle
      const pin = new T.ConeGeometry(0.42, 2.4, 4);
      pin.rotateY(Math.PI / 4);
      pin.translate(x, h + 2.0, z); dark.push(pin);
    }
  }

  // pointed (gothic) arch between two pillar tops, with some voussoirs missing
  function addArch(parts, p, q, h, rnd) {
    const mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2;
    const span = Math.hypot(q.x - p.x, q.z - p.z);
    const dirx = (q.x - p.x) / span, dirz = (q.z - p.z) / span;
    const yaw = Math.atan2(-dirz, dirx);
    const half = span / 2;
    const rad = span * 0.8; // radius of each arc (pointed arch)
    const segs = 9;
    const spring = h + 0.8;
    for (let side = -1; side <= 1; side += 2) {
      // centre of the arc lies on the springing line at the opposite side
      const cx = -side * (rad - half);
      const aEnd = Math.acos((rad - half) / rad);
      for (let i = 0; i < segs; i++) {
        if (rnd() < 0.18 && i > 2) continue;
        const t0 = (i / segs) * aEnd, t1 = ((i + 1) / segs) * aEnd;
        const x0 = cx + side * Math.cos(t0) * rad, y0 = Math.sin(t0) * rad;
        const x1 = cx + side * Math.cos(t1) * rad, y1 = Math.sin(t1) * rad;
        const len = Math.hypot(x1 - x0, y1 - y0) + 0.06;
        const g = new T.BoxGeometry(len, 0.6, 0.85);
        g.rotateZ(Math.atan2(y1 - y0, x1 - x0));
        g.translate((x0 + x1) / 2, spring + (y0 + y1) / 2, 0);
        g.rotateY(yaw);
        g.translate(mx, 0, mz);
        parts.push(g);
      }
    }
  }

  // ---------- Distant gothic silhouettes ----------
  // A gothic tower: stepped body with buttress pinnacles, an octagonal lantern, and a long needle spire.
  function spireGeo(h, w, rnd) {
    const parts = [];
    const bodyH = h * (0.5 + rnd() * 0.12);
    const d = w * (0.75 + rnd() * 0.4);
    const b = new T.BoxGeometry(w, bodyH, d);
    b.translate(0, bodyH / 2, 0); parts.push(b);
    // buttress pinnacles at two levels
    for (let lvl = 0; lvl < 2; lvl++) {
      const y = bodyH * (lvl ? 1.0 : 0.7);
      const ph = h * (lvl ? 0.13 : 0.09);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        const r = (lvl ? 0.42 : 0.62) * w;
        const pin = new T.ConeGeometry(w * 0.07, ph, 4);
        pin.translate(Math.cos(a) * r, y + ph / 2, Math.sin(a) * r);
        parts.push(pin);
      }
    }
    const midH = h * 0.14;
    const mid = new T.CylinderGeometry(w * 0.3, w * 0.36, midH, 8);
    mid.translate(0, bodyH + midH / 2, 0); parts.push(mid);
    const coneH = h - bodyH - midH;
    const cone = new T.ConeGeometry(w * 0.3, coneH, 8);
    cone.translate(0, bodyH + midH + coneH / 2, 0); parts.push(cone);
    return parts;
  }

  function buildDistantWorld() {
    const rnd = U.rng(4242);
    const far = [], near = [];
    const place = (list, geos, x, y, z, rot) => {
      for (const g of geos) {
        g.rotateY(rot);
        g.translate(x, y, z);
        list.push(g.index ? g.toNonIndexed() : g);
      }
    };
    const eclAz = 10 * Math.PI / 180;
    // spires rising out of the abyss; tops sit at or below the terrace so their rooflines read from above
    let placed = 0, tries = 0;
    while (placed < 34 && tries++ < 400) {
      const a = (rnd() - 0.5) * Math.PI * 2;
      const d = 55 + rnd() * 210;
      // keep the sightline to the eclipse clear (the citadel fills it lower down)
      if (Math.abs(U.wrapAngle(a - eclAz)) < 0.32 && d > 40) continue;
      // tip placed at a view elevation inside the band the gameplay camera can see beyond the rim
      const el = (19 + rnd() * 10) * Math.PI / 180;
      const topY = W.camOffset.y - d * Math.tan(el);
      const h = 30 + rnd() * 26;
      const w = 4 + rnd() * 6;
      place(d < 120 ? near : far, spireGeo(h, w, rnd), Math.sin(a) * d, topY - h, -Math.cos(a) * d, rnd() * 3);
      placed++;
    }
    // the citadel: a cathedral mass beneath the eclipse, its spires reaching toward the ring
    const cd = 215;
    const cx = Math.sin(eclAz) * cd, cz = -Math.cos(eclAz) * cd;
    const naveTop = W.camOffset.y - cd * Math.tan(23 * Math.PI / 180);
    const nave = new T.BoxGeometry(60, 30, 34); nave.translate(0, naveTop - 35, 0);
    const roof = new T.ConeGeometry(30, 20, 4); roof.rotateY(Math.PI / 4); roof.scale(1, 1, 0.55); roof.translate(0, naveTop - 10, 0);
    place(far, [nave, roof], cx, 0, cz, -eclAz);
    for (let i = 0; i < 13; i++) {
      const ox = (rnd() - 0.5) * 90, oz = (rnd() - 0.5) * 36;
      const central = Math.abs(ox) < 14;
      const h = 36 + rnd() * 18 + (central ? 16 : 0);
      const el = (central ? 17.5 : 20 + Math.abs(ox) * 0.06) * Math.PI / 180;
      const topY = W.camOffset.y - (cd + oz) * Math.tan(el) + rnd() * 5;
      place(far, spireGeo(h, central ? 9 : 4 + rnd() * 5, rnd), cx + ox, topY - h, cz + oz, rnd() * 3);
    }
    // arcade bridges spanning between towers, low in the haze
    for (let i = 0; i < 4; i++) {
      let a = (rnd() - 0.5) * 2.4;
      if (Math.abs(a - eclAz) < 0.3) a += 0.6;
      const d = 75 + rnd() * 70;
      const len = 40 + rnd() * 50;
      const y = W.camOffset.y - d * Math.tan((21 + rnd() * 6) * Math.PI / 180); // deck sits inside the visible band
      const geos = [];
      const deck = new T.BoxGeometry(len, 3, 5); deck.translate(0, y, 0); geos.push(deck);
      for (let k = 0; k <= 6; k++) {
        const pier = new T.BoxGeometry(2.5, 34, 4); pier.translate(-len / 2 + (k / 6) * len, y - 18.5, 0); geos.push(pier);
      }
      place(near, geos, Math.sin(a) * d, 0, -Math.cos(a) * d, -a + (rnd() - 0.5) * 0.6);
    }
    const mk = (list, mat) => {
      for (const g of list) {
        for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
      }
      const geo = THREE.BufferGeometryUtils.mergeGeometries(list, false);
      geo.computeVertexNormals();
      const mesh = new T.Mesh(geo, mat);
      mesh.matrixAutoUpdate = false;
      W.scene.add(mesh);
      return mesh;
    };
    mk(far, U.mats.far);
    mk(near, U.mats.farLit);

    // floating fractured masonry just beyond the rim
    W.debris = [];
    for (let i = 0; i < 12; i++) {
      const a = rnd() * Math.PI * 2;
      const d = 19 + rnd() * 16;
      const g = rnd() < 0.5 ? new T.BoxGeometry(1 + rnd() * 2.4, 0.6 + rnd() * 1.4, 1 + rnd() * 2) : new T.DodecahedronGeometry(0.7 + rnd() * 1.4, 0);
      const mesh = new T.Mesh(g, rnd() < 0.5 ? U.mats.stone : U.mats.stoneDark);
      mesh.position.set(Math.sin(a) * d, -2 - rnd() * 9, -Math.cos(a) * d);
      mesh.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      mesh.userData = { base: mesh.position.y, ph: rnd() * 6, spin: (rnd() - 0.5) * 0.08 };
      W.scene.add(mesh);
      W.debris.push(mesh);
    }
  }

  // ---------- Mist layers ----------
  const MIST_VS = `
    varying vec2 vXZ; varying float vY;
    void main(){
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vXZ = wp.xz; vY = wp.y;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`;
  const MIST_FS = `
    uniform sampler2D uMap; uniform float uTime, uOpacity, uScale, uInner, uOuter, uFadeIn, uFadeOut;
    uniform vec2 uS1, uS2; uniform vec3 uColor;
    varying vec2 vXZ; varying float vY;
    void main(){
      float r = length(vXZ);
      float radial = smoothstep(uInner, uInner + uFadeIn, r) * (1.0 - smoothstep(uOuter - uFadeOut, uOuter, r));
      float n1 = texture2D(uMap, vXZ * uScale + uS1 * uTime).a;
      float n2 = texture2D(uMap, vXZ * uScale * 1.73 + uS2 * uTime + 0.37).a;
      float n = clamp(n1 * 0.65 + n2 * 0.55 - 0.08, 0.0, 1.0);
      gl_FragColor = vec4(uColor, n * radial * uOpacity);
    }`;

  function mistLayer(y, inner, outer, fadeIn, fadeOut, opacity, scale, color, s1, s2) {
    const mat = new T.ShaderMaterial({
      uniforms: {
        uMap: { value: U.tex.mist }, uTime: U.shared.uTime, uOpacity: { value: opacity }, uScale: { value: scale },
        uInner: { value: inner }, uOuter: { value: outer }, uFadeIn: { value: fadeIn }, uFadeOut: { value: fadeOut },
        uS1: { value: new T.Vector2(s1[0], s1[1]) }, uS2: { value: new T.Vector2(s2[0], s2[1]) },
        uColor: { value: new T.Color(color) },
      },
      vertexShader: MIST_VS, fragmentShader: MIST_FS,
      transparent: true, depthWrite: false, fog: false,
    });
    const geo = new T.RingGeometry(inner, outer, 64, 1);
    const mesh = new T.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    mesh.renderOrder = y < -20 ? 0 : 2;
    W.scene.add(mesh);
    return mesh;
  }

  function buildMist() {
    W.mist = [
      // luminous abyss far below: the spires rise out of it
      mistLayer(-120, 10, 800, 6, 340, 0.95, 0.0035, 0x7c808c, [0.0012, 0.0005], [-0.0008, 0.0009]),
      mistLayer(-78, 14, 520, 8, 240, 0.66, 0.006, 0x8e929e, [-0.0018, 0.0008], [0.0013, -0.0007]),
      mistLayer(-44, 16, 320, 10, 150, 0.46, 0.01, 0xa2a6b2, [0.0024, -0.001], [-0.0018, 0.0016]),
      // haze curling just beneath and around the rim
      mistLayer(-3.5, 14, 34, 3, 14, 0.24, 0.04, 0xbcc0cb, [0.004, 0.0015], [-0.003, 0.004]),
      mistLayer(0.4, 15.5, 26, 2.5, 9, 0.16, 0.05, 0xc6c9d3, [0.006, 0.002], [-0.004, 0.005]),
      // faint ground mist over the courtyard (kept very low so telegraphs stay readable)
      mistLayer(0.16, 0, 15, 0.1, 4, 0.05, 0.06, 0xd0d3dc, [0.008, 0.004], [-0.006, 0.003]),
    ];
  }

  // ---------- Motes ----------
  function buildMotes() {
    const n = 170;
    const pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 24;
      pos[i * 3] = Math.sin(a) * r; pos[i * 3 + 1] = Math.random() * 8; pos[i * 3 + 2] = -Math.cos(a) * r;
      seed[i] = Math.random();
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new T.BufferAttribute(seed, 1));
    const mat = new T.ShaderMaterial({
      uniforms: { uTime: U.shared.uTime, uScale: { value: 300 } },
      vertexShader: `
        attribute float aSeed; uniform float uTime; uniform float uScale; varying float vA;
        void main(){
          vec3 p = position;
          p.y = mod(p.y + uTime * (0.12 + aSeed * 0.2), 8.0) - 0.5;
          p.x += sin(uTime * 0.3 + aSeed * 40.0) * 0.6;
          p.z += cos(uTime * 0.23 + aSeed * 31.0) * 0.6;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (0.035 + aSeed * 0.05) * uScale / -mv.z;
          vA = smoothstep(-0.5, 0.6, p.y) * (1.0 - smoothstep(6.0, 7.5, p.y)) * (0.35 + 0.65 * fract(aSeed * 7.3));
        }`,
      fragmentShader: `
        varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vec3(1.6), a * vA * 0.8); }`,
      transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    });
    const pts = new T.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 3;
    W.scene.add(pts);
    W.motes = pts;
  }

  // ---------- Aim reticle ----------
  function buildReticle() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(64, 64, 40, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 4;
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      ctx.beginPath(); ctx.moveTo(64 + Math.cos(a) * 46, 64 + Math.sin(a) * 46); ctx.lineTo(64 + Math.cos(a) * 60, 64 + Math.sin(a) * 60); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(64, 64, 4, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    const tex = new T.CanvasTexture(c);
    const mat = new T.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.42, depthWrite: false, blending: T.AdditiveBlending, color: new T.Color(1.2, 1.2, 1.3) });
    const mesh = new T.Mesh(new T.PlaneGeometry(1.1, 1.1), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 6;
    W.scene.add(mesh);
    W.reticle = mesh;
  }

  // ---------- Per-frame ----------
  const _ray = new T.Raycaster();
  const _v = new T.Vector3();
  const _ndc = new T.Vector2();

  // intersect the mouse ray with the horizontal plane y = h
  W.mouseGround = function (ndcX, ndcY, h, out) {
    _ndc.set(ndcX, ndcY);
    _ray.setFromCamera(_ndc, W.camera);
    const o = _ray.ray.origin, d = _ray.ray.direction;
    const t = (h - o.y) / (Math.abs(d.y) < 1e-4 ? -1e-4 : d.y);
    return (out || new T.Vector3()).copy(o).addScaledVector(d, Math.max(t, 0));
  };

  W.addShake = function (amount) { W.shake.trauma = Math.min(1, W.shake.trauma + amount); };

  W.lookHeight = 0.9; // frame the chest rather than the feet
  W.followCamera = function (target, dt, snap) {
    const ty = target.y + W.lookHeight;
    if (snap) W.camTarget.set(target.x, ty, target.z);
    else {
      W.camTarget.x = U.damp(W.camTarget.x, target.x, 9, dt);
      W.camTarget.z = U.damp(W.camTarget.z, target.z, 9, dt);
      W.camTarget.y = U.damp(W.camTarget.y, ty, 9, dt);
    }
    const cam = W.camera;
    cam.position.copy(W.camTarget).add(W.camOffset);
    const s = W.shake;
    s.t += dt;
    if (s.trauma > 0) {
      const k = s.trauma * s.trauma * 0.32;
      cam.position.x += k * (Math.sin(s.t * 63.1) + Math.sin(s.t * 37.7) * 0.5);
      cam.position.y += k * (Math.sin(s.t * 57.3 + 1.3) + Math.sin(s.t * 29.1) * 0.5);
      s.trauma = Math.max(0, s.trauma - dt * 2.8);
    }
    // keep the shadow frustum centred on the action, snapped to texels to avoid shimmer
    const key = W.key;
    const texel = 34 / 2048;
    const tx = Math.round(W.camTarget.x / texel) * texel, tz = Math.round(W.camTarget.z / texel) * texel;
    key.target.position.set(tx, 0, tz - 2);
    key.position.set(tx + W.keyDir.x * 40, W.keyDir.y * 40, tz - 2 + W.keyDir.z * 40);
    W.fill.target.position.set(tx, 0, tz);
    W.fill.position.set(tx - 5, 9, tz + 12);
    W.sky.position.copy(cam.position);
  };

  W.update = function (dt, t) {
    U.shared.uTime.value = t;
    for (const d of W.debris) {
      d.position.y = d.userData.base + Math.sin(t * 0.35 + d.userData.ph) * 0.5;
      d.rotation.y += d.userData.spin * dt;
      d.rotation.x += d.userData.spin * 0.5 * dt;
    }
    // global dimming for The Seal Objects' anticipation
    const k = 1 - W.dim * 0.72;
    W.hemi.intensity = W.baseLight.hemi * k;
    W.key.intensity = W.baseLight.key * (1 - W.dim * 0.65);
    W.fill.intensity = W.baseLight.fill * k;
    W.heroLight.intensity = W.baseLight.hero * (1 - W.dim * 0.7);
    W.sky.material.uniforms.uDim.value = W.dim;
    W.eclipse.material.uniforms.uDim.value = W.dim;
    W.grade.uniforms.uDim.value = W.dim * 0.7;
    W.seal.material.opacity = 0.2 + W.sealPulse * 0.6;
    W.sealPulse = Math.max(0, W.sealPulse - dt * 1.2);
    // view-space key direction for rim shading (camera orientation is fixed, but cheap to recompute)
    _v.copy(W.keyDir).transformDirection(W.camera.matrixWorldInverse);
    U.shared.uRimDir.value.copy(_v);
  };
  W.sealPulse = 0;

  W.render = function (rt) {
    W.grade.uniforms.uTime.value = rt;
    W.composer.render();
  };
})(window.U);
