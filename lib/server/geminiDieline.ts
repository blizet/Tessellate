import { GoogleGenAI, Modality } from "@google/genai";
import sharp from "sharp";
import type { BoxType } from "@/lib/constants/boxTypes";

/** Nano Banana 2 — Gemini 3.1 Flash Image Preview */
const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image-preview";

function usesImagenModel(model: string): boolean {
  return /^imagen/i.test(model.trim());
}

function bufferFromImageBytes(
  bytes: string | Uint8Array | undefined | null,
): Buffer | null {
  if (!bytes) return null;
  if (typeof bytes === "string") return Buffer.from(bytes, "base64");
  return Buffer.from(bytes);
}

function extractInlineImageBytes(response: unknown): Buffer | null {
  if (!response || typeof response !== "object") return null;
  const candidates = (response as { candidates?: unknown[] }).candidates;
  const first = candidates?.[0];
  if (!first || typeof first !== "object") return null;
  const parts = (first as { content?: { parts?: unknown[] } }).content?.parts;
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const inline = (part as { inlineData?: { data?: string } }).inlineData;
    const data = inline?.data;
    if (typeof data === "string" && data.length > 0) {
      return Buffer.from(data, "base64");
    }
  }
  return null;
}

// ─── Per-box-type dieline specifications ─────────────────────────────────────

type BoxMeta = {
  netShape: string;
  panelList: string[];
  frontPanel: string;
  sidePanel: string;
  topBottomPanels: string;
  flapNotes: string;
  dimensionAxes: string;
  aspectHint: string; // rough W:H ratio of the whole net image
};

const BOX_META: Record<string, BoxMeta> = {
  vertical_box: {
    netShape: "vertical cross / T-shape",
    panelList: [
      "TUCK FLAP (top, narrow strip with rounded lock tab)",
      "TOP PANEL (tall, full width)",
      "BACK PANEL (tall, center-left column)",
      "LEFT SIDE PANEL (narrow column, text rotated 90°)",
      "BOTTOM PANEL (tall, center-right column)",
      "INNER FRONT / DUST FLAP (narrow strip at bottom)",
      "RIGHT SIDE PANEL (narrow column on far right, text rotated 90°)",
      "GLUE TAB (narrow strip on far left)",
    ],
    frontPanel: "TOP PANEL (the main front face of the erected box)",
    sidePanel: "LEFT SIDE PANEL and RIGHT SIDE PANEL (narrow, flanking the front/back)",
    topBottomPanels: "TUCK FLAP (top lock) and INNER FRONT (bottom dust flap)",
    flapNotes:
      "The tuck flap has a semicircular lock notch. The glue tab is on the far left and will be glued to the right side panel edge.",
    dimensionAxes:
      "H = height of the box (vertical span of BACK/TOP panels), W = width (horizontal span of side panels), L = depth (not visible in net, implicit in side panel width)",
    aspectHint: "roughly 2:3 width-to-height for the overall net",
  },
  horizontal_box: {
    netShape: "horizontal cross / T-shape (landscape orientation)",
    panelList: [
      "TUCK FLAP (top, narrow strip)",
      "TOP PANEL (wide, landscape)",
      "BACK PANEL (wide, center row)",
      "LEFT SIDE PANEL (narrow, left end, text rotated 90°)",
      "BOTTOM PANEL (wide, center row below back)",
      "INNER FRONT (narrow strip at bottom)",
      "RIGHT SIDE PANEL (narrow, right end, text rotated 90°)",
      "GLUE TAB (narrow strip)",
    ],
    frontPanel: "TOP PANEL (wide landscape front face)",
    sidePanel: "LEFT SIDE PANEL and RIGHT SIDE PANEL",
    topBottomPanels: "TUCK FLAP and INNER FRONT",
    flapNotes: "Tuck flap has a lock tab. Glue tab on one end.",
    dimensionAxes: "W = width (long axis), H = height (short axis), L = depth (side panel width)",
    aspectHint: "roughly 3:2 width-to-height for the overall net (landscape)",
  },
  bottle: {
    netShape: "tall rectangular strip (wraparound label)",
    panelList: [
      "FRONT LABEL ZONE (left two-thirds of the strip)",
      "BACK LABEL ZONE (right one-third of the strip)",
      "SEAM / OVERLAP TAB (narrow strip on far right, ~6 mm)",
    ],
    frontPanel: "FRONT LABEL ZONE",
    sidePanel: "none — this is a wrap-around label",
    topBottomPanels: "Top edge and bottom edge (no flaps — open tube)",
    flapNotes:
      "Seam tab on the right glues to the left edge. A vertical dashed line separates FRONT ZONE from BACK ZONE at roughly the 66% mark.",
    dimensionAxes: "H = label height, W = circumference (width of the strip), L = not applicable",
    aspectHint: "TALL VERTICAL orientation — roughly 1:2.8 width-to-height for the label strip (much taller than wide, like a bottle label)",
  },
  cake_box: {
    netShape: "cross / plus shape with rounded corners — premium bakery box with domed lid",
    panelList: [
      "BASE PANEL (square at center with rounded corners)",
      "FRONT SIDE PANEL (folds up from base bottom edge, with rounded top edge)",
      "BACK SIDE PANEL (folds up from base top edge, with rounded top edge)",
      "LEFT SIDE PANEL (folds up from base left edge, rounded top, text rotated 90°)",
      "RIGHT SIDE PANEL (folds up from base right edge, rounded top, text rotated 90°)",
      "ROUNDED CORNER FLAPS (curved flaps at corners where side panels meet, 4 total)",
      "LID SECTION (optional domed/curved lid top that curves upward)",
    ],
    frontPanel: "FRONT SIDE PANEL (primary display area with circular logo placement)",
    sidePanel: "LEFT SIDE PANEL and RIGHT SIDE PANEL (secondary branding, curved design)",
    topBottomPanels: "BACK SIDE PANEL (back face design) and curved corner elements",
    flapNotes:
      "Curved corner flaps create elegant rounded transitions. All edges feature smooth curves rather than sharp corners for premium bakery appearance. Fold lines should be clean and precise.",
    dimensionAxes: "L = length of base, W = width of base, H = height of side panels",
    aspectHint: "roughly 1:1 (square) for the overall net",
  },
  business_card: {
    netShape: "two side-by-side rectangles (front and back faces)",
    panelList: [
      "FRONT FACE (left rectangle, 90 × 55 mm, landscape)",
      "BACK FACE (right rectangle, 90 × 55 mm, landscape)",
    ],
    frontPanel: "FRONT FACE",
    sidePanel: "none",
    topBottomPanels: "none",
    flapNotes: "No folding or flaps. A 3 mm bleed zone is shown as a dashed inner border on both faces.",
    dimensionAxes: "W = 90 mm, H = 55 mm (per face)",
    aspectHint: "roughly 4:1 width-to-height for both faces side by side",
  },
  trapezoid: {
    netShape: "star / pinwheel shape — trapezoidal panels fan out from a rectangular base",
    panelList: [
      "BASE PANEL (rectangle at center)",
      "FRONT TRAPEZOIDAL SIDE (wider at base edge, narrower at top)",
      "BACK TRAPEZOIDAL SIDE (mirror of front)",
      "LEFT TRAPEZOIDAL SIDE (text rotated 90°)",
      "RIGHT TRAPEZOIDAL SIDE (text rotated 90°)",
      "SMALL GLUE TABS (at the angled edges of each trapezoidal panel)",
    ],
    frontPanel: "FRONT TRAPEZOIDAL SIDE",
    sidePanel: "LEFT TRAPEZOIDAL SIDE and RIGHT TRAPEZOIDAL SIDE",
    topBottomPanels: "BACK TRAPEZOIDAL SIDE",
    flapNotes:
      "Each trapezoidal panel has angled edges with small glue tabs. The wider edge connects to the base; the narrower edge forms the top opening.",
    dimensionAxes: "L = base length, W = base width, H = slant height of side panels",
    aspectHint: "roughly 1:1 (square) for the overall net",
  },
};

const TEMPLATE_REFERENCES: Record<BoxType, string> = {
  vertical_box:
    "Use the vertical folding-carton dieline reference: a tall narrow carton net with four main vertical body panels in a row, top and bottom tuck flaps, side glue tab, rounded locking tabs, solid outer cut line, and dashed vertical crease lines.",
  horizontal_box:
    "Use the horizontal box dieline reference: a squat landscape carton with a large central rectangle, wide top flap with rounded corners and a small thumb notch, side flaps on left and right, bottom flap, dashed fold lines, and W/H/L dimension arrows around the central panel.",
  bottle:
    "Use the bottle packaging reference: a TALL VERTICAL rectangular label strip (portrait orientation, much taller than it is wide) that wraps around a cylindrical bottle. The label should be divided by a vertical dashed line separating FRONT LABEL ZONE from BACK LABEL ZONE. A narrow seam tab is on the right edge. The overall strip is DISTINCTLY TALL and ELONGATED VERTICALLY, not horizontal.",
  trapezoid:
    "Use the trapezoid dieline reference: a tapered central body with trapezoid panels, curved side lobes, angled crease lines radiating from the central rectangles, a top flap with perforation waves, and a scalloped lower edge.",
  cake_box:
    "Use the cake box dieline reference: a premium bakery-style cake box net with a square base center, rounded domed top lid section, and four side panels folding upward. Features include: curved/rounded edges throughout, a prominent circular logo placement on the front face, smooth curved corners (no sharp angles), and clean fold lines. The overall silhouette is elegant and bakery-appropriate with a professional finish.",
};

// ─── Cross-net UV grid (must match buildGlb UV constants) ────────────────────
//
//  Canvas: 1024 × 768 px  →  4 cols × 3 rows, each cell 256 × 256 px
//
//  col 0 (x=0..256)    col 1 (x=256..512)   col 2 (x=512..768)   col 3 (x=768..1024)
//  row 0 (y=0..256):   [  bg  ]              [  TOP PANEL  ]       [  bg  ]  [  bg  ]
//  row 1 (y=256..512): [ LEFT ]              [ FRONT PANEL ]       [ RIGHT]  [ BACK ]
//  row 2 (y=512..768): [  bg  ]              [BOTTOM PANEL ]       [  bg  ]  [  bg  ]
//
//  "bg" cells are background colour — not visible on the 3D model.
//  The 3D UV map reads EXACTLY these pixel boundaries from the texture.

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildDielinePrompt(params: {
  businessName: string;
  tagline?: string;
  printDescription: string;
  boxType: BoxType;
  style?: string;
  hasLogo: boolean;
  dims?: { width: number; height: number; depth: number };
}): string {
  const meta = BOX_META[params.boxType];
  const style = params.style?.trim() || "clean minimalist modern";
  const tagline = params.tagline?.trim();
  const dimNote = params.dims
    ? `Approx. dimensions: W=${params.dims.width} mm × H=${params.dims.height} mm × D=${params.dims.depth} mm.`
    : "";

  return `
You are a senior technical packaging designer creating a professional 2D dieline (structural net) artwork image for a ${params.boxType.replace(/_/g, " ")}. ${dimNote}

CRITICAL TEMPLATE REFERENCE:
${TEMPLATE_REFERENCES[params.boxType]}

Draw that exact style of flat dieline silhouette for the selected template. Do not substitute a generic box cross. Keep it flat, centered, print-ready, and structurally believable.
If any layout instruction conflicts with the selected reference silhouette, the selected reference silhouette wins.

━━━ CRITICAL: EXACT PIXEL LAYOUT FOR 3D UV MAPPING ━━━

The 3D renderer reads this image at fixed pixel boundaries.
Your image MUST be 4:3 landscape (e.g. 1024 × 768 px).
Divide the canvas into 4 equal columns and 3 equal rows → 12 cells of 256 × 256 px each.

  col 0 (x=0..25%)     col 1 (x=25..50%)    col 2 (x=50..75%)    col 3 (x=75..100%)
  row 0 (y=0..33%):    [ background ]        [ TOP PANEL    ]      [ background ]  [ background ]
  row 1 (y=33..67%):   [ LEFT PANEL ]        [ FRONT PANEL  ]      [ RIGHT PANEL]  [ BACK PANEL ]
  row 2 (y=67..100%):  [ background ]        [ BOTTOM PANEL ]      [ background ]  [ background ]

"background" cells = plain background colour only — DO NOT put packaging content there.
Each active cell must contain the artwork for its corresponding face of the 3D box.
The cross-shape formed by the 6 active cells is the ONLY area a print shop (or the 3D renderer) uses.

━━━ STRUCTURAL SPECIFICATION ━━━

NET SHAPE: ${meta.netShape} — laid out in the cross grid above

PANEL CONTENT per grid cell:
${meta.panelList.map((p, i) => `  ${i + 1}. ${p}`).join("\n")}

FRONT / HERO PANEL (col 1, row 1 = center cell): ${meta.frontPanel}
SIDE PANELS (col 0 and col 2, row 1): ${meta.sidePanel}
TOP / BOTTOM (col 1, rows 0 and 2): ${meta.topBottomPanels}
FLAP NOTES: ${meta.flapNotes}
DIMENSION AXES: ${meta.dimensionAxes}

${params.boxType === "bottle" ? `
CRITICAL BOTTLE-SPECIFIC INSTRUCTION:
The bottle label MUST be rendered TALL and VERTICALLY ELONGATED, matching a 200mm height with only ~70mm circumference.
Design the label strip to be MUCH TALLER than it is WIDE within the grid constraint.
The FRONT LABEL ZONE (center cell) and BACK LABEL ZONE must display prominently in the center column with substantial vertical extent.
Avoid horizontal or landscape orientation — this is a portrait-oriented bottle label.
` : ""}

${params.boxType === "cake_box" ? `
CRITICAL CAKE BOX-SPECIFIC INSTRUCTION:
Design a PREMIUM BAKERY-STYLE cake box with these characteristics:
- All edges should feature SMOOTH CURVES and ROUNDED CORNERS (no sharp angles)
- The front panel should have a prominent CIRCULAR LOGO PLACEMENT at the center
- The domed/curved lid appearance should be evident in the design aesthetic
- Four side panels that fold up from the base, each with curved tops
- Clean, elegant fold lines throughout
- The overall impression should be sophisticated bakery packaging, not a plain box
- Include curved decorative corner elements where side panels would meet
- Color palette should be sophisticated (consider soft pastels or elegant whites/creams)
` : ""}

━━━ LINE TYPES (draw ALL four types, include a legend at the bottom) ━━━

- CUT LINES (solid black, 1 pt) — the outer perimeter of the entire net, the die-cut edge
- FOLD / CREASE LINES (dashed black, 0.5 pt, evenly spaced dashes) — every panel-to-panel fold boundary
- PERFORATION LINES (alternating short dash and dot, black) — tuck flap lock notch edges
- GLUE AREA indicator (yellow tint region on the glue tab only)

LEGEND: Draw a small horizontal legend bar at the very bottom of the image showing each line type with a short label: "Cut Line", "Fold/Crease", "Perforation", "Glue Area". Reference image style: "Fold Out | Crease | Perforation | Glue Assistance".

━━━ DIMENSION ANNOTATIONS ━━━

Draw thin arrow dimension lines outside the net boundary showing:
- A double-headed arrow for W (width) below the net
- A double-headed arrow for H (height) on the left side of the net
- Label them "W" and "H" in small caps
Overall net aspect ratio hint: ${meta.aspectHint}

━━━ PANEL LABELS ━━━

Print the structural name of every panel INSIDE its region in small-caps sans-serif text, black, centred:
${meta.panelList.map((p) => `  • ${p.split("(")[0].trim()}`).join("\n")}
Side panel labels must be rotated 90° to match panel orientation.

━━━ BRAND ARTWORK (applied ON TOP of the structure) ━━━

Brand name: ${params.businessName}
Tagline: ${tagline || "No tagline provided"}
Creative brief: ${params.printDescription}
Visual style: ${style}
${params.hasLogo ? "Logo: incorporate the brand logo image (provided) prominently on the front panel." : ""}

Apply branded graphic design artwork ONLY inside the panel boundaries:
- ${meta.frontPanel}: prominent logo if provided, large business name "${params.businessName}", and tagline "${tagline || "subtle short tagline area"}"
- Side panels: brand color accent, smaller brand name or pattern
- Back panel: supplementary info area (barcode placeholder, ingredient list placeholder, website URL line)
- Tuck flaps: minimal colour, no text needed

The brand artwork should look like a real print-ready design — vibrant, intentional, with a cohesive colour palette that matches the style "${style}".

━━━ BACKGROUND & CANVAS ━━━

- Pure white background (#ffffff) with black and yellow artwork only
- The cut-line silhouette of the net is clearly visible against the background
- No drop shadows, no 3D perspective, no photography
- High resolution, crisp edges, flat graphic style
- Overall image should be square or landscape, well-centred, with ~8% margin around the net

━━━ QUALITY BAR ━━━

This image must look indistinguishable from a professional packaging dieline file exported from Adobe Illustrator or ArtiosCAD — the kind a print shop or packaging manufacturer would accept for production. Every fold line, every panel label, every dimension arrow must be present and legible.
`.trim();
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateDielineImage(params: {
  businessName: string;
  tagline?: string;
  printDescription: string;
  boxType: BoxType;
  style?: string;
  logoBuffer?: Buffer | null;
  dims?: { width: number; height: number; depth: number };
}): Promise<{
  pngBuffer: Buffer;
  designNotes: string;
  colorPalette: string[];
  source: "gemini-image" | "imagen" | "fallback";
}> {
  const apiKey = process.env.GEMINI_API_KEY;
  const imageModel =
    process.env.GEMINI_IMAGE_MODEL?.trim() || DEFAULT_GEMINI_IMAGE_MODEL;

  const palette = ["#000000", "#ffffff", "#ffd400"];

  if (apiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey });

      const prompt = buildDielinePrompt({
        businessName: params.businessName,
        tagline: params.tagline,
        printDescription: params.printDescription,
        boxType: params.boxType,
        style: params.style,
        hasLogo: !!params.logoBuffer?.length,
        dims: params.dims,
      });

      let rawImage: Buffer | null = null;
      let source: "gemini-image" | "imagen" = "gemini-image";

      if (usesImagenModel(imageModel)) {
        // ── Imagen path ───────────────────────────────────────────────────
        source = "imagen";
        const response = await ai.models.generateImages({
          model: imageModel,
          prompt,
          config: { numberOfImages: 1 },
        });
        const img = response.generatedImages?.[0]?.image;
        rawImage = bufferFromImageBytes(img?.imageBytes as string | Uint8Array);
      } else {
        // ── Gemini native image path (Nano Banana) ─────────────────────────
        const parts: Array<{
          text?: string;
          inlineData?: { mimeType: string; data: string };
        }> = [{ text: prompt }];

        if (params.logoBuffer?.length) {
          const logoPng = await sharp(params.logoBuffer).png().toBuffer();
          parts.push({
            inlineData: {
              mimeType: "image/png",
              data: logoPng.toString("base64"),
            },
          });
          parts.push({
            text: "The image above is the brand logo. Place it prominently on the front face of the dieline, integrated into the brand artwork.",
          });
        }

        const response = await ai.models.generateContent({
          model: imageModel,
          contents: [{ role: "user", parts }],
          config: {
            responseModalities: [Modality.TEXT, Modality.IMAGE],
          },
        });

        rawImage = extractInlineImageBytes(response);
      }

      if (rawImage && rawImage.length > 100) {
        const pngBuffer = await sharp(rawImage).ensureAlpha().png().toBuffer();

        const composed =
          params.logoBuffer && source === "imagen"
            ? await compositeLogo(pngBuffer, params.logoBuffer)
            : pngBuffer;

        return {
          pngBuffer: composed,
          designNotes: `AI dieline for "${params.businessName}" — ${params.boxType.replace(/_/g, " ")} — ${imageModel}.`,
          colorPalette: palette,
          source,
        };
      }
    } catch (err) {
      console.error("[geminiDieline] API error:", err);
    }
  }

  // ── SVG placeholder fallback ────────────────────────────────────────────────
  const fallback = await buildFallbackDielinePng(params);
  const composed = params.logoBuffer
    ? await compositeLogo(fallback, params.logoBuffer)
    : fallback;

  return {
    pngBuffer: composed,
    designNotes: `Placeholder dieline for "${params.businessName}" (${params.boxType.replace(/_/g, " ")}). Set GEMINI_API_KEY + GEMINI_IMAGE_MODEL=gemini-3.1-flash-image-preview for AI art.`,
    colorPalette: palette,
    source: "fallback",
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function compositeLogo(dieline: Buffer, logo: Buffer): Promise<Buffer> {
  const dl = sharp(dieline).ensureAlpha();
  const meta = await dl.metadata();
  const w = meta.width  ?? 1024;
  const h = meta.height ?? 768;

  // The dieline uses a 4-col × 3-row cross grid (each cell = w/4 × h/3).
  // FRONT panel occupies col-1 · row-1:
  //   x: w/4 .. w/2  →  centre x = 3w/8
  //   y: h/3 .. 2h/3 →  centre y = h/2
  //
  // Logo is sized to ~26% of one cell so it fits neatly inside the FRONT face
  // and roughly replaces the SVG placeholder badge.
  const cellW   = Math.round(w / 4);
  const logoSize = Math.round(cellW * 0.26);          // ≈ 66 px for 1024-wide image
  const cx      = Math.round(w * 3 / 8);             // FRONT panel centre x = 384
  const cy      = Math.round(h / 2) - Math.round(cellW * 0.055); // slightly above panel centre, matching badge y

  const logoBuf = await sharp(logo)
    .resize(logoSize, logoSize, { fit: "inside" })
    .ensureAlpha()
    .png()
    .toBuffer();

  const left = Math.max(0, cx - Math.round(logoSize / 2));
  const top  = Math.max(0, cy - Math.round(logoSize / 2));

  return dl
    .composite([{ input: logoBuf, left, top, blend: "over" }])
    .png()
    .toBuffer();
}

/**
 * Generates a tall vertical bottle label fallback dieline.
 * The bottle label is much TALLER than it is WIDE within the 1024×768 grid.
 * 
 * Layout: Center column (col 1-2) is divided into FRONT and BACK label zones
 * stacked vertically, with a narrow seam tab on the right (col 3).
 */
async function buildFallbackBottleLabel(params: {
  businessName: string;
  tagline?: string;
  printDescription: string;
  boxType: BoxType;
}): Promise<Buffer> {
  const W = 1024;
  const H = 768;
  
  const name  = escapeXml(params.businessName);
  const init  = escapeXml((params.businessName.charAt(0) || "?").toUpperCase());
  const desc  = escapeXml((params.tagline?.trim() || params.printDescription).slice(0, 60));

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"
     viewBox="0 0 ${W} ${H}" font-family="system-ui,Arial,sans-serif">
  <defs>
    <pattern id="hatch-bottle" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="6" stroke="#000000" stroke-width="2"/>
    </pattern>
  </defs>

  <!-- BACKGROUND -->
  <rect width="${W}" height="${H}" fill="#ffffff"/>

  <!-- BOTTLE LABEL STRIP — TALL VERTICAL ORIENTATION -->
  <!-- The wraparound label spans from col 1-2 (center), rows 0-3 (full height) -->
  <!-- Left and right are background, center is the label -->
  
  <!-- FRONT LABEL ZONE (upper two-thirds of center) -->
  <rect x="256" y="20" width="512" height="400" fill="#ffffff" stroke="#000000" stroke-width="2.2"/>
  <rect x="256" y="20" width="512" height="12" fill="#ffd400"/>
  
  <!-- Branding elements in FRONT zone -->
  <circle cx="512" cy="100" r="50" fill="#ffd400" opacity="0.35"/>
  <circle cx="512" cy="100" r="32" fill="#ffd400" opacity="0.65"/>
  <circle cx="512" cy="100" r="20" fill="#000000"/>
  <text x="512" y="108" text-anchor="middle" font-size="24" font-weight="700" fill="#ffffff">${init}</text>
  
  <text x="512" y="190" text-anchor="middle" font-size="24" font-weight="700" fill="#000000">${name}</text>
  <text x="512" y="220" text-anchor="middle" font-size="11" fill="#000000">${desc}</text>
  <text x="512" y="380" text-anchor="middle" font-size="10" font-weight="600" fill="#666666">FRONT LABEL ZONE</text>

  <!-- CENTER DIVIDING LINE (separates FRONT from BACK) -->
  <line x1="256" y1="420" x2="768" y2="420" stroke="#000000" stroke-width="1.5" stroke-dasharray="8 6"/>

  <!-- BACK LABEL ZONE (lower third of center) -->
  <rect x="256" y="420" width="512" height="320" fill="#ffffff" stroke="#000000" stroke-width="2.2"/>
  <text x="512" y="480" text-anchor="middle" font-size="14" font-weight="600" fill="#666666">BACK LABEL ZONE</text>
  <text x="512" y="510" text-anchor="middle" font-size="10" fill="#999999">(secondary info / ingredients)</text>
  <text x="512" y="530" text-anchor="middle" font-size="9" fill="#999999">✧ ✧ ✧</text>

  <!-- SEAM / OVERLAP TAB (right edge, narrow strip) -->
  <rect x="768" y="20" width="40" height="720" fill="url(#hatch-bottle)" opacity="0.7" stroke="#000000" stroke-width="1.5"/>
  <text x="788" y="384" text-anchor="middle" font-size="8" fill="#000000" transform="rotate(-90 788 384)">SEAM TAB</text>

  <!-- DIMENSION ANNOTATIONS -->
  <!-- HEIGHT arrow on left -->
  <g stroke="#000000" stroke-width="1.2" fill="#000000">
    <line x1="40" y1="20" x2="40" y2="740"/>
    <polygon points="40,20 34,36 46,36"/>
    <polygon points="40,740 34,724 46,724"/>
    <text x="20" y="390" text-anchor="end" font-size="10" font-weight="600">H</text>
  </g>
  
  <!-- WIDTH arrow at top -->
  <g stroke="#000000" stroke-width="1.2" fill="#000000">
    <line x1="256" y1="10" x2="768" y2="10"/>
    <polygon points="256,10 272,4 272,16"/>
    <polygon points="768,10 752,4 752,16"/>
  </g>

  <!-- LEGEND — bottom strip -->
  <rect x="0" y="${H - 22}" width="${W}" height="22" fill="#000000"/>
  <g fill="#ffffff" font-size="9">
    <line x1="10" y1="${H - 11}" x2="38" y2="${H - 11}" stroke="#ffffff" stroke-width="2"/>
    <text x="42" y="${H - 6}">Full Cut</text>
    
    <line x1="140" y1="${H - 11}" x2="168" y2="${H - 11}" stroke="#ffffff" stroke-width="1.5" stroke-dasharray="8 5"/>
    <text x="172" y="${H - 6}">Crease</text>
    
    <rect x="296" y="${H - 17}" width="18" height="10" fill="url(#hatch-bottle)"/>
    <text x="318" y="${H - 6}">Seam Tab</text>
    
    <text x="${W / 2}" y="${H - 6}" text-anchor="middle" font-size="9">BOTTLE LABEL — Tall Vertical Orientation (200mm H × 70mm circumference)</text>
    <text x="${W - 8}" y="${H - 6}" text-anchor="end" font-size="8">Placeholder</text>
  </g>
</svg>`;

  return sharp(Buffer.from(svg))
    .resize(W, H, { fit: "fill" })
    .png()
    .toBuffer();
}

/**
 * Generates a placeholder dieline PNG whose panel positions EXACTLY match the
 * UV grid consumed by buildGlb.ts.
 *
 * Canvas: 1024 × 768 px  (4:3 = 4 cols × 3 rows, each cell 256 × 256 px)
 *
 *  col 0 (x=0..256)     col 1 (x=256..512)   col 2 (x=512..768)   col 3 (x=768..1024)
 *  row 0 (y=0..256):    [ bg/arrows ]         [  TOP + TUCK FLAP ] [ bg ]  [ bg ]
 *  row 1 (y=256..512):  [ LEFT+GLUE ]         [ FRONT (hero)     ] [RIGHT] [BACK]
 *  row 2 (y=512..768):  [ bg/arrows ]         [BOTTOM + DUST FLAP] [ bg ]  [ bg ]
 *
 * Special case: bottle type gets a TALL VERTICAL label layout instead
 */
async function buildFallbackDielinePng(params: {
  businessName: string;
  tagline?: string;
  printDescription: string;
  boxType: BoxType;
}): Promise<Buffer> {
  const meta = BOX_META[params.boxType];
  
  // Special handling for bottle labels - create a tall vertical layout
  if (params.boxType === "bottle") {
    return buildFallbackBottleLabel(params);
  }
  
  const W = 1024;
  const H = 768;
  const C = 256;   // cell size

  const x0 = 0, x1 = C, x2 = C * 2, x3 = C * 3, x4 = C * 4;
  const y0 = 0, y1 = C, y2 = C * 2, y3 = C * 3;

  // Structural sub-measurements (px within each 256-px cell)
  const TUCK_H   = 72;   // tuck flap height at top of TOP cell
  const SHLD     = 22;   // shoulder inset — tuck is narrower at very top
  const LOCK_R   = 14;   // lock-tab punch radius
  const DUST_H   = 68;   // dust flap / inner front at bottom of BOTTOM cell
  const DUST_IN  = 15;   // dust flap side inset
  const GLUE_W   = 18;   // glue-tab strip width inside LEFT cell
  const DUST_Y   = y2 + C - DUST_H;  // y-start of dust flap fold line = 700

  const name  = escapeXml(params.businessName);
  const init  = escapeXml((params.businessName.charAt(0) || "?").toUpperCase());
  const desc  = escapeXml((params.tagline?.trim() || params.printDescription).slice(0, 52));

  // FRONT panel centre for layout
  const fcx = (x1 + x2) / 2;  // 384
  const fcy = (y1 + y2) / 2;  // 384

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"
     viewBox="0 0 ${W} ${H}" font-family="system-ui,Arial,sans-serif">
  <defs>
    <!-- hatch for glue area -->
    <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="6" stroke="#000000" stroke-width="2"/>
    </pattern>
  </defs>

  <!-- ──────────────────────────────────────────────────────
       BACKGROUND
       ────────────────────────────────────────────────────── -->
  <rect width="${W}" height="${H}" fill="#ffffff"/>

  <!-- ──────────────────────────────────────────────────────
       TOP CELL (col 1, row 0) — top-face + tuck-flap
       ────────────────────────────────────────────────────── -->
  <!-- Top-face area (lower part of cell) -->
  <rect x="${x1}" y="${y0 + TUCK_H}" width="${C}" height="${C - TUCK_H}" fill="#ffffff"/>
  <!-- Tuck-flap area (trapezoidal — narrower at top, widened to full at fold line) -->
  <polygon
    points="${x1 + SHLD},${y0}  ${x2 - SHLD},${y0}  ${x2},${y0 + TUCK_H}  ${x1},${y0 + TUCK_H}"
    fill="#ffd400"/>
  <!-- Lock-tab punch (semi-circle cut at tuck-flap top centre) -->
  <path d="M ${fcx - LOCK_R},${y0} A ${LOCK_R},${LOCK_R} 0 0,0 ${fcx + LOCK_R},${y0}"
        fill="#ffffff" stroke="#000000" stroke-width="1.5"/>
  <!-- Fold line: tuck flap ↔ top face -->
  <line x1="${x1}" y1="${y0 + TUCK_H}" x2="${x2}" y2="${y0 + TUCK_H}"
        stroke="#000000" stroke-width="1.5" stroke-dasharray="10 6"/>
  <!-- TOP PANEL label -->
  <text x="${fcx}" y="${y0 + TUCK_H + (C - TUCK_H) / 2 + 5}"
        text-anchor="middle" font-size="12" font-weight="600" fill="#000000"
        letter-spacing="1">TOP PANEL</text>
  <text x="${fcx}" y="${y0 + TUCK_H / 2 + 5}"
        text-anchor="middle" font-size="9" fill="#000000">TUCK FLAP</text>

  <!-- ──────────────────────────────────────────────────────
       LEFT CELL (col 0, row 1) — left side + glue tab
       ────────────────────────────────────────────────────── -->
  <rect x="${x0 + GLUE_W}" y="${y1}" width="${C - GLUE_W}" height="${C}" fill="#ffffff"/>
  <!-- Glue-tab strip -->
  <rect x="${x0}" y="${y1 + 10}" width="${GLUE_W}" height="${C - 20}"
        fill="url(#hatch)" opacity="0.8"/>
  <rect x="${x0}" y="${y1 + 10}" width="${GLUE_W}" height="${C - 20}"
        fill="none" stroke="#000000" stroke-width="1"/>
  <!-- "GLUE" label vertical -->
  <text x="${x0 + 9}" y="${y1 + C / 2}" text-anchor="middle" font-size="7" fill="#000000"
        transform="rotate(-90 ${x0 + 9} ${y1 + C / 2})">GLUE AREA</text>
  <!-- LEFT SIDE label rotated -->
  <text x="${x0 + GLUE_W + (C - GLUE_W) / 2}" y="${fcy}"
        text-anchor="middle" font-size="11" font-weight="600" fill="#000000" letter-spacing="1"
        transform="rotate(-90 ${x0 + GLUE_W + (C - GLUE_W) / 2} ${fcy})">LEFT SIDE PANEL</text>

  <!-- ──────────────────────────────────────────────────────
       FRONT CELL (col 1, row 1) — HERO brand face
       Content centred inside the 256×256 cell
       ────────────────────────────────────────────────────── -->
  <rect x="${x1}" y="${y1}" width="${C}" height="${C}" fill="#ffffff"/>
  <!-- thin brand-colour top bar -->
  <rect x="${x1}" y="${y1}" width="${C}" height="6" fill="#ffd400"/>
  <!-- Outer circle halo -->
  <circle cx="${fcx}" cy="${fcy - 14}" r="52" fill="#ffd400" opacity="0.35"/>
  <!-- Inner circle -->
  <circle cx="${fcx}" cy="${fcy - 14}" r="34" fill="#ffd400" opacity="0.65"/>
  <!-- Initial badge -->
  <circle cx="${fcx}" cy="${fcy - 14}" r="22" fill="#000000"/>
  <text x="${fcx}" y="${fcy - 14 + 8}" text-anchor="middle"
        font-size="22" font-weight="700" fill="#ffffff">${init}</text>
  <!-- Brand name -->
  <text x="${fcx}" y="${fcy + 36}" text-anchor="middle"
        font-size="20" font-weight="700" fill="#000000">${name}</text>
  <!-- Tagline / description -->
  <text x="${fcx}" y="${fcy + 54}" text-anchor="middle"
        font-size="9.5" fill="#000000">${desc}</text>

  <!-- ──────────────────────────────────────────────────────
       RIGHT CELL (col 2, row 1) — right side
       ────────────────────────────────────────────────────── -->
  <rect x="${x2}" y="${y1}" width="${C}" height="${C}" fill="#ffffff"/>
  <text x="${(x2 + x3) / 2}" y="${fcy}" text-anchor="middle"
        font-size="11" font-weight="600" fill="#000000" letter-spacing="1"
        transform="rotate(90 ${(x2 + x3) / 2} ${fcy})">RIGHT SIDE PANEL</text>

  <!-- ──────────────────────────────────────────────────────
       BACK CELL (col 3, row 1) — back face
       ────────────────────────────────────────────────────── -->
  <rect x="${x3}" y="${y1}" width="${C}" height="${C}" fill="#ffffff"/>
  <text x="${(x3 + x4) / 2}" y="${fcy}" text-anchor="middle"
        font-size="11" font-weight="600" fill="#000000" letter-spacing="1">BACK PANEL</text>

  <!-- ──────────────────────────────────────────────────────
       BOTTOM CELL (col 1, row 2) — bottom face + dust flap
       ────────────────────────────────────────────────────── -->
  <!-- Bottom-face area -->
  <rect x="${x1}" y="${y2}" width="${C}" height="${C - DUST_H}" fill="#ffffff"/>
  <!-- Dust flap / inner front (slightly narrower, below fold line) -->
  <rect x="${x1 + DUST_IN}" y="${DUST_Y}" width="${C - DUST_IN * 2}" height="${DUST_H}"
        fill="#ffd400"/>
  <!-- Fold line: bottom face ↔ dust flap -->
  <line x1="${x1}" y1="${DUST_Y}" x2="${x2}" y2="${DUST_Y}"
        stroke="#000000" stroke-width="1.5" stroke-dasharray="10 6"/>
  <!-- BOTTOM label -->
  <text x="${fcx}" y="${y2 + (C - DUST_H) / 2 + 5}" text-anchor="middle"
        font-size="12" font-weight="600" fill="#000000" letter-spacing="1">BOTTOM PANEL</text>
  <text x="${fcx}" y="${DUST_Y + DUST_H / 2 + 4}" text-anchor="middle"
        font-size="9" fill="#000000">INNER FRONT / DUST FLAP</text>

  <!-- ──────────────────────────────────────────────────────
       CUT LINES — outer perimeter of the cross (solid)
       ────────────────────────────────────────────────────── -->
  <!-- TOP cell: trapezoidal tuck flap top edge + sides -->
  <polyline points="${x1 + SHLD},${y0}  ${x1},${y0 + TUCK_H}  ${x1},${y1}"
            fill="none" stroke="#000000" stroke-width="2.2" stroke-linejoin="round"/>
  <polyline points="${x2 - SHLD},${y0}  ${x2},${y0 + TUCK_H}  ${x2},${y1}"
            fill="none" stroke="#000000" stroke-width="2.2" stroke-linejoin="round"/>
  <line x1="${x1 + SHLD}" y1="${y0}" x2="${x2 - SHLD}" y2="${y0}"
        stroke="#000000" stroke-width="2.2"/>
  <!-- Main horizontal row perimeter -->
  <polyline points="${x0},${y1}  ${x0},${y2}  ${x4},${y2}  ${x4},${y1}  ${x0},${y1}"
            fill="none" stroke="#000000" stroke-width="2.2" stroke-linejoin="round"/>
  <!-- TOP cell left/right joins to main row -->
  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y1}" stroke="#000000" stroke-width="2.2"/>
  <!-- BOTTOM cell: outer edges + slightly indented dust flap -->
  <polyline points="${x1},${y2}  ${x1},${DUST_Y}  ${x1 + DUST_IN},${DUST_Y}
                   ${x1 + DUST_IN},${y3}  ${x2 - DUST_IN},${y3}
                   ${x2 - DUST_IN},${DUST_Y}  ${x2},${DUST_Y}  ${x2},${y2}"
            fill="none" stroke="#000000" stroke-width="2.2" stroke-linejoin="round"/>

  <!-- ──────────────────────────────────────────────────────
       FOLD LINES between panels (dashed black)
       ────────────────────────────────────────────────────── -->
  <g stroke="#000000" stroke-width="1.5" stroke-dasharray="10 6" fill="none">
    <!-- TOP ↔ FRONT (horizontal) -->
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y1}"/>
    <!-- FRONT ↔ BOTTOM (horizontal) -->
    <line x1="${x1}" y1="${y2}" x2="${x2}" y2="${y2}"/>
    <!-- LEFT | FRONT (vertical) -->
    <line x1="${x1}" y1="${y1}" x2="${x1}" y2="${y2}"/>
    <!-- FRONT | RIGHT (vertical) -->
    <line x1="${x2}" y1="${y1}" x2="${x2}" y2="${y2}"/>
    <!-- RIGHT | BACK (vertical) -->
    <line x1="${x3}" y1="${y1}" x2="${x3}" y2="${y2}"/>
  </g>

  <!-- ──────────────────────────────────────────────────────
       DIMENSION ANNOTATIONS (in background cells)
       ────────────────────────────────────────────────────── -->
  <!-- W (box width) — above TOP cell, centre -->
  <g stroke="#000000" stroke-width="1.2" fill="#000000" font-size="11" font-weight="600">
    <line x1="${x1 + 4}" y1="20" x2="${x2 - 4}" y2="20"/>
    <polygon points="${x1 + 4},20 ${x1 + 14},16 ${x1 + 14},24"/>
    <polygon points="${x2 - 4},20 ${x2 - 14},16 ${x2 - 14},24"/>
    <text x="${fcx}" y="14" text-anchor="middle" font-size="10">W</text>
  </g>
  <!-- H (box height) — right of BACK panel -->
  <g stroke="#000000" stroke-width="1.2" fill="#000000">
    <line x1="1010" y1="${y1 + 4}" x2="1010" y2="${y2 - 4}"/>
    <polygon points="1010,${y1 + 4} 1006,${y1 + 14} 1014,${y1 + 14}"/>
    <polygon points="1010,${y2 - 4} 1006,${y2 - 14} 1014,${y2 - 14}"/>
    <text x="1018" y="${fcy + 4}" text-anchor="start" font-size="10">H</text>
  </g>
  <!-- D (depth) — above LEFT panel -->
  <g stroke="#000000" stroke-width="1.2" fill="#000000">
    <line x1="${x0 + 4}" y1="20" x2="${x1 - 4}" y2="20"/>
    <polygon points="${x0 + 4},20 ${x0 + 14},16 ${x0 + 14},24"/>
    <polygon points="${x1 - 4},20 ${x1 - 14},16 ${x1 - 14},24"/>
    <text x="${(x0 + x1) / 2}" y="14" text-anchor="middle" font-size="10">D</text>
  </g>

  <!-- ──────────────────────────────────────────────────────
       LEGEND — bottom strip
       ────────────────────────────────────────────────────── -->
  <rect x="0" y="${H - 22}" width="${W}" height="22" fill="#000000"/>
  <g fill="#ffffff" font-size="9">
    <!-- Cut symbol -->
    <line x1="10" y1="${H - 11}" x2="38" y2="${H - 11}" stroke="#ffffff" stroke-width="2"/>
    <text x="42" y="${H - 6}">Full Cut</text>
    <!-- Crease symbol -->
    <line x1="100" y1="${H - 11}" x2="128" y2="${H - 11}"
          stroke="#ffffff" stroke-width="1.5" stroke-dasharray="8 5"/>
    <text x="132" y="${H - 6}">Crease</text>
    <!-- Perf symbol -->
    <line x1="190" y1="${H - 11}" x2="218" y2="${H - 11}"
          stroke="#ffffff" stroke-width="1.5" stroke-dasharray="3 3"/>
    <text x="222" y="${H - 6}">Perforation</text>
    <!-- Glue symbol -->
    <rect x="296" y="${H - 17}" width="18" height="10" fill="url(#hatch)"/>
    <text x="318" y="${H - 6}">Glue Area</text>
    <!-- Net shape label -->
    <text x="${W - 8}" y="${H - 6}" text-anchor="end">${escapeXml(meta.netShape)}</text>
    <!-- Placeholder note (centre) -->
    <text x="${W / 2}" y="${H - 6}" text-anchor="middle">
      Placeholder — set GEMINI_API_KEY + GEMINI_IMAGE_MODEL=gemini-3.1-flash-image-preview for AI art
    </text>
  </g>
</svg>`;

  return sharp(Buffer.from(svg))
    .resize(W, H, { fit: "fill" })
    .png()
    .toBuffer();
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
