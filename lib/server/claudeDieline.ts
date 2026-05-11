import sharp from "sharp";
import type { BoxType } from "@/lib/constants/boxTypes";
import { generateDielineImage as generateGeminiDielineImage } from "@/lib/server/geminiDieline";

const CLAUDE_API_VERSION = "2023-06-01";
const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-5";

type DielineParams = {
  businessName: string;
  tagline?: string;
  printDescription: string;
  boxType: BoxType;
  style?: string;
  logoBuffer?: Buffer | null;
  dims?: { width: number; height: number; depth: number };
};

type DesignSpec = {
  palette: string[];
  accentShape: "botanical" | "waves" | "dots" | "stripes" | "geometric";
  finish: string;
  frontHeadline: string;
  frontSubcopy: string;
  sideCopy: string;
  backCopy: string[];
};

const TEMPLATE_NAMES: Record<BoxType, string> = {
  vertical_box: "vertical folding carton",
  horizontal_box: "horizontal folding carton",
  bottle: "wraparound bottle label",
  cake_box: "cake box cross net",
  trapezoid: "tapered trapezoid carton",
};

const PANEL_LABELS: Record<BoxType, string[]> = {
  vertical_box: ["LEFT SIDE + GLUE", "FRONT PANEL", "RIGHT SIDE", "BACK PANEL", "TOP + TUCK", "BOTTOM + DUST"],
  horizontal_box: ["LEFT SIDE + GLUE", "FRONT PANEL", "RIGHT SIDE", "BACK PANEL", "TOP FLAP", "BOTTOM FLAP"],
  bottle: ["WRAP LEFT", "FRONT LABEL", "WRAP RIGHT", "BACK LABEL", "CAP / TOP", "BASE / BOTTOM"],
  cake_box: ["LEFT WALL + TABS", "FRONT WALL", "RIGHT WALL + TABS", "BACK WALL", "LID / LOCK", "BASE PANEL"],
  trapezoid: ["LEFT TAPERED SIDE", "FRONT TAPERED SIDE", "RIGHT TAPERED SIDE", "BACK TAPERED SIDE", "TOP OPENING", "BASE PANEL"],
};

function claudeApiKey(): string | undefined {
  return (
    process.env.CLAUDE_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.CLAUDE_KEY ||
    process.env.CLAUDE_APIKEY
  )?.trim();
}

function sanitizeText(input: string, max = 80): string {
  return input.replace(/\s+/g, " ").trim().slice(0, max);
}

function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function defaultSpec(params: DielineParams): DesignSpec {
  const brief = `${params.style ?? ""} ${params.printDescription}`.toLowerCase();
  const accentShape =
    /botanic|leaf|floral|plant|herb|organic|nature/.test(brief) ? "botanical" :
    /wave|water|ocean|flow|liquid/.test(brief) ? "waves" :
    /dot|play|fun|kid|confetti/.test(brief) ? "dots" :
    /stripe|classic|heritage/.test(brief) ? "stripes" :
    "geometric";

  return {
    palette: ["#111111", "#ffffff", "#ffd400", "#2f6f5e", "#d9ecff"],
    accentShape,
    finish: sanitizeText(params.style || "clean matte print", 44),
    frontHeadline: sanitizeText(params.businessName, 34),
    frontSubcopy: sanitizeText(params.tagline || params.printDescription, 54),
    sideCopy: sanitizeText(params.tagline || params.businessName, 34),
    backCopy: [
      sanitizeText(params.printDescription, 58),
      "Batch No. 001",
      "www.example.com",
    ],
  };
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced ?? text.match(/\{[\s\S]*\}/)?.[0] ?? text;
  return JSON.parse(raw);
}

async function askClaudeForSpec(params: DielineParams): Promise<DesignSpec | null> {
  const apiKey = claudeApiKey();
  if (!apiKey) return null;

  const model = process.env.CLAUDE_MODEL?.trim() || DEFAULT_CLAUDE_MODEL;
  const dims = params.dims
    ? `${params.dims.width}mm W x ${params.dims.height}mm H x ${params.dims.depth}mm D`
    : "default template dimensions";

  const prompt = `
Create a print packaging design spec from the client brief.
Return only valid JSON, no markdown.

Required shape:
{
  "palette": ["#111111", "#ffffff", "#ffd400", "#2f6f5e", "#d9ecff"],
  "accentShape": "botanical|waves|dots|stripes|geometric",
  "finish": "short print finish phrase",
  "frontHeadline": "short front label headline",
  "frontSubcopy": "short front supporting copy",
  "sideCopy": "very short side panel copy",
  "backCopy": ["3 short back panel lines"]
}

Rules:
- Palette must contain 5 hex colors with strong contrast. Include black or near-black and white or near-white.
- Keep all copy short enough to fit on small packaging panels.
- Interpret the client's description literally; do not invent unrelated themes.
- The dieline geometry is rendered separately, so focus only on artwork, palette, and copy.

Client:
Business name: ${params.businessName}
Tagline: ${params.tagline || "none"}
Description: ${params.printDescription}
Style hint: ${params.style || "none"}
Template: ${TEMPLATE_NAMES[params.boxType]}
Dimensions: ${dims}
`.trim();

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": CLAUDE_API_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: 900,
      temperature: 0.35,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Claude API request failed (${res.status})${body ? `: ${body.slice(0, 180)}` : ""}`);
  }

  const data = await res.json() as { content?: Array<{ type?: string; text?: string }> };
  const text = data.content?.find((part) => part.type === "text" && part.text)?.text;
  if (!text) return null;

  const parsed = extractJson(text) as Partial<DesignSpec>;
  const fallback = defaultSpec(params);
  const palette = Array.isArray(parsed.palette)
    ? parsed.palette.filter(isHexColor).slice(0, 5)
    : [];

  return {
    palette: palette.length >= 3 ? palette : fallback.palette,
    accentShape: ["botanical", "waves", "dots", "stripes", "geometric"].includes(String(parsed.accentShape))
      ? parsed.accentShape as DesignSpec["accentShape"]
      : fallback.accentShape,
    finish: sanitizeText(String(parsed.finish || fallback.finish), 44),
    frontHeadline: sanitizeText(String(parsed.frontHeadline || fallback.frontHeadline), 34),
    frontSubcopy: sanitizeText(String(parsed.frontSubcopy || fallback.frontSubcopy), 54),
    sideCopy: sanitizeText(String(parsed.sideCopy || fallback.sideCopy), 34),
    backCopy: Array.isArray(parsed.backCopy)
      ? parsed.backCopy.map((line) => sanitizeText(String(line), 58)).slice(0, 3)
      : fallback.backCopy,
  };
}

function motif(spec: DesignSpec, x: number, y: number, w: number, h: number): string {
  const [, , accent, secondary = "#2f6f5e", soft = "#d9ecff"] = spec.palette;
  if (spec.accentShape === "botanical") {
    return `
      <g fill="none" stroke="${secondary}" stroke-width="2" opacity="0.85">
        <path d="M ${x + w * 0.16} ${y + h * 0.78} C ${x + w * 0.32} ${y + h * 0.46}, ${x + w * 0.54} ${y + h * 0.34}, ${x + w * 0.82} ${y + h * 0.18}"/>
        <ellipse cx="${x + w * 0.35}" cy="${y + h * 0.52}" rx="17" ry="8" transform="rotate(-24 ${x + w * 0.35} ${y + h * 0.52})"/>
        <ellipse cx="${x + w * 0.58}" cy="${y + h * 0.36}" rx="18" ry="8" transform="rotate(-32 ${x + w * 0.58} ${y + h * 0.36})"/>
      </g>`;
  }
  if (spec.accentShape === "waves") {
    return `<g fill="none" stroke="${secondary}" stroke-width="3" opacity="0.75">
      ${[0, 1, 2, 3].map((i) => `<path d="M ${x + 18} ${y + 48 + i * 28} C ${x + 75} ${y + 20 + i * 28}, ${x + 140} ${y + 76 + i * 28}, ${x + w - 18} ${y + 44 + i * 28}"/>`).join("")}
    </g>`;
  }
  if (spec.accentShape === "dots") {
    return `<g fill="${accent}" opacity="0.8">
      ${Array.from({ length: 18 }, (_, i) => `<circle cx="${x + 24 + (i % 6) * 38}" cy="${y + 30 + Math.floor(i / 6) * 38}" r="${5 + (i % 3)}"/>`).join("")}
    </g>`;
  }
  if (spec.accentShape === "stripes") {
    return `<g stroke="${accent}" stroke-width="8" opacity="0.72">
      ${Array.from({ length: 7 }, (_, i) => `<line x1="${x + 15 + i * 38}" y1="${y + h - 12}" x2="${x + 72 + i * 38}" y2="${y + 12}"/>`).join("")}
    </g>`;
  }
  return `<g fill="${soft}" stroke="${secondary}" stroke-width="2" opacity="0.8">
    <rect x="${x + 28}" y="${y + 28}" width="54" height="54" transform="rotate(45 ${x + 55} ${y + 55})"/>
    <circle cx="${x + w - 58}" cy="${y + 62}" r="34"/>
    <polygon points="${x + 46},${y + h - 46} ${x + 92},${y + h - 86} ${x + 130},${y + h - 36}"/>
  </g>`;
}

function panelRect(
  x: number,
  y: number,
  label: string,
  fill = "#ffffff",
  rotate = false,
  showLabel = true,
): string {
  const cx = x + 128;
  const cy = y + 128;
  return `
    <rect x="${x}" y="${y}" width="256" height="256" fill="${fill}"/>
    ${showLabel ? `<text x="${cx}" y="${cy + 92}" text-anchor="middle" font-size="11" font-weight="700" letter-spacing="1"
      transform="${rotate ? `rotate(-90 ${cx} ${cy + 92})` : ""}">${escapeXml(label)}</text>` : ""}`;
}

function buildPreciseSvg(
  params: DielineParams,
  spec: DesignSpec,
  options: { technicalMarks: boolean; hasLogo: boolean },
): string {
  const [ink, paper, accent, , soft = "#d9ecff"] = spec.palette;
  const labels = PANEL_LABELS[params.boxType];
  const dims = params.dims ?? { width: 80, height: 120, depth: 60 };
  const technicalMarks = options.technicalMarks;
  const hasLogo = options.hasLogo;
  const name = escapeXml(spec.frontHeadline || params.businessName);
  const subcopy = escapeXml(spec.frontSubcopy || params.tagline || params.printDescription);
  const sideCopy = escapeXml(spec.sideCopy);
  const backLines = (spec.backCopy.length ? spec.backCopy : defaultSpec(params).backCopy).map(escapeXml);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768" viewBox="0 0 1024 768" font-family="Arial, Helvetica, sans-serif">
  <defs>
    <pattern id="glueHatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="7" stroke="${ink}" stroke-width="2"/>
    </pattern>
    <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="${ink}"/>
    </marker>
  </defs>
  <rect width="1024" height="768" fill="${paper}"/>

  ${panelRect(0, 256, labels[0], paper, true, technicalMarks)}
  ${technicalMarks ? `<rect x="0" y="272" width="22" height="224" fill="url(#glueHatch)"/>
  <text x="11" y="388" font-size="8" text-anchor="middle" transform="rotate(-90 11 388)">GLUE AREA</text>` : ""}

  ${panelRect(256, 256, labels[1], paper, false, technicalMarks)}
  <rect x="256" y="256" width="256" height="16" fill="${accent}"/>
  <rect x="286" y="286" width="196" height="196" rx="0" fill="${soft}" opacity="0.42"/>
  ${motif(spec, 286, 286, 196, 196)}
  ${hasLogo ? "" : `<circle cx="384" cy="352" r="34" fill="${ink}"/>`}
  ${hasLogo ? "" : `<text x="384" y="364" text-anchor="middle" font-size="32" font-weight="800" fill="${paper}">${escapeXml(name.charAt(0).toUpperCase())}</text>`}
  <text x="384" y="414" text-anchor="middle" font-size="22" font-weight="800" fill="${ink}">${name}</text>
  <text x="384" y="437" text-anchor="middle" font-size="11" fill="${ink}">${subcopy}</text>
  <text x="384" y="466" text-anchor="middle" font-size="9" fill="${ink}">${escapeXml(spec.finish)}</text>

  ${panelRect(512, 256, labels[2], paper, true, technicalMarks)}
  <rect x="536" y="286" width="208" height="196" fill="${soft}" opacity="0.35"/>
  <text x="640" y="390" text-anchor="middle" font-size="18" font-weight="700" fill="${ink}" transform="rotate(90 640 390)">${sideCopy}</text>

  ${panelRect(768, 256, labels[3], paper, false, technicalMarks)}
  <rect x="794" y="288" width="204" height="58" fill="${accent}" opacity="0.82"/>
  <text x="896" y="323" text-anchor="middle" font-size="16" font-weight="800" fill="${ink}">${escapeXml(params.businessName)}</text>
  ${backLines.map((line, i) => `<text x="794" y="${382 + i * 22}" font-size="12" fill="${ink}">${line}</text>`).join("")}
  <rect x="916" y="442" width="58" height="34" fill="none" stroke="${ink}" stroke-width="1.5"/>
  ${Array.from({ length: 9 }, (_, i) => `<line x1="${922 + i * 5}" y1="446" x2="${922 + i * 5}" y2="472" stroke="${ink}" stroke-width="${i % 3 === 0 ? 2 : 1}"/>`).join("")}

  ${panelRect(256, 0, labels[4], paper, false, technicalMarks)}
  <polygon points="292,0 476,0 512,62 512,256 256,256 256,62" fill="${paper}"/>
  <rect x="256" y="184" width="256" height="72" fill="${accent}" opacity="0.78"/>
  ${technicalMarks ? `<path d="M 360 0 A 24 24 0 0 0 408 0" fill="${paper}" stroke="${ink}" stroke-width="1.4" stroke-dasharray="4 3"/>` : ""}
  <text x="384" y="219" text-anchor="middle" font-size="13" font-weight="800" fill="${ink}">${escapeXml(params.businessName)}</text>

  ${panelRect(256, 512, labels[5], paper, false, technicalMarks)}
  <rect x="286" y="700" width="196" height="68" fill="${accent}" opacity="0.78"/>
  ${technicalMarks ? `<text x="384" y="736" text-anchor="middle" font-size="11" font-weight="700" fill="${ink}">DUST / LOCK FLAP</text>` : ""}

  ${technicalMarks ? `
  <g fill="none" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round">
    <path d="M292 0H476L512 62V256H768V256H1024V512H512V700H482V768H286V700H256V512H0V256H256V62Z"/>
  </g>
  <g fill="none" stroke="${ink}" stroke-width="1.3" stroke-dasharray="10 7">
    <line x1="256" y1="256" x2="256" y2="512"/>
    <line x1="512" y1="256" x2="512" y2="512"/>
    <line x1="768" y1="256" x2="768" y2="512"/>
    <line x1="256" y1="256" x2="512" y2="256"/>
    <line x1="256" y1="512" x2="512" y2="512"/>
    <line x1="512" y1="62" x2="512" y2="256"/>
    <line x1="256" y1="62" x2="256" y2="256"/>
    <line x1="286" y1="700" x2="482" y2="700"/>
  </g>
  <g fill="none" stroke="${ink}" stroke-width="1.4" stroke-dasharray="3 4">
    <path d="M292 0L256 62"/>
    <path d="M476 0L512 62"/>
  </g>

  <g stroke="${ink}" fill="${ink}" font-size="11" font-weight="700">
    <line x1="256" y1="28" x2="512" y2="28" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
    <text x="384" y="20" text-anchor="middle">W ${dims.width} mm</text>
    <line x1="1008" y1="256" x2="1008" y2="512" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
    <text x="996" y="390" text-anchor="middle" transform="rotate(90 996 390)">H ${dims.height} mm</text>
    <line x1="0" y1="536" x2="256" y2="536" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
    <text x="128" y="558" text-anchor="middle">D ${dims.depth} mm</text>
  </g>

  <rect x="0" y="746" width="1024" height="22" fill="${ink}"/>
  <g fill="${paper}" font-size="9">
    <line x1="12" y1="758" x2="44" y2="758" stroke="${paper}" stroke-width="2"/>
    <text x="50" y="762">Cut Line</text>
    <line x1="120" y1="758" x2="152" y2="758" stroke="${paper}" stroke-width="1.5" stroke-dasharray="8 5"/>
    <text x="158" y="762">Fold/Crease</text>
    <line x1="250" y1="758" x2="282" y2="758" stroke="${paper}" stroke-width="1.5" stroke-dasharray="3 4"/>
    <text x="288" y="762">Perforation</text>
    <rect x="394" y="753" width="20" height="10" fill="${accent}"/>
    <text x="420" y="762">Glue Area</text>
    <text x="1012" y="762" text-anchor="end">${escapeXml(TEMPLATE_NAMES[params.boxType])} | Claude-guided artwork | exact 1024x768 UV grid</text>
  </g>
  ` : ""}
</svg>`;
}

async function compositeLogo(dieline: Buffer, logo: Buffer): Promise<Buffer> {
  const logoBuf = await sharp(logo)
    .resize(72, 72, { fit: "inside" })
    .ensureAlpha()
    .png()
    .toBuffer();

  return sharp(dieline)
    .composite([{ input: logoBuf, left: 348, top: 318, blend: "over" }])
    .png()
    .toBuffer();
}

export async function generateDielineImage(params: DielineParams): Promise<{
  pngBuffer: Buffer;
  cleanTextureBuffer?: Buffer;
  svgSource?: string;
  cleanSvgSource?: string;
  designNotes: string;
  colorPalette: string[];
  source: "claude-svg" | "gemini-image" | "imagen" | "fallback";
}> {
  try {
    const spec = (await askClaudeForSpec(params)) ?? defaultSpec(params);
    const hasLogo = !!params.logoBuffer?.length;
    const svg = buildPreciseSvg(params, spec, { technicalMarks: true, hasLogo });
    const cleanSvg = buildPreciseSvg(params, spec, { technicalMarks: false, hasLogo });
    const png = await sharp(Buffer.from(svg))
      .resize(1024, 768, { fit: "fill" })
      .png()
      .toBuffer();
    const cleanPng = await sharp(Buffer.from(cleanSvg))
      .resize(1024, 768, { fit: "fill" })
      .png()
      .toBuffer();
    const composed = params.logoBuffer?.length ? await compositeLogo(png, params.logoBuffer) : png;
    const cleanComposed = params.logoBuffer?.length ? await compositeLogo(cleanPng, params.logoBuffer) : cleanPng;

    return {
      pngBuffer: composed,
      cleanTextureBuffer: cleanComposed,
      svgSource: svg,
      cleanSvgSource: cleanSvg,
      designNotes: `Claude-guided dieline for "${params.businessName}" using a precise 1024x768 production grid. Artwork follows: ${sanitizeText(params.printDescription, 120)}.`,
      colorPalette: spec.palette,
      source: "claude-svg",
    };
  } catch (err) {
    console.error("[claudeDieline] API/render error:", err);
    return generateGeminiDielineImage(params);
  }
}
