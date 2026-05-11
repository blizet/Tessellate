import { NextResponse } from "next/server";
import { spotEditSchema } from "@/lib/validation/schemas";
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

  const parsed = spotEditSchema.safeParse(body);
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

  const patch = await generateSpotEditPatch(parsed.data);
  return NextResponse.json({
    success: true,
    ...patch,
  });
}
