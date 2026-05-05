import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { generateDielineSchema } from "@/lib/validation/schemas";
import { generateDielineImage } from "@/lib/server/geminiDieline";
import { parseOptionalBase64Image } from "@/lib/server/base64";
import { defaultDimensionsMm } from "@/lib/constants/boxTypes";

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

  const parsed = generateDielineSchema.safeParse(body);
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
  const logoBuffer = parseOptionalBase64Image(data.logoBase64);

  try {
    const out = await generateDielineImage({
      businessName: data.businessName,
      tagline: data.tagline,
      printDescription: data.printDescription,
      boxType: data.boxType,
      style: data.style,
      logoBuffer,
      dims: data.customDimensions,
    });

    const id = randomUUID();
    const dielinePath = `uploads/dieline_${id}.png`;

    return NextResponse.json({
      success: true,
      dielinePath,
      dielineBase64: out.pngBuffer.toString("base64"),
      designNotes: out.designNotes,
      colorPalette: out.colorPalette,
      generatedAt: new Date().toISOString(),
      processingTime: (Date.now() - t0) / 1000,
      dimensionsUsed: data.customDimensions ?? defaultDimensionsMm(data.boxType),
      source: out.source,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Generation failed";
    const unauthorized =
      /401|API key|PERMISSION|denied/i.test(message) ||
      message.toLowerCase().includes("unauthorized");
    return NextResponse.json(
      {
        success: false,
        error: unauthorized ? "GEMINI_API_ERROR" : "GENERATION_FAILED",
        message: unauthorized ? "Invalid or missing Gemini API key" : message,
        statusCode: unauthorized ? 401 : 500,
      },
      { status: unauthorized ? 401 : 500 },
    );
  }
}
