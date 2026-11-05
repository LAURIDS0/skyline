// 3D airport editor. 1 tile = 10 m = 1 scene unit; grid y maps to scene z; floors are LEVEL_H apart.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { api } from './api.js';
import { t, locale } from './i18n.js';
import { MODELS, LEVEL_H, runwayParts, aircraftParts, groupOf, mat, textures } from './models3d.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const money = n => '$' + Math.round(n).toLocaleString(locale());
const GROUP_ICON = { Infrastruktur: 'fa-plane-departure', Passagerer: 'fa-person-walking-luggage', Bygning: 'fa-building',
  Fragt: 'fa-boxes-stacked', Kommercielt: 'fa-store', 'Natur og pynt': 'fa-tree' };
const LEVELS = 4;
const CHAIN = [['area', 'Gulvareal'], ['checkin', 'Check-in'], ['security', 'Sikkerhed'], ['baggage', 'Bagage'], ['toilets', 'Toiletter'], ['seats', 'Siddepladser']];

// ---------- client mirror of backend/src/layout.js placement rules (the server still validates) ----------
const layersOf = (B, k) => (B[k].layer === 'ground' ? ['ground'] : B[k].access === 'air' || k === 'runway' || k === 'runway_ext' ? ['ground', 'object'] : ['object']);
const footprint = (B, p) => (p.r % 2 ? { w: B[p.t].h, h: B[p.t].w } : { w: B[p.t].w, h: B[p.t].h });
function occupancy(B, s, layout) {
  const key = (z, l, x, y) => (((z * 2 + (l === 'ground' ? 0 : 1)) * s.h + y) * s.w) + x;
  const cells = new Map(), edges = new Map();
  const fill = (z, l, x, y, w, h, v) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) cells.set(key(z, l, i, j), v); };
  for (const l of ['ground', 'object']) { fill(0, l, s.runway.x, s.runway.y, s.runway.w, s.runway.h, -1); fill(0, l, s.road.x, s.road.y, s.road.w, s.road.h, -2); }
  layout.forEach((p, i) => {
    if (B[p.t].layer === 'edge') return edges.set(`${p.z || 0}:${p.r & 1}:${p.x}:${p.y}`, i);
    const f = footprint(B, p);
    for (const l of layersOf(B, p.t)) fill(p.z || 0, l, p.x, p.y, f.w, f.h, i);
  });
  const floorAt = (z, x, y) => { const i = cells.get(key(z, 'ground', x, y)); return i >= 0 && layout[i].t === 'floor'; };
  return { cells, edges, key, floorAt };
}
function fitError(B, s, occ, counts, layoutLen, type, x, y, r, z) {
  const b = B[type];
  if (z > 0 && !b.levels) return 'Kan ikke bygges på denne etage';
  if (b.max && (counts[type] || 0) >= b.max) return 'Maksimum nået for denne bygning';
  if (b.layer === 'edge') {
    const hor = !(r & 1);
    if (x < 0 || y < 0 || x > s.w - (hor ? 1 : 0) || y > s.h - (hor ? 0 : 1)) return 'Uden for området';
    return occ.edges.has(`${z}:${r & 1}:${x}:${y}`) ? 'Feltet er optaget' : null;
  }
  const f = footprint(B, { t: type, r });
  if (x < 0 || y < 0 || x + f.w > s.w || y + f.h > s.h) return 'Uden for området';
  if (['stairs', 'escalator', 'elevator'].includes(type) && z >= LEVELS - 1) return 'Kan ikke bygges på denne etage';
  const ls = layersOf(B, type);
  for (let j = y; j < y + f.h; j++) for (let i = x; i < x + f.w; i++) {
    if (ls.some(l => occ.cells.has(occ.key(z, l, i, j)))) return 'Feltet er optaget';
    if (z > 0 && !occ.floorAt(b.layer === 'ground' ? z - 1 : z, i, j)) return b.layer === 'ground' ? 'Gulvet skal stå på et gulv nedenunder' : 'Skal stå på et gulv';
  }
  return null;
}
const countTypes = layout => layout.reduce((c, p) => ((c[p.t] = (c[p.t] || 0) + 1), c), {});

// ---------- palette thumbnails (rendered once per session) ----------
const thumbs = new Map();
let thumbKit;
function thumbnail(B, type) {
  if (thumbs.has(type)) return thumbs.get(type);
  if (!thumbKit) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(112, 112);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    scene.add(new THREE.HemisphereLight('#ffffff', '#667755', 1.2));
    const sun = new THREE.DirectionalLight('#fff4e0', 2); sun.position.set(3, 6, 4); scene.add(sun);
    thumbKit = { renderer, scene, camera: new THREE.PerspectiveCamera(30, 1, 0.01, 500) };
  }
  const { renderer, scene, camera } = thumbKit, b = B[type];
  const big = Math.max(b.w, b.h) > 30;
  const parts = (MODELS[type] || (() => []))(big ? Math.min(b.w, 20) : b.w, b.h);
  const g = groupOf(parts);
  scene.add(g);
  const bb = new THREE.Box3().setFromObject(g), c = bb.getCenter(new THREE.Vector3()), size = bb.getSize(new THREE.Vector3()).length() || 1;
  camera.position.set(c.x + size * 0.9, c.y + size * 0.8, c.z + size * 1.1);
  camera.lookAt(c);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL();
  scene.remove(g);
  thumbs.set(type, url);
  return url;
}

// ---------- the editor ----------
export function openBuilder(el, { airport, catalog, onChange, toast, fleet = [], color = '#ffc72c' }) {
  const B = catalog.BUILDINGS, s = airport.site;
  const ST = { layout: airport.layout, airport, tool: 'floor', mode: 'build', r: 0, group: 'Bygning', query: '', grid: true,
    level: 0, roofs: false, layer: 'all', hover: null, hoverPt: null, drag: null, busy: false, shift: false };

  el.innerHTML = `<div class="ed">
    <header class="ed-top">
      <div class="ed-sign"><span>${esc(airport.iata || airport.ident)}</span><b>${esc(airport.name)}</b></div>
      <div class="ed-kpis" id="ed-kpis"></div>
      <div class="ed-view">
        <button data-act="top" title="${t('Topvisning')} (T)"><i class="fa-solid fa-map"></i></button>
        <button data-act="grid" class="on" title="${t('Gitter')} (G)"><i class="fa-solid fa-border-all"></i></button>
        <button data-act="close" class="ed-close" aria-label="${t('Luk')}"><i class="fa-solid fa-xmark"></i></button>
      </div>
    </header>
    <aside class="ed-palette">
      <div class="ed-search"><i class="fa-solid fa-magnifying-glass"></i><input id="ed-q" placeholder="${t('Søg efter element …')}" autocomplete="off"></div>
      <nav class="ed-cats" id="ed-cats"></nav>
      <div class="ed-items" id="ed-items"></div>
      <div class="ed-detail" id="ed-detail"></div>
    </aside>
    <div class="ed-stage" id="ed-stage">
      <div class="ed-levels" id="ed-levels"></div>
      <aside class="ed-inspector" id="ed-inspector"></aside>
      <div class="ed-tip" id="ed-tip" hidden></div>
      <div class="ed-toolbar">
        <button data-act="build" class="on"><i class="fa-solid fa-trowel-bricks"></i> ${t('Byg')} <kbd>B</kbd></button>
        <button data-act="demolish"><i class="fa-solid fa-eraser"></i> ${t('Nedriv')} <kbd>X</kbd></button>
        <span class="ed-layers" id="ed-layers" hidden></span>
        <button data-act="rotate"><i class="fa-solid fa-rotate-right"></i> <span id="ed-rot">0°</span> <kbd>R</kbd></button>
        <span class="ed-hint">${t('WASD: flyt · Q/E: drej · scroll: zoom · højreklik-træk: se rundt · Shift: rum/hurtig')}</span>
      </div>
    </div>
  </div>`;
  el.hidden = false;
  const $ = q => el.querySelector(q);
  const stage = $('#ed-stage');

  // ----- renderer, scene, environment -----
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  stage.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.fog = new THREE.Fog('#cfe3f2', 160, 520);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color('#5d9bd6') }, horizon: { value: new THREE.Color('#d9ecf8') } },
    vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying float h; void main(){ gl_FragColor = vec4(mix(horizon, top, pow(max(h,0.0),0.6)),1.0); }',
  }));
  scene.add(sky);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.2, 2500);

  scene.add(new THREE.HemisphereLight('#e2f0ff', '#56683a', 0.7));
  const sun = new THREE.DirectionalLight('#fff1d8', 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const T = textures();
  const grassOut = T.grass.clone(); grassOut.repeat.set(s.w, s.h * 2); grassOut.needsUpdate = true;
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(s.w * 3, s.h * 5), mat('#7f9e66', { map: grassOut }));
  outside.rotation.x = -Math.PI / 2; outside.position.set(s.w / 2, -0.03, s.h / 2); outside.receiveShadow = true;
  const grassIn = T.grass.clone(); grassIn.repeat.set(s.w / 3, s.h / 3); grassIn.needsUpdate = true;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), mat('#ffffff', { map: grassIn }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(s.w / 2, 0, s.h / 2); ground.receiveShadow = true;
  scene.add(outside, ground);

  // Fixed main runway, access road, perimeter fence and scenery outside the fence.
  const fixed = groupOf(runwayParts(s.runway.w, s.runway.h, [1.5]));
  fixed.position.set(s.runway.x, 0, s.runway.y);
  const road = groupOf([
    ...MODELS.road().slice(0, 1).map(p => ({ ...p, m: p.m.clone().premultiply(new THREE.Matrix4().makeScale(s.road.w, 1, s.road.h)) })),
    ...Array.from({ length: Math.floor(s.road.w / 3) }, (_, i) => ({ ...MODELS.road()[1], m: new THREE.Matrix4().makeTranslation(i * 3 + 1.5, 0.05, s.road.h / 2) })),
  ]);
  road.position.set(0, 0, s.road.y);
  scene.add(fixed, road);
  const fenceMat = mat('#9aa1ab', { metalness: 0.6, roughness: 0.4 });
  for (const [x, z, w, d] of [[s.w / 2, -0.1, s.w, 0.03], [s.w / 2, s.h + 0.1, s.w, 0.03], [-0.1, s.h / 2, 0.03, s.h], [s.w + 0.1, s.h / 2, 0.03, s.h]]) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(w, 0.25, d), new THREE.MeshStandardMaterial({ color: '#c8ccd2', transparent: true, opacity: 0.5 }));
    f.position.set(x, 0.18, z); scene.add(f);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(w || 0.03, 0.02, d || 0.03), fenceMat); rail.position.set(x, 0.32, z); scene.add(rail);
  }
  {
    const treeParts = MODELS.tree(), rand = mulberry(airport.id);
    const spots = [];
    for (let i = 0; i < 420; i++) {
      const side = rand() < 0.5, x = rand() * s.w * 1.6 - s.w * 0.3, z = side ? -4 - rand() * 60 : s.h + 4 + rand() * 60;
      spots.push([x, z, 0.8 + rand() * 1.4]);
    }
    for (const p of treeParts) {
      const im = new THREE.InstancedMesh(p.geo, p.mat, spots.length);
      spots.forEach(([x, z, k], i) => im.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, 0, z).multiply(new THREE.Matrix4().makeScale(k, k, k)).multiply(p.m)));
      im.castShadow = true; im.frustumCulled = false; scene.add(im);
    }
  }

  // Grid lines on the current level.
  const gridLines = new THREE.Group();
  for (const [step, opacity] of [[1, 0.08], [10, 0.22]]) {
    const pts = [];
    for (let x = 0; x <= s.w; x += step) pts.push(x, 0.07, 0, x, 0.07, s.h);
    for (let z = 0; z <= s.h; z += step) pts.push(0, 0.07, z, s.w, 0.07, z);
    gridLines.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)),
      new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity, depthWrite: false })));
  }
  scene.add(gridLines);

  // ----- camera: WASD + Q/E + wheel + right-drag -----
  const cam = { target: new THREE.Vector3(Math.min(60, s.w / 2), 0, Math.min(40, s.h / 2)), yaw: 0.5, pitch: 0.85, dist: 70 };
  const keys = new Set();
  const applyCam = () => {
    cam.pitch = Math.min(1.53, Math.max(0.18, cam.pitch));
    cam.dist = Math.min(Math.max(s.w, s.h) * 1.3, Math.max(3, cam.dist));
    cam.target.x = Math.min(s.w, Math.max(0, cam.target.x));
    cam.target.z = Math.min(s.h, Math.max(0, cam.target.z));
    cam.target.y += (ST.level * LEVEL_H - cam.target.y) * 0.2;
    const cp = Math.cos(cam.pitch);
    camera.position.set(cam.target.x + Math.sin(cam.yaw) * cp * cam.dist, cam.target.y + Math.sin(cam.pitch) * cam.dist, cam.target.z + Math.cos(cam.yaw) * cp * cam.dist);
    camera.lookAt(cam.target);
    // Shadows follow the camera so they stay sharp on a large site.
    const r = Math.min(180, Math.max(25, cam.dist * 1.1));
    Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 500 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.position.set(cam.target.x - 60, 140, cam.target.z - 80);
    sun.target.position.copy(cam.target);
  };
  const moveCam = dt => {
    const sp = cam.dist * 0.9 * dt * (keys.has('shift') ? 3 : 1);
    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw), rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
    if (keys.has('w')) { cam.target.x += fx * sp; cam.target.z += fz * sp; }
    if (keys.has('s')) { cam.target.x -= fx * sp; cam.target.z -= fz * sp; }
    if (keys.has('d')) { cam.target.x += rx * sp; cam.target.z += rz * sp; }
    if (keys.has('a')) { cam.target.x -= rx * sp; cam.target.z -= rz * sp; }
    if (keys.has('q')) cam.yaw += 1.6 * dt;
    if (keys.has('e')) cam.yaw -= 1.6 * dt;
    if (keys.has('z') || keys.has('+')) cam.dist *= 1 - dt * 1.5;
    if (keys.has('c') || keys.has('-')) cam.dist *= 1 + dt * 1.5;
  };
  const canvas = renderer.domElement;
  canvas.addEventListener('wheel', e => { e.preventDefault(); cam.dist *= Math.exp(e.deltaY * 0.0012); }, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  let look = null;

  // ----- items -----
  const itemsGroup = new THREE.Group(), extras = new THREE.Group();
  scene.add(itemsGroup, extras);
  const modelCache = {};
  const partsFor = type => modelCache[type] ??= (MODELS[type] || (() => [{ geo: new THREE.BoxGeometry(B[type].w, 0.5, B[type].h), mat: mat(B[type].color), shadow: true, m: new THREE.Matrix4().makeTranslation(B[type].w / 2, 0.25, B[type].h / 2) }]))(B[type].w, B[type].h);
  const itemMatrix = p => {
    const b = B[p.t], y = (p.z || 0) * LEVEL_H;
    if (b.layer === 'edge') {
      const m = new THREE.Matrix4().makeTranslation(p.x, y, p.y);
      return p.r & 1 ? m.multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2)) : m;
    }
    const f = footprint(B, p);
    return new THREE.Matrix4().makeTranslation(p.x + f.w / 2, y, p.y + f.h / 2)
      .multiply(new THREE.Matrix4().makeRotationY(-(p.r || 0) * Math.PI / 2)).multiply(new THREE.Matrix4().makeTranslation(-b.w / 2, 0, -b.h / 2));
  };
  const tmp = new THREE.Matrix4();
  const instanced = (parts, mats) => {
    for (const pt of parts) {
      const im = new THREE.InstancedMesh(pt.geo, pt.mat, mats.length);
      mats.forEach((m, i) => im.setMatrixAt(i, tmp.multiplyMatrices(m, pt.m)));
      im.castShadow = pt.shadow; im.receiveShadow = true; im.frustumCulled = false;
      itemsGroup.add(im);
    }
  };
  function rebuildItems() {
    itemsGroup.children.forEach(m => m.dispose?.());
    itemsGroup.clear();
    extras.clear();
    const visible = ST.layout.filter(p => (p.z || 0) <= ST.level || ST.roofs);
    for (const [type, items] of Object.entries(Object.groupBy(visible, p => p.t))) instanced(partsFor(type), items.map(itemMatrix));
    // Slabs under upper floors, and automatic roofs over the top floor of every building.
    const floors = ST.layout.filter(p => p.t === 'floor'), has = new Set(floors.map(p => `${p.z || 0}:${p.x}:${p.y}`));
    const slab = { geo: new THREE.BoxGeometry(1, 0.08, 1), mat: mat('#cfd3d9'), shadow: true, m: new THREE.Matrix4().makeTranslation(0.5, -0.02, 0.5) };
    instanced([slab], floors.filter(p => p.z && (p.z <= ST.level || ST.roofs)).map(p => new THREE.Matrix4().makeTranslation(p.x, p.z * LEVEL_H, p.y)));
    const roof = { geo: new THREE.BoxGeometry(1, 0.06, 1), mat: mat('#e4e7eb', { roughness: 0.6 }), shadow: true, m: new THREE.Matrix4().makeTranslation(0.5, 0.03, 0.5) };
    instanced([roof], floors.filter(p => !has.has(`${(p.z || 0) + 1}:${p.x}:${p.y}`) && (ST.roofs || (p.z || 0) < ST.level))
      .map(p => new THREE.Matrix4().makeTranslation(p.x, ((p.z || 0) + 1) * LEVEL_H, p.y)));
    placeAircraft();
    gridLines.position.y = ST.level * LEVEL_H;
  }

  // Based aircraft stand at working gates/stands of a fitting class (largest first).
  function placeAircraft() {
    const why = new Map(ST.airport.stats?.why || []);
    const slots = ST.layout.map((p, i) => ({ p, i })).filter(({ p, i }) => /^(gate|stand)_/.test(p.t) && !why.has(i))
      .map(o => ({ ...o, size: o.p.t.slice(-1).toUpperCase(), cargo: o.p.t.startsWith('stand') }));
    const rank = { S: 0, M: 1, L: 2 };
    for (const a of [...fleet].sort((x, y) => rank[y.size] - rank[x.size])) {
      const slot = slots.filter(o => !o.used && o.cargo === a.cargo && rank[o.size] >= rank[a.size]).sort((x, y) => rank[x.size] - rank[y.size])[0];
      if (!slot) continue;
      slot.used = true;
      const g = groupOf(aircraftParts(a.size, color)), b = B[slot.p.t];
      g.applyMatrix4(itemMatrix(slot.p).multiply(new THREE.Matrix4().makeTranslation(b.w / 2, 0, b.h * 0.55)));
      extras.add(g);
    }
  }

  // ----- ambient traffic: arrivals/departures on the main runway, cars on the access road -----
  const liner = groupOf(aircraftParts(airport.type === 'small_airport' ? 'S' : airport.type === 'large_airport' ? 'L' : 'M', '#2f5fc4'));
  liner.rotation.y = -Math.PI / 2; // nose along +x
  scene.add(liner);
  const cars = Array.from({ length: 10 }, (_, i) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.14, 0.22), mat(['#d94a4a', '#3d6fd6', '#f2f2f2', '#2b2e35', '#e8c547'][i % 5], { metalness: 0.4, roughness: 0.35 })));
    g.children[0].position.y = 0.1; g.children[0].castShadow = true;
    scene.add(g);
    return { g, x: (i / 10) * s.w, lane: i % 2, speed: 6 + (i % 3) * 2 };
  });
  const animateTraffic = (time, dt) => {
    const len = s.runway.w, y0 = s.runway.y + s.runway.h / 2, cycle = 40, k = (time / 1000) % cycle / cycle;
    // 0–0.45: approach & landing roll; 0.5–0.95: take-off roll & climb (other direction).
    let x, alt, vis = true;
    if (k < 0.45) { const u = k / 0.45; x = s.runway.x - 90 + u * (len * 0.6 + 90); alt = Math.max(0, (1 - u / 0.55)) * 8; liner.rotation.y = -Math.PI / 2; }
    else if (k > 0.5 && k < 0.95) { const u = (k - 0.5) / 0.45; x = s.runway.x + len * 0.95 - u * (len + 90); alt = Math.max(0, (u - 0.45) / 0.55) * 10; liner.rotation.y = Math.PI / 2; }
    else vis = false;
    liner.visible = vis;
    if (vis) liner.position.set(x, alt, y0);
    for (const c of cars) {
      c.x = (c.x + c.speed * dt * (c.lane ? 1 : -1) + s.w) % s.w;
      c.g.position.set(c.x, 0, s.road.y + (c.lane ? 0.9 : 2.1));
    }
  };

  // ----- picking -----
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  const pick = e => {
    const r = canvas.getBoundingClientRect();
    ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ndc, camera);
    plane.constant = -ST.level * LEVEL_H;
    if (!ray.ray.intersectPlane(plane, hit)) return null;
    return { x: hit.x, z: hit.z, cx: Math.floor(hit.x), cy: Math.floor(hit.z) };
  };
  const inSite = p => p && p.cx >= 0 && p.cy >= 0 && p.cx < s.w && p.cy < s.h;
  const rectOf = (a, b) => ({ x1: Math.min(a.cx, b.cx), y1: Math.min(a.cy, b.cy), x2: Math.max(a.cx, b.cx), y2: Math.max(a.cy, b.cy) });
  // Edge strokes: a straight line along the nearest grid line, or (Shift) the outline of a room.
  function edgeStroke(a, b) {
    if (ST.shift) {
      const rc = rectOf(a, b), out = [];
      for (let x = rc.x1; x <= rc.x2; x++) out.push([x, rc.y1, 0], [x, rc.y2 + 1, 0]);
      for (let y = rc.y1; y <= rc.y2; y++) out.push([rc.x1, y, 1], [rc.x2 + 1, y, 1]);
      return out;
    }
    if (Math.abs(b.x - a.x) >= Math.abs(b.z - a.z)) {
      const row = Math.round(a.z), x1 = Math.floor(Math.min(a.x, b.x)), x2 = Math.floor(Math.max(a.x, b.x)), out = [];
      for (let x = x1; x <= x2; x++) out.push([x, row, 0]);
      return out;
    }
    const col = Math.round(a.x), y1 = Math.floor(Math.min(a.z, b.z)), y2 = Math.floor(Math.max(a.z, b.z)), out = [];
    for (let y = y1; y <= y2; y++) out.push([col, y, 1]);
    return out;
  }

  // ----- ghost preview -----
  const ghostOk = new THREE.MeshStandardMaterial({ color: '#3ddc84', transparent: true, opacity: 0.55, emissive: '#1c8a4c', emissiveIntensity: 0.4, depthWrite: false });
  const ghostBad = new THREE.MeshStandardMaterial({ color: '#e5484d', transparent: true, opacity: 0.55, emissive: '#8a1c20', emissiveIntensity: 0.4, depthWrite: false });
  const ghost = new THREE.Group();
  scene.add(ghost);
  const ghostBox = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), ghostOk);
  function showGhost() {
    ghost.clear();
    const tip = $('#ed-tip'), b = B[ST.tool];
    const cur = ST.hoverPt;
    if (!cur || (ST.mode === 'build' && b.auto)) { tip.hidden = true; return; }
    const occ = occupancy(B, s, ST.layout), counts = countTypes(ST.layout), y0 = ST.level * LEVEL_H;
    let html = '';
    const addBox = (x, z, w, d, h, ok) => { const m = ghostBox.clone(); m.material = ok ? ghostOk : ghostBad; m.scale.set(w, h, d); m.position.set(x + w / 2, y0 + h / 2, z + d / 2); ghost.add(m); };
    if (ST.mode === 'demolish') {
      const rc = ST.drag ? rectOf(ST.drag.start, cur) : rectOf(cur, cur);
      addBox(rc.x1, rc.y1, rc.x2 - rc.x1 + 1, rc.y2 - rc.y1 + 1, 0.8, false);
      const hoverItem = itemAt(occ, cur);
      html = ST.drag ? t('Nedriv område') : hoverItem ? `${t('Nedriv')} ${t(B[hoverItem.p.t].name)} · +${money(B[hoverItem.p.t].cost * 0.25)}` : t('Ingenting her');
    } else if (b.layer === 'edge') {
      const list = ST.drag ? edgeStroke(ST.drag.start, cur) : edgeStroke(cur, cur);
      let n = 0;
      for (const [x, y, r] of list) {
        const ok = !fitError(B, s, occ, counts, ST.layout.length, ST.tool, x, y, r, ST.level);
        n += ok;
        addBox(r ? x - 0.06 : x, r ? y : y - 0.06, r ? 0.12 : 1, r ? 1 : 0.12, LEVEL_H, ok);
      }
      html = `${t(b.name)} · ${n} × ${money(b.cost)} = <b>${money(n * b.cost)}</b>`;
    } else if (b.paint && ST.drag) {
      const rc = rectOf(ST.drag.start, cur);
      let n = 0;
      for (let y = rc.y1; y <= rc.y2; y++) for (let x = rc.x1; x <= rc.x2; x++) n += !fitError(B, s, occ, counts, ST.layout.length, ST.tool, x, y, ST.r, ST.level);
      addBox(rc.x1, rc.y1, rc.x2 - rc.x1 + 1, rc.y2 - rc.y1 + 1, 0.15, n > 0);
      html = `${t(b.name)} · ${n} × ${money(b.cost)} = <b>${money(n * b.cost)}</b>`;
    } else {
      const r = b.rot ? ST.r : 0, err = fitError(B, s, occ, counts, ST.layout.length, ST.tool, cur.cx, cur.cy, r, ST.level);
      const g = groupOf(partsFor(ST.tool), err ? ghostBad : ghostOk);
      g.applyMatrix4(itemMatrix({ t: ST.tool, x: cur.cx, y: cur.cy, r, z: ST.level }));
      ghost.add(g);
      const hov = itemAt(occ, cur);
      html = `${t(b.name)} · <b>${money(b.cost)}</b>${err ? ` · <span class="bad">${t(err)}</span>` : ''}${hov ? `<br><small>${statusLine(hov)}</small>` : ''}`;
    }
    tip.innerHTML = html;
    tip.hidden = false;
  }
  function itemAt(occ, cur) {
    for (const l of ['object', 'ground']) {
      const i = occ.cells.get(occ.key(ST.level, l, cur.cx, cur.cy));
      if (i >= 0) return { p: ST.layout[i], i };
    }
    return null;
  }
  function statusLine({ p, i }) {
    const why = new Map(ST.airport.stats?.why || []).get(i);
    return `${t(B[p.t].name)}: ${why ? `<span class="bad">${t(why)}</span>` : `<span class="good">${t('Virker')}</span>`}`;
  }

  // ----- editing -----
  async function commit(path, body) {
    if (ST.busy) return;
    ST.busy = true;
    try {
      ({ layout: ST.layout } = await api(`/airports/${airport.id}/${path}`, body));
      ST.airport = (await onChange(airport.id)) || ST.airport;
      ST.layout = ST.airport.layout;
      rebuildItems();
      renderChrome();
    } catch (err) { toast(err.message, 'bad'); }
    ST.busy = false;
    showGhost();
  }
  canvas.addEventListener('pointerdown', e => {
    if (e.button === 2 || e.button === 1) { look = { x: e.clientX, y: e.clientY, pan: e.button === 1 }; canvas.setPointerCapture(e.pointerId); return; }
    if (e.button !== 0) return;
    const p = pick(e);
    if (!inSite(p)) return;
    canvas.setPointerCapture(e.pointerId);
    const b = B[ST.tool];
    if (ST.mode === 'demolish' || b.paint || b.layer === 'edge') ST.drag = { start: p };
    else if (!b.auto) commit('build', { type: ST.tool, x: p.cx, y: p.cy, r: ST.r, z: ST.level });
    showGhost();
  });
  canvas.addEventListener('pointermove', e => {
    if (look) {
      const dx = e.clientX - look.x, dy = e.clientY - look.y;
      look.x = e.clientX; look.y = e.clientY;
      if (look.pan) { const k = cam.dist * 0.0016; cam.target.x -= (Math.cos(cam.yaw) * dx + Math.sin(cam.yaw) * dy) * k; cam.target.z -= (-Math.sin(cam.yaw) * dx + Math.cos(cam.yaw) * dy) * k; }
      else { cam.yaw -= dx * 0.005; cam.pitch += dy * 0.004; }
      return;
    }
    const r = stage.getBoundingClientRect(), tip = $('#ed-tip');
    tip.style.left = `${e.clientX - r.left + 18}px`;
    tip.style.top = `${e.clientY - r.top + 18}px`;
    const p = pick(e);
    ST.hoverPt = inSite(p) ? p : null;
    showGhost();
  });
  canvas.addEventListener('pointerleave', () => { if (!ST.drag) { ST.hoverPt = null; showGhost(); } });
  canvas.addEventListener('pointerup', async e => {
    if (look && (e.button === 2 || e.button === 1)) { look = null; return; }
    if (e.button !== 0 || !ST.drag) return;
    const a = ST.drag.start, bpt = ST.hoverPt || a, b = B[ST.tool];
    ST.drag = null;
    if (ST.mode === 'demolish') return commit('demolish', { ...rectOf(a, bpt), z: ST.level, layer: ST.layer });
    const occ = occupancy(B, s, ST.layout), counts = countTypes(ST.layout);
    let cells;
    if (b.layer === 'edge') cells = edgeStroke(a, bpt).filter(([x, y, r]) => !fitError(B, s, occ, counts, 0, ST.tool, x, y, r, ST.level));
    else {
      const rc = rectOf(a, bpt);
      cells = [];
      for (let y = rc.y1; y <= rc.y2; y++) for (let x = rc.x1; x <= rc.x2; x++) if (!fitError(B, s, occ, counts, 0, ST.tool, x, y, ST.r, ST.level)) cells.push([x, y]);
    }
    if (!cells.length) return showGhost();
    if (cells.length > catalog.MAX_BATCH) return toast(t('For stort område – maks {n} felter ad gangen', { n: catalog.MAX_BATCH }), 'bad');
    commit('build', { type: ST.tool, cells, r: ST.r, z: ST.level });
  });

  // ----- chrome -----
  const flagsOf = b => [b.indoor && t('Indendørs'), b.levels && t('Kan stå på etager'), b.access === 'land' && t('Kræver vejadgang'),
    b.access === 'air' && t('Kræver taxivej'), b.access === 'both' && t('Kræver vej og taxivej'), b.paint && t('Mal med musen')].filter(Boolean);
  function renderChrome() {
    const st = ST.airport.stats || {}, g = st.gates || {}, sd = st.stands || {}, custom = st.custom;
    $('#ed-kpis').innerHTML = `
      <span><i class="fa-solid fa-ruler-horizontal"></i>${t('Bane {m} m', { m: ST.airport.runway_eff ?? ST.airport.runway_m })}</span>
      <span class="${st.paxUsed > st.pax ? 'bad' : ''}"><i class="fa-solid fa-users"></i>${Math.round(st.paxUsed || 0)}/${Math.round(st.pax || 0)} ${t('pax/t')}</span>
      <span class="${st.movUsed > st.movCap ? 'bad' : ''}"><i class="fa-solid fa-plane-arrival"></i>${(st.movUsed || 0).toFixed(1)}/${(st.movCap || 0).toFixed(1)} ${t('bev./t')}</span>
      <span class="${st.hangarUsed > st.hangar ? 'bad' : ''}"><i class="fa-solid fa-warehouse"></i>${st.hangarUsed || 0}/${st.hangar || 0} ${t('hangarpladser')}</span>
      <span><i class="fa-solid fa-heart"></i>${t('Komfort')} ${Math.round(st.comfort || 0)}</span>`;
    // Inspector: what works and what is holding the airport back.
    const issues = Object.entries(st.issues || {});
    const maxCap = custom ? Math.max(1, ...Object.values(custom.caps)) : 1;
    $('#ed-inspector').innerHTML = `
      <h4>${t('Passagerkapacitet')}</h4>
      <div class="ed-cap"><b>${Math.round(st.pax || 0)}</b><span>${t('pax/t')}</span></div>
      <p class="ed-sub">${t('Færdigbyggede terminaler')}: ${Math.round(st.prefabPax || 0)} · ${t('Egne bygninger')}: ${Math.round(custom?.cap || 0)}</p>
      ${custom?.counts.area ? `<div class="ed-chain">${CHAIN.map(([k, label]) => `<div class="${custom.bottleneck === k ? 'neck' : ''}">
        <span>${t(label)}</span><i style="width:${Math.min(100, custom.caps[k] / maxCap * 100)}%"></i><b>${Math.round(custom.caps[k])}</b></div>`).join('')}</div>
        <p class="ed-sub">${t('Flaskehals')}: <b>${t(CHAIN.find(c => c[0] === custom.bottleneck)?.[1] || '')}</b></p>`
        : `<p class="ed-sub">${t('Byg dit eget: gulv, vægge hele vejen rundt og en dør ud mod et fortov, der fører til vejen. Indret med check-in, sikkerhed, bagagebånd, toiletter og stole.')}</p>`}
      <h4>${t('Gates og stande')}</h4>
      <p class="ed-sub">${t('Virker')}: S${g.S || 0} M${g.M || 0} L${g.L || 0} · ${t('Fragt')}: S${sd.S || 0} M${sd.M || 0} L${sd.L || 0}</p>
      ${issues.length ? `<h4>${t('Problemer')}</h4><ul class="ed-issues">${issues.map(([k, n]) => `<li><i class="fa-solid fa-triangle-exclamation"></i>${t(k)} <b>×${n}</b></li>`).join('')}</ul>`
        : `<p class="ed-ok"><i class="fa-solid fa-circle-check"></i> ${t('Alt virker')}</p>`}`;
    $('#ed-levels').innerHTML = `${[3, 2, 1, 0].map(z => `<button data-level="${z}" class="${ST.level === z ? 'on' : ''}" title="${t('Etage {n}', { n: z })}">${z}</button>`).join('')}
      <button data-act="roofs" class="${ST.roofs ? 'on' : ''}" title="${t('Vis hele bygningen med tag')}"><i class="fa-solid fa-house"></i></button>`;
    const groups = [...new Set(Object.values(B).map(b => b.group))];
    $('#ed-cats').innerHTML = groups.map(g2 => `<button data-group="${esc(g2)}" class="${!ST.query && g2 === ST.group ? 'on' : ''}">
      <i class="fa-solid ${GROUP_ICON[g2] || 'fa-cube'}"></i><span>${t(g2)}</span></button>`).join('');
    const counts = countTypes(ST.layout), q = ST.query.toLowerCase();
    const list = Object.entries(B).filter(([, b]) => (q ? (t(b.name) + ' ' + t(b.desc)).toLowerCase().includes(q) : b.group === ST.group));
    $('#ed-items').innerHTML = list.map(([k, b]) => {
      const n = counts[k] || 0, full = b.max && n >= b.max, blocked = ST.level > 0 && !b.levels;
      return `<button class="ed-item ${ST.mode === 'build' && ST.tool === k ? 'on' : ''}" data-tool="${k}" ${full || (b.auto && !ST.airport.extSlot) || blocked ? 'disabled' : ''}>
        <img src="${thumbnail(B, k)}" alt="" loading="lazy"><b>${t(b.name)}</b><span>${money(b.cost)}${b.max ? ` · ${n}/${b.max}` : ''}</span></button>`;
    }).join('') || `<p class="ed-sub">${t('Ingen elementer matcher søgningen.')}</p>`;
    const b = B[ST.tool];
    $('#ed-detail').innerHTML = `<b>${t(b.name)}</b><p>${t(b.desc)}</p>
      <div class="ed-flags">${flagsOf(b).map(f => `<span>${f}</span>`).join('')}<span>${b.layer === 'edge' ? t('1 kant') : `${b.w * 10} × ${b.h * 10} m`}</span></div>
      ${b.auto ? `<button class="ed-go" data-act="auto">${t('Byg')} · ${money(b.cost)}</button>` : ''}`;
    el.querySelectorAll('[data-act=build],[data-act=demolish]').forEach(x => x.classList.toggle('on', x.dataset.act === ST.mode));
    $('[data-act=grid]').classList.toggle('on', ST.grid);
    $('#ed-rot').textContent = `${ST.r * 90}°`;
    const lay = $('#ed-layers');
    lay.hidden = ST.mode !== 'demolish';
    lay.innerHTML = [['all', 'Alt'], ['object', 'Objekter'], ['ground', 'Gulv og belægning'], ['edge', 'Vægge og døre']]
      .map(([k, l]) => `<button data-layer="${k}" class="${ST.layer === k ? 'on' : ''}">${t(l)}</button>`).join('');
  }

  const actions = {
    close,
    build: () => { ST.mode = 'build'; },
    demolish: () => { ST.mode = ST.mode === 'demolish' ? 'build' : 'demolish'; },
    rotate: () => { ST.r = (ST.r + 1) % 4; },
    grid: () => { ST.grid = !ST.grid; gridLines.visible = ST.grid; },
    top: () => { cam.pitch = cam.pitch > 1.4 ? 0.85 : 1.53; },
    roofs: () => { ST.roofs = !ST.roofs; rebuildItems(); },
    auto: () => commit('build', { type: ST.tool }),
    up: () => { ST.level = Math.min(LEVELS - 1, ST.level + 1); rebuildItems(); },
    down: () => { ST.level = Math.max(0, ST.level - 1); rebuildItems(); },
  };
  el.onclick = e => {
    const a = e.target.closest('[data-act]');
    if (a) { actions[a.dataset.act](); renderChrome(); showGhost(); return; }
    const lv = e.target.closest('[data-level]');
    if (lv) { ST.level = +lv.dataset.level; rebuildItems(); renderChrome(); return; }
    const ly = e.target.closest('[data-layer]');
    if (ly) { ST.layer = ly.dataset.layer; renderChrome(); return; }
    const g2 = e.target.closest('[data-group]');
    if (g2) { ST.group = g2.dataset.group; ST.query = ''; $('#ed-q').value = ''; renderChrome(); return; }
    const it = e.target.closest('[data-tool]');
    if (it) { ST.tool = it.dataset.tool; ST.mode = 'build'; renderChrome(); }
  };
  el.onmousemove = null;
  $('#ed-q').oninput = e => { ST.query = e.target.value.trim(); renderChrome(); };
  const SHORT = { r: 'rotate', x: 'demolish', b: 'build', g: 'grid', t: 'top', pageup: 'up', pagedown: 'down', ']': 'up', '[': 'down' };
  const onKey = e => {
    if (e.target.matches('input, textarea, select')) return;
    const k = e.key.toLowerCase();
    if (k === 'shift') { ST.shift = true; keys.add('shift'); showGhost(); return; }
    if (k === 'escape') { if (ST.drag) { ST.drag = null; showGhost(); } else close(); return; }
    if ('wasdqezc+-'.includes(k) && k.length === 1) { keys.add(k); e.preventDefault(); return; }
    if (SHORT[k]) { e.preventDefault(); actions[SHORT[k]](); renderChrome(); showGhost(); }
  };
  const onKeyUp = e => {
    const k = e.key.toLowerCase();
    keys.delete(k);
    if (k === 'shift') { ST.shift = false; showGhost(); }
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  const onBlur = () => keys.clear();
  window.addEventListener('blur', onBlur);

  // ----- lifecycle -----
  const resize = () => {
    const r = stage.getBoundingClientRect();
    renderer.setSize(r.width, r.height);
    camera.aspect = r.width / Math.max(1, r.height);
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  let raf, last = performance.now();
  const loop = now => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    moveCam(dt);
    applyCam();
    animateTraffic(now, dt);
    sky.position.copy(camera.position);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };

  function close() {
    cancelAnimationFrame(raf);
    ro.disconnect();
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    itemsGroup.children.forEach(m => m.dispose?.());
    renderer.dispose();
    pmrem.dispose();
    el.hidden = true;
    el.onclick = null;
    el.innerHTML = '';
  }

  rebuildItems();
  renderChrome();
  resize();
  raf = requestAnimationFrame(loop);
}

// Small deterministic RNG so scenery stays put between visits.
function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t2 = Math.imul(a ^ (a >>> 15), 1 | a); t2 = (t2 + Math.imul(t2 ^ (t2 >>> 7), 61 | t2)) ^ t2; return ((t2 ^ (t2 >>> 14)) >>> 0) / 4294967296; };
}
