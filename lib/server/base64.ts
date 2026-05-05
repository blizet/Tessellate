export function parseOptionalBase64Image(data?: string | null): Buffer | null {
  if (!data?.trim()) return null;
  const trimmed = data.trim();
  const dataUrl = /^data:image\/[^;]+;base64,(.+)$/i.exec(trimmed);
  const raw = dataUrl ? dataUrl[1] : trimmed;
  try {
    const buf = Buffer.from(raw, "base64");
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}
