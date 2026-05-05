import { NextResponse } from "next/server";
import { convertTo3dSchema } from "@/lib/validation/schemas";
import { parseOptionalBase64Image } from "@/lib/server/base64";
import { defaultDimensionsMm } from "@/lib/constants/boxTypes";
import { buildGlbFromDieline } from "@/lib/server/buildGlb";
import { saveExport } from "@/lib/server/fileStore";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const t0 = Date.now();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "INVALID_INPUT",
        message: "Request body must be JSON",
        statusCode: 400,
      },
      { status: 400 },
    );
  }

  const parsed = convertTo3dSchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Invalid input";
    return NextResponse.json(
      {
        success: false,
        error: "INVALID_INPUT",
        message: msg,
        statusCode: 400,
      },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const dielineBuf = parseOptionalBase64Image(data.dielineBase64);
  if (!dielineBuf) {
    return NextResponse.json(
      {
        success: false,
        error: "INVALID_INPUT",
        message: "dielineBase64 is invalid",
        statusCode: 400,
      },
      { status: 400 },
    );
  }

  const bgBuf = parseOptionalBase64Image(data.backgroundBase64);

  const dims = data.customDimensions ?? defaultDimensionsMm(data.boxType);
  const lightingIntensity = data.lightingIntensity ?? 1.5;

  try {
    const built = await buildGlbFromDieline({
      dielineBuffer: dielineBuf,
      backgroundBuffer: bgBuf,
      boxType: data.boxType,
      dimensionsMm: dims,
      lightingIntensity,
    });

    const metadata = {
      boxType: data.boxType,
      dimensions: { ...dims, unit: "mm" as const },
      textureResolution: 2048,
      lightingSetup: "key_light_and_ambient",
      backgroundType: bgBuf ? "uploaded_image" : "solid",
      materialsCount: built.materialsCount,
      trianglesCount: built.trianglesCount,
      fileSize: built.glb.length,
      generatedAt: new Date().toISOString(),
      processingTime: (Date.now() - t0) / 1000,
    };

    const fileId = saveExport({
      glb: built.glb,
      png: built.previewPng,
      meta: metadata,
    });

    return NextResponse.json({
      success: true,
      gltfPath: `uploads/exports/mockup_${fileId}.glb`,
      gltfBase64: built.glb.toString("base64"),
      previewBase64: built.previewPng.toString("base64"),
      metadata,
      downloadUrl: `/api/download/${fileId}`,
    });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to apply textures to 3D model";
    return NextResponse.json(
      {
        success: false,
        error: "CONVERSION_FAILED",
        message,
        statusCode: 500,
      },
      { status: 500 },
    );
  }
}
