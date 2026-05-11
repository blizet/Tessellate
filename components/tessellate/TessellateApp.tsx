"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { PackagingViewer, type ViewerConfig, type PackagingViewerHandle, type CustomMeshInfo, type CustomMeshTextureSettings } from "@/components/tessellate/PackagingViewer";
import { defaultDimensionsMm, type BoxType } from "@/lib/constants/boxTypes";

// ── Studio box catalogue ──────────────────────────────────────────────────────

type StudioBox = {
  id: string;
  label: string;
  icon: string;
  apiType: BoxType;
  defaultW: number; // mm
  defaultH: number;
  defaultD: number;
};

const STUDIO_BOXES: StudioBox[] = [
  { id: "tuck_end",  label: "Tuck End",  icon: "▣", apiType: "vertical_box",   defaultW: 80,  defaultH: 120, defaultD: 60 },
  { id: "mailer",    label: "Mailer Box", icon: "◫", apiType: "horizontal_box", defaultW: 140, defaultH: 90,  defaultD: 70 },
  { id: "cake_box",  label: "Cake Box",   icon: "⌒", apiType: "cake_box",       defaultW: 250, defaultH: 120, defaultD: 250 },
  { id: "cylinder",  label: "Cylinder",   icon: "⬭", apiType: "bottle",         defaultW: 70,  defaultH: 200, defaultD: 70 },
  { id: "pillow",    label: "Pillow Box", icon: "⬬", apiType: "vertical_box",   defaultW: 90,  defaultH: 50,  defaultD: 30 },
  { id: "gable",     label: "Gable Box",  icon: "⌂", apiType: "vertical_box",   defaultW: 80,  defaultH: 110, defaultD: 50 },
  { id: "hexagon",   label: "Hexagon",    icon: "⬡", apiType: "vertical_box",   defaultW: 80,  defaultH: 60,  defaultD: 80 },
  { id: "sleeve",    label: "Sleeve",     icon: "▭", apiType: "horizontal_box", defaultW: 70,  defaultH: 100, defaultD: 50 },
  { id: "trapezoid", label: "Trapezoid",  icon: "⬠", apiType: "trapezoid",      defaultW: 100, defaultH: 110, defaultD: 75 },
  { id: "dispenser", label: "Dispenser",  icon: "⊞", apiType: "vertical_box",   defaultW: 60,  defaultH: 120, defaultD: 80 },
];

// ── Finish presets ────────────────────────────────────────────────────────────

const FINISH_PRESETS = [
  { id: "matte",  label: "Matte",  roughness: 0.90, metalness: 0.0 },
  { id: "gloss",  label: "Gloss",  roughness: 0.10, metalness: 0.0 },
  { id: "satin",  label: "Satin",  roughness: 0.45, metalness: 0.0 },
  { id: "foil",   label: "Foil",   roughness: 0.15, metalness: 0.8 },
  { id: "kraft",  label: "Kraft",  roughness: 0.95, metalness: 0.0 },
  { id: "velvet", label: "Velvet", roughness: 1.00, metalness: 0.0 },
] as const;

// ── Quick colour palettes ─────────────────────────────────────────────────────

const QUICK_PALETTES: Array<[string, string]> = [
  ["#ffffff", "#e5ddd0"], ["#1a1a2e", "#e94560"],
  ["#fef3c7", "#d97706"], ["#f0fdf4", "#16a34a"],
  ["#fdf2f8", "#db2777"], ["#f8fafc", "#64748b"],
  ["#fff7ed", "#ea580c"], ["#eff6ff", "#2563eb"],
  ["#fafafa", "#262626"], ["#fdf4ff", "#a21caf"],
];

// ── Panel metadata (maps to 1024×768 cross-net) ───────────────────────────────

const PANEL_META = {
  top:    { x: 256, y: 0,   w: 256, h: 256, label: "Top"    },
  left:   { x: 0,   y: 256, w: 256, h: 256, label: "Left"   },
  front:  { x: 256, y: 256, w: 256, h: 256, label: "Front"  },
  right:  { x: 512, y: 256, w: 256, h: 256, label: "Right"  },
  back:   { x: 768, y: 256, w: 256, h: 256, label: "Back"   },
  bottom: { x: 256, y: 512, w: 256, h: 256, label: "Bottom" },
} as const;

type PanelId = keyof typeof PANEL_META;

type PanelState = {
  fill: string;
  text: string;
  logoDataUrl: string | null;
  textColor: string;
};

type StudioState = Record<PanelId, PanelState>;

// ── API response types ────────────────────────────────────────────────────────

type GenResp = {
  success: boolean;
  dielineBase64?: string;
  cleanTextureBase64?: string;
  svgSource?: string;
  cleanSvgSource?: string;
  designNotes?: string;
  colorPalette?: string[];
  message?: string;
};

type ConvResp = {
  success: boolean;
  gltfBase64?: string;
  previewBase64?: string;
  downloadUrl?: string;
  message?: string;
};

type SpotEditResp = {
  success: boolean;
  operations?: Array<
    | { type: "set-panel-bg-color"; color: string }
    | { type: "set-text-content"; elementId: string; text: string }
    | { type: "set-style"; elementId: string; property: string; value: string }
    | { type: "set-attribute"; elementId: string; attribute: string; value: string }
  >;
  message?: string;
};

// ── Utility functions ─────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildInitialStudioState(name: string, tagline: string, desc: string): StudioState {
  return {
    top:    { fill: "#ffffff", text: name || "Top panel",   logoDataUrl: null, textColor: "#111111" },
    left:   { fill: "#ffffff", text: tagline || "Side",     logoDataUrl: null, textColor: "#111111" },
    front:  { fill: "#ffffff", text: name || "Front panel", logoDataUrl: null, textColor: "#111111" },
    right:  { fill: "#ffffff", text: tagline || "Side",     logoDataUrl: null, textColor: "#111111" },
    back:   { fill: "#ffffff", text: desc || "Back copy",   logoDataUrl: null, textColor: "#111111" },
    bottom: { fill: "#ffffff", text: "Bottom",              logoDataUrl: null, textColor: "#111111" },
  };
}

function buildStudioSvg(state: StudioState, sel: PanelId | "all" | null): string {
  const panels = (Object.keys(PANEL_META) as PanelId[])
    .map((id) => {
      const m = PANEL_META[id];
      const d = state[id];
      const highlighted = sel === id || sel === "all";
      const stroke = highlighted ? "#f5c842" : "#000000";
      const sw = highlighted ? 3 : 1.5;
      const logo = d.logoDataUrl
        ? `<image href="${d.logoDataUrl}" x="${m.x + 90}" y="${m.y + 74}" width="76" height="76" preserveAspectRatio="xMidYMid meet"/>`
        : "";
      return `<g id="panel-${id}" data-panel="${id}">
  <rect x="${m.x}" y="${m.y}" width="${m.w}" height="${m.h}" fill="${d.fill}"/>
  <rect x="${m.x}" y="${m.y}" width="${m.w}" height="${m.h}" fill="none" stroke="${stroke}" stroke-width="${sw}"/>
  ${logo}
  <text x="${m.x + 128}" y="${m.y + 210}" text-anchor="middle" font-size="18" font-weight="700" fill="${d.textColor}" font-family="Arial,sans-serif">${esc(d.text)}</text>
  <text x="${m.x + 128}" y="${m.y + 238}" text-anchor="middle" font-size="11" fill="#444" font-family="Arial,sans-serif">${esc(m.label.toUpperCase())}</text>
</g>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768" viewBox="0 0 1024 768" font-family="Arial,sans-serif">
<rect width="1024" height="768" fill="#f5f5f5"/>
${panels}
<g fill="none" stroke="#000" stroke-width="1.2" stroke-dasharray="8 6">
  <line x1="256" y1="256" x2="256" y2="512"/>
  <line x1="512" y1="256" x2="512" y2="512"/>
  <line x1="768" y1="256" x2="768" y2="512"/>
  <line x1="256" y1="256" x2="512" y2="256"/>
  <line x1="256" y1="512" x2="512" y2="512"/>
</g>
</svg>`;
}

async function svgToPngBase64(svg: string): Promise<string> {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const el = new window.Image();
      el.onload = () => res(el);
      el.onerror = () => rej(new Error("SVG rasterize failed"));
      el.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = 1024; canvas.height = 768;
    canvas.getContext("2d")!.drawImage(img, 0, 0, 1024, 768);
    const dataUrl = canvas.toDataURL("image/png");
    const i = dataUrl.indexOf("base64,");
    return i >= 0 ? dataUrl.slice(i + 7) : dataUrl;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function cropPanelPngBase64(svg: string, panelId: PanelId): Promise<string> {
  const m = PANEL_META[panelId];
  const full = await svgToPngBase64(svg);
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const el = new window.Image();
    el.onload = () => res(el);
    el.onerror = () => rej(new Error("Decode failed"));
    el.src = `data:image/png;base64,${full}`;
  });
  const canvas = document.createElement("canvas");
  canvas.width = 512; canvas.height = 512;
  canvas.getContext("2d")!.drawImage(img, m.x, m.y, m.w, m.h, 0, 0, 512, 512);
  const dataUrl = canvas.toDataURL("image/png");
  const i = dataUrl.indexOf("base64,");
  return i >= 0 ? dataUrl.slice(i + 7) : dataUrl;
}

type SelectionRect = { x: number; y: number; w: number; h: number }; // 0-1 relative to panel

async function cropSubRegionPngBase64(svg: string, panelId: PanelId, sel: SelectionRect): Promise<string> {
  const m = PANEL_META[panelId];
  const full = await svgToPngBase64(svg);
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const el = new window.Image();
    el.onload = () => res(el);
    el.onerror = () => rej(new Error("Decode failed"));
    el.src = `data:image/png;base64,${full}`;
  });
  const canvas = document.createElement("canvas");
  canvas.width = 512; canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  const srcX = m.x + sel.x * m.w;
  const srcY = m.y + sel.y * m.h;
  const srcW = Math.max(4, sel.w * m.w);
  const srcH = Math.max(4, sel.h * m.h);
  ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, 512, 512);
  const dataUrl = canvas.toDataURL("image/png");
  const i = dataUrl.indexOf("base64,");
  return i >= 0 ? dataUrl.slice(i + 7) : dataUrl;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { message?: string };
  if (!res.ok) throw new Error((data as { message?: string }).message ?? `Request failed (${res.status})`);
  return data;
}

function downloadBase64(b64: string, filename: string, mime: string): void {
  const a = document.createElement("a");
  a.href = `data:${mime};base64,${b64}`;
  a.download = filename;
  a.click();
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const res = r.result as string;
      const i = res.indexOf("base64,");
      resolve(i >= 0 ? res.slice(i + 7) : res);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => (typeof r.result === "string" ? resolve(r.result) : reject(new Error("read failed")));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

// ── Shared style helpers ──────────────────────────────────────────────────────

const S = {
  label: { fontSize: 11, color: "#555", letterSpacing: "0.8px", textTransform: "uppercase" as const, marginBottom: 8 },
  input: {
    width: "100%", padding: "9px 12px", borderRadius: 7,
    background: "#242424", border: "1px solid #383838",
    color: "#f0ede8", fontSize: 13, outline: "none",
    boxSizing: "border-box" as const,
  },
  btn: {
    primary: { background: "#f5c842", border: "none", borderRadius: 8, padding: "10px 16px", fontWeight: 600 as const, fontSize: 13, color: "#0f0f0f", cursor: "pointer" as const },
    ghost: { background: "#242424", border: "1px solid #333", borderRadius: 8, padding: "10px 16px", fontWeight: 500 as const, fontSize: 13, color: "#ccc", cursor: "pointer" as const },
  },
};

// ── Main component ────────────────────────────────────────────────────────────

type Tab = "design" | "generate" | "edit" | "size" | "export";
type SidebarWidths = { left: number; right: number };

const SIDEBAR_WIDTHS_KEY = "tessellate.sidebarWidths.v1";
const LEFT_MIN = 220;
const LEFT_MAX = 420;
const RIGHT_MIN = 260;
const RIGHT_MAX = 520;
const CENTER_MIN = 420;

function readSidebarWidths(): SidebarWidths {
  if (typeof window === "undefined") return { left: 264, right: 310 };
  try {
    const raw = window.localStorage.getItem(SIDEBAR_WIDTHS_KEY);
    if (!raw) return { left: 264, right: 310 };
    const parsed = JSON.parse(raw) as Partial<SidebarWidths>;
    const left = typeof parsed.left === "number" ? parsed.left : 264;
    const right = typeof parsed.right === "number" ? parsed.right : 310;
    return { left, right };
  } catch {
    return { left: 264, right: 310 };
  }
}

function writeSidebarWidths(widths: SidebarWidths): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SIDEBAR_WIDTHS_KEY, JSON.stringify(widths));
  } catch {
    // Ignore storage errors (private mode/quota)
  }
}

export function TessellateApp() {
  // Box + finish + colours
  const [activeBox, setActiveBox] = useState<StudioBox>(STUDIO_BOXES[0]);
  const [finish, setFinish] = useState("matte");
  const [color, setColor] = useState("#ffffff");
  const [color2, setColor2] = useState("#e8e0d0");
  const [logoText, setLogoText] = useState("BRAND");
  const [logoShow, setLogoShow] = useState(false);

  // Custom dimensions (mm, null = use box default)
  const [customW, setCustomW] = useState<number | null>(null);
  const [customH, setCustomH] = useState<number | null>(null);
  const [customD, setCustomD] = useState<number | null>(null);

  // UI state
  const [activeTab, setActiveTab] = useState<Tab>("generate");
  const [viewerReady, setViewerReady] = useState(false);
  const viewerRef = useRef<PackagingViewerHandle>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const initialWidths = useMemo(() => readSidebarWidths(), []);
  const [leftPanelWidth, setLeftPanelWidth] = useState(initialWidths.left);
  const [rightPanelWidth, setRightPanelWidth] = useState(initialWidths.right);

  // Custom 3D model upload
  const customModelInputRef = useRef<HTMLInputElement>(null);
  const [customModelUrl, setCustomModelUrl] = useState<string | null>(null);
  const [customModelName, setCustomModelName] = useState<string | null>(null);
  const [customMeshInfos, setCustomMeshInfos] = useState<CustomMeshInfo[]>([]);
  const [meshTextureSettings, setMeshTextureSettings] = useState<Record<number, CustomMeshTextureSettings>>({});

  // AI generation form
  const [businessName, setBusinessName] = useState("");
  const [tagline, setTagline] = useState("");
  const [description, setDescription] = useState("");
  const [style, setStyle] = useState("minimalist");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [bgFile, setBgFile] = useState<File | null>(null);
  const [bgBase64, setBgBase64] = useState<string | null>(null);
  const [bgObjectUrl, setBgObjectUrl] = useState<string | null>(null);

  // Dieline / design state
  const [dielineBase64, setDielineBase64] = useState<string | null>(null);
  const [serverSvgSource, setServerSvgSource] = useState<string | null>(null);
  const [designNotes, setDesignNotes] = useState<string | null>(null);
  const [studioState, setStudioState] = useState<StudioState>(() => buildInitialStudioState("", "", ""));

  // 2D editor
  const [selectedPanel, setSelectedPanel] = useState<PanelId | "all">("front");
  const [panelText, setPanelText] = useState("");
  const [panelFill, setPanelFill] = useState("#ffffff");
  const [spotPrompt, setSpotPrompt] = useState("");
  const [spotEditing, setSpotEditing] = useState(false);
  // Spot selection (drag-to-select rectangle on panel preview)
  const [spotSelection, setSpotSelection] = useState<SelectionRect | null>(null);
  const selectionContainerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);

  // Export
  const [gltfBase64, setGltfBase64] = useState<string | null>(null);
  const [previewBase64, setPreviewBase64] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  // Status
  const [busy, setBusy] = useState<null | "dieline" | "convert">(null);
  const [error, setError] = useState<string | null>(null);

  // Derived
  const dimsW = customW ?? activeBox.defaultW;
  const dimsH = customH ?? activeBox.defaultH;
  const dimsD = customD ?? activeBox.defaultD;

  const liveSvg = useMemo(() => buildStudioSvg(studioState, selectedPanel), [studioState, selectedPanel]);
  const liveSvgDataUrl = useMemo(() => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(liveSvg)}`, [liveSvg]);

  // Panel-zoomed SVG for the spot-edit preview (shows only the selected panel)
  const panelPreviewDataUrl = useMemo(() => {
    if (!selectedPanel || selectedPanel === "all") return liveSvgDataUrl;
    const m = PANEL_META[selectedPanel];
    const zoomed = liveSvg.replace(/viewBox="[^"]*"/, `viewBox="${m.x} ${m.y} ${m.w} ${m.h}"`);
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(zoomed)}`;
  }, [liveSvg, liveSvgDataUrl, selectedPanel]);

  const viewerConfig: ViewerConfig = useMemo(() => ({
    type: activeBox.id,
    finish,
    color,
    color2,
    logoText,
    logoShow: logoShow && !dielineBase64,
    w: dimsW / 100,
    h: dimsH / 100,
    d: dimsD / 100,
  }), [activeBox.id, finish, color, color2, logoText, logoShow, dielineBase64, dimsW, dimsH, dimsD]);

  const selectBox = useCallback((box: StudioBox) => {
    setActiveBox(box);
    setCustomW(null); setCustomH(null); setCustomD(null);
  }, []);

  // ── Generate dieline ──────────────────────────────────────────────────────

  const handleGenerate = async () => {
    if (!businessName.trim()) { setError("Enter a business name to generate."); return; }
    setError(null);
    setBusy("dieline");
    try {
      let logoBase64: string | undefined;
      if (logoFile) logoBase64 = await fileToBase64(logoFile);

      const out = await postJson<GenResp>("/api/generate-dieline", {
        businessName,
        tagline,
        printDescription: description || "Packaging design",
        boxType: activeBox.apiType,
        style,
        ...(logoBase64 ? { logoBase64 } : {}),
        ...(customW ? { customDimensions: { width: dimsW, height: dimsH, depth: dimsD, unit: "mm" } } : {}),
      });
      if (!out.success || !out.dielineBase64) throw new Error(out.message ?? "Generation failed");

      setDielineBase64(out.dielineBase64);
      setServerSvgSource(out.cleanSvgSource ?? out.svgSource ?? null);
      setDesignNotes(out.designNotes ?? null);
      setGltfBase64(null); setPreviewBase64(null); setDownloadUrl(null);

      const next = buildInitialStudioState(
        businessName || "Brand",
        tagline || "Tagline",
        description || "Back panel",
      );
      if (logoFile) next.front.logoDataUrl = await fileToDataUrl(logoFile);
      if (out.colorPalette?.[1]) { next.front.fill = out.colorPalette[1]; setColor(out.colorPalette[1]); }
      if (out.colorPalette?.[0]) { next.front.textColor = out.colorPalette[0]; }
      setStudioState(next);
      setPanelText(next.front.text);
      setPanelFill(next.front.fill);
      setActiveTab("edit");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(null);
    }
  };

  // ── Convert to 3D ────────────────────────────────────────────────────────

  const handleConvert = async () => {
    if (!dielineBase64) { setError("Generate a dieline first."); return; }
    setError(null);
    setBusy("convert");
    try {
      const textureBase64 = await svgToPngBase64(liveSvg);
      const out = await postJson<ConvResp>("/api/convert-to-3d", {
        dielineBase64: textureBase64,
        boxType: activeBox.apiType,
        ...(bgBase64 ? { backgroundBase64: bgBase64 } : {}),
        ...(customW ? { customDimensions: { width: dimsW, height: dimsH, depth: dimsD } } : {}),
        lightingIntensity: 1.5,
      });
      if (!out.success || !out.gltfBase64) throw new Error(out.message ?? "Conversion failed");
      setGltfBase64(out.gltfBase64);
      setPreviewBase64(out.previewBase64 ?? null);
      setDownloadUrl(out.downloadUrl ?? null);
      setActiveTab("export");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(null);
    }
  };

  // ── Panel editing ─────────────────────────────────────────────────────────

  const applyPanel = useCallback(() => {
    if (selectedPanel === "all") {
      setStudioState((prev) => {
        const next = { ...prev };
        (Object.keys(PANEL_META) as PanelId[]).forEach((id) => {
          next[id] = { ...next[id], fill: panelFill, text: panelText };
        });
        return next;
      });
    } else {
      setStudioState((prev) => ({
        ...prev,
        [selectedPanel]: { ...prev[selectedPanel], fill: panelFill, text: panelText },
      }));
    }
  }, [selectedPanel, panelFill, panelText]);

  const handlePanelLogo = useCallback(async (file: File | null) => {
    if (!file || selectedPanel === "all") return;
    const dataUrl = await fileToDataUrl(file);
    setStudioState((prev) => ({ ...prev, [selectedPanel]: { ...prev[selectedPanel], logoDataUrl: dataUrl } }));
  }, [selectedPanel]);

  const handleSpotEdit = async () => {
    if (!spotPrompt.trim()) return;
    if (selectedPanel === "all") { setError("Select a specific panel for spot edit."); return; }
    setError(null);
    setSpotEditing(true);
    try {
      const hasSelection = spotSelection && spotSelection.w > 0.05 && spotSelection.h > 0.05;
      const panelImageBase64 = hasSelection
        ? await cropSubRegionPngBase64(liveSvg, selectedPanel, spotSelection!)
        : await cropPanelPngBase64(liveSvg, selectedPanel);
      const p = studioState[selectedPanel];
      const panelSVGSource = `<g id="panel-${selectedPanel}">
  <rect id="${selectedPanel}-bg-rect" x="0" y="0" width="256" height="256" fill="${p.fill}"/>
  <text id="${selectedPanel}-text-0" x="128" y="190" text-anchor="middle" font-size="18" font-weight="700" fill="${p.textColor}">${esc(p.text)}</text>
</g>`;
      const out = await postJson<SpotEditResp>("/api/spot-edit", {
        panelImageBase64,
        panelSVGSource,
        selectedElementIds: [`${selectedPanel}-bg-rect`, `${selectedPanel}-text-0`],
        boxType: activeBox.apiType,
        panelName: selectedPanel,
        brandContext: { name: businessName || "Brand", colors: [panelFill, p.textColor], style },
        prompt: spotPrompt.trim(),
      });
      if (!out.success) throw new Error(out.message ?? "Spot edit failed");
      setStudioState((prev) => {
        const t = { ...prev[selectedPanel] };
        for (const op of out.operations ?? []) {
          if (op.type === "set-panel-bg-color") t.fill = op.color;
          else if (op.type === "set-text-content" && op.elementId === `${selectedPanel}-text-0`) t.text = op.text;
          else if (op.type === "set-style" && op.elementId === `${selectedPanel}-text-0` && op.property === "fill") t.textColor = op.value;
          else if (op.type === "set-attribute" && op.elementId === `${selectedPanel}-bg-rect` && op.attribute === "fill") t.fill = op.value;
        }
        return { ...prev, [selectedPanel]: t };
      });
      setSpotPrompt("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Spot edit failed");
    } finally {
      setSpotEditing(false);
    }
  };

  // ── Background upload ─────────────────────────────────────────────────────

  const handleBgUpload = useCallback(async (file: File | null) => {
    if (bgObjectUrl) URL.revokeObjectURL(bgObjectUrl);
    setBgFile(file); setBgBase64(null); setBgObjectUrl(null);
    if (!file) return;
    setBgObjectUrl(URL.createObjectURL(file));
    const fd = new FormData(); fd.set("file", file);
    const res = await fetch("/api/upload-background", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error((data as { message?: string }).message ?? "Upload failed");
    setBgBase64((data as { backgroundBase64: string }).backgroundBase64);
  }, [bgObjectUrl]);

  const clearBackground = useCallback(() => {
    if (bgObjectUrl) URL.revokeObjectURL(bgObjectUrl);
    setBgFile(null);
    setBgBase64(null);
    setBgObjectUrl(null);
  }, [bgObjectUrl]);

  // ── Custom model upload ───────────────────────────────────────────────────

  function handleCustomModelFile(file: File) {
    if (customModelUrl) URL.revokeObjectURL(customModelUrl);
    const url = URL.createObjectURL(file);
    setCustomModelUrl(url);
    setCustomModelName(file.name.replace(/\.[^.]+$/, ""));
    setCustomMeshInfos([]);
    setMeshTextureSettings({});
  }

  function clearCustomModel() {
    if (customModelUrl) URL.revokeObjectURL(customModelUrl);
    setCustomModelUrl(null);
    setCustomModelName(null);
    setCustomMeshInfos([]);
    setMeshTextureSettings({});
  }

  function setMeshSetting(idx: number, patch: Partial<CustomMeshTextureSettings>) {
    setMeshTextureSettings((prev) => ({
      ...prev,
      [idx]: {
        enabled: prev[idx]?.enabled ?? false,
        scale: prev[idx]?.scale ?? 1,
        offsetX: prev[idx]?.offsetX ?? 0,
        offsetY: prev[idx]?.offsetY ?? 0,
        rotation: prev[idx]?.rotation ?? 0,
        ...patch,
      },
    }));
  }

  function startSidebarResize(side: "left" | "right", startClientX: number) {
    const root = appRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const startLeft = leftPanelWidth;
    const startRight = rightPanelWidth;
    let currentLeft = startLeft;
    let currentRight = startRight;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startClientX;
      const total = rect.width;

      if (side === "left") {
        const maxLeft = Math.min(LEFT_MAX, total - startRight - CENTER_MIN);
        const nextLeft = Math.max(LEFT_MIN, Math.min(maxLeft, startLeft + dx));
        currentLeft = nextLeft;
        setLeftPanelWidth(nextLeft);
      } else {
        const maxRight = Math.min(RIGHT_MAX, total - startLeft - CENTER_MIN);
        const nextRight = Math.max(RIGHT_MIN, Math.min(maxRight, startRight - dx));
        currentRight = nextRight;
        setRightPanelWidth(nextRight);
      }
    };

    const onUp = () => {
      writeSidebarWidths({ left: currentLeft, right: currentRight });
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // ── Toolbar buttons ───────────────────────────────────────────────────────

  const toolbarBtns = [
    { label: "Spin", icon: "↻", action: () => viewerRef.current?.toggleSpin() },
    { label: "Zoom In", icon: "+", action: () => viewerRef.current?.zoomIn() },
    { label: "Zoom Out", icon: "-", action: () => viewerRef.current?.zoomOut() },
    { label: "Reset", icon: "⟲", action: () => viewerRef.current?.resetView() },
    { label: "Grid", icon: "⊞", action: () => viewerRef.current?.toggleGrid() },
  ];

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: "generate", label: "Generate" },
    { id: "design",   label: "Design" },
    { id: "edit",     label: "2D Edit" },
    { id: "size",     label: "Size" },
    { id: "export",   label: "Export" },
  ];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div ref={appRef} style={{ display: "flex", height: "100vh", width: "100%", fontFamily: "'DM Sans','Helvetica Neue',sans-serif", background: "#0f0f0f", color: "#f0ede8", overflow: "hidden" }}>

      {/* ── LEFT SIDEBAR ── */}
      <div style={{ width: leftPanelWidth, flexShrink: 0, background: "#141414", borderRight: "1px solid #222", display: "flex", flexDirection: "column", overflowY: "auto" }}>

        {/* Brand */}
        <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid #222", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, background: "#f5c842", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: "#0f0f0f", flexShrink: 0 }}>T</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: -0.3, color: "#f0ede8" }}>Tessellate</div>
            <div style={{ fontSize: 10, color: "#555", letterSpacing: "0.8px", textTransform: "uppercase" }}>Packaging Studio</div>
          </div>
        </div>

        {/* Box type grid */}
        <div style={{ padding: "14px 14px 8px" }}>
          <div style={{ fontSize: 10, color: "#555", letterSpacing: "1px", textTransform: "uppercase", marginBottom: 10 }}>Package Shape</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
            {STUDIO_BOXES.map((b) => (
              <button key={b.id} onClick={() => selectBox(b)} style={{
                background: activeBox.id === b.id ? "#f5c842" : "#1e1e1e",
                border: "none", borderRadius: 8, padding: "9px 6px",
                cursor: "pointer", textAlign: "center",
                color: activeBox.id === b.id ? "#0f0f0f" : "#777",
                transition: "all .15s",
              }}>
                <div style={{ fontSize: 17, marginBottom: 2 }}>{b.icon}</div>
                <div style={{ fontSize: 9, fontWeight: 500, letterSpacing: "0.2px", lineHeight: 1.3 }}>{b.label}</div>
              </button>
            ))}
          </div>
        </div>

        <div style={{ flex: 1 }} />

        {/* Quick export */}
        <div style={{ padding: 14, borderTop: "1px solid #222", display: "flex", flexDirection: "column", gap: 8 }}>
          {dielineBase64 && (
            <button onClick={() => void handleConvert()} disabled={busy !== null} style={{ ...S.btn.primary, width: "100%", opacity: busy ? 0.6 : 1 }}>
              {busy === "convert" ? "Building 3D…" : "↑ Convert to 3D"}
            </button>
          )}
          {gltfBase64 && (
            <button onClick={() => downloadBase64(gltfBase64, "tessellate.glb", "model/gltf-binary")} style={{ ...S.btn.ghost, width: "100%", fontSize: 12 }}>
              ↓ Download GLB
            </button>
          )}
          <div style={{ fontSize: 10, color: "#444", textAlign: "center", marginTop: 4 }}>Powered by Claude</div>
        </div>
      </div>

      {/* Left resize handle */}
      <div
        role="separator"
        aria-label="Resize left panel"
        onMouseDown={(e) => startSidebarResize("left", e.clientX)}
        style={{
          width: 6,
          flexShrink: 0,
          cursor: "col-resize",
          background: "transparent",
          borderLeft: "1px solid #1d1d1d",
          borderRight: "1px solid #1d1d1d",
        }}
      />

      {/* ── CENTER: 3D VIEWER ── */}
      <div style={{ flex: 1, position: "relative", background: "#f5f4f0", minWidth: 0 }}>
        <PackagingViewer
          ref={viewerRef}
          config={viewerConfig}
          dielineSvg={dielineBase64 ? liveSvg : null}
          bgUrl={bgObjectUrl}
          onReady={() => setViewerReady(true)}
          customModelUrl={customModelUrl}
          customMeshTextureSettings={meshTextureSettings}
          onCustomModelLoaded={(meshes) => {
            setCustomMeshInfos(meshes);
            setMeshTextureSettings(
              Object.fromEntries(
                meshes.map((m) => [
                  m.index,
                  { enabled: m.index === 0, scale: 1, offsetX: 0, offsetY: 0, rotation: 0 },
                ]),
              ),
            );
          }}
        />

        {/* Hidden file input for GLB upload */}
        <input
          ref={customModelInputRef}
          type="file"
          accept=".glb,.gltf"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleCustomModelFile(f);
            e.target.value = "";
          }}
        />

        {/* Custom 3D upload button — top-right corner */}
        <div style={{ position: "absolute", top: 14, right: 14, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, zIndex: 5 }}>
          {viewerReady && !customModelUrl && (
            <div style={{ fontSize: 10, color: "#aaa" }}>drag · scroll to zoom</div>
          )}
          <button
            onClick={() => customModelInputRef.current?.click()}
            title="Upload a custom 3D object (.glb / .gltf)"
            style={{
              background: "rgba(15,15,15,0.85)", backdropFilter: "blur(8px)",
              border: "1px solid #333", borderRadius: 8, padding: "6px 12px",
              color: "#f5c842", fontSize: 11, cursor: "pointer", display: "flex",
              alignItems: "center", gap: 6, fontWeight: 600, letterSpacing: "0.3px",
            }}
          >
            <span style={{ fontSize: 15 }}>⬆</span> Upload 3D
          </button>

          {/* Model name + clear */}
          {customModelName && (
            <div style={{
              background: "rgba(15,15,15,0.88)", backdropFilter: "blur(8px)",
              border: "1px solid #2a2a2a", borderRadius: 8, padding: "8px 12px",
              fontSize: 11, color: "#ccc", maxWidth: 260, maxHeight: 340, overflowY: "auto",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: customMeshInfos.length > 0 ? 8 : 0 }}>
                <span style={{ fontWeight: 600, color: "#f0ede8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {customModelName}
                </span>
                <button
                  onClick={clearCustomModel}
                  title="Remove custom model"
                  style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, flexShrink: 0 }}
                >×</button>
              </div>

              {/* Mesh picker */}
              {customMeshInfos.length > 0 && (
                <div>
                  <div style={{ fontSize: 9, color: "#555", letterSpacing: "0.7px", textTransform: "uppercase", marginBottom: 5 }}>
                    Adjustable sections:
                  </div>
                  {customMeshInfos.map((m) => (
                    <div key={m.index} style={{ border: "1px solid #2c2c2c", borderRadius: 6, padding: 6, marginBottom: 6 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", paddingBottom: 4 }}>
                        <input
                          type="checkbox"
                          checked={meshTextureSettings[m.index]?.enabled ?? false}
                          onChange={(e) => setMeshSetting(m.index, { enabled: e.target.checked })}
                          style={{ accentColor: "#f5c842", cursor: "pointer" }}
                        />
                        <span style={{ fontSize: 11, color: "#ccc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {m.name || `Section ${m.index + 1}`}
                        </span>
                      </label>

                      <div style={{ display: "grid", gridTemplateColumns: "52px 1fr", gap: 6, alignItems: "center", fontSize: 10, color: "#888" }}>
                        <span>Scale</span>
                        <input
                          type="range"
                          min="0.5"
                          max="2"
                          step="0.01"
                          value={meshTextureSettings[m.index]?.scale ?? 1}
                          onChange={(e) => setMeshSetting(m.index, { scale: Number(e.target.value) })}
                          disabled={!(meshTextureSettings[m.index]?.enabled ?? false)}
                        />
                        <span>Offset X</span>
                        <input
                          type="range"
                          min="-1"
                          max="1"
                          step="0.01"
                          value={meshTextureSettings[m.index]?.offsetX ?? 0}
                          onChange={(e) => setMeshSetting(m.index, { offsetX: Number(e.target.value) })}
                          disabled={!(meshTextureSettings[m.index]?.enabled ?? false)}
                        />
                        <span>Offset Y</span>
                        <input
                          type="range"
                          min="-1"
                          max="1"
                          step="0.01"
                          value={meshTextureSettings[m.index]?.offsetY ?? 0}
                          onChange={(e) => setMeshSetting(m.index, { offsetY: Number(e.target.value) })}
                          disabled={!(meshTextureSettings[m.index]?.enabled ?? false)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Viewer toolbar */}
        <div style={{
          position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)",
          display: "flex", gap: 6, background: "rgba(15,15,15,0.85)",
          backdropFilter: "blur(8px)", borderRadius: 40, padding: "7px 12px",
        }}>
          {toolbarBtns.map((btn) => (
            <button key={btn.label} onClick={btn.action} style={{
              background: "transparent", border: "none", cursor: "pointer", color: "#bbb",
              fontSize: 10, display: "flex", flexDirection: "column", alignItems: "center",
              gap: 2, padding: "4px 10px", borderRadius: 20, transition: "all .15s",
            }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#333"; (e.currentTarget as HTMLButtonElement).style.color = "#fff"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "#bbb"; }}
            >
              <span style={{ fontSize: 17 }}>{btn.icon}</span>
              <span>{btn.label}</span>
            </button>
          ))}
        </div>

        {/* Box label */}
        <div style={{ position: "absolute", top: 14, left: 14, background: "rgba(15,15,15,0.72)", backdropFilter: "blur(6px)", borderRadius: 8, padding: "5px 12px", fontSize: 11, color: "#bbb", letterSpacing: "0.3px" }}>
          {activeBox.label}
        </div>

        {/* Error toast */}
        {error && (
          <div style={{ position: "absolute", top: 14, left: "50%", transform: "translateX(-50%)", background: "#ff4444", color: "#fff", padding: "8px 16px", borderRadius: 8, fontSize: 12, maxWidth: 340, textAlign: "center", zIndex: 10 }}>
            {error}
            <button onClick={() => setError(null)} style={{ marginLeft: 10, background: "none", border: "none", color: "#fff", cursor: "pointer", fontWeight: 700 }}>×</button>
          </div>
        )}
      </div>

      {/* ── RIGHT SIDEBAR ── */}
      {/* Right resize handle */}
      <div
        role="separator"
        aria-label="Resize right panel"
        onMouseDown={(e) => startSidebarResize("right", e.clientX)}
        style={{
          width: 6,
          flexShrink: 0,
          cursor: "col-resize",
          background: "transparent",
          borderLeft: "1px solid #1d1d1d",
          borderRight: "1px solid #1d1d1d",
        }}
      />

      <div style={{ width: rightPanelWidth, flexShrink: 0, background: "#141414", borderLeft: "1px solid #222", display: "flex", flexDirection: "column", overflowY: "auto" }}>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #222", overflowX: "auto" }}>
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
              flex: 1, padding: "13px 0", fontSize: 10, fontWeight: 500,
              letterSpacing: "0.7px", textTransform: "uppercase",
              background: "transparent", border: "none", cursor: "pointer",
              color: activeTab === t.id ? "#f5c842" : "#555",
              borderBottom: activeTab === t.id ? "2px solid #f5c842" : "2px solid transparent",
              transition: "all .15s", minWidth: 46, whiteSpace: "nowrap",
            }}>
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ padding: "18px 18px 0", flex: 1, overflow: "auto" }}>

          {/* ── GENERATE TAB ── */}
          {activeTab === "generate" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <FieldLabel>Business Name</FieldLabel>
              <input style={S.input} value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Acme Studio" />

              <FieldLabel>Tagline</FieldLabel>
              <input style={S.input} value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Made for slow mornings" />

              <FieldLabel>Creative Direction</FieldLabel>
              <textarea
                style={{ ...S.input, resize: "vertical", minHeight: 80, lineHeight: 1.5 }}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Minimal kraft packaging with botanical line art…"
              />

              <FieldLabel>Style Hint</FieldLabel>
              <input style={S.input} value={style} onChange={(e) => setStyle(e.target.value)} placeholder="minimalist, luxury, playful…" />

              <FieldLabel>Logo (optional)</FieldLabel>
              <label style={{ ...S.btn.ghost, display: "block", textAlign: "center", fontSize: 12, cursor: "pointer" }}>
                {logoFile ? `✓ ${logoFile.name}` : "Upload logo image"}
                <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }} onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)} />
              </label>

              <FieldLabel>Background Panorama (optional)</FieldLabel>
              <label style={{ ...S.btn.ghost, display: "block", textAlign: "center", fontSize: 12, cursor: "pointer" }}>
                {bgFile ? `✓ ${bgFile.name}` : "Upload 360° panorama"}
                <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }} onChange={async (e) => { try { await handleBgUpload(e.target.files?.[0] ?? null); } catch (err) { setError(err instanceof Error ? err.message : "Upload failed"); } }} />
              </label>
              {bgFile && (
                <button onClick={clearBackground} style={{ ...S.btn.ghost, width: "100%", marginTop: 8, fontSize: 11 }}>
                  ✕ Remove panorama
                </button>
              )}

              <button onClick={() => void handleGenerate()} disabled={busy !== null} style={{ ...S.btn.primary, marginTop: 6, opacity: busy ? 0.65 : 1 }}>
                {busy === "dieline" ? (
                  <span style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
                    <Spinner /> Generating…
                  </span>
                ) : "✦ Generate AI Dieline"}
              </button>

              {designNotes && (
                <div style={{ background: "#1e1e1e", borderRadius: 8, padding: "10px 12px", fontSize: 11, color: "#666", lineHeight: 1.6, marginTop: 4 }}>
                  {designNotes}
                </div>
              )}
            </div>
          )}

          {/* ── DESIGN TAB ── */}
          {activeTab === "design" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div>
                <FieldLabel>Primary Color</FieldLabel>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                  <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 44, height: 44, border: "none", background: "none", cursor: "pointer", borderRadius: 8 }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{color.toUpperCase()}</div>
                    <div style={{ fontSize: 10, color: "#555" }}>Main panels</div>
                  </div>
                </div>

                <FieldLabel>Accent Color</FieldLabel>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                  <input type="color" value={color2} onChange={(e) => setColor2(e.target.value)} style={{ width: 44, height: 44, border: "none", background: "none", cursor: "pointer", borderRadius: 8 }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{color2.toUpperCase()}</div>
                    <div style={{ fontSize: 10, color: "#555" }}>Sides & dome</div>
                  </div>
                </div>

                <FieldLabel>Quick Palettes</FieldLabel>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 5 }}>
                  {QUICK_PALETTES.map(([c, a], i) => (
                    <button key={i} onClick={() => { setColor(c); setColor2(a); }} style={{
                      aspectRatio: "1", borderRadius: 7,
                      background: `linear-gradient(135deg,${c} 50%,${a} 50%)`,
                      border: color === c && color2 === a ? "2px solid #f5c842" : "1px solid #2a2a2a",
                      cursor: "pointer",
                    }} />
                  ))}
                </div>
              </div>

              <div>
                <FieldLabel>Surface Finish</FieldLabel>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {FINISH_PRESETS.map((f) => (
                    <button key={f.id} onClick={() => setFinish(f.id)} style={{
                      background: finish === f.id ? "#202020" : "transparent",
                      border: finish === f.id ? "1px solid #f5c842" : "1px solid #252525",
                      borderRadius: 8, padding: "10px 12px", cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      color: finish === f.id ? "#f0ede8" : "#555", textAlign: "left",
                    }}>
                      <div>
                        <div style={{ fontWeight: 500, fontSize: 12 }}>{f.label}</div>
                        <div style={{ fontSize: 10, color: "#444", marginTop: 2 }}>roughness {f.roughness} · metal {f.metalness}</div>
                      </div>
                      <div style={{ width: 22, height: 22, borderRadius: "50%", background: finish === f.id ? "#f5c842" : "#252525", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#0f0f0f" }}>
                        {finish === f.id ? "✓" : ""}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <FieldLabel>Logo Badge</FieldLabel>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <input style={S.input} value={logoText} onChange={(e) => setLogoText(e.target.value)} placeholder="Your brand (max 8 chars)" maxLength={8} />
                  <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                    <div onClick={() => setLogoShow((v) => !v)} style={{ width: 38, height: 20, borderRadius: 10, background: logoShow ? "#f5c842" : "#2a2a2a", position: "relative", transition: "background .2s", cursor: "pointer", flexShrink: 0 }}>
                      <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: logoShow ? 20 : 2, transition: "left .2s" }} />
                    </div>
                    <span style={{ fontSize: 12, color: "#888" }}>Show on box</span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* ── 2D EDIT TAB ── */}
          {activeTab === "edit" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {!dielineBase64 && (
                <div style={{ background: "#1a1a1a", borderRadius: 8, padding: "16px 12px", textAlign: "center", fontSize: 11, color: "#444", border: "1px dashed #2a2a2a" }}>
                  Generate a dieline first to enable the 2D editor
                </div>
              )}

              <FieldLabel>Selected Panel</FieldLabel>
              <select style={S.input} value={selectedPanel} onChange={(e) => {
                const p = e.target.value as PanelId | "all";
                setSelectedPanel(p);
                setSpotSelection(null);
                if (p !== "all") {
                  setPanelText(studioState[p].text);
                  setPanelFill(studioState[p].fill);
                }
              }}>
                <option value="all">All Panels</option>
                {(Object.keys(PANEL_META) as PanelId[]).map((p) => (
                  <option key={p} value={p}>{PANEL_META[p].label}</option>
                ))}
              </select>

              {/* Panel preview with drag-to-select overlay */}
              {dielineBase64 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {selectedPanel !== "all" && (
                    <>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <FieldLabel>Panel Preview — drag to select region</FieldLabel>
                        {spotSelection && (
                          <button onClick={() => setSpotSelection(null)} style={{ fontSize: 10, color: "#f5c842", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                            Clear selection ×
                          </button>
                        )}
                      </div>
                      <div
                        ref={selectionContainerRef}
                        style={{ position: "relative", userSelect: "none", cursor: "crosshair", borderRadius: 8, overflow: "hidden", border: "1px solid #2a2a2a" }}
                        onMouseDown={(e) => {
                          const rect = selectionContainerRef.current?.getBoundingClientRect();
                          if (!rect) return;
                          const x = (e.clientX - rect.left) / rect.width;
                          const y = (e.clientY - rect.top) / rect.height;
                          dragStartRef.current = { x, y };
                          isDraggingRef.current = true;
                          setSpotSelection({ x, y, w: 0, h: 0 });
                        }}
                        onMouseMove={(e) => {
                          if (!isDraggingRef.current || !dragStartRef.current) return;
                          const rect = selectionContainerRef.current?.getBoundingClientRect();
                          if (!rect) return;
                          const cx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                          const cy = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
                          const ds = dragStartRef.current;
                          setSpotSelection({ x: Math.min(ds.x, cx), y: Math.min(ds.y, cy), w: Math.abs(cx - ds.x), h: Math.abs(cy - ds.y) });
                        }}
                        onMouseUp={() => {
                          isDraggingRef.current = false;
                          setSpotSelection((s) => (s && s.w < 0.04 && s.h < 0.04) ? null : s);
                        }}
                        onMouseLeave={() => { isDraggingRef.current = false; }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={panelPreviewDataUrl} alt="Panel preview" style={{ width: "100%", display: "block" }} draggable={false} />
                        {spotSelection && spotSelection.w > 0.02 && spotSelection.h > 0.02 && (
                          <div style={{
                            position: "absolute",
                            left: `${spotSelection.x * 100}%`, top: `${spotSelection.y * 100}%`,
                            width: `${spotSelection.w * 100}%`, height: `${spotSelection.h * 100}%`,
                            border: "2px solid #f5c842", background: "rgba(245,200,66,0.18)",
                            pointerEvents: "none",
                          }}>
                            <div style={{ position: "absolute", top: -1, left: -1, width: 6, height: 6, background: "#f5c842" }} />
                            <div style={{ position: "absolute", top: -1, right: -1, width: 6, height: 6, background: "#f5c842" }} />
                            <div style={{ position: "absolute", bottom: -1, left: -1, width: 6, height: 6, background: "#f5c842" }} />
                            <div style={{ position: "absolute", bottom: -1, right: -1, width: 6, height: 6, background: "#f5c842" }} />
                          </div>
                        )}
                      </div>
                      {spotSelection && spotSelection.w > 0.04 && (
                        <p style={{ fontSize: 10, color: "#f5c842", margin: 0 }}>
                          Region selected — spot edit will target this area
                        </p>
                      )}
                    </>
                  )}

                  {/* Full dieline thumbnail */}
                  {selectedPanel === "all" && (
                    <>
                      <FieldLabel>Full Dieline</FieldLabel>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={liveSvgDataUrl} alt="Live dieline" style={{ width: "100%", borderRadius: 8, border: "1px solid #2a2a2a" }} />
                    </>
                  )}
                </div>
              )}

              <FieldLabel>Panel Fill Color</FieldLabel>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input type="color" value={panelFill} onChange={(e) => setPanelFill(e.target.value)} style={{ width: 42, height: 38, borderRadius: 7, border: "1px solid #383838", background: "#242424", cursor: "pointer", flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: "#888" }}>{panelFill.toUpperCase()} {selectedPanel === "all" ? "— all panels" : `— ${selectedPanel}`}</span>
              </div>

              <FieldLabel>Panel Text</FieldLabel>
              <input style={S.input} value={panelText} onChange={(e) => setPanelText(e.target.value)} placeholder={selectedPanel === "all" ? "Text for all panels" : "Panel copy"} />

              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={applyPanel} style={{ ...S.btn.primary, flex: 1, fontSize: 12 }}>
                  Apply {selectedPanel === "all" ? "to All" : ""}
                </button>
                <label style={{ ...S.btn.ghost, flex: 1, textAlign: "center", fontSize: 12, cursor: "pointer", opacity: selectedPanel === "all" ? 0.4 : 1 }}>
                  Add Logo
                  <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }} disabled={selectedPanel === "all"} onChange={async (e) => { await handlePanelLogo(e.target.files?.[0] ?? null); }} />
                </label>
              </div>

              <div style={{ borderTop: "1px solid #222", paddingTop: 14 }}>
                <FieldLabel>Spot Edit (AI)</FieldLabel>
                <p style={{ fontSize: 10, color: "#555", marginBottom: 10, lineHeight: 1.5 }}>
                  {selectedPanel === "all"
                    ? "Select a specific panel to use spot edit."
                    : spotSelection && spotSelection.w > 0.04
                      ? "Claude will edit only the selected region (yellow box)."
                      : "Describe what to change. Drag on the preview above to target a specific region."}
                </p>
                <textarea
                  style={{ ...S.input, resize: "vertical", minHeight: 64, lineHeight: 1.5, marginBottom: 8, opacity: selectedPanel === "all" ? 0.4 : 1 }}
                  value={spotPrompt}
                  onChange={(e) => setSpotPrompt(e.target.value)}
                  disabled={selectedPanel === "all"}
                  placeholder="e.g. make typography premium gold, add a botanical illustration"
                />
                <button
                  onClick={() => void handleSpotEdit()}
                  disabled={spotEditing || !spotPrompt.trim() || selectedPanel === "all"}
                  style={{ ...S.btn.primary, width: "100%", opacity: (spotEditing || !spotPrompt.trim() || selectedPanel === "all") ? 0.55 : 1 }}
                >
                  {spotEditing
                    ? <span style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}><Spinner /> Applying…</span>
                    : spotSelection && spotSelection.w > 0.04 ? "✦ Apply to Selected Region" : "✦ Apply Spot Edit"}
                </button>
              </div>
            </div>
          )}

          {/* ── SIZE TAB ── */}
          {activeTab === "size" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <FieldLabel>Custom Dimensions (mm)</FieldLabel>
              {[
                { label: "Width",  cur: dimsW, set: setCustomW,  def: activeBox.defaultW },
                { label: "Height", cur: dimsH, set: setCustomH,  def: activeBox.defaultH },
                { label: "Depth",  cur: dimsD, set: setCustomD,  def: activeBox.defaultD },
              ].map((dim) => (
                <div key={dim.label}>
                  <div style={{ ...S.label, marginBottom: 6 }}>{dim.label}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input type="range" min={20} max={500} step={5} value={dim.cur}
                      onChange={(e) => dim.set(Number(e.target.value))}
                      style={{ flex: 1, accentColor: "#f5c842" }}
                    />
                    <input type="number" min={20} max={500} value={dim.cur}
                      onChange={(e) => dim.set(Math.max(20, Math.min(500, Number(e.target.value) || dim.def)))}
                      style={{ ...S.input, width: 62, textAlign: "center", padding: "6px 4px" }}
                    />
                  </div>
                </div>
              ))}

              {/* Reset dims */}
              <button onClick={() => { setCustomW(null); setCustomH(null); setCustomD(null); }} style={{ ...S.btn.ghost, width: "100%", fontSize: 12, marginTop: 4 }}>
                Reset to defaults
              </button>

              {/* Volume */}
              <div style={{ background: "#1a1a1a", borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>Volume</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#f0ede8" }}>
                  {((dimsW * dimsH * dimsD) / 1_000_000).toFixed(1)} L
                </div>
                <div style={{ fontSize: 10, color: "#444", marginTop: 2 }}>{dimsW} × {dimsH} × {dimsD} mm</div>
              </div>

              {/* Convert button */}
              <button onClick={() => void handleConvert()} disabled={busy !== null || !dielineBase64} style={{ ...S.btn.primary, width: "100%", marginTop: 4, opacity: (!dielineBase64 || busy) ? 0.55 : 1 }}>
                {busy === "convert" ? <span style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}><Spinner /> Building 3D…</span> : "↑ Build 3D Model"}
              </button>
            </div>
          )}

          {/* ── EXPORT TAB ── */}
          {activeTab === "export" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {!gltfBase64 && (
                <div style={{ background: "#1a1a1a", borderRadius: 8, padding: "12px 14px", fontSize: 11, color: "#555", lineHeight: 1.6, border: "1px dashed #2a2a2a" }}>
                  Convert your design to 3D (Size tab) to enable GLB download.
                </div>
              )}

              {[
                {
                  label: "3D Model", ext: ".glb", desc: "Blender / Unity / Unreal",
                  disabled: !gltfBase64,
                  onClick: () => gltfBase64 && downloadBase64(gltfBase64, "tessellate-mockup.glb", "model/gltf-binary"),
                },
                {
                  label: "Render", ext: ".png", desc: "High-res preview image",
                  disabled: !viewerReady,
                  onClick: async () => {
                    const b64 = viewerRef.current?.capture(1920, 1080) ?? null;
                    if (b64) { downloadBase64(b64, "tessellate-render.png", "image/png"); return; }
                    if (previewBase64) { downloadBase64(previewBase64, "tessellate-render.png", "image/png"); return; }
                    const svg64 = await svgToPngBase64(liveSvg);
                    downloadBase64(svg64, "tessellate-render.png", "image/png");
                  },
                },
                {
                  label: "Dieline", ext: ".svg", desc: "Editable vector dieline",
                  disabled: false,
                  onClick: () => {
                    const blob = new Blob([liveSvg], { type: "image/svg+xml;charset=utf-8" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a"); a.href = url; a.download = "tessellate-dieline.svg"; a.click();
                    URL.revokeObjectURL(url);
                  },
                },
                {
                  label: "Metadata", ext: ".json", desc: "Design notes + config",
                  disabled: !downloadUrl,
                  onClick: () => downloadUrl && window.open(`${downloadUrl}?format=json`),
                },
              ].map((item) => (
                <button key={item.ext} disabled={item.disabled} onClick={() => void item.onClick()} style={{
                  ...S.btn.ghost, textAlign: "left", opacity: item.disabled ? 0.38 : 1,
                  display: "flex", alignItems: "center", gap: 12,
                }}>
                  <div style={{ width: 36, height: 36, background: "#1e1e1e", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#888", fontFamily: "monospace" }}>{item.ext}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "#ddd" }}>Download {item.label}</div>
                    <div style={{ fontSize: 10, color: "#555", marginTop: 1 }}>{item.desc}</div>
                  </div>
                </button>
              ))}

              {/* SVG download always available */}
              {dielineBase64 && (
                <div style={{ borderTop: "1px solid #1e1e1e", marginTop: 8, paddingTop: 12 }}>
                  <FieldLabel>Share 2D dieline</FieldLabel>
                  <div style={{ fontSize: 10, color: "#444", wordBreak: "break-all", background: "#1a1a1a", borderRadius: 6, padding: "8px 10px" }}>
                    {liveSvgDataUrl.slice(0, 80)}…
                  </div>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Bottom strip */}
        <div style={{ padding: "14px 18px 18px", borderTop: "1px solid #1e1e1e", display: "flex", gap: 8 }}>
          <button onClick={() => viewerRef.current?.resetView()} style={{ ...S.btn.ghost, flex: 1, fontSize: 11 }}>⟲ Reset View</button>
          {activeTab !== "generate" && (
            <button onClick={() => setActiveTab("generate")} style={{ ...S.btn.primary, flex: 1, fontSize: 11 }}>✦ Generate</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, color: "#555", letterSpacing: "0.8px", textTransform: "uppercase", marginBottom: 6 }}>{children}</div>;
}

function Spinner() {
  return (
    <span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid currentColor", borderRightColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
  );
}
