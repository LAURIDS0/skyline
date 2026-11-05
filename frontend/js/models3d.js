// Procedural 3D models for the airport editor. 1 unit = 10 m; a model lives in its footprint x ∈ [0, w], z ∈ [0, d], y up.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const LEVEL_H = 0.55;

// ---------- procedural textures ----------
function noiseTexture(base, spread, size = 128, specks = 0) {
  const c = Object.assign(document.createElement('canvas'), { width: size, height: size }), g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  const img = g.getImageData(0, 0, size, size), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * spread; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < specks; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.15})`; g.fillRect(Math.random() * size, Math.random() * size, 2, 2); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
let TEX;
export const textures = () => TEX ??= {
  grass: noiseTexture('#6c9a4c', 34, 256, 400),
  asphalt: noiseTexture('#34373e', 22, 128, 300),
  concrete: noiseTexture('#8d929b', 18, 128, 120),
  tile: (() => {
    const t = noiseTexture('#e6e0d3', 8, 64);
    const g = t.image.getContext('2d'); g.strokeStyle = 'rgba(0,0,0,.12)'; g.lineWidth = 2; g.strokeRect(1, 1, 62, 62);
    t.needsUpdate = true; return t;
  })(),
};

// ---------- caches & part helpers ----------
const geoCache = new Map(), matCache = new Map();
const cached = (map, key, make) => map.get(key) ?? (map.set(key, make()), map.get(key));
const boxG = (w, h, d, r = 0) => cached(geoCache, `b${w},${h},${d},${r}`, () => (r ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d)));
const cylG = (rt, rb, h, seg = 16, arc = Math.PI * 2) => cached(geoCache, `c${rt},${rb},${h},${seg},${arc}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, false, 0, arc));
const sphG = (r, seg = 12) => cached(geoCache, `s${r},${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(6, seg - 3)));
const coneG = (r, h, seg = 10) => cached(geoCache, `k${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg));
const capG = (r, l) => cached(geoCache, `p${r},${l}`, () => new THREE.CapsuleGeometry(r, l, 6, 14));
export const GLASS = { transparent: true, opacity: 0.42, roughness: 0.05, metalness: 0.6, envMapIntensity: 1.6 };
const TINT = { transparent: true, opacity: 0.75, roughness: 0.1, metalness: 0.7 };
const METAL = { metalness: 0.75, roughness: 0.32 };
const WATER = { transparent: true, opacity: 0.82, roughness: 0.02, metalness: 0.3 };
const GLOW = c => ({ emissive: c, emissiveIntensity: 1.4 });
export const mat = (color, o = {}) => cached(matCache, color + JSON.stringify(o, (k, v) => (v?.isTexture ? v.uuid : v)),
  () => new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.03, ...o }));

const part = (geo, color, x, y, z, o = {}) => ({
  geo, mat: mat(color, o.mat), shadow: o.shadow ?? true,
  m: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx || 0, o.ry || 0, o.rz || 0)), new THREE.Vector3(...(o.s || [1, 1, 1]))),
});
const box = (w, h, d, color, x, y, z, o = {}) => part(boxG(w, h, d, o.round || 0), color, x, y + h / 2, z, o);
const flat = (w, d, color, x, z, y = 0.02, o = {}) => part(boxG(w, 0.04, d), color, x, y, z, { shadow: false, ...o });
const cyl = (rt, rb, h, color, x, y, z, o = {}) => part(cylG(rt, rb, h, o.seg), color, x, y + h / 2, z, o);
const sph = (r, color, x, y, z, o) => part(sphG(r), color, x, y, z, o);
// Window band: dark tinted glass ring around a block, slightly proud of the facade.
const windows = (w, d, x, z, y, h = 0.18) => box(w + 0.02, h, d + 0.02, '#203246', x, y, z, { mat: TINT });

function stripes(len, width, x0, z, step, dash, color, y = 0.05) {
  const out = [];
  for (let x = x0 + step / 2; x < x0 + len - dash / 2; x += step) out.push(flat(dash, width, color, x, z, y));
  return out;
}
export function runwayParts(len, wid, thresholds) {
  const c = wid / 2, T = textures();
  const out = [flat(len, wid, '#ffffff', len / 2, c, 0.03, { mat: { map: T.asphalt, roughness: 0.92 } }),
    flat(len, 0.1, '#f4f4f0', len / 2, 0.3, 0.055), flat(len, 0.1, '#f4f4f0', len / 2, wid - 0.3, 0.055),
    ...stripes(len, 0.14, 0, c, 6, 3, '#f4f4f0', 0.055)];
  for (const x of thresholds) {
    for (let k = 0; k < 8; k++) out.push(flat(2.4, 0.28, '#f4f4f0', x, 0.7 + k * (wid - 1.4) / 7, 0.056));
    // Edge lights along the threshold bar.
    for (let k = 0; k < 6; k++) out.push(sph(0.05, '#9cff8a', x + (x < len / 2 ? -1.4 : 1.4), 0.08, 0.5 + k * (wid - 1) / 5, { mat: GLOW('#5cff5c'), shadow: false }));
  }
  for (let x = 4; x < len; x += 6) { out.push(sph(0.035, '#fff7d6', x, 0.07, 0.12, { mat: GLOW('#ffe7a0'), shadow: false }), sph(0.035, '#fff7d6', x, 0.07, wid - 0.12, { mat: GLOW('#ffe7a0'), shadow: false })); }
  return out;
}
const pad = (w, d) => flat(w, d, '#ffffff', w / 2, d / 2, 0.025, { mat: { map: textures().concrete } });
function stand(w, d, bridge, cargo) {
  const lead = cargo ? '#ffd23f' : '#e8c547';
  const out = [pad(w, d), flat(0.1, d * 0.85, lead, w / 2, d * 0.45, 0.05), flat(w * 0.5, 0.1, lead, w / 2, d * 0.15, 0.05),
    flat(w - 0.2, 0.06, '#d94a4a', w / 2, 0.05, 0.05), flat(w - 0.2, 0.06, '#d94a4a', w / 2, d - 0.05, 0.05),
    box(0.06, 0.6, 0.06, '#33363d', w / 2 + 0.6, 0, d * 0.12), box(0.3, 0.18, 0.05, '#ffc72c', w / 2 + 0.6, 0.55, d * 0.12, { mat: GLOW('#ffb000') })];
  if (bridge) out.push(box(0.6, 0.55, d * 0.5, '#d4d8de', w * 0.2, 0.75, d * 0.75, { round: 0.06 }), cyl(0.09, 0.09, 0.75, '#8a909a', w * 0.2, 0, d * 0.6),
    box(0.7, 0.62, 0.5, '#bfc4cc', w * 0.2, 0.72, d * 0.5, { round: 0.06 }));
  else out.push(box(0.35, 0.3, 0.9, '#d4d8de', w * 0.28, 0, d * 0.5), box(0.3, 0.5, 0.25, '#e8c547', w * 0.75, 0, d * 0.82));
  return out;
}
const CARS = ['#d94a4a', '#3d6fd6', '#f2f2f2', '#2b2e35', '#e8c547', '#6a7280', '#2f8a5a'];
const car = (x, z, c, ry = 0) => [box(0.22, 0.12, 0.45, c, x, 0.04, z, { round: 0.04, ry }), box(0.18, 0.09, 0.24, '#1b2a3a', x, 0.15, z, { mat: TINT, ry })];

// ---------- models ----------
export const MODELS = {
  runway: (w, d) => runwayParts(w, d, [1.5, w - 1.5]),
  runway_ext: (w, d) => runwayParts(w, d, [w - 1.5]),
  taxiway: () => [flat(1, 1, '#ffffff', 0.5, 0.5, 0.025, { mat: { map: textures().asphalt } }), flat(1, 0.07, '#e8c547', 0.5, 0.5, 0.05),
    sph(0.03, '#7ad7ff', 0.5, 0.06, 0.08, { mat: GLOW('#2aa8ff'), shadow: false })],
  apron: () => [flat(1, 1, '#ffffff', 0.5, 0.5, 0.025, { mat: { map: textures().concrete } })],
  road: () => [flat(1, 1, '#ffffff', 0.5, 0.5, 0.025, { mat: { map: textures().asphalt } }), flat(0.4, 0.05, '#efefef', 0.5, 0.5, 0.05)],
  path: () => [flat(1, 1, '#c9bfa8', 0.5, 0.5, 0.03), flat(0.96, 0.96, '#d6ccb6', 0.5, 0.5, 0.035)],
  floor: () => [flat(1, 1, '#ffffff', 0.5, 0.5, 0.04, { mat: { map: textures().tile, roughness: 0.35 } })],
  grass: () => [flat(1, 1, '#79b257', 0.5, 0.5, 0.03)],
  // Edge items: model spans one tile edge along x at z = 0 (rotated for vertical edges).
  wall: () => [box(1, LEVEL_H, 0.12, '#eeebe4', 0.5, 0, 0), box(1.02, 0.03, 0.15, '#cfcac0', 0.5, LEVEL_H, 0)],
  glasswall: () => [box(1, LEVEL_H - 0.04, 0.05, '#a7d6f2', 0.5, 0.02, 0, { mat: GLASS }), box(1, 0.04, 0.09, '#9aa1ab', 0.5, 0, 0, { mat: METAL }),
    box(1, 0.04, 0.09, '#9aa1ab', 0.5, LEVEL_H - 0.04, 0, { mat: METAL }), box(0.04, LEVEL_H, 0.09, '#9aa1ab', 0.02, 0, 0, { mat: METAL })],
  door: () => [box(0.08, LEVEL_H, 0.13, '#5a6474', 0.08, 0, 0, { mat: METAL }), box(0.08, LEVEL_H, 0.13, '#5a6474', 0.92, 0, 0, { mat: METAL }),
    box(1, 0.1, 0.13, '#5a6474', 0.5, LEVEL_H - 0.1, 0, { mat: METAL }), box(0.38, LEVEL_H - 0.12, 0.03, '#bfe4f7', 0.29, 0.01, 0, { mat: GLASS }),
    box(0.38, LEVEL_H - 0.12, 0.03, '#bfe4f7', 0.71, 0.01, 0, { mat: GLASS }), flat(0.84, 0.3, '#3a3e46', 0.5, 0.15, 0.045), box(0.3, 0.05, 0.02, '#3ddc84', 0.5, LEVEL_H - 0.07, 0.08, { mat: GLOW('#3ddc84') })],
  stairs: () => Array.from({ length: 8 }, (_, i) => box(0.8, LEVEL_H * (i + 1) / 8, 0.25, '#c8c2b6', 0.5, 0, 0.12 + i * 0.25)).concat(
    box(0.04, LEVEL_H * 1.1, 2, '#9aa1ab', 0.08, 0.1, 1, { mat: METAL, rx: -Math.atan2(LEVEL_H, 2) })),
  escalator: () => [part(boxG(0.8, 0.08, 3.2), '#5d6573', 0.5, LEVEL_H / 2 + 0.05, 1.5, { rx: -Math.atan2(LEVEL_H, 3) }),
    part(boxG(0.06, 0.28, 3.2), '#d9dde4', 0.12, LEVEL_H / 2 + 0.2, 1.5, { rx: -Math.atan2(LEVEL_H, 3), mat: GLASS }),
    part(boxG(0.06, 0.28, 3.2), '#d9dde4', 0.88, LEVEL_H / 2 + 0.2, 1.5, { rx: -Math.atan2(LEVEL_H, 3), mat: GLASS }),
    part(boxG(0.07, 0.04, 3.2), '#1d1f24', 0.12, LEVEL_H / 2 + 0.35, 1.5, { rx: -Math.atan2(LEVEL_H, 3) }),
    part(boxG(0.07, 0.04, 3.2), '#1d1f24', 0.88, LEVEL_H / 2 + 0.35, 1.5, { rx: -Math.atan2(LEVEL_H, 3) }),
    flat(0.8, 0.4, '#9aa1ab', 0.5, 0.2, 0.05, { mat: METAL })],
  elevator: () => [box(0.85, LEVEL_H * 1.9, 0.85, '#a7d6f2', 0.5, 0, 0.5, { mat: GLASS }), box(0.9, 0.05, 0.9, '#8a93a3', 0.5, 0, 0.5, { mat: METAL }),
    box(0.9, 0.05, 0.9, '#8a93a3', 0.5, LEVEL_H * 1.9, 0.5, { mat: METAL }), box(0.55, 0.32, 0.55, '#c8ccd2', 0.5, 0.06, 0.5, { mat: METAL })],
  planter: () => [box(0.7, 0.18, 0.7, '#6b5a48', 0.5, 0, 0.5, { round: 0.04 }), sph(0.28, '#3f8a3a', 0.5, 0.36, 0.5), sph(0.18, '#4c9a44', 0.62, 0.48, 0.42)],
  chairs: () => [0.2, 0.4, 0.6, 0.8].flatMap(x => [box(0.16, 0.05, 0.17, '#3b5bc4', x, 0.14, 0.45, { round: 0.02 }), box(0.16, 0.16, 0.04, '#2f4ca8', x, 0.18, 0.56, { round: 0.02 })])
    .concat(box(0.86, 0.03, 0.05, '#9aa1ab', 0.5, 0.1, 0.45, { mat: METAL }), box(0.04, 0.1, 0.04, '#9aa1ab', 0.1, 0, 0.45, { mat: METAL }), box(0.04, 0.1, 0.04, '#9aa1ab', 0.9, 0, 0.45, { mat: METAL })),
  bench: () => [box(0.8, 0.04, 0.22, '#8a6a4a', 0.5, 0.17, 0.5), box(0.8, 0.14, 0.03, '#7a5a3a', 0.5, 0.22, 0.6),
    box(0.04, 0.17, 0.2, '#3a3d44', 0.15, 0, 0.5, { mat: METAL }), box(0.04, 0.17, 0.2, '#3a3d44', 0.85, 0, 0.5, { mat: METAL })],
  flowers: () => [box(0.92, 0.1, 0.92, '#8f8678', 0.5, 0, 0.5, { round: 0.03 }), box(0.82, 0.04, 0.82, '#4a3a2a', 0.5, 0.1, 0.5),
    ...[[0.25, 0.25, '#e05a8a'], [0.7, 0.3, '#f2c14e'], [0.45, 0.55, '#ffffff'], [0.25, 0.75, '#b05ae0'], [0.72, 0.72, '#e05a8a'], [0.5, 0.2, '#ff8a3d'], [0.3, 0.5, '#f2c14e'], [0.7, 0.52, '#b05ae0']]
      .flatMap(([x, z, c]) => [cyl(0.012, 0.012, 0.12, '#3f7a35', x, 0.12, z), sph(0.06, c, x, 0.26, z)])],
  bush: () => [sph(0.32, '#3f8a3a', 0.5, 0.28, 0.5), sph(0.22, '#4f9c45', 0.66, 0.4, 0.4), sph(0.2, '#357a32', 0.35, 0.36, 0.62)],
  tree: () => [cyl(0.05, 0.08, 0.7, '#6b4a2b', 0.5, 0, 0.5), sph(0.42, '#2f7a34', 0.5, 1.05, 0.5), sph(0.3, '#3a8a3e', 0.68, 1.3, 0.42), sph(0.28, '#2a6e30', 0.36, 1.25, 0.6)],
  lamp: () => [cyl(0.025, 0.04, 1.3, '#4a4f58', 0.5, 0, 0.5, { mat: METAL }), box(0.26, 0.04, 0.1, '#33363d', 0.62, 1.3, 0.5, { mat: METAL }),
    box(0.16, 0.02, 0.07, '#fff3c4', 0.68, 1.28, 0.5, { mat: GLOW('#ffd36b') })],
  flag: () => [cyl(0.02, 0.03, 1.7, '#d0d4da', 0.5, 0, 0.5, { mat: METAL }), box(0.5, 0.3, 0.015, '#d94a4a', 0.76, 1.36, 0.5), box(0.5, 0.05, 0.016, '#ffffff', 0.76, 1.48, 0.5)],
  statue: () => [box(0.5, 0.3, 0.5, '#b7b2a8', 0.5, 0, 0.5, { round: 0.03 }), part(new THREE.TorusKnotGeometry(0.16, 0.05, 64, 8), '#c9a64a', 0.5, 0.62, 0.5, { mat: METAL })],
  fountain: () => [cyl(0.9, 0.95, 0.22, '#d2cdc0', 1, 0, 1, { seg: 32 }), cyl(0.82, 0.82, 0.04, '#5aa8d9', 1, 0.19, 1, { seg: 32, mat: WATER }),
    cyl(0.1, 0.13, 0.55, '#d2cdc0', 1, 0.2, 1), cyl(0.34, 0.2, 0.08, '#d2cdc0', 1, 0.72, 1, { seg: 20 }), part(coneG(0.16, 0.5, 12), '#bfe3f5', 1, 1.0, 1, { mat: WATER })],
  info: () => [box(0.8, 0.36, 0.4, '#3d8fd6', 0.5, 0, 0.5, { round: 0.04 }), cyl(0.025, 0.025, 0.9, '#cfd4da', 0.5, 0, 0.78, { mat: METAL }),
    box(0.4, 0.4, 0.04, '#ffc72c', 0.5, 0.7, 0.78), box(0.14, 0.2, 0.045, '#1c1f24', 0.5, 0.8, 0.78)],
  screen: () => [cyl(0.03, 0.03, 0.7, '#5a6474', 0.5, 0, 0.5, { mat: METAL }), box(0.8, 0.4, 0.05, '#0d1420', 0.5, 0.62, 0.5),
    box(0.74, 0.34, 0.055, '#ffc72c', 0.5, 0.65, 0.5, { mat: { emissive: '#ffb000', emissiveIntensity: 0.35, color: '#1c2638' } })],
  kiosk: () => [box(0.8, 0.5, 0.8, '#e06a3a', 0.5, 0, 0.5, { round: 0.04 }), box(0.95, 0.05, 0.95, '#f5f1e8', 0.5, 0.5, 0.5), box(0.6, 0.15, 0.04, '#ffc72c', 0.5, 0.3, 0.08, { mat: GLOW('#ffb000') })],
  toilets: () => [box(1.9, LEVEL_H * 0.9, 1.9, '#d6e6ea', 1, 0, 1), box(1.92, 0.04, 1.92, '#5aa0b5', 1, LEVEL_H * 0.9, 1),
    box(0.25, 0.25, 0.03, '#5aa0b5', 0.6, 0.25, 1.96, { mat: GLOW('#2a90b0') }), box(0.25, 0.25, 0.03, '#d96a8a', 1.4, 0.25, 1.96, { mat: GLOW('#c04070') })],
  checkin: () => [box(0.75, 0.32, 0.38, '#2f5fc4', 0.5, 0, 0.35, { round: 0.03 }), box(0.75, 0.32, 0.38, '#2f5fc4', 1.5, 0, 0.35, { round: 0.03 }),
    box(1.8, 0.08, 0.22, '#4a4f58', 1, 0, 0.82), box(1.8, 0.24, 0.03, '#1c1f24', 1, 0.62, 0.12), box(1.7, 0.18, 0.035, '#ffc72c', 1, 0.65, 0.12, { mat: { emissive: '#ffb000', emissiveIntensity: 0.4, color: '#2a3a5a' } }),
    cyl(0.025, 0.025, 0.62, '#cfd4da', 0.15, 0, 0.12, { mat: METAL }), cyl(0.025, 0.025, 0.62, '#cfd4da', 1.85, 0, 0.12, { mat: METAL })],
  baggage: () => [box(2.8, 0.22, 0.62, '#59606e', 1.5, 0, 0.5, { round: 0.06 }), box(2.6, 0.03, 0.42, '#1d1f24', 1.5, 0.22, 0.5),
    ...[[0.6, '#d94a4a'], [1.2, '#3d6fd6'], [1.9, '#2b2e35'], [2.4, '#e8c547']].map(([x, c]) => box(0.22, 0.16, 0.13, c, x, 0.25, 0.5, { round: 0.02 }))],
  security: () => [flat(3, 2, '#8a93a3', 1.5, 1, 0.045), ...[0.5, 1.5, 2.5].flatMap(x => [box(0.07, 0.48, 0.5, '#e8ebef', x - 0.28, 0, 0.55), box(0.07, 0.48, 0.5, '#e8ebef', x + 0.28, 0, 0.55),
    box(0.63, 0.08, 0.5, '#e8ebef', x, 0.48, 0.55), box(0.36, 0.32, 0.85, '#3a3e46', x, 0, 1.45, { round: 0.03 }), box(0.2, 0.06, 0.03, '#3ddc84', x, 0.42, 0.31, { mat: GLOW('#3ddc84') })])],
  lounge: (w, d) => [flat(w, d, '#6b4a8a', w / 2, d / 2, 0.045), ...[[0.7, 0.7], [2.2, 0.7], [0.7, 2.2], [2.2, 2.2]].flatMap(([x, z]) => [
    box(0.5, 0.18, 0.5, '#8a5ab0', x, 0, z, { round: 0.06 }), box(0.5, 0.2, 0.1, '#7a4aa0', x, 0.18, z + 0.22, { round: 0.04 })]),
    cyl(0.25, 0.25, 0.04, '#f2e6d0', w / 2, 0.22, d / 2), cyl(0.04, 0.04, 0.22, '#555', w / 2, 0, d / 2)],
  shops: (w, d) => [box(w, LEVEL_H * 0.9, d, '#f3efe6', w / 2, 0, d / 2), box(w - 0.3, LEVEL_H * 0.55, 0.03, '#bfe4f7', w / 2, 0.05, d + 0.01, { mat: GLASS }),
    box(w, 0.06, 0.4, '#e0a43a', w / 2, LEVEL_H * 0.72, d + 0.2), box(w - 0.6, 0.12, 0.04, '#ffc72c', w / 2, LEVEL_H * 0.78, d + 0.02, { mat: GLOW('#ffb000') })],
  food: (w, d) => [box(w, LEVEL_H * 0.9, d * 0.45, '#f5ead8', w / 2, 0, d * 0.22), box(w, 0.06, 0.4, '#d9822b', w / 2, LEVEL_H * 0.75, d * 0.47),
    ...[[0.6, 1.8], [1.5, 2.3], [2.4, 1.8], [0.9, 2.6], [2.1, 2.6]].flatMap(([x, z]) => [cyl(0.17, 0.17, 0.03, '#f2f2f2', x, 0.24, z), cyl(0.025, 0.025, 0.24, '#555', x, 0, z),
      box(0.12, 0.13, 0.12, '#a8693a', x + 0.24, 0, z), box(0.12, 0.13, 0.12, '#a8693a', x - 0.24, 0, z)])],
  cafe: (w, d) => [box(w * 0.7, LEVEL_H * 0.8, d * 0.4, '#a8693a', w * 0.35, 0, d * 0.2, { round: 0.04 }), box(w * 0.7, 0.05, 0.3, '#f2e6d0', w * 0.35, LEVEL_H * 0.7, d * 0.42),
    ...[[1.4, 0.9], [0.6, 1.5], [1.4, 1.6]].flatMap(([x, z]) => [part(coneG(0.32, 0.14, 10), '#d94a4a', x, 0.62, z), cyl(0.015, 0.015, 0.55, '#ddd', x, 0, z), cyl(0.14, 0.14, 0.03, '#fff', x, 0.24, z)])],
  // Prefab and airside buildings.
  terminal_s: (w, d) => [box(w, 0.12, d, '#d8d3c8', w / 2, 0, d / 2), box(w - 0.4, 1.4, d - 0.4, '#a7d6f2', w / 2, 0.12, d / 2, { mat: GLASS }),
    box(w - 0.5, 0.05, d - 0.5, '#e6e0d3', w / 2, 0.75, d / 2), ...[1, 3, 5, 7].map(x => box(0.12, 1.4, 0.12, '#9aa1ab', x, 0.12, d - 0.22, { mat: METAL })),
    box(w + 0.6, 0.18, d + 0.6, '#eef0f3', w / 2, 1.52, d / 2, { round: 0.06 }), box(w * 0.4, 0.3, d * 0.3, '#b8bec8', w / 2, 1.7, d / 2, { round: 0.05 }),
    box(2.6, 0.06, 1.2, '#eef0f3', w / 2, 1.0, d + 0.3), box(1.8, 0.22, 0.04, '#ffc72c', w / 2, 1.18, d + 0.33, { mat: GLOW('#ffb000') })],
  terminal_l: (w, d) => [box(w, 0.15, d, '#d8d3c8', w / 2, 0, d / 2), box(w - 0.6, 2.4, d - 0.6, '#9fd0ee', w / 2, 0.15, d / 2, { mat: GLASS }),
    box(w - 0.8, 0.06, d - 0.8, '#e6e0d3', w / 2, 1.2, d / 2),
    part(cylG(d * 0.62, d * 0.62, w + 0.8, 40, Math.PI), '#f1f3f6', w / 2, 2.55, d / 2, { rz: Math.PI / 2, s: [0.2, 1, 1], mat: { metalness: 0.4, roughness: 0.35 } }),
    ...[1.5, 4.5, 7.5, 10.5, 13.5, 16.5, 19].map(x => cyl(0.12, 0.12, 2.4, '#d0d4da', x, 0.15, d + 0.1, { mat: METAL })),
    ...[3, 5, 7].map(z => box(w - 2, 0.05, 0.45, '#9fd0ee', w / 2, 3.65 - Math.abs(z - 5) * 0.12, z, { mat: GLASS })),
    box(6, 0.3, 0.05, '#ffc72c', w / 2, 2.1, d + 0.02, { mat: GLOW('#ffb000') })],
  tower: () => [box(1.6, 0.9, 1.6, '#c9ced8', 1, 0, 1, { round: 0.08 }), cyl(0.32, 0.42, 4.6, '#e3e7ed', 1, 0.9, 1, { seg: 20 }),
    cyl(0.6, 0.38, 0.35, '#d0d4da', 1, 5.3, 1, { seg: 8 }), cyl(0.85, 0.62, 0.7, '#294c6e', 1, 5.65, 1, { seg: 8, mat: TINT }),
    cyl(0.95, 0.95, 0.12, '#f1f3f6', 1, 6.35, 1, { seg: 8 }), cyl(0.025, 0.025, 1.0, '#cfd4da', 1, 6.47, 1, { mat: METAL }), sph(0.06, '#ff3b30', 1, 7.5, 1, { mat: GLOW('#ff3b30') })],
  ils: () => [flat(4, 1, '#c9bfa8', 2, 0.5, 0.03), ...[0.4, 1.2, 2, 2.8, 3.6].flatMap(x => [cyl(0.03, 0.03, 0.5, '#d9dde4', x, 0, 0.5, { mat: METAL }), box(0.5, 0.06, 0.06, '#e85d3a', x, 0.5, 0.5)]),
    box(0.4, 0.3, 0.3, '#e8ebef', 3.8, 0, 0.8)],
  weather: () => [cyl(0.02, 0.02, 1.2, '#d0d4da', 0.5, 0, 0.5, { mat: METAL }), part(coneG(0.08, 0.5, 10), '#f08a3c', 0.75, 1.15, 0.5, { rz: Math.PI / 2 }),
    box(0.3, 0.25, 0.25, '#f2f2f2', 0.3, 0, 0.3), cyl(0.12, 0.12, 0.02, '#9aa1ab', 0.5, 0.9, 0.5)],
  fire: (w, d) => [box(w, 1.3, d, '#c23b32', w / 2, 0, d / 2, { round: 0.05 }), box(w + 0.1, 0.1, d + 0.1, '#f2f2f2', w / 2, 1.3, d / 2),
    ...[0.75, 2, 3.25].map(x => box(0.95, 1.0, 0.04, '#e8e8e8', x, 0, d + 0.01)), box(1.6, 0.3, 0.04, '#ffffff', w / 2, 1.0, d + 0.02),
    box(0.55, 0.42, 1.2, '#e03a2c', 3.25, 0, d + 0.9, { round: 0.06 }), box(0.5, 0.18, 0.4, '#1b2a3a', 3.25, 0.42, d + 0.5, { mat: TINT })],
  fuel: (w, d) => [box(w, 0.15, d, '#9aa0a8', w / 2, 0, d / 2), ...[1.1, 2.9].flatMap(x => [cyl(0.85, 0.85, 1.3, '#eceef1', x, 0.15, d / 2, { seg: 28, mat: { metalness: 0.5, roughness: 0.3 } }),
    part(sphG(0.85, 20), '#eceef1', x, 1.45, d / 2, { s: [1, 0.22, 1] }), cyl(0.86, 0.86, 0.06, '#d94a4a', x, 0.9, d / 2, { seg: 28 })]),
    box(0.5, 0.35, 0.9, '#f2f2f2', w - 0.35, 0, 0.5)],
  deice: (w, d) => [pad(w, d), flat(w - 0.6, 0.12, '#5ab0e8', w / 2, 0.4, 0.05), flat(w - 0.6, 0.12, '#5ab0e8', w / 2, d - 0.4, 0.05),
    box(0.7, 0.5, 1.3, '#e8c547', w - 1.1, 0, 1.2, { round: 0.05 }), box(0.15, 1.1, 0.15, '#9aa0a8', w - 1.1, 0.5, 0.8, { mat: METAL }), box(0.45, 0.22, 0.38, '#4c86a8', w - 1.1, 1.6, 0.8)],
  hangar_s: (w, d) => hangar(w, d), hangar: (w, d) => hangar(w, d), hangar_l: (w, d) => hangar(w, d),
  gate_s: (w, d) => stand(w, d, false), gate_m: (w, d) => stand(w, d, true), gate_l: (w, d) => stand(w, d, true),
  stand_s: (w, d) => [...stand(w, d, false, true), box(0.6, 0.5, 0.6, '#c99422', w - 0.6, 0, d - 0.6)],
  stand_m: (w, d) => [...stand(w, d, false, true), box(0.8, 0.6, 0.8, '#c99422', w - 0.7, 0, d - 0.7), box(0.8, 0.6, 0.8, '#3d6fd6', w - 1.7, 0, d - 0.7)],
  stand_l: (w, d) => [...stand(w, d, false, true), ...[0.7, 1.7, 2.7].map((o, i) => box(0.8, 0.7, 0.8, ['#c99422', '#3d6fd6', '#d94a4a'][i], w - o, 0, d - 0.7))],
  cargo: (w, d) => [box(w, 1.8, d, '#c79a4a', w / 2, 0, d / 2), windows(w, d, w / 2, d / 2, 1.3, 0.14), box(w + 0.1, 0.12, d + 0.1, '#e8e2d2', w / 2, 1.8, d / 2),
    ...[1.5, 3.5, 5.5, 7.5].map(x => box(1.4, 1.2, 0.04, '#e8e2d2', x, 0, d + 0.01)), ...[1.5, 5.5].flatMap(x => car(x, d + 0.8, '#f2f2f2'))],
  cargo_hub: (w, d) => [box(w, 2.6, d, '#c9a050', w / 2, 0, d / 2), windows(w, d, w / 2, d / 2, 2.0, 0.18), box(w * 0.4, 1.0, d * 0.6, '#ddb862', w * 0.3, 2.6, d / 2),
    box(w + 0.1, 0.14, d + 0.1, '#e8e2d2', w / 2, 2.6, d / 2), ...[2, 5, 8, 11, 14].map(x => box(2, 1.7, 0.04, '#e8e2d2', x, 0, d + 0.01))],
  parking: (w, d) => [flat(w, d, '#ffffff', w / 2, d / 2, 0.025, { mat: { map: textures().asphalt } }),
    ...[1.5, 3, 4.5, 6, 7.5, 9].flatMap(x => [flat(0.05, 2.2, '#efefef', x, 1.4, 0.05), flat(0.05, 2.2, '#efefef', x, d - 1.4, 0.05)]),
    ...[[0.75, 1.4], [2.25, 1.4], [5.25, 1.4], [8.25, 1.4], [3.75, d - 1.4], [6.75, d - 1.4], [0.75, d - 1.4], [9.25, d - 1.4]].flatMap(([x, z], i) => car(x, z, CARS[i % CARS.length])),
    ...[2, 5, 8].map(x => cyl(0.02, 0.03, 1.1, '#4a4f58', x, 0, d / 2, { mat: METAL }))],
  busstop: (w, d) => [flat(w, d, '#c9bfa8', w / 2, d / 2, 0.03), box(w - 0.4, 0.05, 0.6, '#3d8f5a', w / 2, 0.5, 0.4), box(w - 0.4, 0.45, 0.03, '#bfe4f7', w / 2, 0.05, 0.1, { mat: GLASS }),
    box(0.04, 0.5, 0.04, '#5a6474', 0.25, 0, 0.7, { mat: METAL }), box(0.04, 0.5, 0.04, '#5a6474', w - 0.25, 0, 0.7, { mat: METAL }), box(w - 0.8, 0.06, 0.18, '#8a6a4a', w / 2, 0.15, 0.25)],
  hotel: (w, d) => [box(w - 1, 5.6, d - 1, '#d4a27a', w / 2, 0, d / 2), ...[0.8, 1.6, 2.4, 3.2, 4.0, 4.8].map(y => windows(w - 1, d - 1, w / 2, d / 2, y, 0.32)),
    box(w - 0.7, 0.2, d - 0.7, '#ece4d8', w / 2, 5.6, d / 2), box(2.4, 0.5, 0.8, '#ece4d8', w / 2, 0, d - 0.2), box(2, 0.22, 0.04, '#ffc72c', w / 2, 5.3, d - 0.48, { mat: GLOW('#ffb000') })],
};
function hangar(w, d) {
  return [box(w, 1.8, d, '#8d96a6', w / 2, 0, d / 2), part(cylG(d / 2, d / 2, w, 32, Math.PI), '#aab2bf', w / 2, 1.8, d / 2, { rz: Math.PI / 2, s: [0.42, 1, 1], mat: { metalness: 0.55, roughness: 0.38 } }),
    box(w - 1.2, 1.7, 0.04, '#c7ccd4', w / 2, 0, d + 0.01, { mat: METAL }), ...Array.from({ length: Math.floor(w / 2) }, (_, i) => box(0.03, 1.7, 0.05, '#9aa1ab', 1 + i * 2, 0, d + 0.02)),
    flat(w - 1.2, 0.08, '#e8c547', w / 2, d - 0.1, 0.05)];
}

// Aircraft by size: S = turboprop, M = narrow-body, L = wide-body. Nose points to −z; livery = airline colour.
export function aircraftParts(size, livery) {
  const L = { S: 1.6, M: 3.6, L: 6.2 }[size], r = { S: 0.11, M: 0.2, L: 0.32 }[size], span = { S: 1.9, M: 3.4, L: 6.0 }[size];
  const y = r + 0.12, out = [
    part(capG(r, L), '#f4f5f7', 0, y, 0, { rx: Math.PI / 2, mat: { metalness: 0.3, roughness: 0.35 } }),
    part(boxG(span, 0.04, L * 0.18), '#e9ecef', 0, y - r * 0.2, L * 0.05, { mat: { metalness: 0.3, roughness: 0.4 } }),
    part(boxG(span * 0.36, 0.03, L * 0.1), '#e9ecef', 0, y + r * 0.2, L * 0.46),
    part(boxG(0.04, r * 2.4, L * 0.16), livery, 0, y + r * 1.4, L * 0.45),
    part(boxG(r * 2.02, r * 0.35, L * 0.85), livery, 0, y + r * 0.1, 0, { s: [1, 1, 1] }),
    part(boxG(r * 1.4, r * 0.35, L * 0.06), '#1b2a3a', 0, y + r * 0.55, -L * 0.48, { mat: TINT }),
  ];
  const eng = size === 'S' ? [[-span * 0.28, 0], [span * 0.28, 0]] : size === 'M' ? [[-span * 0.3, 0], [span * 0.3, 0]] : [[-span * 0.25, 0], [span * 0.25, 0], [-span * 0.4, 0.1], [span * 0.4, 0.1]];
  for (const [x, dz] of eng) out.push(part(cylG(r * 0.5, r * 0.45, L * 0.18, 14), '#c8ccd2', x, y - r * 0.55, L * (dz - 0.02), { rx: Math.PI / 2, mat: METAL }));
  if (size === 'S') for (const [x] of eng) out.push(part(boxG(0.5, 0.02, 0.04), '#2b2e35', x, y - r * 0.55, -L * 0.12));
  return out;
}

// Turns a part list into a Group (for previews, ghosts and one-off objects).
export function groupOf(parts, material) {
  const g = new THREE.Group();
  for (const p of parts) {
    const m = new THREE.Mesh(p.geo, material || p.mat);
    m.applyMatrix4(p.m);
    m.castShadow = !material && p.shadow;
    m.receiveShadow = !material;
    g.add(m);
  }
  return g;
}
