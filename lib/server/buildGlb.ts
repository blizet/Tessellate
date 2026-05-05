/**
 * Pure Node.js GLB builder — no Three.js, no canvas, no WebGL needed.
 *
 * Writes a valid GLTF 2.0 binary (.glb) with:
 *  - A box mesh (24 verts / 6 faces / 12 triangles)
 *  - Per-face UV coordinates that map to a standard cross-shaped dieline net
 *  - The dieline PNG embedded directly as the base-colour texture
 *
 * Scene background is handled in the Three.js viewer via equirectangular env;
 * no backdrop plane is embedded in the GLB.
 */
import sharp from "sharp";
import type { BoxType } from "@/lib/constants/boxTypes";

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Round up to the next multiple of 4 (GLB alignment requirement). */
function pad4(n: number): number {
  return (n + 3) & ~3;
}

// ─── geometry ────────────────────────────────────────────────────────────────

interface V3 { x: number; y: number; z: number }
interface V2 { u: number; v: number }

interface FaceDef {
  /** 4 vertices in CCW order when viewed from outside */
  verts: [V3, V3, V3, V3];
  normal: V3;
  /** UV (u, v) per vertex; GLTF UV origin = upper-left (v ↓) */
  uvs: [V2, V2, V2, V2];
}

/**
 * UV grid constants — match the cross-net dieline image layout exactly.
 *
 * The dieline image is 1024 × 768 px (4 cols × 3 rows, each cell 256 × 256 px).
 *
 *   col 0 (u=0..¼)   col 1 (u=¼..½)   col 2 (u=½..¾)   col 3 (u=¾..1)
 *   row 0 (v=0..⅓):  [  bg  ]          [  TOP  ]         [  bg  ]  [  bg  ]
 *   row 1 (v=⅓..⅔):  [ LEFT ]          [ FRONT ]         [ RIGHT]  [ BACK ]
 *   row 2 (v=⅔..1 ): [  bg  ]          [BOTTOM ]         [  bg  ]  [  bg  ]
 *
 * GLTF UV origin = upper-left, v increases downward — matches image coords.
 */
const UV = {
  c0: 0,          // left column left edge
  c1: 0.25,       // front column left edge
  c2: 0.50,       // right column left edge
  c3: 0.75,       // back column left edge
  c4: 1.0,        // back column right edge
  r0: 0,          // top row top edge
  r1: 1 / 3,      // middle row top edge  (exactly y=256 in 768-tall image)
  r2: 2 / 3,      // bottom row top edge  (exactly y=512 in 768-tall image)
  r3: 1.0,        // bottom row bottom edge
};

/**
 * Build the 6 faces of a box.
 * Each face's UV corners reference the correct panel in the cross-net layout.
 * Vertex winding: CCW when viewed from outside (right-hand rule, +Y up).
 * UV vertex order matches: [bottom-left, bottom-right, top-right, top-left] in 3D space.
 */
function buildBoxFaces(sx: number, sy: number, sz: number): FaceDef[] {
  const hw = sx / 2;
  const hh = sy / 2;
  const hd = sz / 2;

  return [
    // ── Front (+Z) → col 1, row 1 ─────────────────────────────────────────
    {
      verts: [
        { x: -hw, y: -hh, z: +hd }, // BL
        { x: +hw, y: -hh, z: +hd }, // BR
        { x: +hw, y: +hh, z: +hd }, // TR
        { x: -hw, y: +hh, z: +hd }, // TL
      ],
      normal: { x: 0, y: 0, z: 1 },
      uvs: [
        { u: UV.c1, v: UV.r2 }, // BL → lower-left of FRONT panel
        { u: UV.c2, v: UV.r2 }, // BR → lower-right
        { u: UV.c2, v: UV.r1 }, // TR → upper-right
        { u: UV.c1, v: UV.r1 }, // TL → upper-left
      ],
    },
    // ── Back (−Z) → col 3, row 1 ──────────────────────────────────────────
    {
      verts: [
        { x: +hw, y: -hh, z: -hd },
        { x: -hw, y: -hh, z: -hd },
        { x: -hw, y: +hh, z: -hd },
        { x: +hw, y: +hh, z: -hd },
      ],
      normal: { x: 0, y: 0, z: -1 },
      uvs: [
        { u: UV.c3, v: UV.r2 },
        { u: UV.c4, v: UV.r2 },
        { u: UV.c4, v: UV.r1 },
        { u: UV.c3, v: UV.r1 },
      ],
    },
    // ── Top (+Y) → col 1, row 0 ───────────────────────────────────────────
    {
      verts: [
        { x: -hw, y: +hh, z: -hd },
        { x: +hw, y: +hh, z: -hd },
        { x: +hw, y: +hh, z: +hd },
        { x: -hw, y: +hh, z: +hd },
      ],
      normal: { x: 0, y: 1, z: 0 },
      uvs: [
        { u: UV.c1, v: UV.r1 }, // bottom of top-row = top edge of FRONT
        { u: UV.c2, v: UV.r1 },
        { u: UV.c2, v: UV.r0 },
        { u: UV.c1, v: UV.r0 },
      ],
    },
    // ── Bottom (−Y) → col 1, row 2 ────────────────────────────────────────
    {
      verts: [
        { x: -hw, y: -hh, z: +hd },
        { x: +hw, y: -hh, z: +hd },
        { x: +hw, y: -hh, z: -hd },
        { x: -hw, y: -hh, z: -hd },
      ],
      normal: { x: 0, y: -1, z: 0 },
      uvs: [
        { u: UV.c1, v: UV.r2 },
        { u: UV.c2, v: UV.r2 },
        { u: UV.c2, v: UV.r3 },
        { u: UV.c1, v: UV.r3 },
      ],
    },
    // ── Left (−X) → col 0, row 1 ──────────────────────────────────────────
    {
      verts: [
        { x: -hw, y: -hh, z: -hd },
        { x: -hw, y: -hh, z: +hd },
        { x: -hw, y: +hh, z: +hd },
        { x: -hw, y: +hh, z: -hd },
      ],
      normal: { x: -1, y: 0, z: 0 },
      uvs: [
        { u: UV.c0, v: UV.r2 },
        { u: UV.c1, v: UV.r2 },
        { u: UV.c1, v: UV.r1 },
        { u: UV.c0, v: UV.r1 },
      ],
    },
    // ── Right (+X) → col 2, row 1 ─────────────────────────────────────────
    {
      verts: [
        { x: +hw, y: -hh, z: +hd },
        { x: +hw, y: -hh, z: -hd },
        { x: +hw, y: +hh, z: -hd },
        { x: +hw, y: +hh, z: +hd },
      ],
      normal: { x: 1, y: 0, z: 0 },
      uvs: [
        { u: UV.c2, v: UV.r2 },
        { u: UV.c3, v: UV.r2 },
        { u: UV.c3, v: UV.r1 },
        { u: UV.c2, v: UV.r1 },
      ],
    },
  ];
}

function buildBottleFaces(sx: number, sy: number, sz: number): FaceDef[] {
  const radiusX = sx / 2;
  const radiusZ = sz / 2;
  const hh = sy / 2;
  const segments = 32;
  const faces: FaceDef[] = [];

  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const p0 = { x: Math.cos(a0) * radiusX, y: -hh, z: Math.sin(a0) * radiusZ };
    const p1 = { x: Math.cos(a1) * radiusX, y: -hh, z: Math.sin(a1) * radiusZ };
    const p2 = { x: Math.cos(a1) * radiusX, y: +hh, z: Math.sin(a1) * radiusZ };
    const p3 = { x: Math.cos(a0) * radiusX, y: +hh, z: Math.sin(a0) * radiusZ };
    const mid = (a0 + a1) / 2;
    faces.push({
      verts: [p0, p1, p2, p3],
      normal: { x: Math.cos(mid), y: 0, z: Math.sin(mid) },
      uvs: [
        { u: i / segments, v: UV.r2 },
        { u: (i + 1) / segments, v: UV.r2 },
        { u: (i + 1) / segments, v: UV.r1 },
        { u: i / segments, v: UV.r1 },
      ],
    });
  }

  const topCenter = { x: 0, y: +hh, z: 0 };
  const bottomCenter = { x: 0, y: -hh, z: 0 };
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const top0 = { x: Math.cos(a0) * radiusX, y: +hh, z: Math.sin(a0) * radiusZ };
    const top1 = { x: Math.cos(a1) * radiusX, y: +hh, z: Math.sin(a1) * radiusZ };
    const bot0 = { x: Math.cos(a0) * radiusX, y: -hh, z: Math.sin(a0) * radiusZ };
    const bot1 = { x: Math.cos(a1) * radiusX, y: -hh, z: Math.sin(a1) * radiusZ };

    faces.push({
      verts: [topCenter, top0, top1, topCenter],
      normal: { x: 0, y: 1, z: 0 },
      uvs: [
        { u: 0.375, v: 1 / 6 },
        { u: 0.375 + Math.cos(a0) * 0.12, v: 1 / 6 + Math.sin(a0) * 0.12 },
        { u: 0.375 + Math.cos(a1) * 0.12, v: 1 / 6 + Math.sin(a1) * 0.12 },
        { u: 0.375, v: 1 / 6 },
      ],
    });
    faces.push({
      verts: [bottomCenter, bot1, bot0, bottomCenter],
      normal: { x: 0, y: -1, z: 0 },
      uvs: [
        { u: 0.375, v: 5 / 6 },
        { u: 0.375 + Math.cos(a1) * 0.12, v: 5 / 6 + Math.sin(a1) * 0.12 },
        { u: 0.375 + Math.cos(a0) * 0.12, v: 5 / 6 + Math.sin(a0) * 0.12 },
        { u: 0.375, v: 5 / 6 },
      ],
    });
  }

  return faces;
}

function buildTrapezoidFaces(sx: number, sy: number, sz: number): FaceDef[] {
  const bottomW = sx / 2;
  const bottomD = sz / 2;
  const topW = bottomW * 0.62;
  const topD = bottomD * 0.62;
  const hh = sy / 2;

  return [
    {
      verts: [
        { x: -bottomW, y: -hh, z: +bottomD },
        { x: +bottomW, y: -hh, z: +bottomD },
        { x: +topW, y: +hh, z: +topD },
        { x: -topW, y: +hh, z: +topD },
      ],
      normal: { x: 0, y: 0.25, z: 1 },
      uvs: [{ u: UV.c1, v: UV.r2 }, { u: UV.c2, v: UV.r2 }, { u: UV.c2, v: UV.r1 }, { u: UV.c1, v: UV.r1 }],
    },
    {
      verts: [
        { x: +bottomW, y: -hh, z: -bottomD },
        { x: -bottomW, y: -hh, z: -bottomD },
        { x: -topW, y: +hh, z: -topD },
        { x: +topW, y: +hh, z: -topD },
      ],
      normal: { x: 0, y: 0.25, z: -1 },
      uvs: [{ u: UV.c3, v: UV.r2 }, { u: UV.c4, v: UV.r2 }, { u: UV.c4, v: UV.r1 }, { u: UV.c3, v: UV.r1 }],
    },
    {
      verts: [
        { x: -bottomW, y: -hh, z: -bottomD },
        { x: -bottomW, y: -hh, z: +bottomD },
        { x: -topW, y: +hh, z: +topD },
        { x: -topW, y: +hh, z: -topD },
      ],
      normal: { x: -1, y: 0.25, z: 0 },
      uvs: [{ u: UV.c0, v: UV.r2 }, { u: UV.c1, v: UV.r2 }, { u: UV.c1, v: UV.r1 }, { u: UV.c0, v: UV.r1 }],
    },
    {
      verts: [
        { x: +bottomW, y: -hh, z: +bottomD },
        { x: +bottomW, y: -hh, z: -bottomD },
        { x: +topW, y: +hh, z: -topD },
        { x: +topW, y: +hh, z: +topD },
      ],
      normal: { x: 1, y: 0.25, z: 0 },
      uvs: [{ u: UV.c2, v: UV.r2 }, { u: UV.c3, v: UV.r2 }, { u: UV.c3, v: UV.r1 }, { u: UV.c2, v: UV.r1 }],
    },
    {
      verts: [
        { x: -topW, y: +hh, z: -topD },
        { x: +topW, y: +hh, z: -topD },
        { x: +topW, y: +hh, z: +topD },
        { x: -topW, y: +hh, z: +topD },
      ],
      normal: { x: 0, y: 1, z: 0 },
      uvs: [{ u: UV.c1, v: UV.r1 }, { u: UV.c2, v: UV.r1 }, { u: UV.c2, v: UV.r0 }, { u: UV.c1, v: UV.r0 }],
    },
    {
      verts: [
        { x: -bottomW, y: -hh, z: +bottomD },
        { x: +bottomW, y: -hh, z: +bottomD },
        { x: +bottomW, y: -hh, z: -bottomD },
        { x: -bottomW, y: -hh, z: -bottomD },
      ],
      normal: { x: 0, y: -1, z: 0 },
      uvs: [{ u: UV.c1, v: UV.r2 }, { u: UV.c2, v: UV.r2 }, { u: UV.c2, v: UV.r3 }, { u: UV.c1, v: UV.r3 }],
    },
  ];
}

function buildFacesForTemplate(
  boxType: BoxType,
  sx: number,
  sy: number,
  sz: number,
): FaceDef[] {
  switch (boxType) {
    case "bottle":
      return buildBottleFaces(sx, sy, sz);
    case "trapezoid":
      return buildTrapezoidFaces(sx, sy, sz);
    case "vertical_box":
    case "horizontal_box":
    case "cake_box":
      return buildBoxFaces(sx, sy, sz);
  }
}

// ─── GLB binary assembly ─────────────────────────────────────────────────────

/**
 * Build a self-contained GLB buffer from a PNG texture and box dimensions.
 * No browser, canvas, or WebGL is required.
 */
function buildGlbBuffer(
  dielinePng: Buffer,
  dims: { width: number; height: number; depth: number },
  boxType: BoxType,
): Buffer {
  const maxDim = Math.max(dims.width, dims.height, dims.depth, 1);
  const sx = dims.width / maxDim;
  const sy = dims.height / maxDim;
  const sz = dims.depth / maxDim;

  const faces = buildFacesForTemplate(boxType, sx, sy, sz);
  const vertCount = faces.length * 4; // 24
  const idxCount = faces.length * 6;  // 36 (2 triangles × 3 verts × 6 faces)

  const positions = new Float32Array(vertCount * 3);
  const normals   = new Float32Array(vertCount * 3);
  const uvs       = new Float32Array(vertCount * 2);
  const indices   = new Uint16Array(idxCount);

  let pi = 0, ni = 0, ui = 0, ii = 0, base = 0;
  for (const face of faces) {
    for (const v of face.verts) {
      positions[pi++] = v.x; positions[pi++] = v.y; positions[pi++] = v.z;
      normals[ni++]   = face.normal.x; normals[ni++] = face.normal.y; normals[ni++] = face.normal.z;
    }
    for (const uv of face.uvs) {
      uvs[ui++] = uv.u; uvs[ui++] = uv.v;
    }
    // Triangle 0 (0-1-2) and triangle 1 (0-2-3)
    indices[ii++] = base;   indices[ii++] = base+1; indices[ii++] = base+2;
    indices[ii++] = base;   indices[ii++] = base+2; indices[ii++] = base+3;
    base += 4;
  }

  // ── BIN chunk layout ─────────────────────────────────────────────────────
  const posOff  = 0;                        const posLen  = positions.byteLength;
  const normOff = pad4(posOff  + posLen);   const normLen = normals.byteLength;
  const uvOff   = pad4(normOff + normLen);  const uvLen   = uvs.byteLength;
  const idxOff  = pad4(uvOff   + uvLen);   const idxLen  = indices.byteLength;
  const imgOff  = pad4(idxOff  + idxLen);  const imgLen  = dielinePng.length;
  const binLen  = pad4(imgOff  + imgLen);

  const bin = Buffer.alloc(binLen, 0);
  Buffer.from(positions.buffer as ArrayBuffer).copy(bin, posOff);
  Buffer.from(normals.buffer   as ArrayBuffer).copy(bin, normOff);
  Buffer.from(uvs.buffer       as ArrayBuffer).copy(bin, uvOff);
  Buffer.from(indices.buffer   as ArrayBuffer).copy(bin, idxOff);
  dielinePng.copy(bin, imgOff);

  // ── GLTF JSON ─────────────────────────────────────────────────────────────
  const nodes: object[] = [{ mesh: 0, name: "PackagingBox" }];
  const meshes: object[] = [{
    name: "PackagingBox",
    primitives: [{
      attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
      indices: 3,
      material: 0,
      mode: 4,
    }],
  }];
  const materials: object[] = [{
    name: "PackagingMaterial",
    pbrMetallicRoughness: {
      baseColorTexture: { index: 0 },
      metallicFactor: 0.04,
      roughnessFactor: 0.58,
    },
    doubleSided: true,
  }];
  const textures: object[] = [{ source: 0, sampler: 0 }];
  const images: object[]   = [{ mimeType: "image/png", bufferView: 4 }];
  const samplers: object[] = [{
    magFilter: 9729,   // LINEAR
    minFilter: 9987,   // LINEAR_MIPMAP_LINEAR
    wrapS:    10497,   // REPEAT
    wrapT:    10497,
  }];
  const halfW = sx / 2, halfH = sy / 2, halfD = sz / 2;
  const accessors: object[] = [
    { bufferView: 0, byteOffset: 0, componentType: 5126 /* FLOAT */, count: vertCount, type: "VEC3",
      min: [-halfW, -halfH, -halfD], max: [halfW, halfH, halfD] },
    { bufferView: 1, byteOffset: 0, componentType: 5126, count: vertCount, type: "VEC3" },
    { bufferView: 2, byteOffset: 0, componentType: 5126, count: vertCount, type: "VEC2" },
    { bufferView: 3, byteOffset: 0, componentType: 5123 /* UNSIGNED_SHORT */, count: idxCount, type: "SCALAR" },
  ];
  const bufferViews: object[] = [
    { buffer: 0, byteOffset: posOff,  byteLength: posLen,  target: 34962 }, // ARRAY_BUFFER
    { buffer: 0, byteOffset: normOff, byteLength: normLen, target: 34962 },
    { buffer: 0, byteOffset: uvOff,   byteLength: uvLen,   target: 34962 },
    { buffer: 0, byteOffset: idxOff,  byteLength: idxLen,  target: 34963 }, // ELEMENT_ARRAY_BUFFER
    { buffer: 0, byteOffset: imgOff,  byteLength: imgLen  },                // texture image
  ];

  const sceneNodeIndices = nodes.map((_, i) => i);
  const gltfJson = {
    asset: { version: "2.0", generator: "tessellate/1.0" },
    scene: 0,
    scenes: [{ nodes: sceneNodeIndices }],
    nodes,
    meshes,
    materials,
    textures,
    samplers,
    images,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binLen }],
  };

  const jsonBuf    = Buffer.from(JSON.stringify(gltfJson), "utf8");
  const jsonPadLen = pad4(jsonBuf.length);
  const totalLen   = 12 + 8 + jsonPadLen + 8 + binLen;

  const glb = Buffer.alloc(totalLen);
  let off = 0;

  // GLB header
  glb.writeUInt32LE(0x46546c67, off); off += 4; // 'glTF'
  glb.writeUInt32LE(2,          off); off += 4; // version 2
  glb.writeUInt32LE(totalLen,   off); off += 4;

  // JSON chunk
  glb.writeUInt32LE(jsonPadLen,   off); off += 4;
  glb.writeUInt32LE(0x4e4f534a,   off); off += 4; // 'JSON'
  jsonBuf.copy(glb, off);
  glb.fill(0x20, off + jsonBuf.length, off + jsonPadLen); // pad with spaces
  off += jsonPadLen;

  // BIN chunk
  glb.writeUInt32LE(binLen,      off); off += 4;
  glb.writeUInt32LE(0x004e4942,  off); off += 4; // 'BIN\0'
  bin.copy(glb, off);

  return glb;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function buildGlbFromDieline(options: {
  dielineBuffer: Buffer;
  backgroundBuffer?: Buffer | null;
  boxType: BoxType;
  dimensionsMm: { width: number; height: number; depth: number };
  lightingIntensity: number; // kept for API compat, baked into material
}): Promise<{
  glb: Buffer;
  previewPng: Buffer;
  trianglesCount: number;
  materialsCount: number;
}> {
  // Resize to 1024×768 (4 cols × 3 rows, 256×256 px per cell)
  // This MUST match the cross-net UV layout defined in buildBoxFaces / UV constants.
  const dielinePng = await sharp(options.dielineBuffer)
    .ensureAlpha()
    .resize(1024, 768, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toBuffer();

  // Background is applied as equirectangular env in the Three.js viewer,
  // not embedded as a flat quad in the GLB.
  const glb = buildGlbBuffer(dielinePng, options.dimensionsMm, options.boxType);

  const previewPng = await sharp(options.dielineBuffer)
    .resize(512, 512, { fit: "inside" })
    .png()
    .toBuffer();

  return {
    glb,
    previewPng,
    trianglesCount: options.boxType === "bottle" ? 192 : 12,
    materialsCount: 1,
  };
}
