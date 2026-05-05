import { NextResponse } from "next/server";
import sharp from "sharp";

export const runtime = "nodejs";

const MAX_BYTES = 50 * 1024 * 1024;

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "INVALID_INPUT",
        message: "Expected multipart form data",
        statusCode: 400,
      },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json(
      {
        success: false,
        error: "INVALID_INPUT",
        message: "Missing file field",
        statusCode: 400,
      },
      { status: 400 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        success: false,
        error: "FILE_TOO_LARGE",
        message: "File exceeds maximum size of 50MB",
        statusCode: 413,
      },
      { status: 413 },
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  let pngBuf: Buffer;
  try {
    pngBuf = await sharp(buf).ensureAlpha().png().toBuffer();
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "INVALID_INPUT",
        message: "Could not decode image",
        statusCode: 400,
      },
      { status: 400 },
    );
  }

  const meta = await sharp(pngBuf).metadata();

  return NextResponse.json({
    success: true,
    backgroundPath: "uploads/backgrounds/bg_upload.png",
    backgroundBase64: pngBuf.toString("base64"),
    fileSize: pngBuf.length,
    dimensions: {
      width: meta.width ?? 0,
      height: meta.height ?? 0,
    },
    uploadedAt: new Date().toISOString(),
  });
}
