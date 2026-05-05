"use client";

import Image from "next/image";
import { useCallback, useState } from "react";
import { Preview3D } from "@/components/tessellate/Preview3D";
import {
  BOX_TYPES,
  defaultDimensionsMm,
  type BoxType,
} from "@/lib/constants/boxTypes";

type GenResp = {
  success: boolean;
  dielineBase64?: string;
  cleanTextureBase64?: string;
  designNotes?: string;
  colorPalette?: string[];
  processingTime?: number;
  source?: string;
  message?: string;
};

type ConvResp = {
  success: boolean;
  gltfBase64?: string;
  previewBase64?: string;
  downloadUrl?: string;
  metadata?: Record<string, unknown>;
  message?: string;
};

const BOX_TYPE_LABELS: Record<BoxType, string> = {
  vertical_box: "Vertical box",
  horizontal_box: "Horizontal box",
  bottle: "Bottle packaging box",
  cake_box: "Cake box",
  trapezoid: "Trapezoid",
};

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

function downloadBase64(base64: string, filename: string, mime: string): void {
  const link = document.createElement("a");
  link.href = `data:${mime};base64,${base64}`;
  link.download = filename;
  link.click();
}

// ─── Shared input class ───────────────────────────────────────────────────────
const inputCls =
  "w-full rounded-md border border-black bg-white px-3 py-2 text-black outline-none " +
  "ring-yellow-400/40 placeholder:text-black/55 focus:border-black focus:ring-2 transition " +
  "hover:border-black/70 hover:shadow-sm";

export function TessellateApp() {
  const [businessName, setBusinessName] = useState("");
  const [tagline, setTagline] = useState("");
  const [description, setDescription] = useState("");
  const [boxType, setBoxType] = useState<BoxType>("vertical_box");
  const [style, setStyle] = useState("minimalist");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [bgFile, setBgFile] = useState<File | null>(null);
  const [bgBase64, setBgBase64] = useState<string | null>(null);
  const [bgObjectUrl, setBgObjectUrl] = useState<string | null>(null);
  const [dims, setDims] = useState(() => defaultDimensionsMm("vertical_box"));
  const [useCustomDims, setUseCustomDims] = useState(false);

  const [dielineBase64, setDielineBase64] = useState<string | null>(null);
  const [cleanTextureBase64, setCleanTextureBase64] = useState<string | null>(null);
  const [designNotes, setDesignNotes] = useState<string | null>(null);
  const [gltfBase64, setGltfBase64] = useState<string | null>(null);
  const [previewBase64, setPreviewBase64] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const [busy, setBusy] = useState<null | "dieline" | "convert">(null);
  const [error, setError] = useState<string | null>(null);

  const syncDimsForBox = useCallback((bt: BoxType) => setDims(defaultDimensionsMm(bt)), []);

  const fileToBase64 = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const res = r.result;
        if (typeof res === "string") {
          const i = res.indexOf("base64,");
          resolve(i >= 0 ? res.slice(i + 7) : res);
        } else reject(new Error("read failed"));
      };
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });

  const handleGenerateDieline = async () => {
    setError(null);
    setBusy("dieline");
    try {
      let logoBase64: string | undefined;
      if (logoFile) logoBase64 = await fileToBase64(logoFile);
      const out = await postJson<GenResp>("/api/generate-dieline", {
        businessName,
        tagline,
        printDescription: description,
        boxType,
        style,
        ...(logoBase64 ? { logoBase64 } : {}),
        ...(useCustomDims ? { customDimensions: { ...dims, unit: "mm" } } : {}),
      });
      if (!out.success || !out.dielineBase64) throw new Error(out.message ?? "Dieline generation failed");
      setDielineBase64(out.dielineBase64);
      setCleanTextureBase64(out.cleanTextureBase64 ?? out.dielineBase64);
      setDesignNotes(out.designNotes ?? null);
      setGltfBase64(null);
      setPreviewBase64(null);
      setDownloadUrl(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(null);
    }
  };

  const handleConvert = async () => {
    if (!dielineBase64) { setError("Generate a dieline first."); return; }
    setError(null);
    setBusy("convert");
    try {
      const out = await postJson<ConvResp>("/api/convert-to-3d", {
        dielineBase64: cleanTextureBase64 ?? dielineBase64,
        boxType,
        ...(bgBase64 ? { backgroundBase64: bgBase64 } : {}),
        ...(useCustomDims ? { customDimensions: dims } : {}),
        lightingIntensity: 1.5,
      });
      if (!out.success || !out.gltfBase64) throw new Error(out.message ?? "Conversion failed");
      setGltfBase64(out.gltfBase64);
      setPreviewBase64(out.previewBase64 ?? null);
      setDownloadUrl(out.downloadUrl ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(null);
    }
  };

  const handleBgUpload = async (file: File | null) => {
    // Revoke previous blob URL to avoid memory leaks
    if (bgObjectUrl) URL.revokeObjectURL(bgObjectUrl);
    setBgFile(file);
    setBgBase64(null);
    setBgObjectUrl(null);
    if (!file) return;

    // Create an immediate local blob URL for the 3D viewer (no server round-trip)
    setBgObjectUrl(URL.createObjectURL(file));

    // Also upload to server so the GLB backdrop quad uses a processed copy
    const fd = new FormData();
    fd.set("file", file);
    const res = await fetch("/api/upload-background", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error((data as { message?: string }).message ?? "Upload failed");
    setBgBase64((data as { backgroundBase64: string }).backgroundBase64);
  };

  return (
    <div className="flex min-h-full flex-col">

      {/* ── COVER HERO ─────────────────────────────────────────────────────── */}
      <div className="relative w-full overflow-hidden bg-black" style={{ minHeight: "350px" }}>
        {/* Background image fills the hero */}
        <Image
          src="/dieline-cover.png"
          alt="Tessellate packaging dieline reference"
          fill
          priority
          unoptimized
          className="object-cover object-center"
          style={{ opacity: 0.18, filter: "grayscale(1) contrast(1.25)" }}
        />
        {/* Gradient overlay so text is legible */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(135deg, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.82) 55%, rgba(255,212,0,0.48) 100%)",
          }}
        />
        {/* Hero content */}
        <div className="relative z-10 mx-auto flex max-w-6xl flex-col justify-center gap-5 px-6 py-16 sm:py-20">
          {/* wordmark */}
          <div className="flex items-center gap-3">
            <span
              className="rounded-md border border-black px-2.5 py-1 text-xs font-bold uppercase tracking-widest"
              style={{ background: "var(--ts-yellow)", color: "var(--ts-black)" }}
            >
              tessellate
            </span>
            <span className="text-xs font-medium uppercase tracking-widest text-white/60">
              2D → 3D Packaging Studio
            </span>
          </div>
          <h1
            className="max-w-2xl text-balance text-4xl font-semibold leading-tight tracking-tight text-white sm:text-5xl"
          >
            Turn flat packaging dielines into stunning 3D mockups
          </h1>
          <p className="mb-32 max-w-xl pb-8 text-lg leading-relaxed text-white/80">
            Generate AI-powered packaging artwork, fold it into an interactive 3D
            preview, and export a Blender-ready&nbsp;GLB file - in seconds.
          </p>
          {/* feature pills */}
          <div className="flex flex-wrap gap-2">
            {[
              "AI dieline generation",
              "6 box templates",
              "Interactive 3D preview",
              "GLB / PNG / JSON export",
            ].map((f) => (
              <span
                key={f}
                className="rounded-full px-3 py-1 text-xs font-medium"
                style={{ background: "rgba(255,255,255,0.12)", color: "var(--ts-white)", border: "1px solid var(--ts-white)" }}
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── MAIN WORKSPACE ──────────────────────────────────────────────────── */}
      <div
        className="flex-1 border-t-4 border-yellow-400 px-4 py-10 sm:px-6"
        style={{ background: "var(--ts-bg)" }}
      >
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">

            {/* ── Left: Input form ── */}
            <section
              className="space-y-5 rounded-lg p-6"
              style={{
                background: "var(--ts-surface)",
                border: "2px solid var(--ts-border)",
              }}
            >
              <h2
                className="text-base font-semibold uppercase tracking-wider"
                style={{ color: "var(--ts-black)" }}
              >
                Design input
              </h2>

              <label className="block space-y-1.5 group">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium" style={{ color: "var(--ts-text)" }}>Business name</span>
                  <span className="text-xs opacity-0 group-hover:opacity-100 transition" style={{ color: "var(--ts-text-muted)" }} title="Your brand name will appear on the packaging">ℹ️</span>
                </div>
                <input
                  className={inputCls}
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="Acme Studio"
                />
              </label>

              <label className="block space-y-1.5 group">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium" style={{ color: "var(--ts-text)" }}>Tagline</span>
                  <span className="text-xs opacity-0 group-hover:opacity-100 transition" style={{ color: "var(--ts-text-muted)" }} title="A memorable phrase or slogan for your brand">ℹ️</span>
                </div>
                <input
                  className={inputCls}
                  value={tagline}
                  onChange={(e) => setTagline(e.target.value)}
                  placeholder="Made for slow mornings"
                />
              </label>

              <label className="block space-y-1.5 group">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium" style={{ color: "var(--ts-text)" }}>Creative direction</span>
                  <span className="text-xs opacity-0 group-hover:opacity-100 transition" style={{ color: "var(--ts-text-muted)" }} title="Describe the visual style, colors, and overall aesthetic">ℹ️</span>
                </div>
                <textarea
                  rows={4}
                  className={inputCls + " resize-y"}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Minimal kraft packaging with botanical line art and soft matte finish."
                />
              </label>

              <label className="block space-y-1.5 group">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium" style={{ color: "var(--ts-text)" }}>Box template</span>
                  <span className="text-xs opacity-0 group-hover:opacity-100 transition" style={{ color: "var(--ts-text-muted)" }} title="Choose the packaging shape that matches your product">ℹ️</span>
                </div>
                <select
                  className={inputCls}
                  value={boxType}
                  onChange={(e) => {
                    const v = e.target.value as BoxType;
                    setBoxType(v);
                    syncDimsForBox(v);
                  }}
                >
                  {BOX_TYPES.map((t) => (
                    <option key={t} value={t}>{BOX_TYPE_LABELS[t]}</option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1.5 group">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium" style={{ color: "var(--ts-text)" }}>Style hint</span>
                  <span className="text-xs font-normal opacity-60">optional</span>
                  <span className="text-xs opacity-0 group-hover:opacity-100 transition" style={{ color: "var(--ts-text-muted)" }} title="Suggest an aesthetic direction: minimalist, luxury, playful, elegant, etc.">ℹ️</span>
                </div>
                <input
                  className={inputCls}
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  placeholder="minimalist, luxury, playful…"
                />
              </label>

              <div className="space-y-1.5 group">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium" style={{ color: "var(--ts-text)" }}>Logo</span>
                  <span className="text-xs font-normal opacity-60">optional</span>
                  <span className="text-xs opacity-0 group-hover:opacity-100 transition" style={{ color: "var(--ts-text-muted)" }} title="Upload your brand logo to include in the design">ℹ️</span>
                </div>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="block w-full text-sm file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-black file:bg-yellow-400 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-black file:transition file:hover:shadow-md file:hover:bg-yellow-300"
                  style={{ color: "var(--ts-text-muted)" }}
                  onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
                />
                {logoFile && (
                  <p className="text-xs" style={{ color: "var(--ts-text-muted)" }}>
                    <span>✓ Uploaded: {logoFile.name}</span>
                  </p>
                )}
              </div>

              {/* Custom dims toggle */}
              <label className="flex cursor-pointer items-center gap-2.5 text-sm group transition hover:opacity-80" style={{ color: "var(--ts-text)" }}>
                <input
                  type="checkbox"
                  checked={useCustomDims}
                  onChange={(e) => setUseCustomDims(e.target.checked)}
                  className="size-4 rounded cursor-pointer"
                  style={{ accentColor: "var(--ts-yellow)" }}
                />
                Custom dimensions (mm)
                <span className="text-xs opacity-0 group-hover:opacity-100 transition" style={{ color: "var(--ts-text-muted)" }} title="Override default dimensions with custom measurements">ℹ️</span>
              </label>

              {useCustomDims && (
                <div className="grid grid-cols-3 gap-3">
                  {(["width", "height", "depth"] as const).map((key) => (
                    <label key={key} className="space-y-1 text-xs uppercase tracking-wide" style={{ color: "var(--ts-text-muted)" }}>
                      <span className="block">{key}</span>
                      <input
                        type="number"
                        min={1}
                        className="w-full rounded-lg border px-2 py-1.5 text-sm"
                        style={{ borderColor: "var(--ts-border)", background: "var(--ts-white)", color: "var(--ts-text)" }}
                        value={dims[key]}
                        onChange={(e) => setDims((d) => ({ ...d, [key]: Number(e.target.value) || 1 }))}
                      />
                    </label>
                  ))}
                </div>
              )}

              <div className="space-y-1.5 group">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium" style={{ color: "var(--ts-text)" }}>
                    360° Panorama background
                  </span>
                  <span className="text-xs opacity-0 group-hover:opacity-100 transition" style={{ color: "var(--ts-text-muted)" }} title="Create a full-environment effect for your 3D model">ℹ️</span>
                </div>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="block w-full text-sm file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-black file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-black file:transition file:hover:shadow-md file:hover:bg-gray-50"
                  style={{ color: "var(--ts-text-muted)" }}
                  onChange={async (e) => {
                    try { await handleBgUpload(e.target.files?.[0] ?? null); }
                    catch (err) { setError(err instanceof Error ? err.message : "Upload failed"); }
                  }}
                />
                {bgFile && (
                  <p className="text-xs" style={{ color: "var(--ts-text-muted)" }}>
                    {bgFile.name}
                    {bgObjectUrl && (
                      <span
                        className="ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                        style={{ background: "var(--ts-yellow)", color: "var(--ts-black)" }}
                      >
                        360° active
                      </span>
                    )}
                  </p>
                )}
                <p className="text-[11px] leading-snug" style={{ color: "var(--ts-text-muted)" }}>
                  Upload an equirectangular panorama (2:1 ratio) for a full 360° environment.
                  Any image works but a panorama looks best.
                </p>
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap gap-3 pt-3">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void handleGenerateDieline()}
                  className="rounded-md border border-black px-5 py-2.5 text-sm font-semibold text-black transition disabled:opacity-50 hover:shadow-md hover:scale-105 active:scale-95"
                  style={{ background: "var(--ts-yellow)" }}
                >
                  {busy === "dieline" ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-block h-3 w-3 rounded-full border-2 border-black border-r-transparent animate-spin" />
                      Generating…
                    </span>
                  ) : (
                    "Generate dieline"
                  )}
                </button>
                <button
                  type="button"
                  disabled={busy !== null || !dielineBase64}
                  onClick={() => void handleConvert()}
                  className="rounded-md px-5 py-2.5 text-sm font-semibold transition disabled:opacity-50 hover:shadow-md hover:scale-105 active:scale-95"
                  style={{ background: "var(--ts-surface-alt)", border: "1px solid var(--ts-border)", color: "var(--ts-text)" }}
                >
                  {busy === "convert" ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-block h-3 w-3 rounded-full border-2 border-black border-r-transparent animate-spin" />
                      Building 3D…
                    </span>
                  ) : (
                    "Convert to 3D"
                  )}
                </button>
              </div>

              {error && (
                <div
                  className="rounded-md px-3 py-2.5 text-sm"
                  style={{ background: "var(--ts-yellow)", border: "1px solid var(--ts-black)", color: "var(--ts-black)" }}
                >
                  {error}
                </div>
              )}
            </section>

            {/* ── Right: Output panels ── */}
            <section className="flex flex-col gap-6">

              {/* 2D Dieline */}
              <div
                className="rounded-lg p-5"
                style={{ background: "var(--ts-surface)", border: "2px solid var(--ts-border)" }}
              >
                <h2
                  className="mb-3 text-base font-semibold uppercase tracking-wider"
                  style={{ color: "var(--ts-black)" }}
                >
                  2D Dieline
                </h2>
                {dielineBase64 ? (
                  <Image
                    src={`data:image/png;base64,${dielineBase64}`}
                    alt="Generated packaging dieline"
                    width={2048}
                    height={2048}
                    unoptimized
                    className="w-full rounded-md object-contain"
                    style={{ maxHeight: "350px", border: "1px solid var(--ts-border)" }}
                  />
                ) : (
                  <div
                    className="flex h-48 items-center justify-center rounded-md text-sm"
                    style={{ border: "1.5px dashed var(--ts-border)", color: "var(--ts-text-muted)" }}
                  >
                    Generated artwork appears here
                  </div>
                )}
                {designNotes && (
                  <p className="mt-2.5 text-sm leading-relaxed" style={{ color: "var(--ts-text-muted)" }}>
                    {designNotes}
                  </p>
                )}
              </div>

              {/* 3D Preview */}
              <div
                className="rounded-lg p-5"
                style={{ background: "var(--ts-surface)", border: "2px solid var(--ts-border)" }}
              >
                <h2
                  className="mb-3 text-base font-semibold uppercase tracking-wider"
                  style={{ color: "var(--ts-black)" }}
                >
                  3D Preview
                </h2>
                <Preview3D
                  glbBase64={gltfBase64}
                  bgUrl={bgObjectUrl}
                  emptyLabel="Convert to 3D to load the interactive preview"
                />
              </div>

              {/* Export */}
              <div
                className="rounded-lg p-5"
                style={{ background: "var(--ts-surface)", border: "2px solid var(--ts-border)" }}
              >
                <h2
                  className="mb-4 text-base font-semibold uppercase tracking-wider"
                  style={{ color: "var(--ts-black)" }}
                >
                  Export Assets
                </h2>
                {!gltfBase64 && (
                  <p className="text-xs mb-4 p-3 rounded-md" style={{ color: "var(--ts-text-muted)", background: "rgba(255, 212, 0, 0.1)" }}>
                    💡 Convert your design to 3D to enable downloads
                  </p>
                )}
                <div className="grid gap-3 sm:grid-cols-3">
                  <button
                    type="button"
                    disabled={!gltfBase64}
                    onClick={() => gltfBase64 && downloadBase64(gltfBase64, "tessellate-mockup.glb", "model/gltf-binary")}
                    className="rounded-md px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-40 hover:shadow-lg hover:scale-105 active:scale-95"
                    style={{ background: "var(--ts-black)" }}
                    title="Download 3D model for Blender or other 3D software"
                  >
                    <span className="block">Download</span>
                    <span className="block text-xs font-normal opacity-80">.glb (3D model)</span>
                  </button>
                  <button
                    type="button"
                    disabled={!previewBase64}
                    onClick={() => previewBase64 && downloadBase64(previewBase64, "tessellate-preview.png", "image/png")}
                    className="rounded-md px-4 py-3 text-sm font-semibold transition disabled:opacity-40 hover:shadow-lg hover:scale-105 active:scale-95"
                    style={{ border: "1px solid var(--ts-border)", background: "var(--ts-surface-alt)", color: "var(--ts-text)" }}
                    title="Download a high-resolution preview image"
                  >
                    <span className="block">Download</span>
                    <span className="block text-xs font-normal opacity-80">.png (image)</span>
                  </button>
                  <a
                    href={downloadUrl ? `${downloadUrl}?format=json` : undefined}
                    className="inline-flex flex-col items-center justify-center rounded-md px-4 py-3 text-sm font-semibold transition"
                    style={{
                      border: "1px solid var(--ts-border)",
                      background: "var(--ts-surface-alt)",
                      color: "var(--ts-text)",
                      opacity: downloadUrl ? 1 : 0.4,
                      pointerEvents: downloadUrl ? "auto" : "none",
                    }}
                    title="Download metadata and configuration"
                  >
                    <span className="block">Download</span>
                    <span className="block text-xs font-normal opacity-80">.json (metadata)</span>
                  </a>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>

      {/* ── FOOTER ──────────────────────────────────────────────────────────── */}
      <footer
        className="py-5 text-center text-xs"
        style={{ background: "var(--ts-black)", color: "var(--ts-white)" }}
      >
        tessellate - 2D to 3D Packaging Studio &nbsp;·&nbsp; Powered by Claude
      </footer>
    </div>
  );
}
