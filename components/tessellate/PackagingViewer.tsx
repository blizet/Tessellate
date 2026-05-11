"use client";

import { useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ViewerConfig = {
  type: string;
  finish: string;
  color: string;
  color2: string;
  logoText: string;
  logoShow: boolean;
  w: number;
  h: number;
  d: number;
};

type SceneRef = {
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  renderer: THREE.WebGLRenderer | null;
  meshGroup: THREE.Group | null;
  pmrem: THREE.PMREMGenerator | null;
  defaultEnv: THREE.Texture | null;
  bgTexture: THREE.Texture | null;
  grid: THREE.GridHelper | null;
  autoRotate: boolean;
  rotX: number;
  rotY: number;
  zoom: number;
  animAngle: number;
  currentTexture: THREE.Texture | null;
  // Custom uploaded 3D model
  customGroup: THREE.Group | null;
  customMeshes: THREE.Mesh[];
};

type FinishPreset = { metalness: number; roughness: number; clearcoat: number };

// ── Finish presets — all use a touch of clearcoat for premium sheen ───────────

const FINISH_MAP: Record<string, FinishPreset> = {
  matte:  { metalness: 0.0, roughness: 0.85, clearcoat: 0.10 },
  gloss:  { metalness: 0.0, roughness: 0.18, clearcoat: 0.85 },
  satin:  { metalness: 0.0, roughness: 0.45, clearcoat: 0.40 },
  foil:   { metalness: 0.85, roughness: 0.18, clearcoat: 0.60 },
  kraft:  { metalness: 0.0, roughness: 0.92, clearcoat: 0.05 },
  velvet: { metalness: 0.0, roughness: 1.00, clearcoat: 0.00 },
};

// UV regions of the 1024×768 cross-net (Three.js UV: (0,0)=bottom-left)
const FACE_UVS: Record<string, [number, number, number, number]> = {
  front:  [0.25, 0.50, 0.333, 0.667],
  back:   [0.75, 1.00, 0.333, 0.667],
  left:   [0.00, 0.25, 0.333, 0.667],
  right:  [0.50, 0.75, 0.333, 0.667],
  top:    [0.25, 0.50, 0.667, 1.000],
  bottom: [0.25, 0.50, 0.000, 0.333],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function blendHex(h1: string, h2: string, t: number): string {
  const p = (h: string, i: number) => Math.min(255, Math.max(0, parseInt(h.slice(i, i + 2), 16) || 0));
  const r = Math.round(p(h1, 1) + (p(h2, 1) - p(h1, 1)) * t).toString(16).padStart(2, "0");
  const g = Math.round(p(h1, 3) + (p(h2, 3) - p(h1, 3)) * t).toString(16).padStart(2, "0");
  const b = Math.round(p(h1, 5) + (p(h2, 5) - p(h1, 5)) * t).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function applyUVRegion(geo: THREE.PlaneGeometry, faceKey: string) {
  const uvs = FACE_UVS[faceKey];
  if (!uvs) return;
  const [u0, u1, v0, v1] = uvs;
  const attr = geo.attributes.uv as THREE.BufferAttribute;
  // PlaneGeometry vertex order: 0=TL, 1=TR, 2=BL, 3=BR
  attr.setXY(0, u0, v1);
  attr.setXY(1, u1, v1);
  attr.setXY(2, u0, v0);
  attr.setXY(3, u1, v0);
  attr.needsUpdate = true;
}

function makeMat(
  color: string,
  fp: FinishPreset,
  map?: THREE.Texture | null,
): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color),
    roughness: fp.roughness,
    metalness: fp.metalness,
    clearcoat: fp.clearcoat,
    clearcoatRoughness: 0.18,
    map: map ?? null,
    side: THREE.FrontSide,
    envMapIntensity: 0.85,
  });
}

// Make a fall-off interior material (for the inside of an open box)
function makeInteriorMat(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(blendHex(color, "#000000", 0.55)),
    roughness: 0.95,
    metalness: 0,
    side: THREE.BackSide,
  });
}

// ── Procedural HDR-like environment for default reflections ──────────────────

function buildDefaultEnvTexture(renderer: THREE.WebGLRenderer): { tex: THREE.Texture; pmrem: THREE.PMREMGenerator } {
  // Simple equirectangular gradient canvas
  const canvas = document.createElement("canvas");
  canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, "#ffffff");
  grad.addColorStop(0.4, "#dcdcd5");
  grad.addColorStop(0.55, "#a9a8a0");
  grad.addColorStop(1.0, "#3c3a36");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);
  // Add a couple of soft "studio light" bright spots
  const addBlob = (x: number, y: number, r: number, alpha: number) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,250,235,${alpha})`);
    g.addColorStop(1, "rgba(255,250,235,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  addBlob(140, 70, 110, 0.85);
  addBlob(380, 95, 90, 0.55);
  addBlob(260, 30, 80, 0.4);

  const eqTex = new THREE.CanvasTexture(canvas);
  eqTex.mapping = THREE.EquirectangularReflectionMapping;
  eqTex.colorSpace = THREE.SRGBColorSpace;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const env = pmrem.fromEquirectangular(eqTex).texture;
  eqTex.dispose();
  return { tex: env, pmrem };
}

// ── Edge bevel helpers ────────────────────────────────────────────────────────

function addBevelEdges(group: THREE.Group, w: number, h: number, d: number, color: string) {
  const t = Math.min(w, h, d) * 0.012; // bevel thickness
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(blendHex(color, "#000000", 0.18)),
    roughness: 0.55,
    metalness: 0,
    clearcoat: 0.25,
    side: THREE.FrontSide,
  });

  // 12 edges of a box, each as a thin rounded cylinder oriented along one axis
  const make = (len: number, axis: "x" | "y" | "z", x: number, y: number, z: number) => {
    const geo = new THREE.CylinderGeometry(t * 0.55, t * 0.55, len, 8, 1);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (axis === "x") m.rotation.z = Math.PI / 2;
    if (axis === "z") m.rotation.x = Math.PI / 2;
    m.castShadow = true;
    group.add(m);
  };

  // 4 verticals (along Y)
  make(h, "y",  w / 2,  h / 2,  d / 2);
  make(h, "y", -w / 2,  h / 2,  d / 2);
  make(h, "y",  w / 2,  h / 2, -d / 2);
  make(h, "y", -w / 2,  h / 2, -d / 2);
  // 4 horizontals on top (along X and Z)
  make(w, "x",   0,    h,  d / 2);
  make(w, "x",   0,    h, -d / 2);
  make(d, "z",   w / 2, h,   0);
  make(d, "z",  -w / 2, h,   0);
  // 4 horizontals on bottom
  make(w, "x",   0,    0,  d / 2);
  make(w, "x",   0,    0, -d / 2);
  make(d, "z",   w / 2, 0,   0);
  make(d, "z",  -w / 2, 0,   0);
}

// ── Box geometry builders ─────────────────────────────────────────────────────

function buildRectBox(
  group: THREE.Group,
  w: number, h: number, d: number,
  panelMat: THREE.MeshPhysicalMaterial,
  accentMat: THREE.MeshPhysicalMaterial,
  edgeMat: THREE.MeshPhysicalMaterial,
  type: string,
  tex: THREE.Texture | null,
  fp: FinishPreset,
) {
  const hw = w / 2, hh = h / 2, hd = d / 2;

  // Solid darker inner core (gives the box weight + occluded-edge feel)
  const core = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.985, h * 0.985, d * 0.985),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(blendHex("#" + panelMat.color.getHexString(), "#000000", 0.35)),
      roughness: 0.92,
      metalness: 0,
    }),
  );
  core.position.y = hh;
  core.castShadow = true;
  core.receiveShadow = true;
  group.add(core);

  type FaceSpec = {
    geo: THREE.PlaneGeometry;
    pos: [number, number, number];
    rot: [number, number, number];
    base: THREE.MeshPhysicalMaterial;
    faceKey: string;
    fold?: { axis: "x" | "y" | "z"; angle: number };
  };

  const faces: FaceSpec[] = [
    { geo: new THREE.PlaneGeometry(w, h), pos: [0, hh, hd],   rot: [0, 0, 0],            base: panelMat, faceKey: "front", fold: { axis: "x", angle: 0 } },
    { geo: new THREE.PlaneGeometry(w, h), pos: [0, hh, -hd],  rot: [0, Math.PI, 0],      base: panelMat, faceKey: "back" },
    { geo: new THREE.PlaneGeometry(d, h), pos: [-hw, hh, 0],  rot: [0, -Math.PI / 2, 0], base: accentMat, faceKey: "left" },
    { geo: new THREE.PlaneGeometry(d, h), pos: [hw, hh, 0],   rot: [0,  Math.PI / 2, 0], base: accentMat, faceKey: "right" },
    { geo: new THREE.PlaneGeometry(w, d), pos: [0, 0, 0],     rot: [-Math.PI / 2, 0, 0], base: edgeMat,  faceKey: "bottom" },
    { geo: new THREE.PlaneGeometry(w, d), pos: [0, h, 0],     rot: [ Math.PI / 2, 0, 0], base: panelMat, faceKey: "top",  fold: { axis: "x", angle: -Math.PI / 2 } },
  ];

  if (type === "mailer") {
    // Front folding flap
    const flapGeo = new THREE.PlaneGeometry(w, d * 0.7);
    const flapMat = tex ? makeMat(accentMat.color.getStyle(), fp, tex) : accentMat;
    if (tex) applyUVRegion(flapGeo, "top");
    const flapMesh = new THREE.Mesh(flapGeo, flapMat);
    const pivot = new THREE.Group();
    pivot.position.set(0, h, hd);
    flapMesh.position.set(0, d * 0.35, 0);
    flapMesh.rotation.x = -Math.PI / 2;
    pivot.add(flapMesh);
    pivot.userData = { foldAxis: "x", foldAngle: Math.PI * 0.6 };
    group.add(pivot);
  }

  faces.forEach((f) => {
    let mat: THREE.MeshPhysicalMaterial;
    if (tex) {
      mat = makeMat(f.base.color.getStyle(), fp, tex);
      applyUVRegion(f.geo, f.faceKey);
    } else {
      mat = f.base;
    }
    // tiny outward push so face panels don't z-fight with the inner core
    const eps = 0.0008;
    const pos: [number, number, number] = [...f.pos] as [number, number, number];
    if (Math.abs(pos[0]) > 0.01) pos[0] += Math.sign(pos[0]) * eps;
    if (Math.abs(pos[2]) > 0.01) pos[2] += Math.sign(pos[2]) * eps;
    if (f.faceKey === "top") pos[1] += eps;
    if (f.faceKey === "bottom") pos[1] -= eps * 0.3; // bottom doesn't need much
    const mesh = new THREE.Mesh(f.geo, mat);
    mesh.position.set(...pos);
    mesh.rotation.set(...f.rot);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (f.fold) mesh.userData = { foldAxis: f.fold.axis, foldAngle: f.fold.angle };
    group.add(mesh);
  });

  // Subtle bevel cylinders along all 12 edges
  addBevelEdges(group, w, h, d, "#" + panelMat.color.getHexString());
}

// ── Cylinder / Bottle ─────────────────────────────────────────────────────────

function buildCylinder(group: THREE.Group, r: number, h: number, panelMat: THREE.MeshPhysicalMaterial, accentMat: THREE.MeshPhysicalMaterial) {
  // Body
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 64, 1, true), panelMat);
  body.castShadow = true;
  body.receiveShadow = true;
  body.position.y = h / 2;
  group.add(body);

  // Inside (visible at the rim)
  const interior = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 0.97, r * 0.97, h * 0.95, 48, 1, true),
    makeInteriorMat("#" + panelMat.color.getHexString()),
  );
  interior.position.y = h / 2;
  group.add(interior);

  // Top cap (slightly inset to suggest a lid line)
  const top = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.985, r, h * 0.045, 64), accentMat);
  top.position.y = h - h * 0.045 / 2 + 0.001;
  top.castShadow = true;
  group.add(top);

  // Bottom cap
  const bot = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h * 0.025, 64), accentMat);
  bot.position.y = h * 0.025 / 2;
  bot.receiveShadow = true;
  group.add(bot);

  // Top rim (subtle metallic ring)
  const rimMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(blendHex("#" + accentMat.color.getHexString(), "#666666", 0.4)),
    roughness: 0.32, metalness: 0.45, clearcoat: 0.6,
  });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.99, 0.012, 12, 64), rimMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = h - 0.001;
  rim.castShadow = true;
  group.add(rim);
}

// ── Cake Box (purse-style with arched top + handle tab) ──────────────────────

function buildCakeBox(group: THREE.Group, w: number, h: number, d: number, panelMat: THREE.MeshPhysicalMaterial, accentMat: THREE.MeshPhysicalMaterial, edgeMat: THREE.MeshPhysicalMaterial) {
  const hw = w / 2, hd = d / 2;
  const wallH = Math.min(h * 0.16, d * 0.30);
  const archRadius = d / 2;
  const archApex = wallH + archRadius * 2; // Peak of the dome
  const cardT = Math.min(w, h, d) * 0.014;

  const panelHex = "#" + panelMat.color.getHexString();
  const interiorMat = makeInteriorMat(panelHex);
  const creaseMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(blendHex(panelHex, "#000000", 0.22)),
    roughness: 0.65, 
    metalness: 0,
  });

  // ── Floor slab ───
  const slab = new THREE.Mesh(new THREE.BoxGeometry(w, cardT, d), edgeMat);
  slab.position.y = cardT / 2;
  slab.castShadow = true;
  slab.receiveShadow = true;
  group.add(slab);

  // ── Front + back lower walls ──
  const wallSlab = (z: number) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w - cardT, wallH, cardT), 
      panelMat
    );
    m.position.set(0, cardT + wallH / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };
  group.add(wallSlab(hd - cardT / 2));
  group.add(wallSlab(-hd + cardT / 2));

  // ── D-shape side panels ───
  const sideShape = new THREE.Shape();
  sideShape.moveTo(-hd, 0);
  sideShape.lineTo(hd, 0);
  sideShape.lineTo(hd, wallH);
  sideShape.absarc(0, wallH, archRadius, 0, Math.PI, false);
  sideShape.lineTo(-hd, 0);

  const sideGeo = new THREE.ExtrudeGeometry(sideShape, {
    depth: cardT,
    bevelEnabled: true,
    bevelThickness: cardT * 0.18,
    bevelSize: cardT * 0.18,
    bevelSegments: 2,
    curveSegments: 80,
  });
  sideGeo.translate(0, 0, -cardT / 2);

  const leftSide = new THREE.Mesh(sideGeo, panelMat);
  leftSide.position.set(-hw, cardT / 2, 0);
  leftSide.rotation.y = -Math.PI / 2;
  leftSide.castShadow = true;
  leftSide.receiveShadow = true;
  group.add(leftSide);

  const rightSide = new THREE.Mesh(sideGeo.clone(), panelMat);
  rightSide.position.set(hw, cardT / 2, 0);
  rightSide.rotation.y = Math.PI / 2;
  rightSide.castShadow = true;
  rightSide.receiveShadow = true;
  group.add(rightSide);

  // ── Arched lid (DOME) — positioned correctly ───
  const archLen = w - cardT;
  const archGeo = new THREE.CylinderGeometry(
    archRadius, 
    archRadius, 
    archLen, 
    96, 
    1, 
    true,           // openEnded
    -Math.PI / 2, 
    Math.PI
  );
  archGeo.rotateZ(Math.PI / 2);
  archGeo.rotateX(-Math.PI / 2);
  const arch = new THREE.Mesh(archGeo, panelMat);
  // ✅ FIX: Position arch so bottom sits on top of walls
  arch.position.y = cardT + wallH ;
  arch.castShadow = true;
  arch.receiveShadow = true;
  group.add(arch);

  // ── Interior of arch ───
  const archInsideGeo = new THREE.CylinderGeometry(
    archRadius - cardT * 0.6, 
    archRadius - cardT * 0.6, 
    archLen * 0.99, 
    96, 
    1, 
    true,
    -Math.PI / 2, 
    Math.PI
  );
  archInsideGeo.rotateZ(Math.PI / 2);
  archInsideGeo.rotateX(-Math.PI / 2);
  const archInside = new THREE.Mesh(archInsideGeo, interiorMat);
  archInside.position.y = cardT + wallH ;
  group.add(archInside);


  // ── Crease line where arch meets front/back walls ───
  for (const sign of [-1, 1]) {
    const crease = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.99, 0.004, 0.005),
      creaseMat
    );
    crease.position.set(
      0, 
      cardT + wallH, 
      sign * hd - sign * 0.001
    );
    group.add(crease);
  }

  // ── Center seam at apex ───
  const seam = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.995, 0.005, 0.006), 
    creaseMat
  );
  seam.position.set(0, cardT + wallH  + 0.002, 0);
  group.add(seam);

  // ── Radial fold lines on arched lid ───
  for (const ang of [Math.PI * 0.30, Math.PI * 0.50, Math.PI * 0.70]) {
    const r = archRadius + 0.002;
    const cy = cardT + wallH ;
    const cz = -r * Math.cos(ang);
    
    const lineGeo = new THREE.BoxGeometry(w * 0.97, 0.0015, 0.003);
    const line = new THREE.Mesh(lineGeo, creaseMat);
    line.position.set(0, cy, cz);
    line.rotation.x = -(ang - Math.PI / 2);
    group.add(line);
  }

  // ── Handle tab — elegant design ───
  const tabH = h * 0.28;
  const tabW = w * 0.34;
  const tabT = cardT * 1.4;
  const tabRadius = tabW / 2;

  const tabShape = new THREE.Shape();
  tabShape.moveTo(-tabW / 2, 0);
  tabShape.lineTo(tabW / 2, 0);
  tabShape.lineTo(tabW / 2, tabH - tabRadius);
  tabShape.absarc(0, tabH - tabRadius, tabRadius, 0, Math.PI, false);
  tabShape.lineTo(-tabW / 2, 0);

  // Handle hole (for finger grip)
  const tabHole = new THREE.Path();
  tabHole.absellipse(0, tabH * 0.55, tabW * 0.32, tabH * 0.16, 0, Math.PI * 2, false);
  tabShape.holes.push(tabHole);

  const tabGeo = new THREE.ExtrudeGeometry(tabShape, {
    depth: tabT,
    bevelEnabled: true,
    bevelThickness: tabT * 0.30,
    bevelSize: tabT * 0.30,
    bevelSegments: 4,
    curveSegments: 48,
  });
  tabGeo.translate(0, 0, -tabT / 2);
  
  const tab = new THREE.Mesh(tabGeo, panelMat);
  // ✅ Position tab at apex of dome
  tab.position.set(0, cardT + wallH + archRadius, 0);
  tab.castShadow = true;
  tab.receiveShadow = true;
  group.add(tab);

  // ── Anchor plate where tab meets dome ───
  const anchor = new THREE.Mesh(
    new THREE.BoxGeometry(tabW * 1.08, 0.005, tabT * 1.6),
    creaseMat
  );
  anchor.position.set(0, cardT + wallH + archRadius * 2 + 0.001, 0);
  group.add(anchor);

  void accentMat;
}

// ── Pillow ────────────────────────────────────────────────────────────────────

function buildPillow(group: THREE.Group, w: number, h: number, d: number, panelMat: THREE.MeshPhysicalMaterial, accentMat: THREE.MeshPhysicalMaterial) {
  // Smoother, more refined pillow — squashed sphere with subtle bulge
  const geo = new THREE.SphereGeometry(1, 80, 48);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    // Add subtle bulge along Z so the pillow puffs out
    const puff = 1 + 0.08 * (1 - Math.abs(y));
    pos.setXYZ(i, x * (w / 2) * puff, y * (h / 2), z * (d / 4) * puff);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, panelMat);
  m.position.y = h / 2;
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);

  // Pinch caps at top and bottom (the "gathered" ends of a pillow box)
  const pinchGeo = new THREE.TorusGeometry(w * 0.08, 0.015, 12, 36);
  const pinchMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(blendHex("#" + panelMat.color.getHexString(), "#000000", 0.25)),
    roughness: 0.6, metalness: 0, clearcoat: 0.2,
  });
  [-1, 1].forEach((s) => {
    const p = new THREE.Mesh(pinchGeo, pinchMat);
    p.position.y = h / 2 + s * h * 0.48;
    p.rotation.x = Math.PI / 2;
    p.castShadow = true;
    group.add(p);
  });
  void accentMat;
}

// ── Gable ─────────────────────────────────────────────────────────────────────

function buildGable(group: THREE.Group, w: number, h: number, d: number, panelMat: THREE.MeshPhysicalMaterial, accentMat: THREE.MeshPhysicalMaterial, edgeMat: THREE.MeshPhysicalMaterial, fp: FinishPreset) {
  const hw = w / 2, hd = d / 2;
  const wallH = h * 0.62;
  const peakH = h;
  const cardT = Math.min(w, h, d) * 0.012;
  const panelHex = "#" + panelMat.color.getHexString();

  void edgeMat; void fp;

  // ── Build the body as ONE extruded "house pentagon" with a punched handle slot ──
  // Cross-section in the XY plane: rectangle base + triangle peak
  const houseShape = new THREE.Shape();
  houseShape.moveTo(-hw, 0);
  houseShape.lineTo(hw, 0);
  houseShape.lineTo(hw, wallH);
  houseShape.lineTo(0, peakH);
  houseShape.lineTo(-hw, wallH);
  houseShape.lineTo(-hw, 0);

  // Punched handle slot (oval) near the top of the peak — extrudes through the body
  const slotShape = new THREE.Path();
  const slotW = w * 0.18, slotH = h * 0.04;
  const slotY = (wallH + peakH) / 2 + h * 0.05;
  slotShape.absellipse(0, slotY, slotW, slotH, 0, Math.PI * 2, false);
  houseShape.holes.push(slotShape);

  const bodyGeo = new THREE.ExtrudeGeometry(houseShape, {
    depth: d,
    bevelEnabled: true,
    bevelThickness: cardT * 1.2,
    bevelSize: cardT * 1.2,
    bevelSegments: 3,
    curveSegments: 24,
  });
  bodyGeo.translate(0, 0, -hd);

  const body = new THREE.Mesh(bodyGeo, panelMat);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Accent flap on the front face (a darker border around the punched-out shape's outline)
  // small accent highlight along the bottom rim
  const baseStripe = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.99, h * 0.04, d * 0.99),
    accentMat,
  );
  baseStripe.position.y = h * 0.02;
  baseStripe.castShadow = true;
  group.add(baseStripe);

  // ── Inner darker core for handle slot depth (so the punched hole reads as 3D) ──
  // A small dark "shadow" plane behind the slot
  const slotShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(slotW * 2.2, slotH * 2.4),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(blendHex(panelHex, "#000000", 0.75)),
      roughness: 0.95, metalness: 0,
      transparent: true, opacity: 0.85,
    }),
  );
  slotShadow.position.set(0, slotY, 0);
  group.add(slotShadow);

  // ── Ridge cap along the peak ──
  const ridgeMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(blendHex(panelHex, "#000000", 0.28)),
    roughness: 0.45, metalness: 0, clearcoat: 0.4,
  });
  const ridge = new THREE.Mesh(
    new THREE.BoxGeometry(0.014, 0.014, d * 0.99),
    ridgeMat,
  );
  ridge.position.y = peakH;
  ridge.castShadow = true;
  group.add(ridge);

  // ── Crease lines along the roof slopes (left and right of the peak) ──
  const slopeLen = Math.sqrt(hw * hw + (peakH - wallH) * (peakH - wallH));
  const slopeAngle = Math.atan2(peakH - wallH, hw);
  for (const sign of [-1, 1]) {
    const creaseGeo = new THREE.BoxGeometry(0.003, 0.003, d * 0.985);
    const crease = new THREE.Mesh(creaseGeo, ridgeMat);
    // Position along the slope at 50% height
    const midX = sign * (hw / 2);
    const midY = (wallH + peakH) / 2;
    crease.position.set(midX, midY, 0);
    crease.rotation.z = sign * (Math.PI / 2 - slopeAngle);
    group.add(crease);
    void slopeLen;
  }

  // ── Crease line at the wall/roof junction ──
  for (const sign of [-1, 1]) {
    const crease = new THREE.Mesh(
      new THREE.BoxGeometry(0.004, 0.004, d * 0.985),
      ridgeMat,
    );
    crease.position.set(sign * hw, wallH, 0);
    group.add(crease);
  }
}

// Variant of buildRectBox without the bevel cylinder edges (for use as gable body)
function buildRectBoxNoEdges(
  group: THREE.Group,
  w: number, h: number, d: number,
  panelMat: THREE.MeshPhysicalMaterial,
  accentMat: THREE.MeshPhysicalMaterial,
  edgeMat: THREE.MeshPhysicalMaterial,
  _type: string,
  tex: THREE.Texture | null,
  _fp: FinishPreset,
) {
  void _type; void _fp; void tex;
  const hw = w / 2, hh = h / 2, hd = d / 2;

  const core = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.985, h * 0.985, d * 0.985),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(blendHex("#" + panelMat.color.getHexString(), "#000000", 0.35)),
      roughness: 0.92, metalness: 0,
    }),
  );
  core.position.y = hh;
  core.castShadow = true;
  core.receiveShadow = true;
  group.add(core);

  const faces: Array<[THREE.PlaneGeometry, [number, number, number], [number, number, number], THREE.MeshPhysicalMaterial]> = [
    [new THREE.PlaneGeometry(w, h), [0, hh, hd],   [0, 0, 0],            panelMat],
    [new THREE.PlaneGeometry(w, h), [0, hh, -hd],  [0, Math.PI, 0],      panelMat],
    [new THREE.PlaneGeometry(d, h), [-hw, hh, 0],  [0, -Math.PI / 2, 0], accentMat],
    [new THREE.PlaneGeometry(d, h), [hw, hh, 0],   [0,  Math.PI / 2, 0], accentMat],
    [new THREE.PlaneGeometry(w, d), [0, 0, 0],     [-Math.PI / 2, 0, 0], edgeMat],
  ];
  faces.forEach(([geo, pos, rot, mat]) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    m.rotation.set(...rot);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  });
}

// ── Hexagon ───────────────────────────────────────────────────────────────────

function buildHexagon(group: THREE.Group, w: number, h: number, panelMat: THREE.MeshPhysicalMaterial, accentMat: THREE.MeshPhysicalMaterial) {
  const n = 6, r = w / 2;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n + Math.PI / 6;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }

  // Solid hex prism core
  const hexShape = new THREE.Shape();
  hexShape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < n; i++) hexShape.lineTo(pts[i][0], pts[i][1]);
  hexShape.lineTo(pts[0][0], pts[0][1]);
  const coreGeo = new THREE.ExtrudeGeometry(hexShape, {
    depth: h,
    bevelEnabled: true,
    bevelThickness: Math.min(w, h) * 0.012,
    bevelSize: Math.min(w, h) * 0.012,
    bevelSegments: 3,
    curveSegments: 12,
  });
  coreGeo.rotateX(-Math.PI / 2);
  const core = new THREE.Mesh(coreGeo, panelMat);
  core.position.y = 0;
  core.castShadow = true;
  core.receiveShadow = true;
  group.add(core);

  // Top accent disk (slightly lifted)
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.95, r * 0.95, 0.002, 6), accentMat);
  cap.position.y = h + 0.003;
  cap.rotation.y = Math.PI / 6;
  cap.castShadow = true;
  group.add(cap);
}

// ── Sleeve (open-ended box) ───────────────────────────────────────────────────

function buildSleeve(group: THREE.Group, w: number, h: number, d: number, panelMat: THREE.MeshPhysicalMaterial, accentMat: THREE.MeshPhysicalMaterial, edgeMat: THREE.MeshPhysicalMaterial, fp: FinishPreset, tex: THREE.Texture | null) {
  const hw = w / 2, hd = d / 2;

  // Outer sleeve (hollow rectangular tube — open on left/right)
  const outerShape = new THREE.Shape();
  outerShape.moveTo(-hw, 0);
  outerShape.lineTo(hw, 0);
  outerShape.lineTo(hw, h);
  outerShape.lineTo(-hw, h);
  outerShape.lineTo(-hw, 0);
  // Inner hole
  const inner = new THREE.Path();
  const t = 0.012;
  inner.moveTo(-hw + t, t);
  inner.lineTo(hw - t, t);
  inner.lineTo(hw - t, h - t);
  inner.lineTo(-hw + t, h - t);
  inner.lineTo(-hw + t, t);
  outerShape.holes.push(inner);

  const sleeveGeo = new THREE.ExtrudeGeometry(outerShape, {
    depth: d,
    bevelEnabled: true,
    bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2,
  });
  sleeveGeo.translate(0, 0, -hd);
  const sleeve = new THREE.Mesh(sleeveGeo, panelMat);
  sleeve.castShadow = true;
  sleeve.receiveShadow = true;
  group.add(sleeve);

  // Inner tray peeking through
  const trayMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(blendHex("#" + panelMat.color.getHexString(), "#000000", 0.45)),
    roughness: 0.95, metalness: 0,
  });
  const tray = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.72, h * 0.8, d * 0.95),
    trayMat,
  );
  tray.position.set(w * 0.05, h / 2, 0);
  tray.castShadow = true;
  group.add(tray);

  // If we have a dieline texture, place a label band on the front
  if (tex) {
    const labelGeo = new THREE.PlaneGeometry(w, h);
    applyUVRegion(labelGeo, "front");
    const labelMat = makeMat(panelMat.color.getStyle(), fp, tex);
    const label = new THREE.Mesh(labelGeo, labelMat);
    label.position.set(0, h / 2, hd + 0.001);
    label.castShadow = true;
    group.add(label);
  }
  void accentMat; void edgeMat;
}

// ── Trapezoid (slanted-side display box) ──────────────────────────────────────

function buildTrapezoid(group: THREE.Group, w: number, h: number, d: number, panelMat: THREE.MeshPhysicalMaterial, accentMat: THREE.MeshPhysicalMaterial, edgeMat: THREE.MeshPhysicalMaterial) {
  const hw = w / 2, hd = d / 2;
  const taper = 0.18;
  const tw = hw * (1 - taper);
  const td = hd * (1 - taper);
  const panelHex = "#" + panelMat.color.getHexString();

  // ── Solid darker inner core for occlusion + weight ─────────────────
  // Approximate with a small box inset; slight inaccuracy invisible inside the slanted shell
  const coreVerts = new Float32Array([
    -hw * 0.96, 0.005,         -hd * 0.96,
     hw * 0.96, 0.005,         -hd * 0.96,
     hw * 0.96, 0.005,          hd * 0.96,
    -hw * 0.96, 0.005,          hd * 0.96,
    -tw * 0.96, h - 0.005,     -td * 0.96,
     tw * 0.96, h - 0.005,     -td * 0.96,
     tw * 0.96, h - 0.005,      td * 0.96,
    -tw * 0.96, h - 0.005,      td * 0.96,
  ]);
  const coreIdx = [
    0, 1, 2, 0, 2, 3,
    4, 7, 6, 4, 6, 5,
    3, 2, 6, 3, 6, 7,
    1, 0, 4, 1, 4, 5,
    0, 3, 7, 0, 7, 4,
    2, 1, 5, 2, 5, 6,
  ];
  const coreGeo = new THREE.BufferGeometry();
  coreGeo.setAttribute("position", new THREE.Float32BufferAttribute(coreVerts, 3));
  coreGeo.setIndex(coreIdx);
  coreGeo.computeVertexNormals();
  const core = new THREE.Mesh(coreGeo, new THREE.MeshStandardMaterial({
    color: new THREE.Color(blendHex(panelHex, "#000000", 0.4)),
    roughness: 0.9, metalness: 0,
  }));
  core.castShadow = true;
  core.receiveShadow = true;
  group.add(core);

  // ── 6 face panels with proper trapezoid shape for the slanted sides ──
  const buildQuad = (
    a: readonly [number, number, number],
    b: readonly [number, number, number],
    c: readonly [number, number, number],
    dd: readonly [number, number, number],
    mat: THREE.Material,
  ) => {
    const v = new Float32Array([
      a[0], a[1], a[2],
      b[0], b[1], b[2],
      c[0], c[1], c[2],
      dd[0], dd[1], dd[2],
    ]);
    const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };

  // Vertices (slightly outset to avoid z-fighting with core)
  const eps = 0.0008;
  const Bv = [
    [-hw - eps, 0,  -hd - eps],
    [ hw + eps, 0,  -hd - eps],
    [ hw + eps, 0,   hd + eps],
    [-hw - eps, 0,   hd + eps],
  ] as const;
  const Tv = [
    [-tw, h + eps, -td],
    [ tw, h + eps, -td],
    [ tw, h + eps,  td],
    [-tw, h + eps,  td],
  ] as const;

  group.add(buildQuad(Bv[3], Bv[2], Tv[2], Tv[3], panelMat));   // front
  group.add(buildQuad(Bv[1], Bv[0], Tv[0], Tv[1], panelMat));   // back
  group.add(buildQuad(Bv[0], Bv[3], Tv[3], Tv[0], accentMat));  // left
  group.add(buildQuad(Bv[2], Bv[1], Tv[1], Tv[2], accentMat));  // right
  group.add(buildQuad(Tv[0], Tv[1], Tv[2], Tv[3], accentMat));  // top (lid)
  group.add(buildQuad(Bv[0], Bv[1], Bv[2], Bv[3], edgeMat));    // bottom (flipped winding for upward normal not strictly needed)

  // ── Bevelled edges along all 12 edges (handles slanted edges correctly) ──
  const edgeColor = blendHex(panelHex, "#000000", 0.18);
  const bevelMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(edgeColor),
    roughness: 0.50, metalness: 0, clearcoat: 0.30,
  });
  const bevelR = Math.min(w, h, d) * 0.008;

  const addEdge = (a: readonly [number, number, number], b: readonly [number, number, number]) => {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    const mid = va.clone().lerp(vb, 0.5);
    const dir = vb.clone().sub(va).normalize();
    const geo = new THREE.CylinderGeometry(bevelR, bevelR, len, 10, 1);
    const mesh = new THREE.Mesh(geo, bevelMat);
    mesh.position.copy(mid);
    const yAxis = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(yAxis, dir);
    mesh.quaternion.copy(quat);
    mesh.castShadow = true;
    return mesh;
  };

  // Bottom edges
  group.add(addEdge(Bv[0], Bv[1]));
  group.add(addEdge(Bv[1], Bv[2]));
  group.add(addEdge(Bv[2], Bv[3]));
  group.add(addEdge(Bv[3], Bv[0]));
  // Top edges
  group.add(addEdge(Tv[0], Tv[1]));
  group.add(addEdge(Tv[1], Tv[2]));
  group.add(addEdge(Tv[2], Tv[3]));
  group.add(addEdge(Tv[3], Tv[0]));
  // 4 slanted vertical edges
  group.add(addEdge(Bv[0], Tv[0]));
  group.add(addEdge(Bv[1], Tv[1]));
  group.add(addEdge(Bv[2], Tv[2]));
  group.add(addEdge(Bv[3], Tv[3]));

  // ── Premium top accent rim (slightly raised lid line) ──
  const rimMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(blendHex(panelHex, "#000000", 0.30)),
    roughness: 0.40, metalness: 0.10, clearcoat: 0.50,
  });
  const rim = new THREE.Mesh(
    new THREE.BoxGeometry(tw * 2 + bevelR * 2, bevelR * 1.4, td * 2 + bevelR * 2),
    rimMat,
  );
  rim.position.y = h + bevelR * 0.7;
  rim.castShadow = true;
  group.add(rim);
}

// ── Master mesh builder ──────────────────────────────────────────────────────

function buildBoxMesh(config: ViewerConfig, tex: THREE.Texture | null): THREE.Group {
  const { type, color, color2, finish, w, h, d, logoText, logoShow } = config;
  const fp = FINISH_MAP[finish] ?? FINISH_MAP.matte;
  const group = new THREE.Group();

  const c1 = color || "#ffffff";
  const c2 = color2 || c1;

  const panelMat = makeMat(c1, fp);
  const accentMat = makeMat(c2, fp);
  const edgeMat = makeMat(blendHex(c1, "#888888", 0.18), { ...fp, roughness: Math.min(1, fp.roughness + 0.05) });

  if (type === "cylinder") {
    buildCylinder(group, w / 2, h, panelMat, accentMat);
  } else if (type === "cake_box") {
    buildCakeBox(group, w, h, d, panelMat, accentMat, edgeMat);
  } else if (type === "pillow") {
    buildPillow(group, w, h, d, panelMat, accentMat);
  } else if (type === "gable") {
    buildGable(group, w, h, d, panelMat, accentMat, edgeMat, fp);
  } else if (type === "hexagon") {
    buildHexagon(group, w, h, panelMat, accentMat);
  } else if (type === "sleeve") {
    buildSleeve(group, w, h, d, panelMat, accentMat, edgeMat, fp, tex);
  } else if (type === "trapezoid") {
    buildTrapezoid(group, w, h, d, panelMat, accentMat, edgeMat);
  } else {
    buildRectBox(group, w, h, d, panelMat, accentMat, edgeMat, type, tex, fp);
  }

  // Logo badge (only when no SVG dieline texture is bound)
  if (logoShow && logoText && !tex) {
    const canvas = document.createElement("canvas");
    canvas.width = 512; canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, 512, 256);
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      roundRect(ctx, 16, 40, 480, 176, 88);
      ctx.fill();
      ctx.strokeStyle = blendHex(c1, "#000000", 0.22);
      ctx.lineWidth = 4;
      roundRect(ctx, 16, 40, 480, 176, 88);
      ctx.stroke();
      ctx.fillStyle = "#1a1a1a";
      ctx.font = "bold 78px 'Playfair Display', Georgia, serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(logoText.toUpperCase().slice(0, 8), 256, 128);
      const logoTex = new THREE.CanvasTexture(canvas);
      logoTex.colorSpace = THREE.SRGBColorSpace;
      const logoMat = new THREE.MeshPhysicalMaterial({
        map: logoTex, transparent: true, roughness: 0.35, metalness: 0, clearcoat: 0.5,
      });
      const ratio = type === "cake_box" ? 0.55 : 0.45;
      const logoGeo = new THREE.PlaneGeometry(w * ratio, h * 0.18);
      const logo = new THREE.Mesh(logoGeo, logoMat);
      const yPos = type === "cake_box" ? h * 0.04 : h * 0.10;
      logo.position.set(0, yPos, d / 2 + 0.003);
      logo.castShadow = true;
      group.add(logo);
    }
  }

  return group;
}

// ── Component ────────────────────────────────────────────────────────────────

export type CustomMeshInfo = { index: number; name: string };
export type CustomMeshTextureSettings = {
  enabled: boolean;
  scale: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
};

type PackagingViewerProps = {
  config: ViewerConfig;
  dielineSvg?: string | null;
  bgUrl?: string | null;
  onReady?: () => void;
  // Custom 3D model upload
  customModelUrl?: string | null;
  customMeshTextureSettings?: Record<number, CustomMeshTextureSettings>;
  // Backward-compatible fallback: selected mesh indices without UV controls
  customTextureMeshIndices?: number[];
  onCustomModelLoaded?: (meshes: CustomMeshInfo[]) => void;
};

export type PackagingViewerHandle = {
  capture: (width?: number, height?: number) => string | null;
  toggleSpin: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  toggleGrid: () => void;
};

// Applies (or removes) the design texture on selected meshes of a custom model.
// indices = [] means apply to ALL meshes; pass specific indices to limit.
function applyTextureToCustomMeshes(
  s: SceneRef,
  tex: THREE.Texture | null,
  settingsByIndex: Record<number, CustomMeshTextureSettings> | undefined,
  indices: number[],
) {
  s.customMeshes.forEach((mesh, i) => {
    const settings = settingsByIndex?.[i];
    const shouldTexture = settings ? settings.enabled : (indices.length === 0 || indices.includes(i));
    const scale = settings?.scale ?? 1;
    const offsetX = settings?.offsetX ?? 0;
    const offsetY = settings?.offsetY ?? 0;
    const rotation = settings?.rotation ?? 0;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((mat) => {
      if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshPhysicalMaterial) {
        const ud = mat.userData as {
          originalMap?: THREE.Texture | null;
          customMap?: THREE.Texture | null;
        };

        if (ud.originalMap === undefined) ud.originalMap = mat.map ?? null;
        if (ud.customMap) {
          ud.customMap.dispose();
          ud.customMap = null;
        }

        if (shouldTexture && tex) {
          const meshTex = tex.clone();
          meshTex.wrapS = THREE.RepeatWrapping;
          meshTex.wrapT = THREE.RepeatWrapping;
          meshTex.repeat.set(scale, scale);
          meshTex.offset.set(offsetX, offsetY);
          meshTex.rotation = rotation;
          meshTex.center.set(0.5, 0.5);
          meshTex.needsUpdate = true;
          ud.customMap = meshTex;
          mat.map = meshTex;
        } else {
          mat.map = ud.originalMap ?? null;
        }
        mat.needsUpdate = true;
      }
    });
  });
}

export const PackagingViewer = forwardRef<PackagingViewerHandle, PackagingViewerProps>(
function PackagingViewer({ config, dielineSvg, bgUrl, onReady, customModelUrl, customMeshTextureSettings, customTextureMeshIndices, onCustomModelLoaded }, ref) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<SceneRef>({
    scene: null, camera: null, renderer: null, meshGroup: null,
    pmrem: null, defaultEnv: null, bgTexture: null, grid: null,
    autoRotate: false, rotX: 0.30, rotY: 0.6, zoom: 1,
    animAngle: 0.6, currentTexture: null,
    customGroup: null, customMeshes: [],
  });

  useImperativeHandle(ref, () => ({
    capture(width = 1920, height = 1080) {
      const { renderer, scene, camera } = stateRef.current;
      if (!renderer || !scene || !camera) return null;
      const origW = renderer.domElement.width;
      const origH = renderer.domElement.height;
      const origAspect = camera.aspect;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      const dataUrl = renderer.domElement.toDataURL("image/png");
      renderer.setSize(origW, origH);
      camera.aspect = origAspect;
      camera.updateProjectionMatrix();
      const i = dataUrl.indexOf("base64,");
      return i >= 0 ? dataUrl.slice(i + 7) : dataUrl;
    },
    toggleSpin() {
      stateRef.current.autoRotate = !stateRef.current.autoRotate;
    },
    zoomIn() {
      stateRef.current.zoom = Math.max(0.5, Math.min(2.5, stateRef.current.zoom - 0.12));
    },
    zoomOut() {
      stateRef.current.zoom = Math.max(0.5, Math.min(2.5, stateRef.current.zoom + 0.12));
    },
    resetView() {
      stateRef.current.rotX = 0.30;
      stateRef.current.rotY = 0.6;
      stateRef.current.zoom = 1;
      stateRef.current.autoRotate = false;
      stateRef.current.animAngle = 0.6;
    },
    toggleGrid() {
      const s = stateRef.current;
      if (!s.grid || !s.scene) return;
      s.grid.visible = !s.grid.visible;
    },
  }));

  // Scene init (runs once)
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const W = el.clientWidth || 600;
    const H = el.clientHeight || 500;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf5f4f0);

    const camera = new THREE.PerspectiveCamera(38, W / H, 0.01, 100);
    camera.position.set(2.4, 1.6, 2.4);
    camera.lookAt(0, 0.3, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    el.appendChild(renderer.domElement);

    // Procedural environment for default reflections (overridden by uploaded panorama)
    const { tex: defaultEnv, pmrem } = buildDefaultEnvTexture(renderer);
    scene.environment = defaultEnv;
    stateRef.current.pmrem = pmrem;
    stateRef.current.defaultEnv = defaultEnv;

    // ── Studio lighting rig ────────────────────────────────────────
    const ambient = new THREE.AmbientLight(0xffffff, 0.45);
    scene.add(ambient);

    const key = new THREE.DirectionalLight(0xfff2d6, 2.0);
    key.position.set(3.5, 5.5, 3.0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = key.shadow.camera.bottom = -3;
    key.shadow.camera.right = key.shadow.camera.top = 3;
    key.shadow.bias = -0.0008;
    key.shadow.radius = 4;
    scene.add(key);

    const fill = new THREE.DirectionalLight(0xc8e0ff, 0.7);
    fill.position.set(-3.5, 2.5, -1.5);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffffff, 0.55);
    rim.position.set(0, 1.5, -4);
    scene.add(rim);

    // Backlight to define silhouette
    const back = new THREE.DirectionalLight(0xffe7c0, 0.35);
    back.position.set(2, -1, -3);
    scene.add(back);

    // Ground shadow plane
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.ShadowMaterial({ opacity: 0.22 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.0008;
    ground.receiveShadow = true;
    scene.add(ground);

    // Grid — hidden by default, toggled via the toolbar
    const grid = new THREE.GridHelper(8, 32, 0x000000, 0x000000);
    (grid.material as THREE.Material).opacity = 0.06;
    (grid.material as THREE.Material).transparent = true;
    grid.position.y = -0.0005;
    grid.visible = false;
    scene.add(grid);
    stateRef.current.grid = grid;

    stateRef.current.scene = scene;
    stateRef.current.camera = camera;
    stateRef.current.renderer = renderer;

    // Orbit controls
    let isDragging = false, lastX = 0, lastY = 0;
    const onDown = (e: MouseEvent | TouchEvent) => {
      isDragging = true;
      const src = "touches" in e ? e.touches[0] : e;
      lastX = src?.clientX ?? 0;
      lastY = src?.clientY ?? 0;
    };
    const onUp = () => { isDragging = false; };
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!isDragging) return;
      const src = "touches" in e ? e.touches[0] : e;
      const cx = src?.clientX ?? lastX;
      const cy = src?.clientY ?? lastY;
      stateRef.current.rotY += (cx - lastX) * 0.008;
      stateRef.current.rotX = Math.max(-0.6, Math.min(0.85, stateRef.current.rotX + (cy - lastY) * 0.005));
      lastX = cx; lastY = cy;
    };
    const onWheel = (e: WheelEvent) => {
      stateRef.current.zoom = Math.max(0.5, Math.min(2.5, stateRef.current.zoom + e.deltaY * 0.001));
    };
    renderer.domElement.addEventListener("mousedown", onDown as EventListener);
    renderer.domElement.addEventListener("touchstart", onDown as EventListener, { passive: true });
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchend", onUp);
    window.addEventListener("mousemove", onMove as EventListener);
    window.addEventListener("touchmove", onMove as EventListener, { passive: true });
    renderer.domElement.addEventListener("wheel", onWheel, { passive: true });

    let rafId: number;
    const tick = () => {
      rafId = requestAnimationFrame(tick);
      const s = stateRef.current;
      if (s.autoRotate) { s.animAngle += 0.006; s.rotY = s.animAngle; }
      const r = 3.2 * s.zoom;
      if (s.camera) {
        s.camera.position.x = Math.sin(s.rotY) * Math.cos(s.rotX) * r;
        s.camera.position.y = Math.sin(s.rotX) * r + 0.3;
        s.camera.position.z = Math.cos(s.rotY) * Math.cos(s.rotX) * r;
        s.camera.lookAt(0, 0.3, 0);
      }
      if (s.renderer && s.scene && s.camera) s.renderer.render(s.scene, s.camera);
    };
    tick();

    const ro = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      if (stateRef.current.camera) {
        stateRef.current.camera.aspect = w / h;
        stateRef.current.camera.updateProjectionMatrix();
      }
      stateRef.current.renderer?.setSize(w, h);
    });
    ro.observe(el);
    onReady?.();

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      renderer.domElement.removeEventListener("mousedown", onDown as EventListener);
      renderer.domElement.removeEventListener("touchstart", onDown as EventListener);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchend", onUp);
      window.removeEventListener("mousemove", onMove as EventListener);
      window.removeEventListener("touchmove", onMove as EventListener);
      stateRef.current.pmrem?.dispose();
      stateRef.current.defaultEnv?.dispose();
      renderer.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuild mesh when config changes
  useEffect(() => {
    const { scene } = stateRef.current;
    if (!scene) return;
    if (stateRef.current.meshGroup) {
      scene.remove(stateRef.current.meshGroup);
      stateRef.current.meshGroup.traverse((c) => {
        if (c instanceof THREE.Mesh) {
          c.geometry.dispose();
          if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
          else (c.material as THREE.Material).dispose();
        }
      });
    }
    const group = buildBoxMesh(config, stateRef.current.currentTexture);
    scene.add(group);
    stateRef.current.meshGroup = group;
  }, [config]);

  // Update texture when SVG changes
  useEffect(() => {
    if (!dielineSvg) {
      if (stateRef.current.currentTexture) {
        stateRef.current.currentTexture.dispose();
        stateRef.current.currentTexture = null;
      }
      return;
    }
    const blob = new Blob([dielineSvg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    let cancelled = false;

    const img = new window.Image();
    img.onload = () => {
      if (cancelled) { URL.revokeObjectURL(url); return; }
      const canvas = document.createElement("canvas");
      canvas.width = 1024; canvas.height = 768;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, 1024, 768);
      URL.revokeObjectURL(url);

      if (stateRef.current.currentTexture) stateRef.current.currentTexture.dispose();
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = true;
      tex.anisotropy = 8;
      tex.needsUpdate = true;
      stateRef.current.currentTexture = tex;

      // If a custom model is loaded, update its texture and skip rebuilding the box
      if (stateRef.current.customGroup) {
        applyTextureToCustomMeshes(stateRef.current, tex, customMeshTextureSettings, customTextureMeshIndices ?? []);
        return;
      }

      const { scene } = stateRef.current;
      if (!scene) return;
      if (stateRef.current.meshGroup) {
        scene.remove(stateRef.current.meshGroup);
        stateRef.current.meshGroup.traverse((c) => {
          if (c instanceof THREE.Mesh) {
            c.geometry.dispose();
            if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
            else (c.material as THREE.Material).dispose();
          }
        });
      }
      const group = buildBoxMesh(config, tex);
      scene.add(group);
      stateRef.current.meshGroup = group;
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dielineSvg]);

  // ── Custom 3D model loading ─────────────────────────────────────────────────
  useEffect(() => {
    const s = stateRef.current;
    if (!s.scene) return;

    // Helper: dispose and remove the custom group
    function dropCustom() {
      if (!s.customGroup) return;
      s.scene!.remove(s.customGroup);
      s.customGroup.traverse((c) => {
        if (c instanceof THREE.Mesh) {
          c.geometry.dispose();
          const mats = Array.isArray(c.material) ? c.material : [c.material];
          mats.forEach((m) => {
            const meshMat = m as THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;
            const ud = meshMat.userData as { customMap?: THREE.Texture | null };
            if (ud.customMap) {
              ud.customMap.dispose();
              ud.customMap = null;
            }
            (m as THREE.Material).dispose();
          });
        }
      });
      s.customGroup = null;
      s.customMeshes = [];
    }

    if (!customModelUrl) {
      dropCustom();
      // Restore procedural box visibility
      if (s.meshGroup) s.meshGroup.visible = true;
      return;
    }

    // Hide procedural box while custom model is shown
    if (s.meshGroup) s.meshGroup.visible = false;
    dropCustom();

    const loader = new GLTFLoader();
    let cancelled = false;
    loader.load(
      customModelUrl,
      (gltf) => {
        if (cancelled) return;

        // Centre + normalise scale so the model fits the viewer
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 1.6 / maxDim;
        gltf.scene.scale.setScalar(scale);

        const centre = new THREE.Vector3();
        box.getCenter(centre);
        gltf.scene.position.sub(centre.multiplyScalar(scale));

        // Collect all meshes
        const meshes: THREE.Mesh[] = [];
        gltf.scene.traverse((c) => {
          if (c instanceof THREE.Mesh) meshes.push(c);
        });
        s.customMeshes = meshes;
        s.customGroup = gltf.scene;
        s.scene!.add(gltf.scene);

        // Notify parent with mesh names
        if (onCustomModelLoaded) {
          onCustomModelLoaded(meshes.map((m, i) => ({ index: i, name: m.name || `Mesh ${i + 1}` })));
        }

        // Apply current texture to selected meshes immediately
        applyTextureToCustomMeshes(s, s.currentTexture, customMeshTextureSettings, customTextureMeshIndices ?? []);
      },
      undefined,
      (err) => console.error("GLTFLoader error", err),
    );

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customModelUrl]);

  // ── Apply texture to custom mesh selection ──────────────────────────────────
  useEffect(() => {
    const s = stateRef.current;
    if (!s.customGroup) return;
    applyTextureToCustomMeshes(s, s.currentTexture, customMeshTextureSettings, customTextureMeshIndices ?? []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customTextureMeshIndices, customMeshTextureSettings]);

  // Background / panorama
  useEffect(() => {
    const s = stateRef.current;
    if (!s.scene) return;
    let cancelled = false;

    // Always drop any previously loaded panorama texture first.
    if (s.bgTexture) {
      s.bgTexture.dispose();
      s.bgTexture = null;
    }

    if (!bgUrl) {
      // Explicitly restore plain studio background — this is the Clean BG path.
      s.scene.background = new THREE.Color(0xf5f4f0);
      s.scene.environment = s.defaultEnv;
      return;
    }

    const loader = new THREE.TextureLoader();
    loader.load(
      bgUrl,
      (tex) => {
        if (cancelled) { tex.dispose(); return; }
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        s.bgTexture = tex;
        s.scene!.background = tex;
        s.scene!.environment = tex;
      },
      undefined,
      () => { /* silently ignore load errors */ },
    );

    return () => { cancelled = true; };
  }, [bgUrl]);

  return <div ref={mountRef} style={{ width: "100%", height: "100%", cursor: "grab" }} />;
});
