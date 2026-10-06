/* UNHALLOWED — shared materials, rim lighting injection, procedural textures and shaders. */
'use strict';
(function (U) {
  const T = THREE;

  U.shared = {
    uRimDir: { value: new T.Vector3(0, 0.8, -0.6).normalize() }, // key light direction in view space (updated per frame)
    uTime: { value: 0 },
  };

  const RIM_COLOR = new T.Color(0.80, 0.84, 0.94);

  // Inject a cold fresnel rim into a MeshStandardMaterial. The rim is biased toward the key (back) light
  // so silhouettes pick up luminous edges that separate dark masses from each other.
  U.rimify = function (mat, strength, power, color) {
    const rimColor = color ? new T.Color(color) : RIM_COLOR.clone();
    mat.userData.rimStrength = { value: strength };
    mat.userData.rimColor = { value: rimColor };
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uRimDir = U.shared.uRimDir;
      shader.uniforms.uRimColor = mat.userData.rimColor;
      shader.uniforms.uRimStrength = mat.userData.rimStrength;
      shader.uniforms.uRimPower = { value: power || 2.6 };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uRimDir;\nuniform vec3 uRimColor;\nuniform float uRimStrength;\nuniform float uRimPower;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 rimV = normalize(vViewPosition);
          float rimNdv = clamp(abs(dot(normal, rimV)), 0.0, 1.0);
          float rimF = pow(1.0 - rimNdv, uRimPower);
          float rimSide = clamp(dot(normal, uRimDir) * 0.75 + 0.42, 0.0, 1.0);
          totalEmissiveRadiance += uRimColor * (rimF * rimSide * uRimStrength);
        }`);
    };
    mat.customProgramCacheKey = () => 'rim-v1';
    return mat;
  };

  function std(params, rim, rimPow) {
    const m = new T.MeshStandardMaterial(Object.assign({ flatShading: true }, params));
    if (rim) U.rimify(m, rim, rimPow);
    return m;
  }
  U.stdMat = std;

  // ---------- Procedural textures ----------
  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h || w;
    return c;
  }

  // periodic value-noise fbm -> Float32Array (tileable)
  U.noiseField = function (size, octaves, seed, baseCells) {
    const rnd = U.rng(seed);
    const out = new Float32Array(size * size);
    const lats = [];
    for (let o = 0; o < octaves; o++) {
      const n = (baseCells || 4) << o;
      const arr = new Float32Array(n * n);
      for (let i = 0; i < arr.length; i++) arr[i] = rnd();
      lats.push({ n, arr });
    }
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let v = 0, amp = 0.5, tot = 0;
        for (const { n, arr } of lats) {
          const fx = (x / size) * n, fy = (y / size) * n;
          const ix = Math.floor(fx), iy = Math.floor(fy);
          const tx = U.smooth(fx - ix), ty = U.smooth(fy - iy);
          const x0 = ix % n, y0 = iy % n, x1 = (ix + 1) % n, y1 = (iy + 1) % n;
          const a = arr[y0 * n + x0], b = arr[y0 * n + x1], c = arr[y1 * n + x0], d = arr[y1 * n + x1];
          v += amp * U.lerp(U.lerp(a, b, tx), U.lerp(c, d, tx), ty);
          tot += amp; amp *= 0.5;
        }
        out[y * size + x] = v / tot;
      }
    }
    return out;
  };

  function noiseTexture(size, octaves, seed, fn, baseCells) {
    const f = U.noiseField(size, octaves, seed, baseCells);
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < f.length; i++) {
      const [r, g, b, a] = fn(f[i], i % size, Math.floor(i / size));
      img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = a;
    }
    ctx.putImageData(img, 0, 0);
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    return t;
  }

  U.tex = {};

  U.buildTextures = function () {
    // stone grain (sRGB albedo detail)
    U.tex.stone = noiseTexture(256, 6, 11, (v, x, y) => {
      const speck = ((x * 73856093) ^ (y * 19349663)) % 97 === 0 ? 40 : 0;
      const k = Math.floor(U.clamp(178 + (v - 0.5) * 120 + speck, 80, 255));
      return [k, k, k + 3, 255];
    }, 10);
    U.tex.stone.colorSpace = T.SRGBColorSpace;

    // mist: soft tileable cloud alpha
    U.tex.mist = noiseTexture(256, 5, 5, (v) => {
      const a = Math.floor(U.clamp((v - 0.32) * 2.6, 0, 1) * 255);
      return [255, 255, 255, a];
    }, 3);

    // soft round glow sprite
    {
      const c = canvas(64), ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
      U.tex.glow = new T.CanvasTexture(c);
    }

    U.tex.seal = buildSealTexture();
    U.tex.tabard = buildTabardTexture();
    U.tex.coatBack = buildCoatTexture();
    U.tex.cracks = buildCrackTexture();
    U.tex.envMap = null; // set by world after renderer exists
  };

  function buildSealTexture() {
    const S = 1024, c = canvas(S), ctx = c.getContext('2d');
    const cx = S / 2, cy = S / 2;
    ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff';
    ctx.lineCap = 'round';
    const circle = (r, w) => { ctx.lineWidth = w; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); };
    circle(500, 5); circle(486, 2); circle(420, 3); circle(300, 4); circle(288, 1.5); circle(150, 3);
    // tick marks between outer rings
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2, r0 = 452, r1 = i % 10 === 0 ? 484 : i % 5 === 0 ? 474 : 466;
      ctx.lineWidth = i % 10 === 0 ? 3 : 1.5;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.stroke();
    }
    // rune-like glyphs on the middle band
    const rnd = U.rng(77);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + 0.1;
      ctx.save(); ctx.translate(cx + Math.cos(a) * 360, cy + Math.sin(a) * 360); ctx.rotate(a + Math.PI / 2);
      ctx.lineWidth = 3; ctx.beginPath();
      ctx.moveTo(0, -24); ctx.lineTo(0, 24);
      const k = Math.floor(rnd() * 4);
      if (k === 0) { ctx.moveTo(-12, -10); ctx.lineTo(0, -24); ctx.lineTo(12, -10); }
      if (k === 1) { ctx.moveTo(-12, 0); ctx.lineTo(12, 0); ctx.arc(0, 12, 8, 0, Math.PI * 2); }
      if (k === 2) { ctx.moveTo(-12, -20); ctx.lineTo(12, 20); }
      if (k === 3) { ctx.moveTo(0, -8); ctx.arc(0, -8, 10, Math.PI, 0); }
      ctx.stroke(); ctx.restore();
    }
    // eight-pointed star of thin lines
    ctx.lineWidth = 2.5;
    for (let k = 0; k < 2; k++) {
      ctx.beginPath();
      for (let i = 0; i <= 8; i++) {
        const a = (i * 3 / 8) * Math.PI * 2 + k * Math.PI / 8 - Math.PI / 2;
        const x = cx + Math.cos(a) * 420, y = cy + Math.sin(a) * 420;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // crescent and vertical axis (Vaust's emblem)
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(cx, cy - 290); ctx.lineTo(cx, cy + 290); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy + 40, 110, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(cx, cy - 150, 34, 0, Math.PI * 2); ctx.stroke();
    // diamond at centre
    ctx.beginPath(); ctx.moveTo(cx, cy - 46); ctx.lineTo(cx + 26, cy); ctx.lineTo(cx, cy + 46); ctx.lineTo(cx - 26, cy); ctx.closePath(); ctx.stroke();
    // small circles at star tips
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * 420, cy + Math.sin(a) * 420, 14, 0, Math.PI * 2); ctx.stroke();
    }
    // erode: knock out irregular patches so it reads as faded and broken
    const n = U.noiseField(256, 5, 19, 4);
    const img = ctx.getImageData(0, 0, S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const v = n[((y >> 2) & 255) * 256 + ((x >> 2) & 255)];
        const k = U.clamp((v - 0.36) * 3.2, 0.08, 1);
        img.data[(y * S + x) * 4 + 3] *= k;
      }
    }
    ctx.putImageData(img, 0, 0);
    const t = new T.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
  }

  function buildTabardTexture() {
    const W = 128, H = 512, c = canvas(W, H), ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#7a7b82'); g.addColorStop(1, '#4b4c53');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#e4e5ea'; ctx.fillStyle = '#e4e5ea';
    // border trims
    ctx.lineWidth = 3; ctx.strokeRect(8, -4, W - 16, H + 8);
    ctx.lineWidth = 1.5; ctx.strokeRect(15, -4, W - 30, H + 8);
    const cx = W / 2;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx, 30); ctx.lineTo(cx, 380); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, 120, 20, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, 120, 6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx, 200); ctx.lineTo(cx + 16, 230); ctx.lineTo(cx, 260); ctx.lineTo(cx - 16, 230); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, 300, 22, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();
    // chevrons toward the point
    for (let i = 0; i < 3; i++) {
      const y = 400 + i * 26;
      ctx.beginPath(); ctx.moveTo(cx - 30, y); ctx.lineTo(cx, y + 20); ctx.lineTo(cx + 30, y); ctx.stroke();
    }
    grain(ctx, W, H, 0.12, 3);
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    return t;
  }

  function buildCoatTexture() {
    const W = 256, H = 512, c = canvas(W, H), ctx = c.getContext('2d');
    ctx.fillStyle = '#16161b'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#c9cad2'; ctx.lineWidth = 4;
    const cx = W / 2;
    ctx.beginPath(); ctx.moveTo(cx, 30); ctx.lineTo(cx, 330); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, 110, 12, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(cx, 250, 58, 0.08 * Math.PI, 0.92 * Math.PI); ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx - 20, 360); ctx.lineTo(cx, 400); ctx.lineTo(cx + 20, 360); ctx.stroke();
    ctx.strokeStyle = 'rgba(160,162,172,0.55)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(6, H); ctx.moveTo(W - 6, 0); ctx.lineTo(W - 6, H); ctx.stroke();
    grain(ctx, W, H, 0.1, 9);
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    return t;
  }

  function buildCrackTexture() {
    const S = 512, c = canvas(S), ctx = c.getContext('2d');
    const rnd = U.rng(31);
    ctx.strokeStyle = '#fff'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const branch = (x, y, a, len, w, depth) => {
      ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x, y);
      let px = x, py = y;
      const steps = 6;
      for (let i = 0; i < steps; i++) {
        a += (rnd() - 0.5) * 0.7;
        px += Math.cos(a) * len / steps; py += Math.sin(a) * len / steps;
        ctx.lineTo(px, py);
        if (depth > 0 && rnd() < 0.22) {
          ctx.stroke();
          branch(px, py, a + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.6), len * 0.45, w * 0.6, depth - 1);
          ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(px, py);
        }
      }
      ctx.stroke();
    };
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + rnd() * 0.3;
      branch(S / 2 + Math.cos(a) * 20, S / 2 + Math.sin(a) * 20, a, 200 + rnd() * 50, 4, 2);
    }
    return new T.CanvasTexture(c);
  }

  function grain(ctx, W, H, amount, seed) {
    const img = ctx.getImageData(0, 0, W, H);
    const rnd = U.rng(seed);
    for (let i = 0; i < img.data.length; i += 4) {
      const k = 1 + (rnd() - 0.5) * amount * 2;
      img.data[i] *= k; img.data[i + 1] *= k; img.data[i + 2] *= k;
    }
    ctx.putImageData(img, 0, 0);
  }

  // Equirect environment for metal reflections: dark sky, misty horizon, white eclipse ring to the north.
  U.buildEnvEquirect = function () {
    const W = 512, H = 256, c = canvas(W, H), ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#16161a'); g.addColorStop(0.38, '#5d5f68'); g.addColorStop(0.5, '#9a9ca6');
    g.addColorStop(0.62, '#4a4b52'); g.addColorStop(1, '#0c0c0e');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // bright soft band high in the north (catches top highlights on silver)
    const b = ctx.createRadialGradient(W * 0.25, H * 0.26, 4, W * 0.25, H * 0.26, 90);
    b.addColorStop(0, 'rgba(255,255,255,0.95)'); b.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = b; ctx.fillRect(0, 0, W, H);
    // eclipse ring
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(W * 0.25, H * 0.58, 22, 0, Math.PI * 2); ctx.stroke();
    // cold fill from the south (camera side)
    const s = ctx.createRadialGradient(W * 0.75, H * 0.4, 4, W * 0.75, H * 0.4, 120);
    s.addColorStop(0, 'rgba(190,195,210,0.5)'); s.addColorStop(1, 'rgba(190,195,210,0)');
    ctx.fillStyle = s; ctx.fillRect(0, 0, W, H);
    const t = new T.CanvasTexture(c);
    t.mapping = T.EquirectangularReflectionMapping;
    t.colorSpace = T.SRGBColorSpace;
    return t;
  };

  // ---------- Materials ----------
  U.buildMaterials = function () {
    const m = {};
    m.clothBlack = std({ color: 0x0d0d11, roughness: 0.93, metalness: 0.0 }, 0.5, 2.4);
    m.clothBlackDS = std({ color: 0x0d0d11, roughness: 0.93, side: T.DoubleSide }, 0.45, 2.4);
    m.clothChar = std({ color: 0x1e1e25, roughness: 0.9, side: T.DoubleSide }, 0.45, 2.4);
    m.clothInner = std({ color: 0x15151a, roughness: 0.95 }, 0.35, 2.6);
    m.tabard = std({ color: 0xffffff, map: U.tex.tabard, roughness: 0.82, side: T.DoubleSide }, 0.35, 2.4);
    m.coatBack = std({ color: 0xffffff, map: U.tex.coatBack, roughness: 0.9, side: T.DoubleSide }, 0.45, 2.4);
    m.silver = std({ color: 0xd6d8e0, roughness: 0.28, metalness: 0.92, envMapIntensity: 1.3 }, 0.55, 2.0);
    m.darkMetal = std({ color: 0x34343c, roughness: 0.38, metalness: 0.85, envMapIntensity: 0.9 }, 0.45, 2.2);
    m.leather = std({ color: 0x141418, roughness: 0.65, metalness: 0.15 }, 0.45, 2.4);
    m.hair = std({ color: 0x0a0a0d, roughness: 0.5, metalness: 0.15, envMapIntensity: 0.6 }, 0.75, 2.2);
    m.maskDark = std({ color: 0x101014, roughness: 0.5, metalness: 0.5 }, 0.3, 2.4);
    m.eye = new T.MeshBasicMaterial({ color: new T.Color(2.2, 2.3, 2.6) });
    m.blade = std({ color: 0xe4e6ee, roughness: 0.18, metalness: 0.95, envMapIntensity: 1.6 }, 0.8, 1.8);

    // stone
    m.floor = std({ color: 0xffffff, vertexColors: true, map: U.tex.stone, roughness: 0.58, metalness: 0.1 }, 0.05, 3.0);
    m.stone = std({ color: 0x34343b, map: U.tex.stone, roughness: 0.9 }, 0.28, 2.6);
    m.stoneDark = std({ color: 0x1f1f25, map: U.tex.stone, roughness: 0.92 }, 0.25, 2.6);
    m.cliff = std({ color: 0x18181d, map: U.tex.stone, roughness: 0.95 }, 0.3, 2.2);
    m.far = new T.MeshLambertMaterial({ color: 0x0c0c10, flatShading: true });
    m.farLit = new T.MeshLambertMaterial({ color: 0x111116, flatShading: true });
    U.mats = m;
    return m;
  };

  U.applyEnvMap = function (env) {
    for (const k of ['silver', 'darkMetal', 'hair', 'blade', 'maskDark']) {
      U.mats[k].envMap = env;
      U.mats[k].needsUpdate = true;
    }
  };

  // ---------- Spectral shader (hands, afterimages, giant blade) ----------
  const SPECTRAL_VS = `
    #include <common>
    #include <skinning_pars_vertex>
    varying vec3 vViewPos;
    void main() {
      #include <skinbase_vertex>
      #include <begin_vertex>
      #include <skinning_vertex>
      #include <project_vertex>
      vViewPos = mvPosition.xyz;
    }`;
  const SPECTRAL_FS = `
    uniform vec3 uColor;
    uniform float uOpacity;
    uniform float uCore;
    uniform float uEdge;
    uniform float uGlow;
    varying vec3 vViewPos;
    void main() {
      vec3 n = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));
      vec3 v = normalize(-vViewPos);
      float ndv = abs(dot(n, v));
      float fres = pow(1.0 - ndv, 2.2);
      float facet = 0.45 + 0.55 * clamp(n.y * 0.6 + n.x * 0.25 + 0.5, 0.0, 1.0);
      float a = uOpacity * clamp(uCore * facet + fres * uEdge, 0.0, 1.0);
      vec3 col = uColor * (uGlow * (0.55 + 0.6 * facet) + fres * 1.6 * uGlow);
      gl_FragColor = vec4(col, a);
    }`;

  U.spectralMaterial = function (opts) {
    opts = opts || {};
    return new T.ShaderMaterial({
      uniforms: {
        uColor: { value: new T.Color(opts.color || 0xe8ecf6) },
        uOpacity: { value: opts.opacity != null ? opts.opacity : 1 },
        uCore: { value: opts.core != null ? opts.core : 0.22 },
        uEdge: { value: opts.edge != null ? opts.edge : 0.9 },
        uGlow: { value: opts.glow != null ? opts.glow : 1.2 },
      },
      vertexShader: SPECTRAL_VS,
      fragmentShader: SPECTRAL_FS,
      transparent: true,
      depthWrite: false,
      blending: opts.blending != null ? opts.blending : T.AdditiveBlending,
      side: opts.side || T.FrontSide,
    });
  };
})(window.U);
