import { NextResponse } from "next/server";
import { generatePanelSchema } from "@/lib/validation/schemas";
import { generateSpotEditPatch } from "@/lib/server/spotEditClaude";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "INVALID_INPUT", message: "Request body must be JSON", statusCode: 400 },
      { status: 400 },
    );
  }

  const parsed = generatePanelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: "INVALID_INPUT",
        message: parsed.error.issues[0]?.message ?? "Invalid request",
        statusCode: 400,
      },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const patch = await generateSpotEditPatch({
    panelImageBase64: "",
    panelSVGSource: `<g id="panel-${data.panelId}-content"></g>`,
    selectedElementIds: [],
    boxType: data.boxType,
    panelName: data.panelId,
    brandContext: data.brand,
    prompt: data.prompt,
  });

  return NextResponse.json({
    success: true,
    operations: patch.operations,
    description: patch.description,
  });
}
